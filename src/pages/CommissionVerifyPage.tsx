import { useMemo, useState, type ChangeEvent } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { AppShell } from '../components/AppShell'
import { useAuth } from '../lib/auth'
import {
  useCommissionVerifications,
  useCreateCommissionVerification,
  useUploadAndExtract,
  useRematchVerification,
} from '../lib/queries'
import {
  ALLOWED_MIME_TYPES,
  MAX_UPLOAD_BYTES,
} from '../lib/commissionVerifications'
import { formatError } from '../lib/errors'
import { formatMYR } from '../lib/format'
import type { ExtractedAllInOne } from '../lib/types'

// ─── Helpers ────────────────────────────────────────────────────────────────

const inputClass =
  'w-full rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm outline-none focus:border-gray-900 focus:ring-2 focus:ring-gray-900/10'
const labelClass = 'block text-xs font-medium text-gray-600 mb-1'

function readableSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function toNumber(v: string): number | undefined {
  if (v.trim() === '') return undefined
  const n = Number(v)
  return Number.isFinite(n) ? n : undefined
}

// ─── Status pill ────────────────────────────────────────────────────────────

function StatusPill({
  matched,
  hasDiscrepancy,
}: {
  matched: boolean
  hasDiscrepancy: boolean
}) {
  if (!matched) {
    return (
      <span className="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
        ⚠ Unmatched
      </span>
    )
  }
  if (hasDiscrepancy) {
    return (
      <span className="inline-flex items-center rounded-full bg-rose-100 px-2 py-0.5 text-xs font-medium text-rose-800">
        ✗ Discrepancy
      </span>
    )
  }
  return (
    <span className="inline-flex items-center rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800">
      ✓ Matched
    </span>
  )
}

// ─── Confirm form ──────────────────────────────────────────────────────────
// Rendered after extraction; user reviews / corrects before save.

