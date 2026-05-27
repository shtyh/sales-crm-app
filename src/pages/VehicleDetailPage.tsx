import { useEffect, useState, type FormEvent } from 'react'
import { Link, Navigate, useParams } from 'react-router-dom'
import { AppShell } from '../components/AppShell'
import { useAuth } from '../lib/auth'
import {
  useServiceOrdersByVehicle,
  useUpdateVehicle,
  useVehicle,
} from '../lib/queries'
import { formatError } from '../lib/errors'
import {
  PROTON_MODELS,
  coloursFor,
  variantsFor,
} from '../data/proton-models'
import {
  SERVICE_ORDER_STATUS_LABEL,
  type ServiceOrderStatus,
} from '../lib/types'

const inputClass =
  'w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm outline-none focus:border-gray-900 focus:ring-2 focus:ring-gray-900/10 user-invalid:border-red-500 user-invalid:focus:border-red-500 user-invalid:focus:ring-red-500/20'

const STATUS_PILL: Record<ServiceOrderStatus, string> = {
  open: 'bg-gray-100 text-gray-700',
  in_progress: 'bg-amber-100 text-amber-800',
  awaiting_parts: 'bg-orange-100 text-orange-800',
  completed: 'bg-blue-100 text-blue-800',
  collected: 'bg-green-100 text-green-800',
  cancelled: 'bg-rose-100 text-rose-700',
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-MY', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })
}

function formatMyr(n: number) {
  return new Intl.NumberFormat('en-MY', {
    style: 'currency',
    currency: 'MYR',
    maximumFractionDigits: 2,
  }).format(n)
}

