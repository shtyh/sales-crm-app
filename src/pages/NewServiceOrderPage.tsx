import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { AppShell } from '../components/AppShell'
import { useAuth } from '../lib/auth'
import {
  useCreateServiceOrder,
  useCreateVehicle,
  useCustomers,
  useProfiles,
  useTechnicians,
  useUpsertCustomerByNric,
  useVehicles,
} from '../lib/queries'
import { formatError } from '../lib/errors'
import { useFormDraft } from '../lib/formDraft'
import { useOnlineStatus } from '../lib/online'
import {
  PROTON_MODELS,
  coloursFor,
  variantsFor,
} from '../data/proton-models'
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
  // The reg-no input is a free-text field — the matched vehicle drives
  // the auto-fill panel below it. The string is canonicalised to upper-
  // case + trimmed before any match check, so "ggg 1234 " still maps.
  const [regNoInput, setRegNoInput] = useState('')
  const [technicianId, setTechnicianId] = useState('')
  const [serviceAdvisorId, setServiceAdvisorId] = useState(profile?.id ?? '')
  // Modal state for the "this is a new registration" flow.
  const [registerOpen, setRegisterOpen] = useState(false)
  const [pendingNewReg, setPendingNewReg] = useState('')
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
      regNoInput,
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
      setRegNoInput(d.regNoInput ?? '')
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

  // Reg input → vehicle id resolver. Runs on blur and on Enter — picks
  // the matching vehicle if there is one, otherwise pops the new-reg
  // alert and offers the registration modal.
  function resolveReg() {
    const norm = regNoInput.trim().toUpperCase().replace(/\s+/g, ' ')
    if (!norm) {
      setVehicleId('')
      return
    }
    const match = vehicles?.find(
      (v) => v.registration_no.toUpperCase().replace(/\s+/g, ' ') === norm,
    )
    if (match) {
      setVehicleId(match.id)
      setRegNoInput(match.registration_no)
      return
    }
    // Not found — mirror the legacy WMS popup, then open the modal.
    window.alert('This is a New Registration Car No.')
    setPendingNewReg(norm)
    setRegisterOpen(true)
  }

  // When the modal finishes creating a vehicle, switch focus to it.
  function handleVehicleRegistered(newVehicleId: string, newRegNo: string) {
    setVehicleId(newVehicleId)
    setRegNoInput(newRegNo)
    setRegisterOpen(false)
    setPendingNewReg('')
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
              <div className="flex w-full items-center gap-1.5">
                <input
                  list="vehicle-regs"
                  required
                  value={regNoInput}
                  onChange={(e) =>
                    setRegNoInput(e.target.value.toUpperCase())
                  }
                  onBlur={resolveReg}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      resolveReg()
                    }
                  }}
                  className={inputClass}
                  placeholder={
                    vehicles ? 'Type or pick a plate…' : 'Loading…'
                  }
                  disabled={!vehicles}
                  autoComplete="off"
                />
                <datalist id="vehicle-regs">
                  {vehicleOptions.map((v) => (
                    <option
                      key={v.id}
                      value={v.registration_no}
                      label={`${v.model}${v.variant ? ` ${v.variant}` : ''}`}
                    />
                  ))}
                </datalist>
              </div>
              {regNoInput && !vehicleId && (
                <span className="mt-1 block text-[11px] text-amber-700">
                  Press Tab or Enter to look this plate up.
                </span>
              )}
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

      {registerOpen && (
        <RegisterVehicleModal
          regNo={pendingNewReg}
          onClose={() => {
            setRegisterOpen(false)
            setPendingNewReg('')
            setRegNoInput('')
          }}
          onCreated={handleVehicleRegistered}
        />
      )}
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