function ConfirmForm({
  initial,
  onCancel,
  onSave,
  saving,
}: {
  initial: ExtractedAllInOne
  onCancel: () => void
  onSave: (edited: ExtractedAllInOne) => void
  saving: boolean
}) {
  const [customerName, setCustomerName] = useState(initial.customer_name ?? '')
  const [saName, setSaName] = useState(initial.sa_name ?? '')
  const [model, setModel] = useState(initial.model ?? '')
  const [otrPrice, setOtrPrice] = useState(
    initial.otr_price != null ? String(initial.otr_price) : '',
  )
  const [totalOtr, setTotalOtr] = useState(
    initial.total_otr != null ? String(initial.total_otr) : '',
  )
  const [bookingFee, setBookingFee] = useState(
    initial.booking_fee != null ? String(initial.booking_fee) : '',
  )
  const [commission, setCommission] = useState(
    initial.commission_amount != null ? String(initial.commission_amount) : '',
  )
  const [paymentType, setPaymentType] = useState(
    initial.payment_type === 'loan' || initial.payment_type === 'cash'
      ? initial.payment_type
      : '',
  )
  const [date, setDate] = useState(initial.date ?? '')
  const [ncd, setNcd] = useState(
    initial.ncd_discount != null ? String(initial.ncd_discount) : '',
  )
  const [own, setOwn] = useState(
    initial.own_discount != null ? String(initial.own_discount) : '',
  )
  const [pesb, setPesb] = useState(
    initial.pesb_discount != null ? String(initial.pesb_discount) : '',
  )

  function handleSave() {
    onSave({
      customer_name: customerName.trim() || undefined,
      sa_name: saName.trim() || undefined,
      model: model.trim() || undefined,
      otr_price: toNumber(otrPrice),
      total_otr: toNumber(totalOtr),
      booking_fee: toNumber(bookingFee),
      commission_amount: toNumber(commission),
      payment_type: paymentType || undefined,
      date: date.trim() || undefined,
      ncd_discount: toNumber(ncd),
      own_discount: toNumber(own),
      pesb_discount: toNumber(pesb),
    })
  }

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
      <div className="mb-4">
        <h2 className="text-base font-semibold text-gray-900">
          Review extracted data
        </h2>
        <p className="mt-0.5 text-sm text-gray-500">
          AI read the form — double-check anything that looks off, then save.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className={labelClass}>Customer name</label>
          <input
            className={inputClass}
            value={customerName}
            onChange={(e) => setCustomerName(e.target.value)}
          />
        </div>
        <div>
          <label className={labelClass}>SA name</label>
          <input
            className={inputClass}
            value={saName}
            onChange={(e) => setSaName(e.target.value)}
          />
        </div>
        <div>
          <label className={labelClass}>Model</label>
          <input
            className={inputClass}
            value={model}
            onChange={(e) => setModel(e.target.value)}
          />
        </div>
        <div>
          <label className={labelClass}>Date (YYYY-MM-DD)</label>
          <input
            type="date"
            className={inputClass}
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </div>
        <div>
          <label className={labelClass}>OTR price (RM)</label>
          <input
            inputMode="decimal"
            className={inputClass}
            value={otrPrice}
            onChange={(e) => setOtrPrice(e.target.value)}
          />
        </div>
        <div>
          <label className={labelClass}>Total OTR (RM)</label>
          <input
            inputMode="decimal"
            className={inputClass}
            value={totalOtr}
            onChange={(e) => setTotalOtr(e.target.value)}
          />
        </div>
        <div>
          <label className={labelClass}>Booking fee (RM)</label>
          <input
            inputMode="decimal"
            className={inputClass}
            value={bookingFee}
            onChange={(e) => setBookingFee(e.target.value)}
          />
        </div>
        <div>
          <label className={labelClass}>Commission (RM)</label>
          <input
            inputMode="decimal"
            className={inputClass}
            value={commission}
            onChange={(e) => setCommission(e.target.value)}
          />
        </div>
        <div>
          <label className={labelClass}>Payment type</label>
          <select
            className={inputClass}
            value={paymentType}
            onChange={(e) => setPaymentType(e.target.value)}
          >
            <option value="">—</option>
            <option value="cash">Cash</option>
            <option value="loan">Loan</option>
          </select>
        </div>
        <div>
          <label className={labelClass}>NCD discount (RM)</label>
          <input
            inputMode="decimal"
            className={inputClass}
            value={ncd}
            onChange={(e) => setNcd(e.target.value)}
          />
        </div>
        <div>
          <label className={labelClass}>Own discount (RM)</label>
          <input
            inputMode="decimal"
            className={inputClass}
            value={own}
            onChange={(e) => setOwn(e.target.value)}
          />
        </div>
        <div>
          <label className={labelClass}>PESB discount (RM)</label>
          <input
            inputMode="decimal"
            className={inputClass}
            value={pesb}
            onChange={(e) => setPesb(e.target.value)}
          />
        </div>
      </div>

      <div className="mt-5 flex flex-wrap items-center justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="rounded-lg bg-gray-900 px-3 py-1.5 text-sm font-medium text-white shadow-sm disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save & match'}
        </button>
      </div>
    </div>
  )
}

// ─── Page ──────────────────────────────────────────────────────────────────

