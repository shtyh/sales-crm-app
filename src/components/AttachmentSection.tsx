import { useEffect, useRef, useState } from 'react'
import {
  deleteAttachment,
  getAttachmentUrl,
  listAttachments,
  uploadAttachment,
} from '../lib/attachments'
import { formatError } from '../lib/errors'
import type { Attachment, AttachmentKind } from '../lib/types'

const ACCEPT_MIME =
  'image/jpeg,image/png,image/webp,application/pdf'
const MAX_BYTES = 10 * 1024 * 1024 // 10 MB — matches the bucket limit

function formatBytes(bytes: number | null) {
  if (!bytes && bytes !== 0) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function isImage(mime: string | null) {
  return !!mime && mime.startsWith('image/')
}

type Props = {
  bookingId: string
  /** Booking code, used as the human-readable folder name in Storage. */
  bookingCode: string
  kind: AttachmentKind
  title: string
  description?: string
}

export function AttachmentSection({
  bookingId,
  bookingCode,
  kind,
  title,
  description,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null)

  const [items, setItems] = useState<Attachment[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)

  async function refresh() {
    try {
      const all = await listAttachments(bookingId)
      setItems(all.filter((a) => a.kind === kind))
    } catch (e) {
      setError(formatError(e))
    }
  }

  useEffect(() => {
    refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookingId, kind])

  async function handlePick(file: File | null) {
    if (!file) return
    setError(null)
    if (file.size > MAX_BYTES) {
      setError(`File is too large (max 10 MB).`)
      return
    }
    setUploading(true)
    try {
      await uploadAttachment(bookingId, bookingCode, kind, file)
      await refresh()
    } catch (e) {
      setError(formatError(e))
    } finally {
      setUploading(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  async function handleView(a: Attachment) {
    setError(null)
    try {
      const url = await getAttachmentUrl(a.file_path, 60)
      window.open(url, '_blank', 'noopener,noreferrer')
    } catch (e) {
      setError(formatError(e))
    }
  }

  async function handleDelete(a: Attachment) {
    if (!window.confirm(`Delete "${a.file_name}"?`)) return
    setError(null)
    try {
      await deleteAttachment(a)
      await refresh()
    } catch (e) {
      setError(formatError(e))
    }
  }

  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-4 sm:p-5">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-gray-900">{title}</h3>
          {description && (
            <p className="mt-0.5 text-xs text-gray-500">{description}</p>
          )}
        </div>
        <label className="shrink-0 cursor-pointer rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700 transition hover:bg-gray-50">
          {uploading ? 'Uploading…' : '+ Upload'}
          <input
            ref={inputRef}
            type="file"
            accept={ACCEPT_MIME}
            disabled={uploading}
            onChange={(e) => handlePick(e.target.files?.[0] ?? null)}
            className="hidden"
          />
        </label>
      </div>

      {error && (
        <div
          role="alert"
          className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700"
        >
          {error}
        </div>
      )}

      {items === null ? (
        <div className="text-xs text-gray-400">Loading…</div>
      ) : items.length === 0 ? (
        <div className="rounded-lg border border-dashed border-gray-200 p-4 text-center text-xs text-gray-400">
          No files uploaded yet.
        </div>
      ) : (
        <ul className="divide-y divide-gray-100">
          {items.map((a) => (
            <li
              key={a.id}
              className="flex items-center gap-3 py-2 first:pt-0 last:pb-0"
            >
              <span className="text-lg" aria-hidden>
                {isImage(a.mime_type) ? '🖼️' : '📄'}
              </span>
              <div className="min-w-0 flex-1">
                <button
                  type="button"
                  onClick={() => handleView(a)}
                  className="block truncate text-left text-sm font-medium text-gray-900 hover:underline"
                  title={a.file_name}
                >
                  {a.file_name}
                </button>
                <div className="text-xs text-gray-500">
                  {formatBytes(a.size_bytes)} ·{' '}
                  {new Date(a.uploaded_at).toLocaleString('en-MY', {
                    day: '2-digit',
                    month: 'short',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </div>
              </div>
              <button
                type="button"
                onClick={() => handleDelete(a)}
                className="shrink-0 rounded p-1 text-gray-400 transition hover:bg-red-50 hover:text-red-600"
                aria-label="Delete"
                title="Delete"
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
