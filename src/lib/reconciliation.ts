// Data layer for the 3-way reconciliation feature.
//
// Three docs come into reconcile_booking():
//   • Bank statement (super_admin uploads PDF → extract-bank-statement
//     fills bank_statement_lines).
//   • LOU + Bank-in receipts (FA uploads via booking_attachments;
//     extract-document fills attachment_extractions).
//   • All-In-One (SA uploads via /commission-verify).
//
// This module just exposes the FE-facing operations: upload a statement,
// kick off extraction, list reconciliations, fetch detail, force-run
// reconcile.

import { supabase } from './supabase'
import type {
  AttachmentExtraction,
  BankStatement,
  BookingReconciliation,
  BookingReconciliationRow,
} from './types'

const BUCKET = 'booking-files'

// ----- Statement upload + extract ----------------------------------------

export const MAX_STATEMENT_BYTES = 20 * 1024 * 1024
export const STATEMENT_ALLOWED_MIME = new Set([
  'application/pdf',
])

export async function uploadAndExtractStatement(
  userId: string,
  file: File,
): Promise<{ statement: BankStatement; lines_inserted: number }> {
  if (!STATEMENT_ALLOWED_MIME.has(file.type) && !file.name.toLowerCase().endsWith('.pdf')) {
    throw new Error('Bank statement must be a PDF.')
  }
  if (file.size > MAX_STATEMENT_BYTES) {
    throw new Error('File too large. Max 20 MB.')
  }

  const path = `statements/${userId}/${Date.now()}.pdf`

  const { error: uploadErr } = await supabase.storage
    .from(BUCKET)
    .upload(path, file, {
      contentType: 'application/pdf',
      upsert: false,
    })
  if (uploadErr) throw uploadErr

  const { data: inserted, error: insertErr } = await supabase
    .from('bank_statements')
    .insert({ uploaded_by: userId, file_path: path })
    .select('*')
    .single()
  if (insertErr) {
    await supabase.storage.from(BUCKET).remove([path])
    throw insertErr
  }
  const statement = inserted as BankStatement

  const { data: extractRes, error: extractErr } = await supabase.functions.invoke(
    'extract-bank-statement',
    {
      body: { file_path: path, statement_id: statement.id },
    },
  )
  if (extractErr) {
    // Statement row + storage object stay around so the user can retry,
    // but surface the failure to the UI.
    throw extractErr
  }
  const lines = (extractRes as { lines_inserted?: number } | null)?.lines_inserted ?? 0
  return { statement, lines_inserted: lines }
}

export async function listStatements(): Promise<BankStatement[]> {
  const { data, error } = await supabase
    .from('bank_statements')
    .select('*')
    .order('uploaded_at', { ascending: false })
  if (error) throw error
  return (data as BankStatement[]) ?? []
}

// ----- Attachment extraction (LOU + bank-in) ------------------------------

/** Fire-and-forget Gemini extraction for a freshly uploaded attachment.
 *  Errors are swallowed in the FE — the underlying call writes failures to
 *  audit_log, and the reconciliation queue just shows "missing" for the
 *  affected doc. Caller can re-run by re-uploading. */
export async function extractAttachmentInBackground(attachmentId: string): Promise<void> {
  try {
    await supabase.functions.invoke('extract-document', {
      body: { attachment_id: attachmentId },
    })
  } catch (_err) {
    // No-op — reconciliation status will reflect the missing extraction.
  }
}

export async function extractAttachment(
  attachmentId: string,
): Promise<AttachmentExtraction> {
  const { data, error } = await supabase.functions.invoke('extract-document', {
    body: { attachment_id: attachmentId },
  })
  if (error) throw error
  const extraction = (data as { extraction?: AttachmentExtraction } | null)?.extraction
  if (!extraction) throw new Error('Extraction failed')
  return extraction
}

// ----- Reconciliation list + detail --------------------------------------

export async function listReconciliations(): Promise<BookingReconciliationRow[]> {
  const { data, error } = await supabase
    .from('booking_reconciliations')
    .select(
      `
        id,
        booking_id,
        status,
        all_in_one_id,
        lou_extraction_id,
        bankin_extraction_id,
        statement_line_id,
        details,
        updated_at,
        booking:bookings(
          code, customer_name, vehicle_model,
          booking_fee, loan_amount, commission_amount, otr_price
        )
      `,
    )
    .order('updated_at', { ascending: false })

  if (error) throw error

  type Joined = BookingReconciliation & {
    booking:
      | {
          code: string
          customer_name: string
          vehicle_model: string
          booking_fee: number
          loan_amount: number | null
          commission_amount: number | null
          otr_price: number
        }
      | Array<{
          code: string
          customer_name: string
          vehicle_model: string
          booking_fee: number
          loan_amount: number | null
          commission_amount: number | null
          otr_price: number
        }>
      | null
  }

  function pickFirst<T>(v: T | T[] | null): T | null {
    if (v == null) return null
    return Array.isArray(v) ? (v[0] ?? null) : v
  }

  return ((data as unknown as Joined[] | null) ?? []).map((row) => {
    const b = pickFirst(row.booking)
    return {
      ...row,
      booking_code: b?.code ?? '—',
      customer_name: b?.customer_name ?? '—',
      vehicle_model: b?.vehicle_model ?? '—',
      booking_fee: b?.booking_fee ?? 0,
      loan_amount: b?.loan_amount ?? null,
      commission_amount: b?.commission_amount ?? null,
      otr_price: b?.otr_price ?? 0,
    }
  })
}

export async function runReconcile(
  bookingId: string,
): Promise<BookingReconciliation | null> {
  const { data, error } = await supabase.rpc('reconcile_booking', {
    p_booking_id: bookingId,
  })
  if (error) throw error
  return (data as BookingReconciliation | null) ?? null
}
