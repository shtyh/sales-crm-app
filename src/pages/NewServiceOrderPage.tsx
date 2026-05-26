import { useMemo, useState, type FormEvent } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { AppShell } from '../components/AppShell'
import { useAuth } from '../lib/auth'
import {
  useCreateServiceOrder,
  useCustomers,
  useProfiles,
  useTechnicians,
  useVehicles,
} from '../lib/queries'
import { formatError } from '../lib/errors'
import { useFormDraft } from '../lib/formDraft'
import { useOnlineStatus } from '../lib/online'
import {
  SERVICE_TYPE_LABEL,
  type AppointmentType,
  type ServiceType,
} from '../lib/types'

const inputClass =
  'w-full rounded border border-gray-300 bg-white px-2 py-1.5 text-sm outline-none focus:border-gray-900 focus:ring-1 focus:ring-gray-900/20'

const labelClass = 'text-xs font-medium text-gray-700'

const SERVICE_TYPES: ServiceType[] = [
  'maintenance',
  'int_g_repair',
  'warranty_service',
  'service_coupon',
  'come_back_job',
  'body_repair',
  'inspection',
]

/**
 * Job Sheet intake — laid out to mirror the legacy WMS "Create New Job
 * Sheet" dialog so the workshop team's muscle memory carries over.
 *
 * The form auto-fills chassis / car model / owner / phone the moment a
 * vehicle is picked, so the SA isn't retyping things we already store.
 * Membership No and Race remain on the legacy form but aren't tracked
 * in this CRM (no customer-level fields for them); we omit them.
 */
