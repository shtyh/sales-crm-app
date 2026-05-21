import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { AppShell } from '../components/AppShell'
import { AttachmentSection } from '../components/AttachmentSection'
import { getBooking, updateBooking, deleteBooking } from '../lib/bookings'
import { formatError } from '../lib/errors'
import { PROTON_MODELS, variantsFor } from '../data/proton-models'
import type { Booking, BookingStatus } from '../lib/types'

const STATUSES: { value: BookingStatus; label: string }[] = [
  { value: 'pending', label: 'Pending' },
  { value: 'confirmed', label: 'Confirmed' },
  { value: 'delivered', label: 'Delivered' },
  { value: 'cancelled', label: 'Cancelled' },
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

  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [booking, setBooking] = useState<Booking | null>(null)

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
  const [bookingDate, setBookingDate] = useState('')
  const [status, setStatus] = useState<BookingStatus>('pending')
  const [notes, setNotes] = useState('')

  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [savedAt, setSavedAt] = useState<number | null>(null)

  useEffect(() => {
    let alive = true
    setLoading(true)
    getBooking(id)
      .then((b) => {
        if (!alive) return
        if (!b) {
          setLoadError('Booking not found, or you do not have access.')
          return
        }
        setBooking(b)
        setCustomerName(b.customer_name)
        setCustomerNric(b.customer_nric)
        setCustomerPhone(b.customer_phone)
        setCustomerEmail(b.customer_email ?? '')
        setVehicleModel(b.vehicle_model)
        setVehicleVariant(b.vehicle_variant)
        setVehicleColor(b.vehicle_color)
        setOtrPrice(String(b.otr_price))
        setBookingFee(String(b.booking_fee))
        setBookingDate(b.booking_date)
        setStatus(b.status)
        setNotes(b.notes ?? '')
      })
      .catch((e) => {
        if (alive) setLoadError(formatError(e))
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [id])

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
    setSaving(true)
    setError(null)
    try {
      const updated = await updateBooking(id, {
        customer_name: customerName.trim(),
        customer_nric: customerNric.trim(),
        customer_phone: customerPhone.trim(),
        customer_email: customerEmail.trim() || null,
        vehicle_model: vehicleModel,
        vehicle_variant: vehicleVariant,
        vehicle_color: vehicleColor.trim(),
        otr_price: Number(otrPrice) || 0,
        booking_fee: Number(bookingFee) || 0,
        booking_date: bookingDate,
        status,
        notes: notes.trim() || null,
      })
      setBooking(updated)
      setSavedAt(Date.now())
    } catch (e) {
      setError(formatError(e))
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    if (
      !window.confirm(
        `Delete booking ${booking?.code}? This cannot be undone.`,
      )
    ) {
      return
    }
    setDeleting(true)
    setError(null)
    try {
      await deleteBooking(id)
      navigate('/bookings', { replace: true })
    } catch (e) {
      setError(formatError(e))
      setDeleting(false)
    }
  }

  if (loading) {
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
          <div className="mt-2 flex items-center gap-3">
            <h1 className="font-mono text-xl font-semibold text-gray-900">
              {booking.code}
            </h1>
            <span
              className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_BADGE[booking.status]}`}
            >
              {booking.status}
            </span>
          </div>
        </div>
        <button
          type="button"
          onClick={handleDelete}
          disabled={deleting || saving}
          className="rounded-lg border border-red-200 bg-white px-3 py-1.5 text-sm font-medium text-red-700 transition hover:bg-red-50 disabled:opacity-50"
        >
          {deleting ? 'Deleting…' : 'Delete'}
        </button>
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
            disabled={saving || deleting}
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
          kind="bank_transaction"
          title="🏦 Bank transaction"
          description="Deposit / payment slips, online transfer screenshots, etc."
        />
        <AttachmentSection
          bookingId={booking.id}
          kind="lou"
          title="📃 Letter of Undertaking (LOU)"
          description="Employer LOU, loan undertaking, guarantor letter, etc."
        />
      </div>
    </AppShell>
  )
}

// ----- small layout helpers -------------------------------------------------

const inputClass =
  'w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm outline-none focus:border-gray-900 focus:ring-2 focus:ring-gray-900/10'

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
