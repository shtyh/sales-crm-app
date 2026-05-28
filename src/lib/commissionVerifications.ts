// Data layer for the commission-verification flow.
//
// The frontend uploads an image to Storage under
//   commission/{user_id}/{timestamp}.{ext}
// then asks the extract-allinone Edge Function (Gemini under the hood) to
// read the form. The user confirms the extracted fields and we persist a
// row into commission_verifications, finally calling
// match_commission_verification() to auto-link to a booking + diff the
// commission amount.

import { supabase } from './supabase'
import type {
  CommissionVerification,
  CommissionVerificationRow,
  ExtractedAllInOne,
} from './types'

const BUCKET = 'booking-files'

/** 10 MB hard cap — same ceiling the Edge Function enforces. */
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024
export const ALLOWED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/heic',
  'image/heif',
])

function extOf(file: File): string {
  const fromName = file.name.toLowerCase().split('.').pop() ?? ''
  if (['jpg', 'jpeg', 'png', 'heic', 'heif'].includes(fromName)) {
    return fromName === 'jpg' ? 'jpeg' : fromName
  }
  if (file.type === 'image/png') return 'png'
  if (file.type === 'image/heic' || file.type === 'image/heif') return 'heic'
  return 'jpeg'
}

export type UploadFormResult = {
  file_path: string
}

/** Upload the image. The frontend never sends the file bytes to our Edge
 *  Function — only the storage path. */
export async function uploadAllInOneImage(
  userId: string,
  file: File,
): Promise<UploadFormResult> {
  if (!ALLOWED_MIME_TYPES.has(file.type)) {
    throw new Error('Unsupported file type. Use JPEG, PNG, or HEIC.')
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    throw new Error('File too large. Max 10 MB.')
  }

  const ext = extOf(file)
  const path = `commission/${userId}/${Date.now()}.${ext}`

  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(path, file, {
      contentType: file.type || 'application/octet-stream',
      upsert: false,
    })
  if (error) throw error
  return { file_path: path }
}

/** Call the extract-allinone Edge Function with the storage path. The
 *  function downloads the image server-side via the service role and
 *  returns the extracted JSON. */
export async function extractAllInOne(
  filePath: string,
): Promise<ExtractedAllInOne> {
  const { data, error } = await supabase.functions.invoke('extract-allinone', {
    body: { file_path: filePath },
  })
  if (error) throw error
  const extracted = (data as { extracted?: ExtractedAllInOne })?.extracted ?? {}
  return extracted
}

export type CreateVerificationInput = {
  uploaded_by: string
  image_path: string
  extracted: ExtractedAllInOne
}

function asNumberOrNull(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : null
}

function asDateOrNull(v: unknown): string | null {
  if (typeof v !== 'string') return null
  // Accept YYYY-MM-DD strictly; anything else stays null so PG doesn't reject
  // the insert with a vague error.
  return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null
}

function asStringOrNull(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const t = v.trim()
  return t === '' ? null : t
}

/** Insert a commission_verifications row from the (confirmed) extracted
 *  data and then run the match RPC. Returns the post-match row. */
export async function createVerification(
  input: CreateVerificationInput,
): Promise<CommissionVerification> {
  const e = input.extracted
  const { data: inserted, error: insertErr } = await supabase
    .from('commission_verifications')
    .insert({
      uploaded_by: input.uploaded_by,
      image_path: input.image_path,
      extracted_customer_name: asStringOrNull(e.customer_name),
      extracted_sa_name: asStringOrNull(e.sa_name),
      extracted_model: asStringOrNull(e.model),
      extracted_otr_price: asNumberOrNull(e.otr_price),
      extracted_commission: asNumberOrNull(e.commission_amount),
      extracted_payment_type: asStringOrNull(e.payment_type),
      extracted_date: asDateOrNull(e.date),
    })
    .select('*')
    .single()

  if (insertErr) throw insertErr

  // Run the matcher. If it fails we still return the unmatched row so the
  // user sees their upload.
  const { data: matched } = await supabase.rpc(
    'match_commission_verification',
    { p_verification_id: (inserted as CommissionVerification).id },
  )
  return (matched ?? inserted) as CommissionVerification
}

/** Re-run the matcher for an existing verification (after editing fields). */
export async function rematchVerification(
  verificationId: string,
): Promise<CommissionVerification> {
  const { data, error } = await supabase.rpc('match_commission_verification', {
    p_verification_id: verificationId,
  })
  if (error) throw error
  return data as CommissionVerification
}

/** List verifications visible to the caller. Server-side RLS handles
 *  scoping (SA sees own, SM / FA / super see all). Joins the linked
 *  booking's commission for the comparison column and the uploader's name
 *  so the table can show who took the photo. */
export async function listVerifications(): Promise<CommissionVerificationRow[]> {
  const { data, error } = await supabase
    .from('commission_verifications')
    .select(
      `
        id,
        booking_id,
        uploaded_by,
        uploaded_at,
        image_path,
        extracted_customer_name,
        extracted_sa_name,
        extracted_model,
        extracted_otr_price,
        extracted_commission,
        extracted_payment_type,
        extracted_date,
        matched,
        discrepancy_notes,
        booking:bookings(commission_amount),
        uploader:profiles!commission_verifications_uploaded_by_fkey(full_name)
      `,
    )
    .order('uploaded_at', { ascending: false })

  if (error) throw error

  // PostgREST can return joined rows as either a single object or a 1-element
  // array depending on the FK direction it infers — normalise both shapes.
  type JoinedBooking =
    | { commission_amount: number | null }
    | Array<{ commission_amount: number | null }>
    | null
  type JoinedUploader =
    | { full_name: string | null }
    | Array<{ full_name: string | null }>
    | null
  type Joined = CommissionVerification & {
    booking: JoinedBooking
    uploader: JoinedUploader
  }

  function pickFirst<T>(v: T | T[] | null): T | null {
    if (v == null) return null
    return Array.isArray(v) ? (v[0] ?? null) : v
  }

  const rows = (data as unknown as Joined[] | null) ?? []
  return rows.map((row) => {
    const b = pickFirst(row.booking)
    const u = pickFirst(row.uploader)
    return {
      ...row,
      booking_commission: b?.commission_amount ?? null,
      uploader_name: u?.full_name ?? null,
    }
  })
}
