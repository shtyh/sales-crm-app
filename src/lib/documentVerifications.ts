// Data layer for the document-verification flow (Phase C–E).
//
// The SA uploads a document image to Storage under
//   document-verification/{user_id}/{doc_type}-{timestamp}.{ext}
// then invokes the matching edge function (extract-all-in-one /
// extract-down-payment / extract-lou). The edge function reads the image with
// Gemini, inserts a document_verifications row, and the DB-side trigger
// (recompute_booking_documents) rolls the result up onto the booking. Finance
// Admin reviews on /finance: approve/reject the All-In-One, confirm the LOU
// loan amount. Every review is a plain UPDATE on document_verifications — the
// same trigger re-derives the booking status + unlocks commission.

import { supabase } from './supabase'
import type {
  DocumentType,
  DocumentVerification,
  DocumentVerificationRow,
} from './types'

const BUCKET = 'booking-files'

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024
export const ALLOWED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/heic',
  'image/heif',
])

const EDGE_FN: Record<DocumentType, string> = {
  all_in_one: 'extract-all-in-one',
  down_payment: 'extract-down-payment',
  lou: 'extract-lou',
}

function extOf(file: File): string {
  const fromName = file.name.toLowerCase().split('.').pop() ?? ''
  if (['jpg', 'jpeg', 'png', 'heic', 'heif'].includes(fromName)) {
    return fromName === 'jpg' ? 'jpeg' : fromName
  }
  if (file.type === 'image/png') return 'png'
  if (file.type === 'image/heic' || file.type === 'image/heif') return 'heic'
  return 'jpeg'
}

export type UploadAndExtractResult = {
  document_verification_id: string
  extracted: Record<string, unknown>
  file_path: string
}

/** Upload the image, then invoke the matching extractor edge function. The
 *  edge function inserts the document_verifications row server-side (and the
 *  trigger updates the booking) — the FE only needs to refetch afterwards. */
export async function uploadAndExtractDocument(params: {
  userId: string
  bookingId: string
  documentType: DocumentType
  file: File
}): Promise<UploadAndExtractResult> {
  const { userId, bookingId, documentType, file } = params
  if (!ALLOWED_MIME_TYPES.has(file.type)) {
    throw new Error('Unsupported file type. Use JPEG, PNG, or HEIC.')
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    throw new Error('File too large. Max 10 MB.')
  }

  const ext = extOf(file)
  const path = `document-verification/${userId}/${documentType}-${Date.now()}.${ext}`

  const { error: upErr } = await supabase.storage
    .from(BUCKET)
    .upload(path, file, {
      contentType: file.type || 'application/octet-stream',
      upsert: false,
    })
  if (upErr) throw upErr

  const { data, error } = await supabase.functions.invoke(EDGE_FN[documentType], {
    body: { file_path: path, booking_id: bookingId },
  })
  if (error) throw error
  return data as UploadAndExtractResult
}

const JOINED_SELECT = `
  *,
  booking:bookings(code, customer_name, vehicle_model, payment_type, owner_id),
  uploader:profiles!document_verifications_uploaded_by_fkey(full_name)
`

type JoinedBooking =
  | { code: string | null; customer_name: string | null; vehicle_model: string | null; payment_type: DocumentVerificationRow['booking_payment_type']; owner_id: string | null }
  | Array<{ code: string | null; customer_name: string | null; vehicle_model: string | null; payment_type: DocumentVerificationRow['booking_payment_type']; owner_id: string | null }>
  | null
type JoinedUploader =
  | { full_name: string | null }
  | Array<{ full_name: string | null }>
  | null

function pickFirst<T>(v: T | T[] | null): T | null {
  if (v == null) return null
  return Array.isArray(v) ? (v[0] ?? null) : v
}

function normalise(
  row: DocumentVerification & { booking: JoinedBooking; uploader: JoinedUploader },
): DocumentVerificationRow {
  const b = pickFirst(row.booking)
  const u = pickFirst(row.uploader)
  return {
    ...row,
    booking_code: b?.code ?? null,
    booking_customer_name: b?.customer_name ?? null,
    booking_model: b?.vehicle_model ?? null,
    booking_payment_type: b?.payment_type ?? null,
    uploader_name: u?.full_name ?? null,
  }
}

/** Every verification the caller can see (RLS scopes it). Newest first. */
export async function listDocumentVerifications(): Promise<DocumentVerificationRow[]> {
  const { data, error } = await supabase
    .from('document_verifications')
    .select(JOINED_SELECT)
    .order('created_at', { ascending: false })
  if (error) throw error
  return ((data as unknown as Parameters<typeof normalise>[0][]) ?? []).map(normalise)
}

/** Verifications for one booking — used on the booking detail page. */
export async function listDocumentVerificationsForBooking(
  bookingId: string,
): Promise<DocumentVerificationRow[]> {
  const { data, error } = await supabase
    .from('document_verifications')
    .select(JOINED_SELECT)
    .eq('booking_id', bookingId)
    .order('created_at', { ascending: false })
  if (error) throw error
  return ((data as unknown as Parameters<typeof normalise>[0][]) ?? []).map(normalise)
}

// ── Finance-admin review mutations (plain UPDATEs; the trigger recomputes) ──

export async function approveAllInOne(id: string): Promise<void> {
  const { error } = await supabase
    .from('document_verifications')
    .update({ verification_status: 'approved', rejection_reason: null })
    .eq('id', id)
  if (error) throw error
}

export async function rejectAllInOne(id: string, reason: string): Promise<void> {
  const { error } = await supabase
    .from('document_verifications')
    .update({ verification_status: 'rejected', rejection_reason: reason.trim() || 'Rejected.' })
    .eq('id', id)
  if (error) throw error
}

/** FA confirms the LOU loan amount. We flag whether it matches the extracted
 *  amount within RM1 for the record; confirming is what flips lou → verified. */
export async function confirmLou(params: {
  id: string
  userId: string
  loanAmount: number
  extractedLoanAmount: number | null
  notes?: string
}): Promise<void> {
  const { id, userId, loanAmount, extractedLoanAmount, notes } = params
  const match =
    extractedLoanAmount != null
      ? Math.abs(loanAmount - extractedLoanAmount) <= 1
      : null
  const { error } = await supabase
    .from('document_verifications')
    .update({
      finance_admin_loan_amount: loanAmount,
      finance_admin_confirmed: true,
      finance_admin_confirmed_by: userId,
      finance_admin_confirmed_at: new Date().toISOString(),
      finance_admin_notes: notes?.trim() || null,
      gemini_match: match,
      verification_status: 'approved',
    })
    .eq('id', id)
  if (error) throw error
}

/** Force a re-check (recompute_booking_documents) for a booking — e.g. after
 *  finance edits the loan amount on the booking itself. */
export async function recheckBooking(bookingId: string): Promise<void> {
  const { error } = await supabase.rpc('check_booking_complete', {
    p_booking_id: bookingId,
  })
  if (error) throw error
}
