import { useState, type ChangeEvent, type ReactNode } from 'react'
import {
  useDocumentVerificationsForBooking,
  useUploadDocument,
} from '../lib/queries'
import {
  ALLOWED_MIME_TYPES,
  MAX_UPLOAD_BYTES,
} from '../lib/documentVerifications'
import { formatError } from '../lib/errors'
import { formatMYR } from '../lib/format'
import {
  DOCUMENT_TYPE_LABEL,
  type Booking,
  type DocumentType,
  type DocumentVerificationRow,
  type VerificationStatus,
} from '../lib/types'

// SA-facing document submission. Three upload cards (All-In-One / Down payment
// / LOU). Each upload posts to document-verification/{uid}/... and invokes the
// matching extractor edge function; the DB trigger then rolls the result up
// onto the booking, which is what these per-card status badges reflect.

const VERIF_PILL: Record<VerificationStatus, { cls: string; label: string }> = {
  pending: { cls: 'bg-amber-100 text-amber-800', label: '⏳ Pending review' },
  approved: { cls: 'bg-green-100 text-green-800', label: '✓ Approved' },
  rejected: { cls: 'bg-rose-100 text-rose-800', label: '✗ Rejected' },
  needs_review: { cls: 'bg-blue-100 text-blue-800', label: '👀 Needs review' },
}

