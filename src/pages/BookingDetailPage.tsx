import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { AppShell } from '../components/AppShell'
import { AttachmentSection } from '../components/AttachmentSection'
import { BookingActivityLog } from '../components/AuditLogPanel'
import { DocumentSubmissionCards } from '../components/DocumentSubmissionCards'
import { useAuth } from '../lib/auth'
import {
  qk,
  useAttachments,
  useBooking,
  useCars,
  useCustomer,
  useDeleteBooking,
  useUpdateBooking,
  useUpdateCustomer,
} from '../lib/queries'
import { formatError } from '../lib/errors'
// hpDocument pulls in jszip (~90 KB gz). Only loaded on Print-HP click so
// the read-a-booking path stays lean.
// (dynamic-imported inside handlePrintHp)
import {
  PROTON_MODELS,
  coloursFor,
  variantsFor,
} from '../data/proton-models'
import { LOAN_BANKS, INSURERS } from '../data/banks-and-insurers'
import type {
  Attachment,
  AttachmentKind,
  BookingStatus,
  DepositStatus,
  FloorStockStatus,
  LoanStatus,
  PaymentStatus,
} from '../lib/types'
import { COMMISSION_LABEL, FLOOR_STOCK_LABEL } from '../lib/types'
import { formatMYR } from '../lib/format'

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

const PAYMENT_OPTIONS: { value: PaymentStatus; label: string }[] = [
  { value: 'unpaid', label: 'Unpaid' },
  { value: 'partial', label: 'Partially paid' },
  { value: 'paid', label: 'Fully paid' },
]

const PAYMENT_LABEL: Record<PaymentStatus, string> = Object.fromEntries(
  PAYMENT_OPTIONS.map((o) => [o.value, o.label]),
) as Record<PaymentStatus, string>

