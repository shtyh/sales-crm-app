import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { AppShell } from '../components/AppShell'
import { AttachmentSection } from '../components/AttachmentSection'
import { AuditLogPanel } from '../components/AuditLogPanel'
import { useAuth } from '../lib/auth'
import {
  qk,
  useAttachments,
  useBooking,
  useCars,
  useDeleteBooking,
  useProfiles,
  useUpdateBooking,
} from '../lib/queries'
import { formatError } from '../lib/errors'
import { PROTON_MODELS, variantsFor } from '../data/proton-models'
import { LOAN_BANKS, INSURERS } from '../data/banks-and-insurers'
import type {
  ApprovalStatus,
  Attachment,
  AttachmentKind,
  BookingStatus,
  DepositStatus,
  FloorStockStatus,
  LoanStatus,
  PaymentStatus,
} from '../lib/types'
import { FLOOR_STOCK_LABEL } from '../lib/types'

const STATUSES: { value: BookingStatus; label: string }[] = [
  { value: 'pending', label: 'Pending' },
  { value: 'confirmed', label: 'Confirmed' },
  { value: 'delivered', label: 'Delivered' },
  { value: 'cancelled', label: 'Cancelled' },
]

const LOAN_STATUSES: { value: LoanStatus; label: string }[] = [
  { value: 'not_applicable', label: 'Not applicable (cash deal)' },
  { value: 'pending', label: 'Pending' },
  { value: 'approved', label: 'Approved' },
  { value: 'rejected', label: 'Rejected' },
]

const LOAN_BADGE: Record<LoanStatus, string> = {
  not_applicable: 'bg-gray-100 text-gray-600',
  pending: 'bg-amber-100 text-amber-800',
  approved: 'bg-green-100 text-green-800',
  rejected: 'bg-red-100 text-red-800',
}

const LOAN_LABEL: Record<LoanStatus, string> = {
  not_applicable: 'Cash / N/A',
  pending: '⏳ Loan pending',
  approved: '✓ Loan approved',
  rejected: '✗ Loan rejected',
}

const APPROVAL_BADGE: Record<ApprovalStatus, string> = {
  not_required: 'bg-gray-100 text-gray-600',
  pending: 'bg-amber-100 text-amber-800',
  approved: 'bg-green-100 text-green-800',
  rejected: 'bg-red-100 text-red-800',
}

const APPROVAL_LABEL: Record<ApprovalStatus, string> = {
  not_required: 'No discount',
  pending: '⏳ Awaiting manager approval',
  approved: '✓ Discount approved',
  rejected: '✗ Discount rejected',
}

const DEPOSIT_OPTIONS: { value: DepositStatus; label: string }[] = [
  { value: 'unpaid', label: 'Unpaid' },
  { value: 'received', label: 'Received' },
  { value: 'refunded', label: 'Refunded' },
]

const PAYMENT_OPTIONS: { value: PaymentStatus; label: string }[] = [
  { value: 'unpaid', label: 'Unpaid' },
  { value: 'partial', label: 'Partially paid' },
  { value: 'paid', label: 'Fully paid' },
]

const STATUS_BADGE: Record<BookingStatus, string> = {
  pending: 'bg-amber-100 text-amber-800',
  confirmed: 'bg-blue-100 text-blue-800',
  delivered: 'bg-green-100 text-green-800',
  cancelled: 'bg-gray-100 text-gray-600',
}