function VerifPill({ status }: { status: VerificationStatus }) {
  const p = VERIF_PILL[status]
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${p.cls}`}>
      {p.label}
    </span>
  )
}

function readableSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

/** One booking-level status line per card (reflects bookings.<x>_status). */
function bookingStatusLine(
  docType: DocumentType,
  booking: Booking,
): { cls: string; text: string } {
  if (docType === 'all_in_one') {
    const s = booking.all_in_one_status
    if (s === 'approved') return { cls: 'text-green-700', text: 'Approved by finance' }
    if (s === 'rejected') return { cls: 'text-rose-700', text: 'Rejected — re-upload needed' }
    return { cls: 'text-amber-700', text: 'Awaiting finance review' }
  }
  if (docType === 'down_payment') {
    const s = booking.down_payment_status
    const expected = Number(booking.down_payment || 0)
    const received = Number(booking.total_received_down_payment || 0)
    const got = formatMYR(received)
    if (expected > 0) {
      // Agreed figure set on the booking — show received / agreed.
      const pair = `${got} / ${formatMYR(expected)}`
      const toGo = formatMYR(Math.max(expected - received, 0))
      if (s === 'complete') return { cls: 'text-green-700', text: `Complete — ${pair} received` }
      if (s === 'partial') return { cls: 'text-amber-700', text: `${pair} — ${toGo} to go` }
      return { cls: 'text-amber-700', text: `Agreed ${formatMYR(expected)} — no receipts yet` }
    }
    if (s === 'complete') return { cls: 'text-green-700', text: `Complete — ${got} received` }
    if (s === 'partial') return { cls: 'text-amber-700', text: `Partial — ${got} received` }
    return { cls: 'text-gray-500', text: 'No receipts yet' }
  }
  // lou
  const s = booking.lou_status
  if (s === 'not_required') return { cls: 'text-gray-500', text: 'Not required (cash deal)' }
  if (s === 'verified') return { cls: 'text-green-700', text: 'Verified by finance' }
  return { cls: 'text-amber-700', text: 'Awaiting finance verification' }
}

function DocCard({
  docType,
  booking,
  rows,
  canUpload,
  uploading,
  onPick,
  error,
}: {
  docType: DocumentType
  booking: Booking
  rows: DocumentVerificationRow[]
  canUpload: boolean
  uploading: boolean
  onPick: (docType: DocumentType, file: File) => void
  error: string | null
}) {
  const status = bookingStatusLine(docType, booking)
  const louNotRequired =
    docType === 'lou' && booking.lou_status === 'not_required' &&
    booking.payment_type != null && booking.payment_type !== 'loan'

  function handleChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (file) onPick(docType, file)
  }

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <div className="mb-2 flex items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-gray-900">
            {DOCUMENT_TYPE_LABEL[docType]}
          </h3>
          <p className={`mt-0.5 text-xs font-medium ${status.cls}`}>{status.text}</p>
        </div>
        {canUpload && !louNotRequired && (
          <label className="inline-flex cursor-pointer items-center rounded-lg bg-gray-900 px-3 py-1.5 text-xs font-medium text-white shadow-sm hover:bg-gray-800">
            {uploading ? 'Reading…' : rows.length ? '+ Add' : 'Upload'}
            <input
              type="file"
              accept="image/jpeg,image/png,image/heic,image/heif"
              onChange={handleChange}
              disabled={uploading}
              className="hidden"
            />
          </label>
        )}
      </div>

      {error && (
        <p className="mb-2 rounded-lg border border-rose-200 bg-rose-50 px-2.5 py-1.5 text-xs text-rose-700">
          {error}
        </p>
      )}

      {rows.length === 0 ? (
        <p className="text-xs text-gray-400">
          {louNotRequired ? 'No LOU needed for a cash deal.' : 'Nothing uploaded yet.'}
        </p>
      ) : (
        <ul className="space-y-1.5">
          {rows.map((r) => (
            <li
              key={r.id}
              className="flex items-center justify-between gap-2 rounded-md bg-gray-50 px-2.5 py-1.5 text-xs"
            >
              <span className="min-w-0 truncate text-gray-600">
                {docType === 'all_in_one' && (
                  <>
                    {r.extracted_customer_name ?? '—'}
                    {r.extracted_commission != null && (
                      <span className="text-gray-400"> · comm {formatMYR(r.extracted_commission)}</span>
                    )}
                    {r.extracted_sm_signature_detected === false && (
                      <span className="text-rose-500"> · no SM sign</span>
                    )}
                  </>
                )}
                {docType === 'down_payment' && (
                  <>
                    {r.extracted_payment_amount != null ? formatMYR(r.extracted_payment_amount) : '—'}
                    {r.extracted_payment_date && (
                      <span className="text-gray-400"> · {r.extracted_payment_date}</span>
                    )}
                  </>
                )}
                {docType === 'lou' && (
                  <>
                    {r.extracted_hirer_name ?? '—'}
                    {r.extracted_loan_amount_lou != null && (
                      <span className="text-gray-400"> · loan {formatMYR(r.extracted_loan_amount_lou)}</span>
                    )}
                  </>
                )}
              </span>
              <VerifPill status={r.verification_status} />
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export function DocumentSubmissionCards({
  booking,
  canUpload,
  showDocCards = true,
  bankSlot,
}: {
  booking: Booking
  canUpload: boolean
  /** Hide the AI doc cards (e.g. for roles that don't submit them) while still
   *  showing the section + bank-transaction slot. */
  showDocCards?: boolean
  /** Rendered inside the same box, under the doc cards — used to nest the
   *  Bank transaction attachment section here. */
  bankSlot?: ReactNode
}) {
  const { data: rows } = useDocumentVerificationsForBooking(booking.id)
  const upload = useUploadDocument()
  const [errors, setErrors] = useState<Partial<Record<DocumentType, string>>>({})
  const [activeType, setActiveType] = useState<DocumentType | null>(null)

  function rowsFor(t: DocumentType): DocumentVerificationRow[] {
    return (rows ?? []).filter((r) => r.document_type === t)
  }

  function handlePick(docType: DocumentType, file: File) {
    setErrors((e) => ({ ...e, [docType]: undefined }))
    if (!ALLOWED_MIME_TYPES.has(file.type)) {
      setErrors((e) => ({
        ...e,
        [docType]: `Unsupported file type (${file.type || 'unknown'}). Use JPEG, PNG, or HEIC.`,
      }))
      return
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      setErrors((e) => ({ ...e, [docType]: `File too large (${readableSize(file.size)}). Max 10 MB.` }))
      return
    }
    setActiveType(docType)
    upload.mutate(
      { userId: booking.owner_id, bookingId: booking.id, documentType: docType, file },
      {
        onError: (err) =>
          setErrors((e) => ({ ...e, [docType]: formatError(err) })),
        onSettled: () => setActiveType(null),
      },
    )
  }

  const renderCard = (t: DocumentType) => (
    <DocCard
      docType={t}
      booking={booking}
      rows={rowsFor(t)}
      canUpload={canUpload}
      uploading={upload.isPending && activeType === t}
      onPick={handlePick}
      error={errors[t] ?? null}
    />
  )

  return (
    <section className="mt-6 rounded-lg border border-gray-200 bg-gray-50/60 p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-gray-900">📄 Document submission</h2>
          <p className="mt-0.5 text-xs text-gray-500">
            Snap the All-In-One, the down-payment receipt(s), and (for loans) the
            LOU. AI reads each one and finance verifies it.
          </p>
        </div>
        {booking.documents_complete && (
          <span className="inline-flex items-center rounded-full bg-green-100 px-2.5 py-1 text-xs font-medium text-green-800">
            ✓ All documents complete
          </span>
        )}
      </div>
      {showDocCards ? (
        <div className="space-y-3">
          {/* All-In-One spans the full width */}
          {renderCard('all_in_one')}
          {/* Down payment · LOU · Bank transaction share a row */}
          <div className="grid gap-3 md:grid-cols-3">
            {renderCard('down_payment')}
            {renderCard('lou')}
            {bankSlot}
          </div>
        </div>
      ) : (
        bankSlot && <div>{bankSlot}</div>
      )}
    </section>
  )
}