const LOAN_STATUS_LABEL: Record<LoanStatus, string> = Object.fromEntries(
  LOAN_STATUSES.map((o) => [o.value, o.label]),
) as Record<LoanStatus, string>

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
    role,
    isAdmin,
    isFinanceAdmin,
    canCancel,
    canApproveDiscount,
    canEditFinanceStatus,
    canAssignCar,
    canAccessSales,
    isSuperAdmin,
  } = useAuth()
  const isSalesAdvisor = role === 'sales_advisor'
  const qc = useQueryClient()

  const { data: booking, error: bookingErr, isLoading } = useBooking(id)
  const { data: attachments } = useAttachments(id)
  // Owner reassignment dropdown — only manager needs the profile list, and
  // Owner reassignment UI is currently hidden — profiles fetch not needed.
  // Cars list — used both for the general_admin dropdown and to look up
  // the linked car's chassis / floor-stock for everyone else's read-only
  // display. Small data, RLS lets everyone read, cached by React Query.
  const { data: cars } = useCars()
  const updateMut = useUpdateBooking()
  const deleteMut = useDeleteBooking()
  // Customer record linked to this booking, when present. Falls back to the
  // booking's customer_* snapshot for legacy rows that haven't been backfilled.
  const customerQuery = useCustomer(booking?.customer_id ?? null)
  const updateCustomerMut = useUpdateCustomer()

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
  const [customerAddress, setCustomerAddress] = useState('')
  const [vehicleModel, setVehicleModel] = useState<string>(PROTON_MODELS[0])
  const [vehicleVariant, setVehicleVariant] = useState('')
  const [vehicleColor, setVehicleColor] = useState<string[]>([])
  /** Free-text fallback (when the model has no preset palette). */
  const [vehicleColorFree, setVehicleColorFree] = useState('')
  // OTR is hidden from the UI but the column is preserved; we leave whatever
  // was stored alone on save (no patch sent).
  const [bookingFee, setBookingFee] = useState('')
  const [discountAmount, setDiscountAmount] = useState('')
  const [specialSupport, setSpecialSupport] = useState('')
  const [bookingDate, setBookingDate] = useState('')
  const [notes, setNotes] = useState('')
  const [loanBank, setLoanBank] = useState('')
  const [insuranceCompany, setInsuranceCompany] = useState('')
  const [loanStatus, setLoanStatus] = useState<LoanStatus>('not_applicable')
  const [loanNotes, setLoanNotes] = useState('')
  const [loanAmount, setLoanAmount] = useState('')
  const [depositStatus, setDepositStatus] = useState<DepositStatus>('unpaid')
  const [paymentStatus, setPaymentStatus] = useState<PaymentStatus>('unpaid')
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
    // Upload/remove now lands in the booking Activity log too — refresh it.
    qc.invalidateQueries({ queryKey: qk.auditBooking(id) })
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
  // Customer fields prefer the canonical customer record; the booking's
  // customer_* snapshot is only a fallback for rows that pre-date the
  // customers table (customer_id null).
  useEffect(() => {
    if (!booking) return
    const c = customerQuery.data
    if (c) {
      setCustomerName(c.name)
      setCustomerNric(c.nric)
      setCustomerPhone(c.phone)
      setCustomerEmail(c.email ?? '')
      setCustomerAddress(c.address ?? '')
    } else {
      setCustomerName(booking.customer_name)
      setCustomerNric(booking.customer_nric)
      setCustomerPhone(booking.customer_phone)
      setCustomerEmail(booking.customer_email ?? '')
      setCustomerAddress('')
    }
    setVehicleModel(booking.vehicle_model)
    setVehicleVariant(booking.vehicle_variant)
    {
      const arr = booking.vehicle_color ?? []
      setVehicleColor(arr)
      // Pre-fill the free-text fallback for models without a preset
      // palette so the user can keep editing the colours they saw.
      setVehicleColorFree(arr.join(', '))
    }
    setBookingFee(String(booking.booking_fee))
    setDiscountAmount(String(booking.discount_amount ?? 0))
    setSpecialSupport(String(booking.special_support ?? 0))
    setBookingDate(booking.booking_date)
    setNotes(booking.notes ?? '')
    setLoanBank(booking.loan_bank ?? '')
    setInsuranceCompany(booking.insurance_company ?? '')
    setLoanStatus(booking.loan_status ?? 'not_applicable')
    setLoanNotes(booking.loan_notes ?? '')
    setLoanAmount(
      booking.loan_amount != null ? String(booking.loan_amount) : '',
    )
    setDepositStatus(booking.deposit_status ?? 'unpaid')
    // No booking fee → default the Payment pull-down to Fully paid (there's
    // no deposit owed). Only overrides the 'unpaid' default, so a finance
    // admin's explicit partial/paid choice is preserved.
    setPaymentStatus(
      Number(booking.booking_fee) === 0 &&
        (booking.payment_status ?? 'unpaid') === 'unpaid'
        ? 'paid'
        : (booking.payment_status ?? 'unpaid'),
    )
    setCarId(booking.car_id ?? '')
  }, [booking, customerQuery.data])

  function handleModelChange(newModel: string) {
    setVehicleModel(newModel)
    // If the previously chosen variant or colour isn't valid for the new
    // model, reset that field so the form doesn't display a stale value.
    if (!variantsFor(newModel).includes(vehicleVariant)) {
      setVehicleVariant('')
    }
    const palette = coloursFor(newModel)
    if (palette.length > 0) {
      // Drop any selected colours that aren't in the new model's palette.
      setVehicleColor((cur) => cur.filter((c) => palette.includes(c)))
    }
  }

  function toggleColour(c: string) {
    setVehicleColor((cur) =>
      cur.includes(c) ? cur.filter((x) => x !== c) : [...cur, c],
    )
  }

  async function handleSave(e: FormEvent) {
    e.preventDefault()
    setError(null)
    try {
      // If this booking is linked to a customer row, save customer-level
      // fields to the customer table first. The booking row keeps a
      // snapshot of the same values for backward compat / historical
      // reads, but the customer record is the canonical source.
      if (booking?.customer_id) {
        await updateCustomerMut.mutateAsync({
          id: booking.customer_id,
          patch: {
            name: customerName,
            nric: customerNric,
            phone: customerPhone,
            email: customerEmail || null,
            address: customerAddress || null,
          },
        })
      }

      await updateMut.mutateAsync({
        id,
        patch: {
          customer_name: customerName.trim(),
          customer_nric: customerNric.trim(),
          customer_phone: customerPhone.trim(),
          customer_email: customerEmail.trim() || null,
          vehicle_model: vehicleModel,
          vehicle_variant: vehicleVariant,
          vehicle_color: (() => {
            const fromFree = vehicleColorFree
              .split(',')
              .map((s) => s.trim())
              .filter(Boolean)
            return vehicleColor.length > 0 ? vehicleColor : fromFree
          })(),
          booking_fee: Number(bookingFee) || 0,
          discount_amount: Number(discountAmount) || 0,
          booking_date: bookingDate,
          notes: notes.trim() || null,
          // special_support is SM-only; non-SM callers must omit it from the
          // patch entirely or the DB guard will reject the whole PATCH.
          ...(canApproveDiscount &&
          Number(specialSupport || 0) !==
            Number(booking?.special_support ?? 0)
            ? { special_support: Number(specialSupport) || 0 }
            : {}),
          // Send each role-gated bucket of fields ONLY when the caller is
          // allowed to write them; otherwise the DB trigger will reject the
          // whole PATCH because something is "distinct from" the old value.
          ...(isFinanceAdmin
            ? {
                loan_bank: loanBank || null,
                insurance_company: insuranceCompany || null,
                loan_status: loanStatus,
                loan_notes: loanNotes.trim() || null,
                loan_amount:
                  loanAmount.trim() === '' ? null : Number(loanAmount),
              }
            : {}),
          ...(canEditFinanceStatus
            ? {
                deposit_status: depositStatus,
                payment_status: paymentStatus,
              }
            : {}),
          ...(canAssignCar && carId !== (booking?.car_id ?? '')
            ? { car_id: carId || null }
            : {}),
        },
      })
      setSavedAt(Date.now())
    } catch (e) {
      setError(formatError(e))
    }
  }

  /** Manager-only: flip commission_status (Approve / Reject). The "Paid"
   * transition happens via the /commissions page payout batch flow. */
  async function handleCommissionDecision(
    decision: 'approved' | 'rejected',
  ) {
    if (!canApproveDiscount) return
    setError(null)
    try {
      await updateMut.mutateAsync({
        id,
        // approval_status is unrelated; we send commission_status only
        patch: { commission_status: decision } as never,
      })
      setSavedAt(Date.now())
    } catch (e) {
      setError(formatError(e))
    }
  }

  async function handlePrintHp() {
    if (!booking) return
    if (booking.loan_amount == null) {
      setError(
        'Loan amount is not set yet — Finance Admin must fill it in (and save) before the HP letter can be generated.',
      )
      return
    }
    setError(null)
    try {
      const customerName =
        customerQuery.data?.name ?? booking.customer_name
      const { generateHpLetter } = await import('../lib/hpDocument')
      await generateHpLetter({
        customerName,
        loanAmount: Number(booking.loan_amount),
      })
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

  // Sales-side page: workshop-only roles aren't supposed to see bookings.
  // Run AFTER hooks above so React rules-of-hooks are satisfied.
  if (canAccessSales === false) return <Navigate to="/" replace />

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
              <DepositBadge
                status={booking.status}
                fee={Number(booking.booking_fee) || 0}
              />
            )}
            {booking.status !== 'cancelled' &&
              booking.loan_status !== 'not_applicable' && (
                <span
                  className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${LOAN_BADGE[booking.loan_status]}`}
                >
                  {LOAN_LABEL[booking.loan_status]}
                </span>
              )}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {booking.status === 'delivered' && isAdmin && (
            <button
              type="button"
              onClick={handlePrintHp}
              disabled={saving || cancelling || deleteMut.isPending}
              title={
                booking.loan_amount == null
                  ? 'Set the loan amount in the Finance section first, then save.'
                  : 'Download the HP disbursement letter pre-filled for this customer.'
              }
              className="rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-sm font-medium text-emerald-800 transition hover:bg-emerald-100 disabled:opacity-50"
            >
              🖨 Print HP form
            </button>
          )}
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
              onChange={(e) =>
                setCustomerNric(e.target.value.replace(/\D/g, ''))
              }
              className={inputClass}
              inputMode="numeric"
              pattern="[0-9]{12}"
              maxLength={12}
              title="NRIC must be exactly 12 digits"
            />
          </Field>
          <Field label="Phone" required>
            <input
              type="tel"
              required
              value={customerPhone}
              onChange={(e) =>
                setCustomerPhone(e.target.value.replace(/\D/g, ''))
              }
              className={inputClass}
              inputMode="numeric"
              pattern="[0-9]{10,11}"
              minLength={10}
              maxLength={11}
              title="Phone must be 10 or 11 digits"
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
          <div className="sm:col-span-2">
            <Field label="Address">
              <textarea
                rows={2}
                value={customerAddress}
                onChange={(e) => setCustomerAddress(e.target.value)}
                className={`${inputClass} min-h-16`}
                placeholder="Street, postcode, state…"
              />
            </Field>
          </div>
          {booking?.customer_id && (
            <div className="sm:col-span-2 text-[11px] text-gray-500">
              ℹ Customer record is shared — edits here update every booking
              for this NRIC.
            </div>
          )}
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
          <Field label="Color (pick one or more)" required>
            {(() => {
              const palette = coloursFor(vehicleModel)
              if (palette.length === 0) {
                // No factory palette for this model (e.g. Persona) —
                // free-text, comma-separated for multi-colour entry.
                return (
                  <input
                    type="text"
                    required
                    value={vehicleColorFree}
                    onChange={(e) => setVehicleColorFree(e.target.value)}
                    className={inputClass}
                    placeholder="e.g. Snow White, Jet Grey"
                  />
                )
              }
              // Legacy bookings may carry a colour that isn't in the
              // current palette; merge it in so we don't silently drop it.
              const options = Array.from(
                new Set([...palette, ...vehicleColor]),
              )
              return (
                <>
                  <div className="flex flex-wrap gap-2">
                    {options.map((c) => {
                      const on = vehicleColor.includes(c)
                      return (
                        <button
                          key={c}
                          type="button"
                          onClick={() => toggleColour(c)}
                          className={`rounded-full border px-3 py-1 text-xs font-medium transition ${
                            on
                              ? 'border-gray-900 bg-gray-900 text-white'
                              : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'
                          }`}
                        >
                          {on ? '✓ ' : ''}
                          {c}
                        </button>
                      )
                    })}
                  </div>
                  <div className="mt-1 text-[10px] text-gray-500">
                    {vehicleColor.length === 0
                      ? 'Tick at least one colour.'
                      : `Selected: ${vehicleColor.join(', ')}`}
                  </div>
                </>
              )
            })()}
          </Field>
        </Section>

        {/* ---------- Pricing ---------- */}
        <Section title="💰 Pricing (MYR)">
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
          <Field label="Discount (MYR)">
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
          <Field label="Special support (MYR)">
            <input
              type="number"
              min={0}
              step="0.01"
              disabled={!canApproveDiscount}
              value={specialSupport}
              onChange={(e) => setSpecialSupport(e.target.value)}
              className={readonlyInputClass(canApproveDiscount)}
              inputMode="decimal"
              placeholder="0"
            />
            <span className="mt-1 block text-xs text-gray-500">
              {canApproveDiscount
                ? 'Manager-granted bonus added on top of SA commission.'
                : '🔒 Sales Manager only — bumps the SA commission up.'}
            </span>
          </Field>
        </Section>

        {/* ---------- Date ---------- */}
        <Section title="📅 Date">
          <Field label="Booking date" required>
            <input
              type="date"
              required
              value={bookingDate}
              onChange={(e) => setBookingDate(e.target.value)}
              className={inputClass}
            />
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
            {!canAssignCar && (
              <span className="text-xs text-gray-500">
                🔒 General Admin or Sales Manager assigns inventory
              </span>
            )}
          </div>

          {canAssignCar ? (
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
            isSalesAdvisor ? (
              <div className="block rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
                <div className="font-mono text-xs text-gray-600">
                  {linkedCar.chassis_no}
                </div>
                <div className="text-sm text-gray-900">
                  {linkedCar.model}
                  {linkedCar.variant ? ` · ${linkedCar.variant}` : ''}
                  {linkedCar.color ? ` · ${linkedCar.color}` : ''}
                </div>
              </div>
            ) : (
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
            )
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

        {/* ---------- Commission (read-only for most; SM gets Approve/Reject) ---- */}
        <section className="rounded-xl border border-blue-200 bg-blue-50/40 p-4 sm:p-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-blue-900">
              💸 Commission
            </h2>
            <span
              className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                booking.commission_status === 'paid'
                  ? 'bg-green-100 text-green-800'
                  : booking.commission_status === 'approved'
                    ? 'bg-blue-100 text-blue-800'
                    : booking.commission_status === 'rejected'
                      ? 'bg-red-100 text-red-700'
                      : booking.commission_status === 'pending'
                        ? 'bg-amber-100 text-amber-800'
                        : 'bg-gray-100 text-gray-600'
              }`}
            >
              {COMMISSION_LABEL[booking.commission_status]}
            </span>
          </div>

          {/* Auto-applied HQ + Dealer support (read-only strip). These
              come from the commission schedule at insert time. */}
          {(Number(booking.hq_discount ?? 0) > 0 ||
            Number(booking.dealer_support ?? 0) > 0) && (
            <div className="mb-3 grid grid-cols-2 gap-3 text-sm sm:gap-4">
              <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
                <div className="text-[10px] uppercase tracking-wider text-gray-500">
                  HQ discount (auto)
                </div>
                <div className="mt-1 tabular-nums text-gray-900">
                  {formatMYR(Number(booking.hq_discount ?? 0))}
                </div>
              </div>
              <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
                <div className="text-[10px] uppercase tracking-wider text-gray-500">
                  Dealer support (auto)
                </div>
                <div className="mt-1 tabular-nums text-gray-900">
                  {formatMYR(Number(booking.dealer_support ?? 0))}
                </div>
              </div>
            </div>
          )}

          {booking.base_commission == null ? (
            <div className="rounded-lg border border-dashed border-gray-200 bg-white p-3 text-xs text-gray-500">
              No commission schedule set for{' '}
              <span className="font-medium">
                {booking.vehicle_model}
                {booking.vehicle_variant ? ` · ${booking.vehicle_variant}` : ''}
              </span>
              . Super admin can add a row at /admin/commissions — this booking
              picks it up automatically (refresh the page).
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4 sm:gap-4">
              <div className="rounded-lg border border-gray-200 bg-white p-3">
                <div className="text-[10px] uppercase tracking-wider text-gray-500">
                  Base
                </div>
                <div className="mt-1 tabular-nums text-gray-900">
                  {formatMYR(Number(booking.base_commission))}
                </div>
              </div>
              <div className="rounded-lg border border-gray-200 bg-white p-3">
                <div className="text-[10px] uppercase tracking-wider text-gray-500">
                  − Discount
                </div>
                <div className="mt-1 tabular-nums text-rose-700">
                  −{formatMYR(Number(booking.discount_amount ?? 0))}
                </div>
              </div>
              <div className="rounded-lg border border-gray-200 bg-white p-3">
                <div className="text-[10px] uppercase tracking-wider text-gray-500">
                  + Special support
                </div>
                <div className="mt-1 tabular-nums text-emerald-700">
                  +{formatMYR(Number(booking.special_support ?? 0))}
                </div>
              </div>
              {(() => {
                const saEarns = Number(booking.commission_amount ?? 0)
                const negative = saEarns < 0
                return (
                  <div
                    className={
                      negative
                        ? 'rounded-lg border border-rose-300 bg-rose-100/60 p-3'
                        : 'rounded-lg border border-blue-300 bg-blue-100/50 p-3'
                    }
                  >
                    <div
                      className={
                        negative
                          ? 'text-[10px] uppercase tracking-wider text-rose-800'
                          : 'text-[10px] uppercase tracking-wider text-blue-800'
                      }
                    >
                      {negative ? '= SA owes' : '= SA earns'}
                    </div>
                    <div
                      className={
                        negative
                          ? 'mt-1 tabular-nums font-semibold text-rose-900'
                          : 'mt-1 tabular-nums font-semibold text-blue-900'
                      }
                    >
                      {formatMYR(saEarns)}
                    </div>
                  </div>
                )
              })()}
            </div>
          )}

          {/* SM inline Approve/Reject when pending */}
          {canApproveDiscount &&
            booking.commission_status === 'pending' && (
              <div className="mt-3 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => handleCommissionDecision('approved')}
                  disabled={updateMut.isPending}
                  className="rounded-lg bg-green-600 px-3 py-1 text-xs font-medium text-white hover:bg-green-700 disabled:opacity-50"
                >
                  Approve commission
                </button>
                <button
                  type="button"
                  onClick={() => handleCommissionDecision('rejected')}
                  disabled={updateMut.isPending}
                  className="rounded-lg bg-red-600 px-3 py-1 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-50"
                >
                  Reject
                </button>
              </div>
            )}

          {booking.commission_status === 'pending' && !canApproveDiscount && (
            <div className="mt-3 text-xs text-gray-500">
              Awaiting Sales Manager approval.
            </div>
          )}
        </section>

        {/* SA gets Finance + Loan side-by-side (condensed); other roles see
            them stacked full-width with the SM "reassign owner" block between.
            `contents` removes the wrapper from layout for the non-SA path. */}
        <div
          className={
            isSalesAdvisor
              ? 'grid grid-cols-1 gap-4 sm:grid-cols-2'
              : 'contents'
          }
        >
        {/* ---------- Finance Admin: deposit + payment status -----------------
            SAs get a condensed one-line view; everyone else sees the editable
            form (Finance Admin edits, others see disabled inputs). */}
        <section className="rounded-xl border border-amber-200 bg-amber-50/50 px-4 py-3">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <h2 className="text-sm font-semibold text-amber-900">
              💰 Finance status
            </h2>
            <div className="ml-auto flex items-center gap-2">
              <span className="text-xs font-medium text-gray-600">Payment</span>
              {isSalesAdvisor ? (
                <span className="text-sm font-medium text-gray-900">
                  {PAYMENT_LABEL[booking.payment_status]}
                </span>
              ) : (
                <div className="w-40">
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
                </div>
              )}
              {!canEditFinanceStatus && (
                <span
                  className="text-xs text-gray-500"
                  title="Finance Admin only"
                >
                  🔒
                </span>
              )}
            </div>
          </div>
          <div className="mt-2 text-xs text-gray-700">
            Deposit:{' '}
            <span className="font-medium">
              {depositSummary(Number(booking.booking_fee) || 0, booking.status)}
            </span>
          </div>
        </section>

        {/* Owner reassignment UI removed 2026-05-23 per request. owner_id
            stays on the DB row and is still SM-only-writable at the trigger;
            re-enable here if lead reassignment comes back. */}

        {/* ---------- Finance Admin: Loan & Insurance ----------
            SA sees a one-line summary; Finance Admin sees the full editable
            form; other privileged roles see the form disabled. */}
        <section className="rounded-xl border border-purple-200 bg-purple-50/50 p-4 sm:p-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-purple-900">
              🏛️ Loan & Insurance
            </h2>
            {!isFinanceAdmin && (
              <span className="text-xs text-gray-500">🔒 Finance Admin only</span>
            )}
          </div>

          {isSalesAdvisor ? (
            <div className="text-sm text-gray-800">
              Loan:{' '}
              <span className="font-medium">
                {booking.loan_bank || '— not set —'}
              </span>
              {' — '}
              <span className="font-medium">
                {LOAN_STATUS_LABEL[booking.loan_status]}
              </span>
              {' · '}Insurance:{' '}
              <span className="font-medium">
                {booking.insurance_company || '— not set —'}
              </span>
              {booking.loan_notes ? (
                <div className="mt-1 text-xs text-gray-600">
                  Notes: {booking.loan_notes}
                </div>
              ) : null}
            </div>
          ) : (
            <>
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
            <Field label="Loan amount (MYR)">
              <input
                type="number"
                min={0}
                step="0.01"
                inputMode="decimal"
                disabled={!isFinanceAdmin}
                value={loanAmount}
                onChange={(e) => setLoanAmount(e.target.value)}
                className={readonlyInputClass(isFinanceAdmin)}
                placeholder="e.g. 95000"
              />
            </Field>
            <div className="sm:col-span-2">
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
          </div>
            </>
          )}

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
        </div>

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

      {(isSalesAdvisor || canApproveDiscount || isSuperAdmin) && (
        <DocumentSubmissionCards
          booking={booking}
          canUpload={isSalesAdvisor || canApproveDiscount || isSuperAdmin}
        />
      )}

      <BookingActivityLog bookingId={booking.id} />
    </AppShell>
  )
}

// ----- small layout helpers -------------------------------------------------

const inputClass =
  'w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm outline-none focus:border-gray-900 focus:ring-2 focus:ring-gray-900/10 user-invalid:border-red-500 user-invalid:focus:border-red-500 user-invalid:focus:ring-red-500/20'

/** Like inputClass but visually muted + disabled when the caller can't edit. */
function readonlyInputClass(editable: boolean) {
  return editable
    ? inputClass
    : 'w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-700 outline-none cursor-not-allowed'
}

/** Deposit status line shown in the Finance status card. */
function depositSummary(fee: number, status: BookingStatus): string {
  if (fee === 0) return '✅ no booking fee — nothing to collect'
  if (status === 'confirmed' || status === 'delivered') return '✅ received'
  if (status === 'cancelled') return '— booking cancelled'
  return '⏳ awaiting admin to collect'
}

function DepositBadge({
  status,
  fee,
}: {
  status: BookingStatus
  fee: number
}) {
  // No booking fee → nothing to collect, treat the deposit as settled.
  if (fee === 0) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800">
        ✓ No booking fee
      </span>
    )
  }
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
