import { useEffect, useState, type FormEvent } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { AppShell } from '../components/AppShell'
import { useAuth } from '../lib/auth'
import {
  useCreateBooking,
  useCustomerByNric,
  useUpsertCustomerByNric,
} from '../lib/queries'
import { formatError } from '../lib/errors'
import {
  PROTON_MODELS,
  coloursFor,
  variantsFor,
} from '../data/proton-models'
import type { BookingStatus } from '../lib/types'

const STATUSES: { value: BookingStatus; label: string }[] = [
  { value: 'pending', label: 'Pending' },
  { value: 'confirmed', label: 'Confirmed' },
  { value: 'delivered', label: 'Delivered' },
  { value: 'cancelled', label: 'Cancelled' },
]

const today = () => new Date().toISOString().slice(0, 10)

export function NewBookingPage() {
  const navigate = useNavigate()
  const { canAccessSales } = useAuth()
  // Workshop-only roles can't create bookings — bounce them home.
  if (canAccessSales === false) return <Navigate to="/" replace />

  const [customerName, setCustomerName] = useState('')
  const [customerNric, setCustomerNric] = useState('')
  const [customerPhone, setCustomerPhone] = useState('')
  const [customerEmail, setCustomerEmail] = useState('')
  const [customerAddress, setCustomerAddress] = useState('')

  const [vehicleModel, setVehicleModel] = useState<string>(PROTON_MODELS[0])
  const [vehicleVariant, setVehicleVariant] = useState('')
  const [vehicleColor, setVehicleColor] = useState('')

  // OTR is hidden from the booking flow but the DB column is still required
  // (NOT NULL), so we submit 0 for new bookings until/unless the column gets
  // dropped.
  const [bookingFee, setBookingFee] = useState('')
  const [discountAmount, setDiscountAmount] = useState('')

  const [bookingDate, setBookingDate] = useState(today())

  const [status, setStatus] = useState<BookingStatus>('pending')
  const [notes, setNotes] = useState('')

  const createMut = useCreateBooking()
  const upsertCustomerMut = useUpsertCustomerByNric()
  const submitting = createMut.isPending || upsertCustomerMut.isPending
  const [error, setError] = useState<string | null>(null)

  // Debounce NRIC input — after the SA stops typing for 400ms, hit the
  // customers table to see if this person already exists. We don't want a
  // query per keystroke (NRICs are 12 digits).
  const [debouncedNric, setDebouncedNric] = useState('')
  useEffect(() => {
    const t = setTimeout(() => setDebouncedNric(customerNric.trim()), 400)
    return () => clearTimeout(t)
  }, [customerNric])
  const existing = useCustomerByNric(debouncedNric)

  // Once we get a match, pre-fill the customer fields — but only for fields
  // the SA hasn't filled in themselves. This way, typing in someone else's
  // NRIC by mistake won't wipe what they've already entered, and a fresh
  // form just gets populated.
  useEffect(() => {
    if (!existing.data) return
    setCustomerName((curr) => curr || existing.data!.name)
    setCustomerPhone((curr) => curr || existing.data!.phone)
    setCustomerEmail((curr) => curr || existing.data!.email || '')
    setCustomerAddress((curr) => curr || existing.data!.address || '')
  }, [existing.data])

  function handleModelChange(newModel: string) {
    setVehicleModel(newModel)
    setVehicleVariant('')
    setVehicleColor('')
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    try {
      // Step 1: upsert the customer by NRIC. If the row already exists this
      // updates it with the latest contact details the SA typed; otherwise
      // it inserts a new customer. Either way we get back the customer id.
      const customer = await upsertCustomerMut.mutateAsync({
        name: customerName,
        nric: customerNric,
        phone: customerPhone,
        email: customerEmail || null,
        address: customerAddress || null,
      })

      // Step 2: create the booking, pointing at the customer. We still
      // populate the customer_* snapshot columns so historical lookups +
      // existing UI keep working.
      const created = await createMut.mutateAsync({
        customer_name: customer.name,
        customer_nric: customer.nric,
        customer_phone: customer.phone,
        customer_email: customer.email,
        customer_id: customer.id,
        vehicle_model: vehicleModel,
        vehicle_variant: vehicleVariant,
        vehicle_color: vehicleColor.trim(),
        otr_price: 0,
        booking_fee: Number(bookingFee) || 0,
        discount_amount: Number(discountAmount) || 0,
        booking_date: bookingDate,
        status,
        notes: notes.trim() || null,
      })
      navigate('/bookings', {
        replace: true,
        state: { justCreated: created.code },
      })
    } catch (e) {
      setError(formatError(e))
    }
  }

  const variants = variantsFor(vehicleModel)
  // Show a small badge when the NRIC matches an existing customer, so the SA
  // knows the pre-fill is from a real record and not random typing.
  const matched = !!existing.data && existing.data.nric === debouncedNric

  return (
    <AppShell>
      <div className="mb-6">
        <Link
          to="/bookings"
          className="text-sm text-gray-500 hover:text-gray-700"
        >
          ← Back to bookings
        </Link>
        <h1 className="mt-2 text-xl font-semibold text-gray-900">
          New booking
        </h1>
      </div>

      <form
        onSubmit={handleSubmit}
        className="space-y-6 rounded-2xl border border-gray-200 bg-white p-5 sm:p-6"
      >
        {/* ---------- Customer ---------- */}
        <Section title="👤 Customer">
          <Field label="NRIC" required>
            <input
              type="text"
              required
              value={customerNric}
              onChange={(e) =>
                // Strip non-digits as the SA types so 970624-07-5367 / spaces
                // / dashes silently normalise to the bare 12-digit form the
                // DB CHECK constraint expects.
                setCustomerNric(e.target.value.replace(/\D/g, ''))
              }
              className={inputClass}
              placeholder="990999XXXXXX"
              inputMode="numeric"
              pattern="[0-9]{12}"
              maxLength={12}
              title="NRIC must be exactly 12 digits"
            />
            {matched && (
              <span className="mt-1 inline-flex items-center gap-1 rounded-full bg-green-50 px-2 py-0.5 text-[11px] font-medium text-green-700">
                ✓ Existing customer — fields auto-filled
              </span>
            )}
          </Field>
          <Field label="Full name" required>
            <input
              type="text"
              required
              value={customerName}
              onChange={(e) => setCustomerName(e.target.value)}
              className={inputClass}
              placeholder="As shown on IC"
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
              placeholder="0123456789"
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
              placeholder="you@example.com"
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
            {coloursFor(vehicleModel).length > 0 ? (
              <select
                required
                value={vehicleColor}
                onChange={(e) => setVehicleColor(e.target.value)}
                className={inputClass}
              >
                <option value="" disabled>
                  — Select colour —
                </option>
                {coloursFor(vehicleModel).map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            ) : (
              <input
                type="text"
                required
                value={vehicleColor}
                onChange={(e) => setVehicleColor(e.target.value)}
                className={inputClass}
                placeholder="e.g. Snow White"
              />
            )}
          </Field>
        </Section>

        {/* ---------- Money ---------- */}
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
              placeholder="1000"
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
              placeholder="0"
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
              placeholder="Anything else worth remembering…"
            />
          </div>
        </Section>

        {error && (
          <div
            role="alert"
            className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
          >
            {error}
          </div>
        )}

        <div className="flex items-center justify-end gap-3 border-t border-gray-100 pt-4">
          <Link
            to="/bookings"
            className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
          >
            Cancel
          </Link>
          <button
            type="submit"
            disabled={submitting}
            className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-gray-800 disabled:opacity-60"
          >
            {submitting ? 'Saving…' : 'Create booking'}
          </button>
        </div>
      </form>
    </AppShell>
  )
}

// ----- small layout helpers -------------------------------------------------

// `user-invalid:` only triggers after the user has interacted with the
// field (Tailwind v4 modifier wrapping :user-invalid), so empty inputs on
// first load don't all glow red — only fields the SA actually typed into
// or tried to submit get the red border + ring.
const inputClass =
  'w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm outline-none focus:border-gray-900 focus:ring-2 focus:ring-gray-900/10 user-invalid:border-red-500 user-invalid:focus:border-red-500 user-invalid:focus:ring-red-500/20'

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
