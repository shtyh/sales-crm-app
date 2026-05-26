import { useMemo, useState, type FormEvent } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { AppShell } from '../components/AppShell'
import { useAuth } from '../lib/auth'
import {
  useCreateServiceOrder,
  useCustomers,
  useVehicles,
} from '../lib/queries'
import { formatError } from '../lib/errors'
import { useFormDraft } from '../lib/formDraft'
import { useOnlineStatus } from '../lib/online'

const inputClass =
  'w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm outline-none focus:border-gray-900 focus:ring-2 focus:ring-gray-900/10 user-invalid:border-red-500 user-invalid:focus:border-red-500 user-invalid:focus:ring-red-500/20'

/**
 * Service-order intake form. Used by SA and SM to open a new job.
 *
 * The customer dropdown lists every customer; once a customer is picked,
 * the vehicle dropdown narrows to vehicles owned by that customer. If the
 * customer has none, the form points the SA at /vehicles/new to add the
 * car first.
 *
 * service_advisor_id is auto-set to the caller — so when an SA creates a
 * job it's already "theirs" and the RLS own-only rule keeps it visible.
 */
export function NewServiceOrderPage() {
  const navigate = useNavigate()
  const { role, profile, isAdmin } = useAuth()

  // Mirror the workshop access gate: SAs (sales side) can't open service
  // jobs; everyone else can. Hit /service-orders/new as a sales_advisor
  // and you get bounced.
  if (role && !isAdmin) return <Navigate to="/" replace />

  const { data: customers } = useCustomers(true)
  const { data: vehicles } = useVehicles(true)
  const createMut = useCreateServiceOrder()

  const [customerId, setCustomerId] = useState('')
  const [vehicleId, setVehicleId] = useState('')
  const [complaint, setComplaint] = useState('')
  const [mileageIn, setMileageIn] = useState('')
  const [notes, setNotes] = useState('')
  const [error, setError] = useState<string | null>(null)
  const online = useOnlineStatus()

  // Auto-save the form to localStorage so a tab crash or network blink
  // doesn't wipe what the SA typed. Cleared after a successful submit.
  // Keyed per-user so two staff on the same browser don't see each
  // other's draft (rare but happens at the front-desk PC).
  const draftKey = `so-intake-draft:${profile?.id ?? 'anon'}`
  const clearDraft = useFormDraft(
    draftKey,
    { customerId, vehicleId, complaint, mileageIn, notes },
    (d) => {
      setCustomerId(d.customerId ?? '')
      setVehicleId(d.vehicleId ?? '')
      setComplaint(d.complaint ?? '')
      setMileageIn(d.mileageIn ?? '')
      setNotes(d.notes ?? '')
    },
  )

  const customerOptions = useMemo(
    () => (customers ?? []).slice().sort((a, b) => a.name.localeCompare(b.name)),
    [customers],
  )

  // Vehicles for the selected customer only. If they have none, we'll
  // show a helper link to add one.
  const vehicleOptions = useMemo(
    () => (vehicles ?? []).filter((v) => v.customer_id === customerId),
    [vehicles, customerId],
  )

  function handleCustomerChange(next: string) {
    setCustomerId(next)
    // Selected vehicle probably no longer belongs to this customer — reset.
    setVehicleId('')
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    try {
      const created = await createMut.mutateAsync({
        customer_id: customerId,
        vehicle_id: vehicleId,
        service_advisor_id: profile?.id ?? null,
        complaint: complaint || null,
        mileage_in: mileageIn ? Number(mileageIn) : null,
        notes: notes || null,
      })
      clearDraft()
      navigate(`/service-orders/${created.id}`, { replace: true })
    } catch (e) {
      setError(formatError(e))
    }
  }

  const submitting = createMut.isPending
  const noVehicles =
    !!customerId && vehicleOptions.length === 0 && vehicles !== undefined

  return (
    <AppShell>
      <div className="mb-6">
        <Link
          to="/"
          className="text-sm text-gray-500 hover:text-gray-700"
        >
          ← Back
        </Link>
        <h1 className="mt-2 text-xl font-semibold text-gray-900">
          New job order
        </h1>
        <p className="mt-1 text-sm text-gray-500">
          Open a new service order. You can add parts and labour after the
          order is created.
        </p>
      </div>

      {!online && (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          🛜 You're offline. Keep typing — everything is saved locally and
          will sync back when the connection returns.
        </div>
      )}

      <form
        onSubmit={handleSubmit}
        className="space-y-6 rounded-2xl border border-gray-200 bg-white p-5 sm:p-6"
      >
        {/* ---------- Customer + vehicle ---------- */}
        <Section title="👤 Customer & vehicle">
          <div className="sm:col-span-2">
            <Field label="Customer" required>
              <select
                required
                value={customerId}
                onChange={(e) => handleCustomerChange(e.target.value)}
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
            </Field>
          </div>
          <div className="sm:col-span-2">
            <Field label="Vehicle" required>
              <select
                required
                value={vehicleId}
                onChange={(e) => setVehicleId(e.target.value)}
                className={inputClass}
                disabled={!customerId || !vehicles}
              >
                <option value="" disabled>
                  {!customerId
                    ? '— Pick a customer first —'
                    : '— Select vehicle —'}
                </option>
                {vehicleOptions.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.registration_no} · {v.model}
                    {v.variant ? ` ${v.variant}` : ''}
                    {v.color ? ` · ${v.color}` : ''}
                  </option>
                ))}
              </select>
              {noVehicles && (
                <span className="mt-1 block text-xs text-amber-700">
                  ⚠ This customer has no vehicles on file.{' '}
                  <Link to="/vehicles/new" className="underline">
                    Register one
                  </Link>{' '}
                  first.
                </span>
              )}
            </Field>
          </div>
        </Section>

        {/* ---------- Complaint + mileage ---------- */}
        <Section title="📝 Intake">
          <div className="sm:col-span-2">
            <Field label="Customer's complaint">
              <textarea
                rows={3}
                value={complaint}
                onChange={(e) => setComplaint(e.target.value)}
                className={`${inputClass} min-h-20`}
                placeholder="e.g. AC not cold; rattling on left turn…"
              />
            </Field>
          </div>
          <Field label="Mileage in (km)">
            <input
              type="number"
              min={0}
              step={1}
              value={mileageIn}
              onChange={(e) => setMileageIn(e.target.value)}
              className={inputClass}
              placeholder="e.g. 46500"
              inputMode="numeric"
            />
          </Field>
        </Section>

        {/* ---------- Notes ---------- */}
        <Section title="🗒 Internal notes">
          <div className="sm:col-span-2">
            <textarea
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className={`${inputClass} min-h-16`}
              placeholder="Anything the mechanic should know"
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
            to="/"
            className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
          >
            Cancel
          </Link>
          <button
            type="submit"
            disabled={submitting || !customers || !vehicles || !vehicleId}
            className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-gray-800 disabled:opacity-60"
          >
            {submitting ? 'Saving…' : 'Open job order'}
          </button>
        </div>
      </form>
    </AppShell>
  )
}

// ----- small layout helpers (mirrors NewBookingPage / NewVehiclePage) ------

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