function formatTimestamp(iso: string) {
  return new Date(iso).toLocaleString('en-MY', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function BookingDetailPage() {
  const { id = '' } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const {
    isFinanceAdmin,
    canCancel,
    canApproveDiscount,
    canEditFinanceStatus,
    canReassign,
    canEditCarAttributes,
    isSuperAdmin,
  } = useAuth()
  const qc = useQueryClient()

  const { data: booking, error: bookingErr, isLoading } = useBooking(id)
  const { data: attachments } = useAttachments(id)
  // Owner reassignment dropdown — only manager needs the profile list, and
  // useProfiles is cached so this is essentially free when navigating from
  // /bookings.
  const { data: profiles } = useProfiles(canReassign)
  // Cars list — used both for the general_admin dropdown and to look up
  // the linked car's chassis / floor-stock for everyone else's read-only
  // display. Small data, RLS lets everyone read, cached by React Query.
  const { data: cars } = useCars()
  const updateMut = useUpdateBooking()
  const deleteMut = useDeleteBooking()

  const loadError = bookingErr
    ? formatError(bookingErr)
    : booking === null
      ? 'Booking not found, or you do not have access.'
      : null

  // Editable form state — populated once the booking loads.
  const [customerName, setCustomerName] = useState('')
  const [customerNric, setCustomerNric] = useState('')
  const [customerPhone, setCustomerPhone] = useState('')
  const [customerEmail, setCustomerEmail] = useState('')
  const [vehicleModel, setVehicleModel] = useState<string>(PROTON_MODELS[0])
  const [vehicleVariant, setVehicleVariant] = useState('')
  const [vehicleColor, setVehicleColor] = useState('')
  const [otrPrice, setOtrPrice] = useState('')
  const [bookingFee, setBookingFee] = useState('')
  const [discountAmount, setDiscountAmount] = useState('')
  const [bookingDate, setBookingDate] = useState('')
  const [status, setStatus] = useState<BookingStatus>('pending')
  const [notes, setNotes] = useState('')
  const [loanBank, setLoanBank] = useState('')
  const [insuranceCompany, setInsuranceCompany] = useState('')
  const [loanStatus, setLoanStatus] = useState<LoanStatus>('not_applicable')
  const [loanNotes, setLoanNotes] = useState('')
  const [depositStatus, setDepositStatus] = useState<DepositStatus>('unpaid')
  const [paymentStatus, setPaymentStatus] = useState<PaymentStatus>('unpaid')
  const [ownerId, setOwnerId] = useState('')
  const [carId, setCarId] = useState<string>('')

  const linkedCar = useMemo(
    () => (carId ? cars?.find((c) => c.id === carId) ?? null : null),
    [cars, carId],
  )

  const [cancelling, setCancelling] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [savedAt, setSavedAt] = useState<number | null>(null)
  const saving = updateMut.isPending && !cancelling

  // Mutations refetch on invalidate; this lets AttachmentSection trigger a
  // refresh after upload/delete without owning the query itself.
  const refreshAttachments = useCallback(async () => {
    await qc.invalidateQueries({ queryKey: qk.attachments(id) })
  }, [qc, id])

  const attachmentsByKind = useMemo(() => {
    const map: Record<AttachmentKind, Attachment[] | null> = {
      bank_transaction: null,
      bank_statement: null,
      lou: null,
      cancellation_form: null,
      other: null,
    }
    if (!attachments) return map
    for (const k of Object.keys(map) as AttachmentKind[]) map[k] = []
    for (const a of attachments) map[a.kind]?.push(a)
    return map
  }, [attachments])

  // Sync server data into the form once it arrives (or after a refresh).
  useEffect(() => {
    if (!booking) return
    setCustomerName(booking.customer_name)
    setCustomerNric(booking.customer_nric)
    setCustomerPhone(booking.customer_phone)
    setCustomerEmail(booking.customer_email ?? '')
    setVehicleModel(booking.vehicle_model)
    setVehicleVariant(booking.vehicle_variant)
    setVehicleColor(booking.vehicle_color)
    setOtrPrice(String(booking.otr_price))
    setBookingFee(String(booking.booking_fee))
    setDiscountAmount(String(booking.discount_amount ?? 0))
    setBookingDate(booking.booking_date)
    setStatus(booking.status)
    setNotes(booking.notes ?? '')
    setLoanBank(booking.loan_bank ?? '')
    setInsuranceCompany(booking.insurance_company ?? '')
    setLoanStatus(booking.loan_status ?? 'not_applicable')
    setLoanNotes(booking.loan_notes ?? '')
    setDepositStatus(booking.deposit_status ?? 'unpaid')
    setPaymentStatus(booking.payment_status ?? 'unpaid')
    setOwnerId(booking.owner_id)
    setCarId(booking.car_id ?? '')
  }, [booking])

  function handleModelChange(newModel: string) {
    setVehicleModel(newModel)
    // If the previously chosen variant isn't valid for the new model, reset.
    const valid = variantsFor(newModel)
    if (!valid.includes(vehicleVariant)) {
      setVehicleVariant('')
    }
  }

  async function handleSave(e: FormEvent) {
    e.preventDefault()
    setError(null)
    try {
      await updateMut.mutateAsync({
        id,
        patch: {
          customer_name: customerName.trim(),
          customer_nric: customerNric.trim(),
          customer_phone: customerPhone.trim(),
          customer_email: customerEmail.trim() || null,
          vehicle_model: vehicleModel,
          vehicle_variant: vehicleVariant,
          vehicle_color: vehicleColor.trim(),
          otr_price: Number(otrPrice) || 0,
          booking_fee: Number(bookingFee) || 0,
          discount_amount: Number(discountAmount) || 0,
          booking_date: bookingDate,
          status,
          notes: notes.trim() || null,
          // Send each role-gated bucket of fields ONLY when the caller is
          // allowed to write them; otherwise the DB trigger will reject the
          // whole PATCH because something is "distinct from" the old value.
          ...(isFinanceAdmin
            ? {
                loan_bank: loanBank || null,
                insurance_company: insuranceCompany || null,
                loan_status: loanStatus,
                loan_notes: loanNotes.trim() || null,
              }
            : {}),
          ...(canEditFinanceStatus
            ? {
                deposit_status: depositStatus,
                payment_status: paymentStatus,
              }
            : {}),
          ...(canReassign && ownerId && ownerId !== booking?.owner_id
            ? { owner_id: ownerId }
            : {}),
          ...(canEditCarAttributes && carId !== (booking?.car_id ?? '')
            ? { car_id: carId || null }
            : {}),
        },
      })
      setSavedAt(Date.now())
    } catch (e) {
      setError(formatError(e))
    }
  }

  /** Manager-only: flip approval_status without touching other fields. */
  async function handleApprovalDecision(decision: 'approved' | 'rejected') {
    if (!canApproveDiscount) return
    setError(null)
    try {
      await updateMut.mutateAsync({
        id,
        patch: { approval_status: decision },
      })
      setSavedAt(Date.now())
    } catch (e) {
      setError(formatError(e))
    }
  }

  async function handleCancel() {
    if (
      !window.confirm(
        `Cancel booking ${booking?.code}? The record will be kept but marked as cancelled.`,
      )
    ) {
      return
    }
    setCancelling(true)
    setError(null)
    try {
      await updateMut.mutateAsync({ id, patch: { status: 'cancelled' } })
      setStatus('cancelled')
      setSavedAt(Date.now())
    } catch (e) {
      setError(formatError(e))
    } finally {
      setCancelling(false)
    }
  }

  /**
   * Hard delete — super_admin only. Two confirmations:
   *   1. Plain "are you sure" prompt
   *   2. Type the booking code to confirm (defeats accidental clicks)
   */
  async function handleDelete() {
    if (!booking) return
    if (
      !window.confirm(
        `PERMANENTLY DELETE booking ${booking.code}?\n\n` +
          'This wipes the record (and all attachments) from the database. ' +
          'There is no undo. Normally you should Cancel instead.',
      )
    ) {
      return
    }
    const typed = window.prompt(
      `To confirm, type the booking code exactly: ${booking.code}`,
    )
    if (typed !== booking.code) {
      setError('Booking code did not match — delete aborted.')
      return
    }
    setError(null)
    try {
      await deleteMut.mutateAsync(id)
      navigate('/bookings', { replace: true })
    } catch (e) {
      setError(formatError(e))
    }
  }

  if (isLoading) {
    return (
      <AppShell>
        <div className="rounded-2xl border border-gray-200 bg-white p-10 text-center text-sm text-gray-500">
          Loading…
        </div>
      </AppShell>
    )
  }

  if (loadError || !booking) {
    return (
      <AppShell>
        <div className="mb-4">
          <Link
            to="/bookings"
            className="text-sm text-gray-500 hover:text-gray-700"
          >
            ← Back to bookings
          </Link>
        </div>
        <div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-sm text-red-700">
          {loadError ?? 'Booking not available.'}
        </div>
      </AppShell>
    )
  }

  const variants = variantsFor(vehicleModel)

  return (
    <AppShell>
      <div className="mb-6 flex items-start justify-between gap-3">
        <div>
          <Link
            to="/bookings"
            className="text-sm text-gray-500 hover:text-gray-700"
          >
            ← Back to bookings
          </Link>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <h1 className="font-mono text-xl font-semibold text-gray-900">
              {booking.code}
            </h1>
            <span
              className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_BADGE[booking.status]}`}
            >
              {booking.status}
            </span>
            {booking.status !== 'cancelled' && (
              <DepositBadge status={booking.status} />
            )}
            {booking.status !== 'cancelled' &&
              booking.loan_status !== 'not_applicable' && (
                <span
                  className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${LOAN_BADGE[booking.loan_status]}`}
                >
                  {LOAN_LABEL[booking.loan_status]}
                </span>
              )}
            {booking.approval_status !== 'not_required' && (
              <span
                className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${APPROVAL_BADGE[booking.approval_status]}`}
              >
                {APPROVAL_LABEL[booking.approval_status]}
              </span>
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {booking.status !== 'cancelled' && canCancel && (
            <button
              type="button"
              onClick={handleCancel}
              disabled={cancelling || saving || deleteMut.isPending}
              className="rounded-lg border border-red-200 bg-white px-3 py-1.5 text-sm font-medium text-red-700 transition hover:bg-red-50 disabled:opacity-50"
            >
              {cancelling ? 'Cancelling…' : 'Cancel booking'}
            </button>
          )}
          {isSuperAdmin && (
            <button
              type="button"
              onClick={handleDelete}
              disabled={deleteMut.isPending || saving || cancelling}
              className="rounded-lg border border-rose-300 bg-rose-50 px-3 py-1.5 text-sm font-medium text-rose-800 transition hover:bg-rose-100 disabled:opacity-50"
              title="Super admin only — permanent delete"
            >
              {deleteMut.isPending ? 'Deleting…' : '★ Delete'}
            </button>
          )}
        </div>
      </div>

      <form
        onSubmit={handleSave}
        className="space-y-6 rounded-2xl border border-gray-200 bg-white p-5 sm:p-6"
      >
        {/* ---------- Customer ---------- */}
        <Section title="👤 Customer">
          <Field label="Full name" required>
            <input
              type="text"
              required
              value={customerName}
              onChange={(e) => setCustomerName(e.target.value)}
              className={inputClass}
            />
          </Field>
          <Field label="NRIC" required>
            <input
              type="text"
              required
              value={customerNric}
              onChange={(e) => setCustomerNric(e.target.value)}
              className={inputClass}
              inputMode="numeric"
            />
          </Field>
          <Field label="Phone" required>
            <input
              type="tel"
              required
              value={customerPhone}
              onChange={(e) => setCustomerPhone(e.target.value)}
              className={inputClass}
              inputMode="tel"
            />
          </Field>
          <Field label="Email">
            <input
              type="email"
              value={customerEmail}
              onChange={(e) => setCustomerEmail(e.target.value)}
              className={inputClass}
            />
          </Field>
        </Section>

        {/* ---------- Vehicle ---------- */}
        <Section title="🚗 Vehicle">
          <Field label="Model" required>
            <select
              required
              value={vehicleModel}
              onChange={(e) => handleModelChange(e.target.value)}
              className={inputClass}
            >
              {PROTON_MODELS.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Variant" required>
            <select
              required
              value={vehicleVariant}
              onChange={(e) => setVehicleVariant(e.target.value)}
              className={inputClass}
            >
              <option value="">— Select variant —</option>
              {variants.map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Color" required>
            <input
              type="text"
              required
              value={vehicleColor}
              onChange={(e) => setVehicleColor(e.target.value)}
              className={inputClass}
            />
          </Field>
        </Section>

        {/* ---------- Pricing ---------- */}
        <Section title="💰 Pricing (MYR)">
          <Field label="OTR price" required>
            <input
              type="number"
              required
              min={0}
              step="0.01"
              value={otrPrice}
              onChange={(e) => setOtrPrice(e.target.value)}
              className={inputClass}
              inputMode="decimal"
            />
          </Field>
          <Field label="Booking fee paid" required>
            <input
              type="number"
              required
              min={0}
              step="0.01"
              value={bookingFee}
              onChange={(e) => setBookingFee(e.target.value)}
              className={inputClass}
              inputMode="decimal"
            />
          </Field>
          <Field label="Discount (MYR off OTR)">
            <input
              type="number"
              min={0}
              step="0.01"
              value={discountAmount}
              onChange={(e) => setDiscountAmount(e.target.value)}
              className={inputClass}
              inputMode="decimal"
              placeholder="0"
            />
          </Field>
          <div className="sm:col-span-1">
            <label className="block text-sm">
              <span className="mb-1 block font-medium text-gray-700">
                Discount approval
              </span>
              <div
                className={`inline-flex w-full items-center justify-between rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm`}
              >
                <span
                  className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${APPROVAL_BADGE[booking.approval_status]}`}
                >
                  {APPROVAL_LABEL[booking.approval_status]}
                </span>
                {canApproveDiscount &&
                  booking.approval_status === 'pending' && (
                    <span className="flex gap-1">
                      <button
                        type="button"
                        onClick={() => handleApprovalDecision('approved')}
                        disabled={updateMut.isPending}
                        className="rounded-lg bg-green-600 px-2 py-0.5 text-xs font-medium text-white hover:bg-green-700 disabled:opacity-50"
                      >
                        Approve
                      </button>
                      <button
                        type="button"
                        onClick={() => handleApprovalDecision('rejected')}
                        disabled={updateMut.isPending}
                        className="rounded-lg bg-red-600 px-2 py-0.5 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-50"
                      >
                        Reject
                      </button>
                    </span>
                  )}
              </div>
            </label>
          </div>
        </Section>

        {/* ---------- Dates + status ---------- */}
        <Section title="📅 Date & status">
          <Field label="Booking date" required>
            <input
              type="date"
              required
              value={bookingDate}
              onChange={(e) => setBookingDate(e.target.value)}
              className={inputClass}
            />
          </Field>
          <Field label="Status">
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value as BookingStatus)}
              className={inputClass}
            >
              {STATUSES.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </Field>
        </Section>

        {/* ---------- Notes ---------- */}
        <Section title="📝 Notes">
          <div className="sm:col-span-2">
            <textarea
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className={`${inputClass} min-h-20`}
            />
          </div>
        </Section>

        {/* ---------- Linked car (inventory) ---------- */}
        <section className="rounded-xl border border-gray-200 bg-white p-4 sm:p-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-gray-900">
              🚙 Linked car
            </h2>
            {!canEditCarAttributes && (
              <span className="text-xs text-gray-500">
                🔒 General Admin assigns inventory
              </span>
            )}
          </div>

          {canEditCarAttributes ? (
            <Field label="Inventory unit">
              <select
                value={carId}
                onChange={(e) => setCarId(e.target.value)}
                className={inputClass}
              >
                <option value="">— Not yet assigned —</option>
                {/* Show: the currently-linked car (even if not in_stock) +
                    every other in_stock car. Stops you from being stuck if
                    the car is already reserved by this booking. */}
                {cars
                  ?.filter(
                    (c) => c.status === 'in_stock' || c.id === booking.car_id,
                  )
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.chassis_no} · {c.model}
                      {c.variant ? ` ${c.variant}` : ''}
                      {c.color ? ` · ${c.color}` : ''}
                    </option>
                  ))}
              </select>
            </Field>
          ) : linkedCar ? (
            <Link
              to={`/cars/${linkedCar.id}`}
              className="block rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 hover:bg-gray-100"
            >
              <div className="font-mono text-xs text-gray-600">
                {linkedCar.chassis_no}
              </div>
              <div className="text-sm text-gray-900">
                {linkedCar.model}
                {linkedCar.variant ? ` · ${linkedCar.variant}` : ''}
                {linkedCar.color ? ` · ${linkedCar.color}` : ''}
              </div>
            </Link>
          ) : (
            <div className="rounded-lg border border-dashed border-gray-200 px-3 py-2 text-xs text-gray-500">
              No inventory unit assigned yet.
            </div>
          )}

          {/* Surface the floor-stock state so non-finance roles know why
              delivery is blocked when the bank hasn't been settled. */}
          {linkedCar && linkedCar.floor_stock_status !== 'paid_off' && (
            <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              ⚠ This car is{' '}
              <span className="font-semibold">
                {FLOOR_STOCK_LABEL[linkedCar.floor_stock_status as FloorStockStatus]}
              </span>{' '}
              — delivery is blocked until Finance Admin marks it{' '}
              <span className="font-semibold">Paid off</span>.
            </div>
          )}
        </section>

        {/* ---------- Finance / Accountant: deposit + payment status ---------- */}
        <section className="rounded-xl border border-amber-200 bg-amber-50/50 p-4 sm:p-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-amber-900">
              💰 Finance status
            </h2>
            {!canEditFinanceStatus && (
              <span className="text-xs text-gray-500">
                🔒 Finance Admin / Accountant only
              </span>
            )}
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Deposit">
              <select
                disabled={!canEditFinanceStatus}
                value={depositStatus}
                onChange={(e) =>
                  setDepositStatus(e.target.value as DepositStatus)
                }
                className={readonlyInputClass(canEditFinanceStatus)}
              >
                {DEPOSIT_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Payment">
              <select
                disabled={!canEditFinanceStatus}
                value={paymentStatus}
                onChange={(e) =>
                  setPaymentStatus(e.target.value as PaymentStatus)
                }
                className={readonlyInputClass(canEditFinanceStatus)}
              >
                {PAYMENT_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </Field>
          </div>
        </section>

        {/* ---------- Sales Manager: reassign owner ---------- */}
        {canReassign && profiles && (
          <section className="rounded-xl border border-blue-200 bg-blue-50/50 p-4 sm:p-5">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-blue-900">
                🔁 Owner
              </h2>
              <span className="text-xs text-gray-500">
                Manager-only: reassign this lead
              </span>
            </div>
            <Field label="Assigned to">
              <select
                value={ownerId}
                onChange={(e) => setOwnerId(e.target.value)}
                className={inputClass}
              >
                {profiles.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.full_name || p.email}{' '}
                    {p.role !== 'sales_advisor' ? `· ${p.role}` : ''}
                  </option>
                ))}
              </select>
            </Field>
          </section>
        )}

        {/* ---------- Finance Admin: Loan & Insurance ---------- */}
        <section className="rounded-xl border border-purple-200 bg-purple-50/50 p-4 sm:p-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-purple-900">
              🏛️ Loan & Insurance
            </h2>
            {!isFinanceAdmin && (
              <span className="text-xs text-gray-500">🔒 Finance Admin only</span>
            )}
          </div>

          <div className="mb-3 text-xs text-gray-600">
            Deposit:{' '}
            {booking.status === 'confirmed' || booking.status === 'delivered'
              ? '✅ received'
              : booking.status === 'cancelled'
                ? '— booking cancelled'
                : '⏳ awaiting admin to collect'}
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Loan bank">
              <select
                disabled={!isFinanceAdmin}
                value={loanBank}
                onChange={(e) => setLoanBank(e.target.value)}
                className={readonlyInputClass(isFinanceAdmin)}
              >
                <option value="">
                  {isFinanceAdmin ? '— Select bank —' : '— Not set yet —'}
                </option>
                {LOAN_BANKS.map((b) => (
                  <option key={b} value={b}>
                    {b}
                  </option>
                ))}
                {loanBank &&
                  !LOAN_BANKS.includes(loanBank as (typeof LOAN_BANKS)[number]) && (
                    <option value={loanBank}>{loanBank}</option>
                  )}
              </select>
            </Field>

            <Field label="Insurance company">
              <select
                disabled={!isFinanceAdmin}
                value={insuranceCompany}
                onChange={(e) => setInsuranceCompany(e.target.value)}
                className={readonlyInputClass(isFinanceAdmin)}
              >
                <option value="">
                  {isFinanceAdmin ? '— Select insurer —' : '— Not set yet —'}
                </option>
                {INSURERS.map((i) => (
                  <option key={i} value={i}>
                    {i}
                  </option>
                ))}
                {insuranceCompany &&
                  !INSURERS.includes(
                    insuranceCompany as (typeof INSURERS)[number],
                  ) && (
                    <option value={insuranceCompany}>{insuranceCompany}</option>
                  )}
              </select>
            </Field>
          </div>

          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Loan status">
              <select
                disabled={!isFinanceAdmin}
                value={loanStatus}
                onChange={(e) => setLoanStatus(e.target.value as LoanStatus)}
                className={readonlyInputClass(isFinanceAdmin)}
              >
                {LOAN_STATUSES.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Loan notes">
              <input
                type="text"
                disabled={!isFinanceAdmin}
                value={loanNotes}
                onChange={(e) => setLoanNotes(e.target.value)}
                className={readonlyInputClass(isFinanceAdmin)}
                placeholder={
                  loanStatus === 'rejected'
                    ? 'Why rejected? Next bank to try?'
                    : 'Any context to remember'
                }
              />
            </Field>
          </div>

          {loanStatus === 'approved' && (
            <div className="mt-3 rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-xs text-green-800">
              ✅ Loan approved. Admin can now proceed with JPJ.
            </div>
          )}
          {loanStatus === 'rejected' && (
            <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
              ✗ Loan rejected. SA: notify customer, pick another bank, ask
              admin to update Loan bank, then change status back to Pending.
            </div>
          )}
        </section>

        {/* ---------- Meta ---------- */}
        <div className="grid grid-cols-1 gap-2 border-t border-gray-100 pt-4 text-xs text-gray-500 sm:grid-cols-2">
          <div>Created: {formatTimestamp(booking.created_at)}</div>
          <div className="sm:text-right">
            Last updated: {formatTimestamp(booking.updated_at)}
          </div>
        </div>

        {error && (
          <div
            role="alert"
            className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
          >
            {error}
          </div>
        )}

        {savedAt && !error && (
          <div className="rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700">
            Saved ✓
          </div>
        )}

        <div className="flex items-center justify-end gap-3 border-t border-gray-100 pt-4">
          <Link
            to="/bookings"
            className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
          >
            Back
          </Link>
          <button
            type="submit"
            disabled={saving || cancelling}
            className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-gray-800 disabled:opacity-60"
          >
            {saving ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </form>

      {/* Attachments live outside the booking form — they're independent. */}
      <div className="mt-6 space-y-4">
        <AttachmentSection
          bookingId={booking.id}
          bookingCode={booking.code}
          kind="bank_transaction"
          title="🏦 Bank transaction"
          description="Deposit / payment slips, online transfer screenshots, etc."
          items={attachmentsByKind.bank_transaction}
          onChange={refreshAttachments}
        />
        <AttachmentSection
          bookingId={booking.id}
          bookingCode={booking.code}
          kind="bank_statement"
          title="💳 Bank statement"
          description="Customer bank statement — only needed for cancellation refunds."
          items={attachmentsByKind.bank_statement}
          onChange={refreshAttachments}
        />
        <AttachmentSection
          bookingId={booking.id}
          bookingCode={booking.code}
          kind="lou"
          title="📃 Letter of Undertaking (LOU)"
          description="Employer LOU, loan undertaking, guarantor letter, etc."
          items={attachmentsByKind.lou}
          onChange={refreshAttachments}
        />
        <AttachmentSection
          bookingId={booking.id}
          bookingCode={booking.code}
          kind="cancellation_form"
          title="❌ Cancellation form"
          description="Signed cancellation form if the customer backs out."
          items={attachmentsByKind.cancellation_form}
          onChange={refreshAttachments}
        />
      </div>

      <AuditLogPanel tableName="bookings" rowId={booking.id} />
    </AppShell>
  )
}

// ----- small layout helpers -------------------------------------------------

const inputClass =
  'w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm outline-none focus:border-gray-900 focus:ring-2 focus:ring-gray-900/10'

/** Like inputClass but visually muted + disabled when the caller can't edit. */
function readonlyInputClass(editable: boolean) {
  return editable
    ? inputClass
    : 'w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-700 outline-none cursor-not-allowed'
}

function DepositBadge({ status }: { status: BookingStatus }) {
  const received = status === 'confirmed' || status === 'delivered'
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${
        received
          ? 'bg-green-100 text-green-800'
          : 'bg-gray-100 text-gray-600'
      }`}
    >
      {received ? '✓ Deposit received' : '⏳ Awaiting deposit'}
    </span>
  )
}

function Section({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <section>
      <h2 className="mb-3 text-sm font-semibold text-gray-700">{title}</h2>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">{children}</div>
    </section>
  )
}

function Field({
  label,
  required,
  children,
}: {
  label: string
  required?: boolean
  children: React.ReactNode
}) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block font-medium text-gray-700">
        {label}
        {required && <span className="ml-0.5 text-red-500">*</span>}
      </span>
      {children}
    </label>
  )
}