/**
 * Inline "Edit Vehicle / New Account" dialog — pops up when the SA types
 * a plate that isn't in our vehicles table. Captures the minimum we
 * need to file the car: the plate (pre-filled from the parent), basic
 * vehicle attrs, and the owner (either pick an existing customer or
 * enter NRIC/Name/Phone for a new one).
 *
 * On save the customer is upserted by NRIC, the vehicle is created
 * linked to that customer, and the parent form receives the new
 * vehicle id so the rest of the job sheet auto-fills.
 */
function RegisterVehicleModal({
  regNo,
  onClose,
  onCreated,
}: {
  regNo: string
  onClose: () => void
  onCreated: (vehicleId: string, regNo: string) => void
}) {
  const { data: customers } = useCustomers(true)
  const upsertCustomer = useUpsertCustomerByNric()
  const createVehicle = useCreateVehicle()

  const [mode, setMode] = useState<'existing' | 'new'>('existing')
  const [existingCustomerId, setExistingCustomerId] = useState('')
  const [name, setName] = useState('')
  const [nric, setNric] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [address, setAddress] = useState('')

  const [chassisNo, setChassisNo] = useState('')
  const [model, setModel] = useState<string>(PROTON_MODELS[0])
  const [variant, setVariant] = useState('')
  const [color, setColor] = useState('')
  const [year, setYear] = useState('')

  const [error, setError] = useState<string | null>(null)
  const saving = upsertCustomer.isPending || createVehicle.isPending
  const variants = variantsFor(model)
  const palette = coloursFor(model)

  // Close on Escape — keyboard parity with native dialogs.
  const overlayRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const customerOptions = useMemo(
    () =>
      (customers ?? [])
        .slice()
        .sort((a, b) => a.name.localeCompare(b.name)),
    [customers],
  )

  function handleModelChange(next: string) {
    setModel(next)
    if (!variantsFor(next).includes(variant)) setVariant('')
    const p = coloursFor(next)
    if (p.length > 0 && !p.includes(color)) setColor('')
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    try {
      let customerId = existingCustomerId
      if (mode === 'new') {
        const upserted = await upsertCustomer.mutateAsync({
          name: name.trim(),
          nric: nric.trim(),
          phone: phone.trim(),
          email: email.trim() || null,
          address: address.trim() || null,
        })
        customerId = upserted.id
      }
      if (!customerId) {
        setError('Pick an existing customer or fill in new-customer details.')
        return
      }
      const created = await createVehicle.mutateAsync({
        customer_id: customerId,
        registration_no: regNo,
        chassis_no: chassisNo || null,
        model,
        variant: variant || null,
        color: color || null,
        year: year ? Number(year) : null,
      })
      onCreated(created.id, created.registration_no)
    } catch (e) {
      setError(formatError(e))
    }
  }

  return (
    <div
      ref={overlayRef}
      role="dialog"
      aria-modal="true"
      aria-label="Register new vehicle"
      className="fixed inset-0 z-30 flex items-center justify-center bg-black/40 px-4 py-6"
      onClick={(e) => {
        if (e.target === overlayRef.current) onClose()
      }}
    >
      <form
        onSubmit={handleSubmit}
        className="max-h-full w-full max-w-2xl overflow-y-auto rounded-2xl border border-gray-300 bg-white p-5 shadow-xl"
      >
        <div className="mb-3 border-b border-gray-200 pb-2">
          <div className="text-[10px] font-medium uppercase tracking-widest text-gray-500">
            Edit Vehicle Information
          </div>
          <h2 className="mt-0.5 text-base font-semibold text-gray-900">
            New registration: <span className="font-mono">{regNo}</span>
          </h2>
          <p className="mt-1 text-xs text-gray-500">
            File the car and its owner so this plate can be picked up on
            future job sheets.
          </p>
        </div>

        {/* ---------- Vehicle ---------- */}
        <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Row label="Vehicle No">
            <input
              type="text"
              readOnly
              value={regNo}
              className={`${inputClass} bg-gray-50 font-mono`}
            />
          </Row>
          <Row label="Chassis No">
            <input
              type="text"
              value={chassisNo}
              onChange={(e) => setChassisNo(e.target.value.toUpperCase())}
              className={inputClass}
              placeholder="17-char VIN (optional)"
            />
          </Row>
          <Row label="Car Model" required>
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
          </Row>
          <Row label="Variant">
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
          </Row>
          <Row label="Vehicle Colour">
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
          </Row>
          <Row label="Year Make">
            <input
              type="number"
              min={1980}
              max={new Date().getFullYear() + 1}
              value={year}
              onChange={(e) => setYear(e.target.value)}
              placeholder="e.g. 2024"
              inputMode="numeric"
              className={inputClass}
            />
          </Row>
        </div>

        {/* ---------- Owner ---------- */}
        <div className="mb-2 border-t border-gray-200 pt-3">
          <div className="text-xs font-medium uppercase tracking-wide text-gray-500">
            Owner
          </div>
          <div className="mt-2 flex gap-1.5">
            <button
              type="button"
              onClick={() => setMode('existing')}
              className={`rounded-full px-3 py-1 text-xs font-medium transition ${
                mode === 'existing'
                  ? 'bg-gray-900 text-white'
                  : 'border border-gray-300 bg-white text-gray-700 hover:bg-gray-50'
              }`}
            >
              Existing customer
            </button>
            <button
              type="button"
              onClick={() => setMode('new')}
              className={`rounded-full px-3 py-1 text-xs font-medium transition ${
                mode === 'new'
                  ? 'bg-gray-900 text-white'
                  : 'border border-gray-300 bg-white text-gray-700 hover:bg-gray-50'
              }`}
            >
              + New customer
            </button>
          </div>
        </div>

        {mode === 'existing' ? (
          <div className="mt-3">
            <Row label="Pick customer" required>
              <select
                required
                value={existingCustomerId}
                onChange={(e) => setExistingCustomerId(e.target.value)}
                className={inputClass}
                disabled={!customers}
              >
                <option value="" disabled>
                  {customers ? '— Select —' : 'Loading customers…'}
                </option>
                {customerOptions.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} ·{' '}
                    {c.nric.slice(-4).padStart(c.nric.length, '•')}
                  </option>
                ))}
              </select>
            </Row>
          </div>
        ) : (
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Row label="Owner name" required>
              <input
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                className={inputClass}
                placeholder="Full name as on IC"
              />
            </Row>
            <Row label="NRIC" required>
              <input
                type="text"
                required
                value={nric}
                onChange={(e) =>
                  setNric(e.target.value.replace(/\D/g, '').slice(0, 12))
                }
                className={inputClass}
                placeholder="12 digits, no dashes"
                inputMode="numeric"
                pattern="\d{12}"
                title="NRIC must be 12 digits"
              />
            </Row>
            <Row label="Phone" required>
              <input
                type="tel"
                required
                value={phone}
                onChange={(e) =>
                  setPhone(e.target.value.replace(/\D/g, '').slice(0, 11))
                }
                className={inputClass}
                placeholder="01x… (10–11 digits)"
                inputMode="numeric"
                pattern="\d{10,11}"
                title="Phone must be 10–11 digits"
              />
            </Row>
            <Row label="Email">
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className={inputClass}
                placeholder="Optional"
              />
            </Row>
            <div className="sm:col-span-2">
              <Row label="Address">
                <input
                  type="text"
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  className={inputClass}
                  placeholder="Optional"
                />
              </Row>
            </div>
          </div>
        )}

        {error && (
          <div
            role="alert"
            className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
          >
            {error}
          </div>
        )}

        <div className="mt-5 flex flex-wrap items-center justify-end gap-2 border-t border-gray-200 pt-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving}
            className="rounded-md bg-gray-900 px-4 py-1.5 text-sm font-medium text-white shadow-sm hover:bg-gray-800 disabled:opacity-60"
          >
            {saving ? 'Saving…' : 'Save vehicle + owner'}
          </button>
        </div>
      </form>
    </div>
  )
}
