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
    if (mileageIn.trim() === '') {
      setError('Mileage is required.')
      return
    }
    try {
      const created = await createMut.mutateAsync({
        customer_id: customer.id,
        vehicle_id: vehicle.id,
        technician_id: technicianId || null,
        service_advisor_id: serviceAdvisorId || null,
        complaint: complaint || null,
        mileage_in: Number(mileageIn),
        notes: notes || null,
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
  // Time Out = Time In + days_to_complete. Empty or 0 days → same day.
  // We render the date too when the order spans more than one day so
  // the SA can sanity-check the pickup date at a glance.
  const days = daysToComplete ? Number(daysToComplete) : 0
  const timeOutDate = new Date(now.getTime() + days * 86_400_000)
  const timeOutTime = timeOutDate.toLocaleTimeString('en-MY', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
  const timeOutLabel =
    days > 0
      ? `${timeOutDate.toLocaleDateString('en-MY')} · ${timeOutTime}`
      : timeOutTime

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
            <Row label="Mileage" required>
              <input
                type="number"
                required
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
            <Row label="Time Out">
              <input
                type="text"
                readOnly
                value={timeOutLabel}
                title="Auto = Time In + No of Days to Complete"
                className={`${inputClass} bg-gray-50`}
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
            disabled={submitting || !vehicleId || mileageIn.trim() === ''}
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
 * Edit Vehicle Information — full WMS-style account dialog. Modelled
 * 1:1 on the legacy form: vehicle attrs on top, Detail Information
 * (owner + reminders + tax) below. Pops up when the SA types a plate
 * that isn't on file.
 *
 * Owner resolution is NRIC-driven (matching the legacy "Reg/ID/Passport
 * No" lookup): if the typed NRIC matches an existing customer, the
 * Owner block prefills with that customer's saved data and any edits
 * are saved back via the same NRIC-keyed upsert. If it doesn't match,
 * the same upsert just creates a new customer.
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

  // ---------- Vehicle fields ----------
  const [accountNo, setAccountNo] = useState('')
  const [chassisNo, setChassisNo] = useState('')
  const [membershipNo, setMembershipNo] = useState('')
  const [engineNo, setEngineNo] = useState('')
  const [vehicleColour, setVehicleColour] = useState('')
  const [model, setModel] = useState<string>(PROTON_MODELS[0])
  const [variant, setVariant] = useState('')
  const [capacityCc, setCapacityCc] = useState('')
  const [yearMake, setYearMake] = useState('')
  const [registrationDate, setRegistrationDate] = useState('')
  const [warrantyDate, setWarrantyDate] = useState('')

  // ---------- Owner (Detail Information) ----------
  const [name, setName] = useState('')
  const [address, setAddress] = useState('')
  const [city, setCity] = useState('')
  const [state, setState] = useState('')
  const [postCode, setPostCode] = useState('')
  const [nric, setNric] = useState('')
  const [phone, setPhone] = useState('')
  const [phone2, setPhone2] = useState('')
  const [faxNo, setFaxNo] = useState('')
  const [email, setEmail] = useState('')
  const [remark, setRemark] = useState('')
  const [tinNo, setTinNo] = useState('')
  const [taxNo, setTaxNo] = useState('')
  const [sex, setSex] = useState<'' | 'M' | 'F'>('')
  const [race, setRace] = useState<'' | 'C' | 'M' | 'I' | 'O'>('')
  const [salesDealer, setSalesDealer] = useState('')
  const [maritalStatus, setMaritalStatus] = useState<'' | 'S' | 'M' | 'D'>('')
  const [birthday, setBirthday] = useState('')
  const [birthdayReminder, setBirthdayReminder] = useState(true)
  const [status, setStatus] = useState<'active' | 'inactive'>('active')
  const [fixedDiscountRate, setFixedDiscountRate] = useState('0.00')
  const [roadTaxRenewal, setRoadTaxRenewal] = useState('')
  const [roadTaxReminder, setRoadTaxReminder] = useState(true)
  const [insuranceRenewal, setInsuranceRenewal] = useState('')
  const [insuranceReminder, setInsuranceReminder] = useState(true)
  const [drivingLicenseRenewal, setDrivingLicenseRenewal] = useState('')
  const [drivingLicenseReminder, setDrivingLicenseReminder] = useState(true)
  const [preferenceListPrice, setPreferenceListPrice] = useState('List Price 1')
  const [sendNextServiceReminder, setSendNextServiceReminder] = useState(true)
  const [sendGreetingCard, setSendGreetingCard] = useState(true)

  const [error, setError] = useState<string | null>(null)
  const saving = upsertCustomer.isPending || createVehicle.isPending
  const variants = variantsFor(model)
  const palette = coloursFor(model)

  const overlayRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  function handleModelChange(next: string) {
    setModel(next)
    if (!variantsFor(next).includes(variant)) setVariant('')
    const p = coloursFor(next)
    if (p.length > 0 && !p.includes(vehicleColour)) setVehicleColour('')
  }

  // NRIC lookup: when the user finishes typing a 12-digit NRIC, check
  // if a customer already exists. If yes, prefill every Owner field so
  // they're editing the existing record (and the upsert on save will
  // patch it). If no, leave the fields untouched for a fresh entry.
  function lookupCustomerByNric(value: string) {
    const trimmed = value.trim()
    if (!trimmed || !customers) return
    const match = customers.find((c) => c.nric === trimmed)
    if (!match) return
    setName(match.name)
    setPhone(match.phone)
    setEmail(match.email ?? '')
    setAddress(match.address ?? '')
    setCity(match.city ?? '')
    setState(match.state ?? '')
    setPostCode(match.post_code ?? '')
    setPhone2(match.phone2 ?? '')
    setFaxNo(match.fax_no ?? '')
    setTinNo(match.tin_no ?? '')
    setTaxNo(match.tax_no ?? '')
    setSex(match.sex ?? '')
    setRace(match.race ?? '')
    setMaritalStatus(match.marital_status ?? '')
    setSalesDealer(match.sales_dealer ?? '')
    setBirthday(match.birthday ?? '')
    setStatus(match.status)
    setFixedDiscountRate(String(match.fixed_discount_rate ?? '0'))
    setRoadTaxRenewal(match.road_tax_renewal ?? '')
    setInsuranceRenewal(match.insurance_renewal ?? '')
    setDrivingLicenseRenewal(match.driving_license_renewal ?? '')
    setRoadTaxReminder(match.road_tax_send_reminder)
    setInsuranceReminder(match.insurance_send_reminder)
    setDrivingLicenseReminder(match.driving_license_send_reminder)
    setBirthdayReminder(match.birthday_send_reminder)
    setSendNextServiceReminder(match.send_next_service_reminder)
    setSendGreetingCard(match.send_greeting_card)
    setPreferenceListPrice(match.preference_list_price)
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    try {
      // Upsert the customer keyed on NRIC — creates if new, updates if
      // we found a match. All Detail Information fields ride along.
      const upserted = await upsertCustomer.mutateAsync({
        name: name.trim(),
        nric: nric.trim(),
        phone: phone.trim(),
        email: email.trim() || null,
        address: address.trim() || null,
        city: city.trim() || null,
        state: state.trim() || null,
        post_code: postCode.trim() || null,
        phone2: phone2.trim() || null,
        fax_no: faxNo.trim() || null,
        tin_no: tinNo.trim() || null,
        tax_no: taxNo.trim() || null,
        sex: sex || null,
        race: race || null,
        marital_status: maritalStatus || null,
        sales_dealer: salesDealer.trim() || null,
        birthday: birthday || null,
        status,
        fixed_discount_rate: Number(fixedDiscountRate) || 0,
        preference_list_price: preferenceListPrice,
        road_tax_renewal: roadTaxRenewal || null,
        insurance_renewal: insuranceRenewal || null,
        driving_license_renewal: drivingLicenseRenewal || null,
        road_tax_send_reminder: roadTaxReminder,
        insurance_send_reminder: insuranceReminder,
        driving_license_send_reminder: drivingLicenseReminder,
        birthday_send_reminder: birthdayReminder,
        send_next_service_reminder: sendNextServiceReminder,
        send_greeting_card: sendGreetingCard,
      })
      const created = await createVehicle.mutateAsync({
        customer_id: upserted.id,
        registration_no: regNo,
        chassis_no: chassisNo || null,
        model,
        variant: variant || null,
        color: vehicleColour || null,
        year: yearMake ? Number(yearMake) : null,
        account_no: accountNo.trim() || null,
        membership_no: membershipNo.trim() || null,
        engine_no: engineNo.trim() || null,
        capacity_cc: capacityCc ? Number(capacityCc) : null,
        year_make: yearMake ? Number(yearMake) : null,
        registration_date: registrationDate || null,
        warranty_date: warrantyDate || null,
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
      aria-label="Edit Vehicle Information"
      className="fixed inset-0 z-30 flex items-start justify-center bg-black/40 px-4 py-6 sm:items-center"
      onClick={(e) => {
        if (e.target === overlayRef.current) onClose()
      }}
    >
      <form
        onSubmit={handleSubmit}
        className="max-h-full w-full max-w-5xl overflow-y-auto rounded-2xl border border-gray-300 bg-white p-5 shadow-xl"
      >
        <div className="mb-4 border-b border-gray-200 pb-2">
          <h2 className="text-base font-semibold text-gray-900">
            Edit Vehicle Information
          </h2>
          <p className="mt-0.5 text-xs text-gray-500">
            New registration: <span className="font-mono">{regNo}</span>
          </p>
        </div>

        {/* ============ TOP: Vehicle attrs (two columns) ============ */}
        <div className="grid grid-cols-1 gap-x-6 gap-y-2.5 sm:grid-cols-2">
          {/* Left column */}
          <Row label="Account No">
            <input
              type="text"
              value={accountNo}
              onChange={(e) => setAccountNo(e.target.value)}
              className={inputClass}
              placeholder="Optional"
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

          <Row label="Vehicle No">
            <input
              type="text"
              readOnly
              value={regNo}
              className={`${inputClass} bg-gray-50 font-mono`}
            />
          </Row>
          <Row label="Capacity (cc)">
            <input
              type="number"
              min={0}
              step={1}
              value={capacityCc}
              onChange={(e) => setCapacityCc(e.target.value)}
              className={inputClass}
              placeholder="e.g. 1500"
              inputMode="numeric"
            />
          </Row>

          <Row label="Chassis No">
            <input
              type="text"
              value={chassisNo}
              onChange={(e) => setChassisNo(e.target.value.toUpperCase())}
              className={inputClass}
              placeholder="17-char VIN"
            />
          </Row>
          <Row label="Year Make">
            <input
              type="number"
              min={1980}
              max={new Date().getFullYear() + 1}
              value={yearMake}
              onChange={(e) => setYearMake(e.target.value)}
              className={inputClass}
              placeholder="e.g. 2024"
              inputMode="numeric"
            />
          </Row>

          <Row label="Membership No">
            <input
              type="text"
              value={membershipNo}
              onChange={(e) => setMembershipNo(e.target.value)}
              className={inputClass}
              placeholder="Optional"
            />
          </Row>
          <Row label="Registration Date">
            <input
              type="date"
              value={registrationDate}
              onChange={(e) => setRegistrationDate(e.target.value)}
              className={inputClass}
            />
          </Row>

          <Row label="Engine No">
            <input
              type="text"
              value={engineNo}
              onChange={(e) => setEngineNo(e.target.value.toUpperCase())}
              className={inputClass}
              placeholder="Optional"
            />
          </Row>
          <Row label="Warranty Date">
            <input
              type="date"
              value={warrantyDate}
              onChange={(e) => setWarrantyDate(e.target.value)}
              className={inputClass}
            />
          </Row>

          <Row label="Vehicle Colour">
            {palette.length > 0 ? (
              <select
                value={vehicleColour}
                onChange={(e) => setVehicleColour(e.target.value)}
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
                value={vehicleColour}
                onChange={(e) => setVehicleColour(e.target.value)}
                className={inputClass}
              />
            )}
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
        </div>

        {/* ============ DIVIDER ============ */}
        <div className="my-5 flex items-center gap-3">
          <span className="text-xs font-medium uppercase tracking-widest text-blue-600">
            Detail Information
          </span>
          <span className="h-px flex-1 bg-blue-200" />
        </div>

        {/* ============ BOTTOM: Detail Information ============ */}
        <div className="grid grid-cols-1 gap-x-6 gap-y-2.5 sm:grid-cols-2">
          {/* ---------- Left column: contact + address ---------- */}
          <div className="space-y-2.5">
            <Row label="Owner" required>
              <input
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                className={inputClass}
                placeholder="Full name as on IC"
              />
            </Row>
            <Row label="Address">
              <textarea
                rows={3}
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                className={`${inputClass} min-h-16`}
              />
            </Row>
            <Row label="City">
              <input
                type="text"
                value={city}
                onChange={(e) => setCity(e.target.value)}
                className={inputClass}
              />
            </Row>
            <Row label="State">
              <input
                type="text"
                value={state}
                onChange={(e) => setState(e.target.value)}
                className={inputClass}
              />
            </Row>
            <Row label="Post Code">
              <input
                type="text"
                value={postCode}
                onChange={(e) => setPostCode(e.target.value)}
                className={inputClass}
                maxLength={6}
              />
            </Row>
            <Row label="Reg./ID/Passport No" required>
              <input
                type="text"
                required
                value={nric}
                onChange={(e) =>
                  setNric(e.target.value.replace(/\D/g, '').slice(0, 12))
                }
                onBlur={(e) => lookupCustomerByNric(e.target.value)}
                className={inputClass}
                placeholder="12-digit NRIC, no dashes"
                inputMode="numeric"
                pattern="\d{12}"
                title="12 digits — if it matches an existing customer, their details auto-fill on blur"
              />
            </Row>
            <Row label="Tel No / HP No" required>
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
              />
            </Row>
            <Row label="Tel No (2)">
              <input
                type="tel"
                value={phone2}
                onChange={(e) => setPhone2(e.target.value)}
                className={inputClass}
                placeholder="Optional"
              />
            </Row>
            <Row label="Fax No">
              <input
                type="tel"
                value={faxNo}
                onChange={(e) => setFaxNo(e.target.value)}
                className={inputClass}
                placeholder="Optional"
              />
            </Row>
            <Row label="Email">
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className={inputClass}
              />
            </Row>
            <Row label="Remark">
              <input
                type="text"
                value={remark}
                onChange={(e) => setRemark(e.target.value)}
                className={inputClass}
                placeholder="(visual only — not stored)"
                title="Customer-level remark isn't persisted today; use Internal notes on the job sheet instead."
              />
            </Row>
          </div>

          {/* ---------- Right column: tax / demographics / reminders ---------- */}
          <div className="space-y-2.5">
            <Row label="TIN No">
              <input
                type="text"
                value={tinNo}
                onChange={(e) => setTinNo(e.target.value)}
                className={inputClass}
              />
            </Row>
            <Row label="Tax No">
              <input
                type="text"
                value={taxNo}
                onChange={(e) => setTaxNo(e.target.value)}
                className={inputClass}
              />
            </Row>
            <Row label="Sex (M/F)">
              <select
                value={sex}
                onChange={(e) => setSex(e.target.value as '' | 'M' | 'F')}
                className={inputClass}
              >
                <option value="">—</option>
                <option value="M">M</option>
                <option value="F">F</option>
              </select>
            </Row>
            <Row label="Race (C/M/I/O)">
              <select
                value={race}
                onChange={(e) =>
                  setRace(e.target.value as '' | 'C' | 'M' | 'I' | 'O')
                }
                className={inputClass}
              >
                <option value="">—</option>
                <option value="C">C — Chinese</option>
                <option value="M">M — Malay</option>
                <option value="I">I — Indian</option>
                <option value="O">O — Others</option>
              </select>
            </Row>
            <Row label="Sales Dealer">
              <input
                type="text"
                value={salesDealer}
                onChange={(e) => setSalesDealer(e.target.value)}
                className={inputClass}
              />
            </Row>
            <Row label="Marital Status (S/M/D)">
              <select
                value={maritalStatus}
                onChange={(e) =>
                  setMaritalStatus(e.target.value as '' | 'S' | 'M' | 'D')
                }
                className={inputClass}
              >
                <option value="">—</option>
                <option value="S">S — Single</option>
                <option value="M">M — Married</option>
                <option value="D">D — Divorced</option>
              </select>
            </Row>
            <RowWithReminder
              label="Birthday (dd/mm/yyyy)"
              reminder={birthdayReminder}
              onReminderChange={setBirthdayReminder}
            >
              <input
                type="date"
                value={birthday}
                onChange={(e) => setBirthday(e.target.value)}
                className={inputClass}
              />
            </RowWithReminder>
            <Row label="Status">
              <select
                value={status}
                onChange={(e) =>
                  setStatus(e.target.value as 'active' | 'inactive')
                }
                className={inputClass}
              >
                <option value="active">AC — Active</option>
                <option value="inactive">IN — Inactive</option>
              </select>
            </Row>
            <Row label="Fixed Discount Rate (%)">
              <input
                type="number"
                min={0}
                max={100}
                step={0.01}
                value={fixedDiscountRate}
                onChange={(e) => setFixedDiscountRate(e.target.value)}
                className={inputClass}
              />
            </Row>
            <RowWithReminder
              label="Road Tax Renewal"
              reminder={roadTaxReminder}
              onReminderChange={setRoadTaxReminder}
            >
              <input
                type="date"
                value={roadTaxRenewal}
                onChange={(e) => setRoadTaxRenewal(e.target.value)}
                className={inputClass}
              />
            </RowWithReminder>
            <RowWithReminder
              label="Insurance Renewal"
              reminder={insuranceReminder}
              onReminderChange={setInsuranceReminder}
            >
              <input
                type="date"
                value={insuranceRenewal}
                onChange={(e) => setInsuranceRenewal(e.target.value)}
                className={inputClass}
              />
            </RowWithReminder>
            <RowWithReminder
              label="Driving License Renewal"
              reminder={drivingLicenseReminder}
              onReminderChange={setDrivingLicenseReminder}
            >
              <input
                type="date"
                value={drivingLicenseRenewal}
                onChange={(e) => setDrivingLicenseRenewal(e.target.value)}
                className={inputClass}
              />
            </RowWithReminder>
            <Row label="Preference List Price">
              <select
                value={preferenceListPrice}
                onChange={(e) => setPreferenceListPrice(e.target.value)}
                className={inputClass}
              >
                <option>List Price 1</option>
                <option>List Price 2</option>
                <option>List Price 3</option>
              </select>
            </Row>
            <div className="pt-1">
              <label className="flex items-center gap-2 text-sm text-gray-800">
                <input
                  type="checkbox"
                  checked={sendNextServiceReminder}
                  onChange={(e) =>
                    setSendNextServiceReminder(e.target.checked)
                  }
                />
                Send Next Service Reminder
              </label>
              <label className="mt-1 flex items-center gap-2 text-sm text-gray-800">
                <input
                  type="checkbox"
                  checked={sendGreetingCard}
                  onChange={(e) => setSendGreetingCard(e.target.checked)}
                />
                Send Greeting Card
              </label>
            </div>
            <Row label="Last Updated Date">
              <input
                type="text"
                readOnly
                value="— auto on save —"
                className={`${inputClass} bg-gray-50 italic text-gray-500`}
              />
            </Row>
          </div>
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
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
          >
            Close
          </button>
          <button
            type="submit"
            disabled={saving}
            className="rounded-md bg-gray-900 px-4 py-1.5 text-sm font-medium text-white shadow-sm hover:bg-gray-800 disabled:opacity-60"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </form>
    </div>
  )
}

/**
 * Row variant with a "Send Reminder" checkbox inline on the right —
 * mirrors the legacy WMS dialog where every renewal date paired with a
 * checkbox to opt the customer into automated reminders.
 */
function RowWithReminder({
  label,
  reminder,
  onReminderChange,
  children,
}: {
  label: string
  reminder: boolean
  onReminderChange: (next: boolean) => void
  children: React.ReactNode
}) {
  return (
    <div className="grid grid-cols-[7.5rem_1fr_auto] items-center gap-2">
      <span className={labelClass}>{label}</span>
      {children}
      <label
        className="flex shrink-0 items-center gap-1 text-[11px] text-gray-600"
        title="Send a reminder when this date approaches"
      >
        <input
          type="checkbox"
          checked={reminder}
          onChange={(e) => onReminderChange(e.target.checked)}
        />
        Send Reminder
      </label>
    </div>
  )
}