export function VehicleDetailPage() {
  const { id = '' } = useParams<{ id: string }>()
  const { canAccessService } = useAuth()

  // Workshop-side detail page. Sales-side staff bounced even if they
  // type /vehicles/:id directly.
  if (canAccessService === false) return <Navigate to="/" replace />

  const { data: vehicle, error: vehicleErr, isLoading } = useVehicle(id)
  const { data: history, error: historyErr } = useServiceOrdersByVehicle(id)
  const updateMut = useUpdateVehicle()

  const [registrationNo, setRegistrationNo] = useState('')
  const [chassisNo, setChassisNo] = useState('')
  const [model, setModel] = useState<string>(PROTON_MODELS[0])
  const [variant, setVariant] = useState('')
  const [color, setColor] = useState('')
  const [year, setYear] = useState('')
  const [mileage, setMileage] = useState('')
  const [notes, setNotes] = useState('')

  const [error, setError] = useState<string | null>(null)
  const [savedAt, setSavedAt] = useState<number | null>(null)
  const saving = updateMut.isPending

  useEffect(() => {
    if (!vehicle) return
    setRegistrationNo(vehicle.registration_no)
    setChassisNo(vehicle.chassis_no ?? '')
    setModel(vehicle.model)
    setVariant(vehicle.variant ?? '')
    setColor(vehicle.color ?? '')
    setYear(vehicle.year != null ? String(vehicle.year) : '')
    setMileage(vehicle.mileage != null ? String(vehicle.mileage) : '')
    setNotes(vehicle.notes ?? '')
  }, [vehicle])

  function handleModelChange(next: string) {
    setModel(next)
    if (!variantsFor(next).includes(variant)) setVariant('')
    const palette = coloursFor(next)
    if (palette.length > 0 && !palette.includes(color)) setColor('')
  }

  async function handleSave(e: FormEvent) {
    e.preventDefault()
    setError(null)
    try {
      await updateMut.mutateAsync({
        id,
        patch: {
          registration_no: registrationNo,
          chassis_no: chassisNo || null,
          model,
          variant: variant || null,
          color: color || null,
          year: year ? Number(year) : null,
          mileage: mileage ? Number(mileage) : null,
          notes: notes || null,
        },
      })
      setSavedAt(Date.now())
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

  if (vehicleErr || !vehicle) {
    return (
      <AppShell>
        <div className="mb-4">
          <Link
            to="/vehicles"
            className="text-sm text-gray-500 hover:text-gray-700"
          >
            ← Back to vehicles
          </Link>
        </div>
        <div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-sm text-red-700">
          {vehicleErr ? formatError(vehicleErr) : 'Vehicle not found.'}
        </div>
      </AppShell>
    )
  }

  const palette = coloursFor(model)

  return (
    <AppShell>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link
            to="/vehicles"
            className="text-sm text-gray-500 hover:text-gray-700"
          >
            ← Back to vehicles
          </Link>
          <h1 className="mt-2 font-mono text-xl font-semibold text-gray-900">
            {vehicle.registration_no}
          </h1>
          <p className="text-sm text-gray-500">
            {vehicle.model}
            {vehicle.variant ? ` · ${vehicle.variant}` : ''}
            {vehicle.color ? ` · ${vehicle.color}` : ''}
            {vehicle.year ? ` · ${vehicle.year}` : ''}
          </p>
          {vehicle.customer && (
            <p className="mt-1 text-sm text-gray-600">
              👤 {vehicle.customer.name}
              {vehicle.customer.phone ? ` · ${vehicle.customer.phone}` : ''}
            </p>
          )}
        </div>
      </div>

      <form
        onSubmit={handleSave}
        className="space-y-6 rounded-2xl border border-gray-200 bg-white p-5 sm:p-6"
      >
        {/* ---------- Identifiers ---------- */}
        <Section title="🔢 Identifiers">
          <Field label="Plate number" required>
            <input
              type="text"
              required
              value={registrationNo}
              onChange={(e) => setRegistrationNo(e.target.value.toUpperCase())}
              className={inputClass}
              maxLength={20}
            />
          </Field>
          <Field label="Chassis no.">
            <input
              type="text"
              value={chassisNo}
              onChange={(e) => setChassisNo(e.target.value.toUpperCase())}
              className={inputClass}
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
              {variantsFor(model).map((v) => (
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
              inputMode="numeric"
            />
          </Field>
          <Field label="Mileage (km)">
            <input
              type="number"
              min={0}
              value={mileage}
              onChange={(e) => setMileage(e.target.value)}
              className={inputClass}
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
        {savedAt && !error && (
          <div className="rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700">
            ✓ Saved.
          </div>
        )}

        <div className="flex items-center justify-end gap-3 border-t border-gray-100 pt-4">
          <Link
            to="/vehicles"
            className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
          >
            Back
          </Link>
          <button
            type="submit"
            disabled={saving}
            className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-gray-800 disabled:opacity-60"
          >
            {saving ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </form>

      {/* ---------- Service history ---------- */}
      <section className="mt-6 rounded-2xl border border-gray-200 bg-white p-5 sm:p-6">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-700">
            🛠 Service history
          </h2>
          <span className="text-xs text-gray-500">
            {history ? `${history.length} order${history.length === 1 ? '' : 's'}` : '—'}
          </span>
        </div>

        {historyErr && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {formatError(historyErr)}
          </div>
        )}

        {!history && !historyErr && (
          <p className="text-sm text-gray-500">Loading…</p>
        )}

        {history && history.length === 0 && (
          <p className="text-sm text-gray-500">
            No service orders for this vehicle yet. Once the workshop module is
            live, every visit will appear here in chronological order.
          </p>
        )}

        {history && history.length > 0 && (
          <ul className="divide-y divide-gray-100">
            {history.map((s) => (
              <li
                key={s.id}
                className="flex flex-wrap items-center justify-between gap-2 py-2.5 first:pt-0 last:pb-0"
              >
                <div className="min-w-0">
                  <div className="font-mono text-xs text-gray-600">
                    {s.order_no ?? '— draft —'}
                  </div>
                  <div className="text-sm text-gray-900">
                    Opened {formatDate(s.opened_at)}
                    {s.mileage_in != null && (
                      <span className="ml-2 text-xs text-gray-500">
                        @ {s.mileage_in.toLocaleString()} km
                      </span>
                    )}
                  </div>
                  {s.complaint && (
                    <div className="text-xs text-gray-500 truncate max-w-md">
                      {s.complaint}
                    </div>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <span className="tabular-nums text-sm text-gray-700">
                    {formatMyr(Number(s.total_amount))}
                  </span>
                  <span
                    className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_PILL[s.status]}`}
                  >
                    {SERVICE_ORDER_STATUS_LABEL[s.status]}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </AppShell>
  )
}

// ----- small layout helpers (mirrors NewVehiclePage / NewBookingPage) ------

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
