import { useMemo, useState, type FormEvent } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { AppShell } from '../components/AppShell'
import { useAuth } from '../lib/auth'
import { useCreateVehicle, useCustomers } from '../lib/queries'
import { formatError } from '../lib/errors'
import {
  PROTON_MODELS,
  coloursFor,
  variantsFor,
} from '../data/proton-models'

const inputClass =
  'w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm outline-none focus:border-gray-900 focus:ring-2 focus:ring-gray-900/10 user-invalid:border-red-500 user-invalid:focus:border-red-500 user-invalid:focus:ring-red-500/20'

export function NewVehiclePage() {
  const navigate = useNavigate()
  const { canAccessService } = useAuth()

  // Workshop-side intake. Sales staff bounced even if they type
  // /vehicles/new directly.
  if (canAccessService === false) return <Navigate to="/" replace />

  const { data: customers, error: customersErr } = useCustomers(true)
  const createMut = useCreateVehicle()

  const [customerId, setCustomerId] = useState('')
  const [registrationNo, setRegistrationNo] = useState('')
  const [chassisNo, setChassisNo] = useState('')
  const [model, setModel] = useState<string>(PROTON_MODELS[0])
  const [variant, setVariant] = useState('')
  const [color, setColor] = useState('')
  const [year, setYear] = useState('')
  const [mileage, setMileage] = useState('')
  const [notes, setNotes] = useState('')
  const [error, setError] = useState<string | null>(null)

  // Sort customers alphabetically and dedupe — the dropdown shows
  // "Name (last-4-of-NRIC)" so identically-named walk-ins are still
  // distinguishable.
  const customerOptions = useMemo(() => {
    if (!customers) return []
    return [...customers].sort((a, b) => a.name.localeCompare(b.name))
  }, [customers])

  function handleModelChange(next: string) {
    setModel(next)
    if (!variantsFor(next).includes(variant)) setVariant('')
    const palette = coloursFor(next)
    if (palette.length > 0 && !palette.includes(color)) setColor('')
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    try {
      const created = await createMut.mutateAsync({
        customer_id: customerId,
        registration_no: registrationNo,
        chassis_no: chassisNo || null,
        model,
        variant: variant || null,
        color: color || null,
        year: year ? Number(year) : null,
        mileage: mileage ? Number(mileage) : null,
        notes: notes || null,
      })
      navigate(`/vehicles/${created.id}`, { replace: true })
    } catch (e) {
      setError(formatError(e))
    }
  }

  const submitting = createMut.isPending
  const variants = variantsFor(model)
  const palette = coloursFor(model)

  return (
    <AppShell>
      <div className="mb-6">
        <Link
          to="/vehicles"
          className="text-sm text-gray-500 hover:text-gray-700"
        >
          ← Back to vehicles
        </Link>
        <h1 className="mt-2 text-xl font-semibold text-gray-900">
          New vehicle
        </h1>
        <p className="mt-1 text-sm text-gray-500">
          Register a customer's car so it can be picked up on the next service
          intake.
        </p>
      </div>

      {customersErr && (
        <div
          role="alert"
          className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
        >
          {formatError(customersErr)}
        </div>
      )}

      <form
        onSubmit={handleSubmit}
        className="space-y-6 rounded-2xl border border-gray-200 bg-white p-5 sm:p-6"
      >
        {/* ---------- Owner ---------- */}
        <Section title="👤 Owner">
          <div className="sm:col-span-2">
            <Field label="Customer" required>
              <select
                required
                value={customerId}
                onChange={(e) => setCustomerId(e.target.value)}
                className={inputClass}
                disabled={!customers}
              >
                <option value="" disabled>
                  {customers ? '— Select customer —' : 'Loading customers…'}
                </option>
                {customerOptions.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} · {c.nric.slice(-4).padStart(c.nric.length, '•')}
                  </option>
                ))}
              </select>
              <span className="mt-1 block text-xs text-gray-500">
                Customer not in the list? Create one via{' '}
                <Link to="/bookings/new" className="underline">
                  new booking
                </Link>{' '}
                first.
              </span>
            </Field>
          </div>
        </Section>

        {/* ---------- Identifiers ---------- */}
        <Section title="🔢 Identifiers">
          <Field label="Plate number" required>
            <input
              type="text"
              required
              value={registrationNo}
              onChange={(e) => setRegistrationNo(e.target.value.toUpperCase())}
              className={inputClass}
              placeholder="WKK 1234"
              maxLength={20}
              title="Required. Stored in upper-case for de-dup."
            />
          </Field>
          <Field label="Chassis no.">
            <input
              type="text"
              value={chassisNo}
              onChange={(e) => setChassisNo(e.target.value.toUpperCase())}
              className={inputClass}
              placeholder="Optional — 17-char VIN"
              maxLength={32}
            />
          </Field>
        </Section>

        {/* ---------- Vehicle ---------- */}
        <Section title="🚗 Vehicle">
          <Field label="Model" required>
            <select
              required
              value={model}
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
          <Field label="Variant">
            <select
              value={variant}
              onChange={(e) => setVariant(e.target.value)}
              className={inputClass}
            >
              <option value="">— Not specified —</option>
              {variants.map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Colour">
            {palette.length > 0 ? (
              <select
                value={color}
                onChange={(e) => setColor(e.target.value)}
                className={inputClass}
              >
                <option value="">— Not specified —</option>
                {palette.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            ) : (
              <input
                type="text"
                value={color}
                onChange={(e) => setColor(e.target.value)}
                className={inputClass}
                placeholder="e.g. Snow White"
              />
            )}
          </Field>
          <Field label="Year">
            <input
              type="number"
              min={1980}
              max={new Date().getFullYear() + 1}
              value={year}
              onChange={(e) => setYear(e.target.value)}
              className={inputClass}
              placeholder="e.g. 2022"
              inputMode="numeric"
            />
          </Field>
          <Field label="Mileage (km)">
            <input
              type="number"
              min={0}
              step={1}
              value={mileage}
              onChange={(e) => setMileage(e.target.value)}
              className={inputClass}
              placeholder="e.g. 45000"
              inputMode="numeric"
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
              placeholder="Anything worth knowing — accessories, prior accidents, customer preferences…"
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
            to="/vehicles"
            className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
          >
            Cancel
          </Link>
          <button
            type="submit"
            disabled={submitting || !customers}
            className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-gray-800 disabled:opacity-60"
          >
            {submitting ? 'Saving…' : 'Create vehicle'}
          </button>
        </div>
      </form>
    </AppShell>
  )
}

// ----- small layout helpers (mirrors NewBookingPage) -----------------------

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
