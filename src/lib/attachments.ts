import { supabase } from './supabase'
import { extractAttachmentInBackground } from './reconciliation'
import type { Attachment, AttachmentKind } from './types'

const BUCKET = 'booking-files'

// Which attachment kinds should auto-fire Gemini extraction on upload.
// LOU + bank-in feed the reconciliation queue; the rest are reference
// material we don't read.
const EXTRACT_ON_UPLOAD = new Set<AttachmentKind>(['lou', 'bank_transaction'])

/** All attachments for a booking, newest first. */
export async function listAttachments(bookingId: string) {
  const { data, error } = await supabase
    .from('booking_attachments')
    .select('*')
    .eq('booking_id', bookingId)
    .order('uploaded_at', { ascending: false })

  if (error) throw error
  return data as Attachment[]
}

/** Every attachment visible to the caller. Used by the GA dashboard to
 *  detect which bookings are missing required paperwork. */
export async function listAllAttachments() {
  const { data, error } = await supabase
    .from('booking_attachments')
    .select('*')
    .order('uploaded_at', { ascending: false })

  if (error) throw error
  return data as Attachment[]
}

/**
 * Upload a file to Supabase Storage AND create a matching row in
 * `booking_attachments`. If the DB insert fails we remove the storage object
 * so we don't leak orphan files.
 *
 * The storage path is prefixed with the booking *code* (e.g. `BK-260521-abc123`)
 * so files are easy to identify when browsing the bucket in the Supabase UI.
 */
export async function uploadAttachment(
  bookingId: string,
  bookingCode: string,
  kind: AttachmentKind,
  file: File,
): Promise<Attachment> {
  // Strip anything other than letters/digits/dash/dot so the storage path
  // never breaks on weird filenames.
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
  const path = `${bookingCode}/${kind}/${Date.now()}-${safeName}`

  const { error: uploadErr } = await supabase.storage
    .from(BUCKET)
    .upload(path, file, {
      contentType: file.type || 'application/octet-stream',
      upsert: false,
    })
  if (uploadErr) throw uploadErr

  const { data, error } = await supabase
    .from('booking_attachments')
    .insert({
      booking_id: bookingId,
      kind,
      file_path: path,
      file_name: file.name,
      mime_type: file.type || null,
      size_bytes: file.size,
    })
    .select('*')
    .single()

  if (error) {
    // Compensating action — the storage object is now an orphan.
    await supabase.storage.from(BUCKET).remove([path])
    throw error
  }
  const attachment = data as Attachment

  // Fire Gemini extraction in the background for LOU + bank-in receipts.
  // Failures don't block the upload — they show up as "missing extraction"
  // in the reconciliation queue and the user can re-upload to retry.
  if (EXTRACT_ON_UPLOAD.has(kind)) {
    void extractAttachmentInBackground(attachment.id)
  }

  return attachment
}

/** Short-lived signed URL for viewing a private file. */
export async function getAttachmentUrl(filePath: string, expiresIn = 60) {
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(filePath, expiresIn)
  if (error) throw error
  return data.signedUrl
}

/** Delete the storage object first, then the DB row. */
export async function deleteAttachment(attachment: Attachment) {
  const { error: storErr } = await supabase.storage
    .from(BUCKET)
    .remove([attachment.file_path])
  if (storErr) throw storErr

  const { error } = await supabase
    .from('booking_attachments')
    .delete()
    .eq('id', attachment.id)
  if (error) throw error
}