export function CommissionVerifyPage() {
  const { user, role } = useAuth()

  // Role gate: SA, SM, super only.
  if (
    role &&
    role !== 'sales_advisor' &&
    role !== 'sales_manager' &&
    role !== 'super_admin'
  ) {
    return <Navigate to="/" replace />
  }

  const isPrivileged = role === 'sales_manager' || role === 'super_admin'

  // ----- Upload + extract state -----
  const upload = useUploadAndExtract()
  const create = useCreateCommissionVerification()
  const rematch = useRematchVerification()

  const [pendingExtract, setPendingExtract] = useState<{
    file_path: string
    extracted: ExtractedAllInOne
  } | null>(null)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [okMessage, setOkMessage] = useState<string | null>(null)

  // ----- Verifications list -----
  const { data: verifications, error: listErr } = useCommissionVerifications()

  // ----- Filters (apply to list) -----
  const [filterSa, setFilterSa] = useState<string>('')
  const [filterFrom, setFilterFrom] = useState<string>('')
  const [filterTo, setFilterTo] = useState<string>('')
  const [filterStatus, setFilterStatus] = useState<
    '' | 'matched' | 'discrepancy' | 'unmatched'
  >('')

  const saOptions = useMemo(() => {
    if (!verifications) return [] as string[]
    const set = new Set<string>()
    verifications.forEach((v) => {
      if (v.uploader_name) set.add(v.uploader_name)
      if (v.extracted_sa_name) set.add(v.extracted_sa_name)
    })
    return Array.from(set).sort((a, b) => a.localeCompare(b))
  }, [verifications])

  const filtered = useMemo(() => {
    if (!verifications) return []
    return verifications.filter((v) => {
      if (
        filterSa &&
        v.uploader_name !== filterSa &&
        v.extracted_sa_name !== filterSa
      ) {
        return false
      }
      if (filterFrom && (v.extracted_date ?? '') < filterFrom) return false
      if (filterTo && (v.extracted_date ?? '') > filterTo) return false
      if (filterStatus) {
        const hasDisc = !!v.discrepancy_notes && v.matched
        if (filterStatus === 'matched' && (!v.matched || hasDisc)) return false
        if (filterStatus === 'discrepancy' && !(v.matched && hasDisc)) {
          return false
        }
        if (filterStatus === 'unmatched' && v.matched) return false
      }
      return true
    })
  }, [verifications, filterSa, filterFrom, filterTo, filterStatus])

  function handleFileChange(e: ChangeEvent<HTMLInputElement>) {
    setUploadError(null)
    setSaveError(null)
    setOkMessage(null)
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return

    if (!ALLOWED_MIME_TYPES.has(file.type)) {
      setUploadError(
        `Unsupported file type (${file.type || 'unknown'}). Use JPEG, PNG, or HEIC.`,
      )
      return
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      setUploadError(
        `File too large (${readableSize(file.size)}). Max 10 MB.`,
      )
      return
    }
    if (!user) {
      setUploadError('Not signed in.')
      return
    }

    upload.mutate(
      { userId: user.id, file },
      {
        onSuccess: (res) => setPendingExtract(res),
        onError: (err) => setUploadError(formatError(err)),
      },
    )
  }

  function handleSaveConfirmed(edited: ExtractedAllInOne) {
    if (!user || !pendingExtract) return
    setSaveError(null)
    create.mutate(
      {
        uploaded_by: user.id,
        image_path: pendingExtract.file_path,
        extracted: edited,
      },
      {
        onSuccess: () => {
          setPendingExtract(null)
          setOkMessage('Saved & matched.')
        },
        onError: (err) => setSaveError(formatError(err)),
      },
    )
  }

  function handleCancelConfirm() {
    setPendingExtract(null)
    setUploadError(null)
  }

  function handleRematch(id: string) {
    rematch.mutate(id)
  }

  return (
    <AppShell>
      <div className="space-y-6">
        <header className="flex items-end justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold text-gray-900">
              Verify commission
            </h1>
            <p className="mt-0.5 text-sm text-gray-500">
              Upload an "All In One Preparation" form photo — AI reads it and
              compares to the matching booking.
            </p>
          </div>
        </header>

        {/* ───── Upload ───── */}
        <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
          {!pendingExtract ? (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-3">
                <label className="inline-flex cursor-pointer items-center rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-gray-800">
                  {upload.isPending ? 'Reading…' : 'Choose photo'}
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/heic,image/heif"
                    onChange={handleFileChange}
                    disabled={upload.isPending}
                    className="hidden"
                  />
                </label>
                <span className="text-xs text-gray-500">
                  JPEG / PNG / HEIC · max 10 MB
                </span>
              </div>
              {upload.isPending && (
                <p className="text-sm text-gray-600">
                  Uploading + extracting — usually takes 5–15 seconds…
                </p>
              )}
              {uploadError && (
                <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
                  {uploadError}
                </p>
              )}
              {okMessage && (
                <p className="rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700">
                  {okMessage}
                </p>
              )}
            </div>
          ) : (
            <div className="space-y-4">
              <ConfirmForm
                initial={pendingExtract.extracted}
                onCancel={handleCancelConfirm}
                onSave={handleSaveConfirmed}
                saving={create.isPending}
              />
              {saveError && (
                <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
                  {saveError}
                </p>
              )}
            </div>
          )}
        </section>

        {/* ───── List ───── */}
        <section className="space-y-3">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <h2 className="text-base font-semibold text-gray-900">
              History
            </h2>
            <div className="flex flex-wrap items-center gap-2">
              {isPrivileged && (
                <select
                  className={inputClass + ' w-auto min-w-[10rem]'}
                  value={filterSa}
                  onChange={(e) => setFilterSa(e.target.value)}
                >
                  <option value="">All SAs</option>
                  {saOptions.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              )}
              <input
                type="date"
                className={inputClass + ' w-auto'}
                value={filterFrom}
                onChange={(e) => setFilterFrom(e.target.value)}
                aria-label="From date"
              />
              <span className="text-xs text-gray-400">to</span>
              <input
                type="date"
                className={inputClass + ' w-auto'}
                value={filterTo}
                onChange={(e) => setFilterTo(e.target.value)}
                aria-label="To date"
              />
              <select
                className={inputClass + ' w-auto min-w-[9rem]'}
                value={filterStatus}
                onChange={(e) =>
                  setFilterStatus(
                    e.target.value as
                      | ''
                      | 'matched'
                      | 'discrepancy'
                      | 'unmatched',
                  )
                }
              >
                <option value="">All statuses</option>
                <option value="matched">Matched</option>
                <option value="discrepancy">Discrepancy</option>
                <option value="unmatched">Unmatched</option>
              </select>
            </div>
          </div>

          {listErr && (
            <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
              {formatError(listErr)}
            </p>
          )}

          <div className="overflow-x-auto rounded-2xl border border-gray-200 bg-white shadow-sm">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="px-3 py-2 text-left">Date</th>
                  <th className="px-3 py-2 text-left">Customer</th>
                  <th className="px-3 py-2 text-left">SA</th>
                  <th className="px-3 py-2 text-left">Model</th>
                  <th className="px-3 py-2 text-left">Payment</th>
                  <th className="px-3 py-2 text-right">Extracted (RM)</th>
                  <th className="px-3 py-2 text-right">Booking (RM)</th>
                  <th className="px-3 py-2 text-right">Difference</th>
                  <th className="px-3 py-2 text-left">Status</th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filtered.length === 0 && (
                  <tr>
                    <td
                      colSpan={10}
                      className="px-3 py-6 text-center text-sm text-gray-500"
                    >
                      No verifications yet. Upload a form to get started.
                    </td>
                  </tr>
                )}
                {filtered.map((v) => {
                  const ext = v.extracted_commission
                  const bk = v.booking_commission
                  const diff =
                    ext != null && bk != null ? ext - bk : null
                  const hasDisc = !!v.discrepancy_notes && v.matched
                  return (
                    <tr key={v.id} className="hover:bg-gray-50/60">
                      <td className="whitespace-nowrap px-3 py-2 text-gray-700">
                        {v.extracted_date ?? '—'}
                      </td>
                      <td className="px-3 py-2 text-gray-900">
                        {v.extracted_customer_name ?? '—'}
                      </td>
                      <td className="px-3 py-2 text-gray-700">
                        {v.extracted_sa_name ?? v.uploader_name ?? '—'}
                      </td>
                      <td className="px-3 py-2 text-gray-700">
                        {v.extracted_model ?? '—'}
                      </td>
                      <td className="px-3 py-2 text-gray-700 capitalize">
                        {v.extracted_payment_type ?? '—'}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {ext != null ? formatMYR(ext) : '—'}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {bk != null ? (
                          v.booking_id ? (
                            <Link
                              to={`/bookings/${v.booking_id}`}
                              className="text-gray-900 underline-offset-2 hover:underline"
                            >
                              {formatMYR(bk)}
                            </Link>
                          ) : (
                            formatMYR(bk)
                          )
                        ) : (
                          '—'
                        )}
                      </td>
                      <td
                        className={
                          'px-3 py-2 text-right tabular-nums ' +
                          (diff != null && diff !== 0
                            ? 'font-medium text-rose-700'
                            : 'text-gray-500')
                        }
                      >
                        {diff != null ? formatMYR(diff) : '—'}
                      </td>
                      <td className="px-3 py-2">
                        <StatusPill
                          matched={v.matched}
                          hasDiscrepancy={hasDisc}
                        />
                        {v.discrepancy_notes && (
                          <p className="mt-1 max-w-[18rem] text-xs text-gray-500">
                            {v.discrepancy_notes}
                          </p>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <button
                          type="button"
                          onClick={() => handleRematch(v.id)}
                          disabled={
                            rematch.isPending &&
                            rematch.variables === v.id
                          }
                          className="text-xs text-gray-500 underline-offset-2 hover:text-gray-900 hover:underline disabled:opacity-50"
                        >
                          {rematch.isPending && rematch.variables === v.id
                            ? '…'
                            : 'Re-match'}
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </AppShell>
  )
}
