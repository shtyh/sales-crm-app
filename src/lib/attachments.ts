import { supabase } from './supabase'
import type { Attachment, AttachmentKind } from './types'

const BUCKET = 'booking-files'

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

/**
 * Upload a file to Supabase Storage AND create a matching row in
 * `booking_attachments`. If the DB insert fails we remove the storage object
 * so we don't leak orphan files.
 */
export async function uploadAttachment(
  bookingId: string,
  kind: AttachmentKind,
  file: File,
): Promise<Attachment> {
  // Strip anything other than letters/digits/dash/dot so the storage path
  // never breaks on weird filenames.
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
  const path = `${bookingId}/${kind}/${Date.now()}-${safeName}`

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
  return data as Attachment
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