export function NewServiceOrderPage() {
  const navigate = useNavigate()
  const { role, profile, isAdmin } = useAuth()

  // Mirror the workshop access gate: sales-side advisors can't open
  // service jobs.
  if (role && !isAdmin) return <Navigate to="/" replace />

  const { data: customers } = useCustomers(true)
  const { data: vehicles } = useVehicles(true)
  const { data: technicians } = useTechnicians()
  const { data: profiles } = useProfiles()
  const createMut = useCreateServiceOrder()
  const online = useOnlineStatus()

  // Required
  const [vehicleId, setVehicleId] = useState('')
  const [technicianId, setTechnicianId] = useState('')
  const [serviceAdvisorId, setServiceAdvisorId] = useState(profile?.id ?? '')
  // Intake metadata
  const [department, setDepartment] = useState('')
  const [mileageIn, setMileageIn] = useState('')
  const [daysToComplete, setDaysToComplete] = useState('')
  const [complaint, setComplaint] = useState('')
  const [serviceTypes, setServiceTypes] = useState<ServiceType[]>([])
  const [appointmentType, setAppointmentType] =
    useState<AppointmentType>('walk_in')
  const [notes, setNotes] = useState('')
  const [error, setError] = useState<string | null>(null)

  // Draft persistence — survives a tab crash mid-intake. Keyed per-user
  // to avoid bleed between two staff on the same front-desk machine.
  const draftKey = `so-intake-draft:${profile?.id ?? 'anon'}`
  const clearDraft = useFormDraft(
    draftKey,
    {
      vehicleId,
      technicianId,
      serviceAdvisorId,
      department,
      mileageIn,
      daysToComplete,
      complaint,
      serviceTypes,
      appointmentType,
      notes,
    },
    (d) => {
      setVehicleId(d.vehicleId ?? '')
      setTechnicianId(d.technicianId ?? '')
      setServiceAdvisorId(d.serviceAdvisorId ?? '')
      setDepartment(d.department ?? '')
      setMileageIn(d.mileageIn ?? '')
      setDaysToComplete(d.daysToComplete ?? '')
      setComplaint(d.complaint ?? '')
      setServiceTypes(Array.isArray(d.serviceTypes) ? d.serviceTypes : [])
      setAppointmentType(d.appointmentType ?? 'walk_in')
      setNotes(d.notes ?? '')
    },
  )

  const vehicle = useMemo(
    () => (vehicleId ? vehicles?.find((v) => v.id === vehicleId) : undefined),
    [vehicleId, vehicles],
  )
  const customer = useMemo(
    () =>
      vehicle?.customer_id
        ? customers?.find((c) => c.id === vehicle.customer_id)
        : undefined,
    [vehicle, customers],
  )

  // The service-advisor dropdown lists profiles that are actually
  // service_advisor / service_manager. The current user is the default
  // when they're one of those.
  const advisorOptions = useMemo(
    () =>
      (profiles ?? [])
        .filter(
          (p) =>
            p.role === 'service_advisor' || p.role === 'service_manager',
        )
        .sort((a, b) =>
          (a.full_name || a.email || '').localeCompare(
            b.full_name || b.email || '',
          ),
        ),
    [profiles],
  )

  // Vehicle dropdown — sorted by registration. We don't pre-filter to
  // one customer here; intake usually starts from "what's that car?"
  // not "who's the customer?", and the customer is derived.
  const vehicleOptions = useMemo(
    () =>
      (vehicles ?? [])
        .slice()
        .sort((a, b) =>
          (a.registration_no || '').localeCompare(b.registration_no || ''),
        ),
    [vehicles],
  )

  function toggleService(s: ServiceType) {
    setServiceTypes((cur) =>
      cur.includes(s) ? cur.filter((x) => x !== s) : [...cur, s],
    )
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (!vehicle || !customer) {
      setError('Pick a vehicle that has a customer on file.')
      return
    }
    try {
      const created = await createMut.mutateAsync({
        customer_id: customer.id,
        vehicle_id: vehicle.id,
        technician_id: technicianId || null,
        service_advisor_id: serviceAdvisorId || null,
        complaint: complaint || null,
        mileage_in: mileageIn ? Number(mileageIn) : null,
        notes: notes || null,
        department: department || null,
        service_types: serviceTypes,
        appointment_type: appointmentType,
        days_to_complete: daysToComplete ? Number(daysToComplete) : null,
      })
      clearDraft()
      navigate(`/service-orders/${created.id}`, { replace: true })
    } catch (e) {
      setError(formatError(e))
    }
  }

  const submitting = createMut.isPending
  const now = new Date()
  const today = now.toLocaleDateString('en-MY')
  const timeIn = now.toLocaleTimeString('en-MY', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })

  return (
    <AppShell>
      <div className="mb-4 flex items-center justify-between">
        <Link to="/" className="text-sm text-gray-500 hover:text-gray-700">
          ← Back
        </Link>
        <div className="text-xs text-gray-500">
          Today: <span className="text-gray-900">{today}</span>
        </div>
      </div>

      {!online && (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          🛜 You're offline. Keep typing — everything is saved locally and
          will sync back when the connection returns.
        </div>
      )}

      <form
        onSubmit={handleSubmit}
        className="rounded-2xl border border-gray-300 bg-white p-4 shadow-sm sm:p-5"
      >
        <div className="mb-3 border-b border-gray-200 pb-2">
          <h1 className="text-base font-semibold text-gray-900">
            Create New Job Sheet
          </h1>
        </div>

        {/* ---------- Header row: Date · Job Number ---------- */}
        <div className="mb-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Row label="Date">
            <input
              type="text"
              readOnly
              value={today}
              className={`${inputClass} bg-gray-50`}
            />
          </Row>
          <Row label="Job Number">
            <input
              type="text"
              readOnly
              value="Auto (SO-YYMMDD-####)"
              className={`${inputClass} bg-gray-50 italic text-gray-500`}
            />
          </Row>
        </div>

        {/* ---------- Two-column grid: people + vehicle / contact ---------- */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {/* Left column */}
          <div className="space-y-2.5">
            <Row label="Mechanic">
              <select
                value={technicianId}
                onChange={(e) => setTechnicianId(e.target.value)}
                className={inputClass}
                disabled={!technicians}
              >
                <option value="">— Unassigned —</option>
                {(technicians ?? []).map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                    {t.specialty ? ` · ${t.specialty}` : ''}
                  </option>
                ))}
              </select>
            </Row>
            <Row label="Service Advisor">
              <select
                value={serviceAdvisorId}
                onChange={(e) => setServiceAdvisorId(e.target.value)}
                className={inputClass}
                disabled={!profiles}
              >
                <option value="">— Select advisor —</option>
                {advisorOptions.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.full_name || p.email}
                  </option>
                ))}
              </select>
            </Row>
            <Row label="Department">
              <input
                type="text"
                value={department}
                onChange={(e) => setDepartment(e.target.value)}
                placeholder="e.g. Mechanical · Body shop · Detailing"
                className={inputClass}
              />
            </Row>
            <Row label="Vehicle No" required>
              <select
                required
                value={vehicleId}
                onChange={(e) => setVehicleId(e.target.value)}
                className={inputClass}
                disabled={!vehicles}
              >
                <option value="" disabled>
                  {vehicles ? '— Select vehicle —' : 'Loading vehicles…'}
                </option>
                {vehicleOptions.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.registration_no} · {v.model}
                    {v.variant ? ` ${v.variant}` : ''}
                  </option>
                ))}
              </select>
            </Row>
            <Row label="Chassis No">
              <input
                type="text"
                readOnly
                value={vehicle?.chassis_no ?? ''}
                placeholder="— auto-fills from vehicle —"
                className={`${inputClass} bg-gray-50`}
              />
            </Row>
            <Row label="Car Model">
              <input
                type="text"
                readOnly
                value={
                  vehicle
                    ? `${vehicle.model}${vehicle.variant ? ` ${vehicle.variant}` : ''}${vehicle.color ? ` · ${vehicle.color}` : ''}`
                    : ''
                }
                placeholder="— auto-fills from vehicle —"
                className={`${inputClass} bg-gray-50`}
              />
            </Row>
            <Row label="Owner">
              <input
                type="text"
                readOnly
                value={customer?.name ?? ''}
                placeholder="— auto-fills from vehicle's customer —"
                className={`${inputClass} bg-gray-50`}
              />
            </Row>
          </div>

          {/* Right column */}
          <div className="space-y-2.5">
            <Row label="Tel No / HP No">
              <input
                type="text"
                readOnly
                value={customer?.phone ?? ''}
                placeholder="— auto-fills from customer —"
                className={`${inputClass} bg-gray-50`}
              />
            </Row>
            <Row label="Mileage">
              <input
                type="number"
                min={0}
                step={1}
                value={mileageIn}
                onChange={(e) => setMileageIn(e.target.value)}
                placeholder="km"
                inputMode="numeric"
                className={inputClass}
              />
            </Row>
            <Row label="Time In">
              <input
                type="text"
                readOnly
                value={timeIn}
                className={`${inputClass} bg-gray-50`}
              />
            </Row>
            <Row label="No of Days to Complete">
              <input
                type="number"
                min={0}
                step={1}
                value={daysToComplete}
                onChange={(e) => setDaysToComplete(e.target.value)}
                placeholder="0"
                inputMode="numeric"
                className={inputClass}
              />
            </Row>
            <Row label="Appointment Type">
              <div className="flex items-center gap-4 py-1">
                <label className="flex items-center gap-1.5 text-sm">
                  <input
                    type="radio"
                    name="appt"
                    value="walk_in"
                    checked={appointmentType === 'walk_in'}
                    onChange={() => setAppointmentType('walk_in')}
                  />
                  Walk-in
                </label>
                <label className="flex items-center gap-1.5 text-sm">
                  <input
                    type="radio"
                    name="appt"
                    value="by_appointment"
                    checked={appointmentType === 'by_appointment'}
                    onChange={() => setAppointmentType('by_appointment')}
                  />
                  By appointment
                </label>
              </div>
            </Row>
          </div>
        </div>

        {/* ---------- Complaint / Remark ---------- */}
        <div className="mt-4">
          <div className={`${labelClass} mb-1`}>Complaint / Remark</div>
          <textarea
            rows={5}
            value={complaint}
            onChange={(e) => setComplaint(e.target.value)}
            placeholder="What the customer reported. One line per issue."
            className={`${inputClass} min-h-24`}
          />
        </div>

        {/* ---------- Services checkboxes ---------- */}
        <div className="mt-4">
          <div className={`${labelClass} mb-2`}>Services</div>
          <div className="grid grid-cols-2 gap-2 rounded-lg border border-gray-200 bg-gray-50 p-3 sm:grid-cols-4">
            {SERVICE_TYPES.map((s) => (
              <label
                key={s}
                className="flex items-center gap-2 text-sm text-gray-800"
              >
                <input
                  type="checkbox"
                  checked={serviceTypes.includes(s)}
                  onChange={() => toggleService(s)}
                />
                {SERVICE_TYPE_LABEL[s]}
              </label>
            ))}
          </div>
        </div>

        {/* ---------- Internal notes ---------- */}
        <div className="mt-4">
          <div className={`${labelClass} mb-1`}>Internal notes</div>
          <textarea
            rows={2}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="For the mechanic — not shown to the customer."
            className={`${inputClass} min-h-16`}
          />
        </div>

        {error && (
          <div
            role="alert"
            className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
          >
            {error}
          </div>
        )}

        <div className="mt-5 flex flex-wrap items-center justify-end gap-2 border-t border-gray-200 pt-3">
          <Link
            to="/"
            className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
          >
            Close
          </Link>
          <button
            type="submit"
            disabled={submitting || !vehicleId}
            className="rounded-md bg-gray-900 px-4 py-1.5 text-sm font-medium text-white shadow-sm hover:bg-gray-800 disabled:opacity-60"
          >
            {submitting ? 'Saving…' : 'Save'}
          </button>
        </div>
      </form>
    </AppShell>
  )
}

function Row({
  label,
  required,
  children,
}: {
  label: string
  required?: boolean
  children: React.ReactNode
}) {
  return (
    <label className="grid grid-cols-[7.5rem_1fr] items-center gap-2">
      <span className={labelClass}>
        {label}
        {required && <span className="ml-0.5 text-red-500">*</span>}
      </span>
      {children}
    </label>
  )
}
