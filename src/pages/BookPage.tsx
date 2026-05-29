import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AppShell } from '../components/AppShell'
import { useAuth } from '../lib/auth'
import { useAvailableSlots, useSubmitAppointment } from '../lib/queries'
import { formatError } from '../lib/errors'
import {
  SERVICE_MILEAGE_OPTIONS,
  SLOT_CAPACITY,
  SLOT_LABEL,
  SLOT_TIMES,
  formatServiceMileage,
  formatSlot,
  type AvailableSlot,
  type ServiceMileage,
  type SlotTime,
} from '../lib/types'

/**
 * Customer-facing service-booking form.
 *
 * Two entry points, same component:
 *   /book          — public route, rendered standalone (no AppShell, no
 *                    auth required). Customer fills + submits, lands on
 *                    /book/<token> for the status read-back.
 *   /service/book  — staff path, rendered inside AppShell. Same form,
 *                    plus a "Phone booking" toggle for service advisors
 *                    taking a slot on a phone-call customer's behalf
 *                    (which auto-confirms and tags source='phone').
 *
 * Slot picker: the eight hour-long slots (9–4) for the chosen date,
 * fetched from `get_available_slots(p_date)`. Each slot shows
 * `taken/capacity`; full slots render disabled. Customers + staff are
 * forced into one of these values — no free-form time entry.
 */
export function BookPage({
  embedded = false,
  staffPhoneBlockEnabled = false,
}: {
  embedded?: boolean
  /** Set true on /service/book so the phone-block toggle is rendered. */
  staffPhoneBlockEnabled?: boolean
}) {
  const navigate = useNavigate()
  const submitMut = useSubmitAppointment()

  const [customerName, setCustomerName] = useState('')
  const [customerPhone, setCustomerPhone] = useState('')
  const [customerEmail, setCustomerEmail] = useState('')
  const [vehicleReg, setVehicleReg] = useState('')
  const [vehicleModel, setVehicleModel] = useState('')

  const today = new Date().toISOString().slice(0, 10)
  const [preferredDate, setPreferredDate] = useState(today)
  const [slotTime, setSlotTime] = useState<SlotTime | null>(null)
  /** A picked tier from SERVICE_MILEAGE_OPTIONS, or the sentinel
   *  `'other'` for the free-form km input below the select. */
  const [mileageChoice, setMileageChoice] = useState<
    ServiceMileage | 'other' | null
  >(null)
  /** Free-form km value when `mileageChoice === 'other'`. */
  const [otherMileageStr, setOtherMileageStr] = useState('')
  const [complaint, setComplaint] = useState('')
  const [phoneBlock, setPhoneBlock] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const { data: slots, isLoading: slotsLoading } =
    useAvailableSlots(preferredDate)

  // Clear the slot pick whenever the date changes — yesterday's 9am
  // becoming tomorrow's 9am could silently be full.
  useEffect(() => {
    setSlotTime(null)
  }, [preferredDate])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setFormError(null)

    const name = customerName.trim()
    const phone = customerPhone.trim()
    const email = customerEmail.trim()
    const reg = vehicleReg.trim().toUpperCase()
    const model = vehicleModel.trim()
    if (!name || !phone || !email || !reg || !model) {
      setFormError(
        'Please fill in name, phone, email, vehicle reg, and model.',
      )
      return
    }
    if (!slotTime) {
      setFormError('Please pick a time slot.')
      return
    }
    if (!mileageChoice) {
      setFormError('Please pick which service interval (km) you need.')
      return
    }
    let mileage: number
    if (mileageChoice === 'other') {
      const parsed = Number(otherMileageStr)
      if (!Number.isFinite(parsed) || parsed <= 100000) {
        setFormError(
          'For "Other", enter a mileage greater than 100,000 km.',
        )
        return
      }
      mileage = Math.round(parsed)
    } else {
      mileage = mileageChoice
    }
    try {
      const token = await submitMut.mutateAsync({
        customer_name: name,
        customer_phone: phone,
        customer_email: email,
        vehicle_reg: reg,
        vehicle_model: model,
        preferred_date: preferredDate,
        slot_time: slotTime,
        service_mileage: mileage,
        complaint: complaint.trim() || null,
        phone_block: staffPhoneBlockEnabled ? phoneBlock : false,
      })
      if (embedded) {
        // Staff path: jump back to the appointments queue.
        navigate('/service/appointments')
      } else {
        navigate(`/book/${token}`)
      }
    } catch (err) {
      setFormError(formatError(err))
    }
  }

  const body = (
    <form onSubmit={handleSubmit} className="space-y-6">
      {!embedded && (
        <div>
          <h1 className="text-xl font-semibold text-gray-900">
            Book a service appointment
          </h1>
          <p className="mt-1 text-sm text-gray-600">
            Pick an open time slot and tell us about your car. We'll confirm
            by phone shortly after.
          </p>
        </div>
      )}

      <Section title="Your details">
        <Field label="Full name" required>
          <input
            value={customerName}
            onChange={(e) => setCustomerName(e.target.value)}
            required
            autoComplete="name"
            className={inputCls}
          />
        </Field>
        <Field label="Phone" required>
          <input
            value={customerPhone}
            onChange={(e) => setCustomerPhone(e.target.value)}
            required
            inputMode="tel"
            autoComplete="tel"
            placeholder="01X-XXXXXXX"
            className={inputCls}
          />
        </Field>
        <Field label="Email" required>
          <input
            type="email"
            value={customerEmail}
            onChange={(e) => setCustomerEmail(e.target.value)}
            required
            autoComplete="email"
            className={inputCls}
          />
        </Field>
      </Section>

      <Section title="Your vehicle">
        <Field label="Registration no" required>
          <input
            value={vehicleReg}
            onChange={(e) => setVehicleReg(e.target.value)}
            required
            className={`${inputCls} font-mono uppercase`}
          />
        </Field>
        <Field label="Model" required>
          <input
            value={vehicleModel}
            onChange={(e) => setVehicleModel(e.target.value)}
            required
            placeholder="e.g. Proton X50"
            className={inputCls}
          />
        </Field>
      </Section>

      <Section title="Pick a slot">
        <Field label="Service interval (km)" required>
          <select
            value={mileageChoice ?? ''}
            onChange={(e) => {
              const v = e.target.value
              if (v === '') setMileageChoice(null)
              else if (v === 'other') setMileageChoice('other')
              else setMileageChoice(Number(v) as ServiceMileage)
            }}
            required
            className={inputCls}
          >
            <option value="" disabled>
              Pick the service interval
            </option>
            {SERVICE_MILEAGE_OPTIONS.map((km) => (
              <option key={km} value={km}>
                {formatServiceMileage(km)}
              </option>
            ))}
            <option value="other">Other (more than 100,000 km)</option>
          </select>
        </Field>
        {mileageChoice === 'other' && (
          <Field label="Your mileage (km)" required>
            <input
              type="number"
              min={100001}
              step={1000}
              inputMode="numeric"
              value={otherMileageStr}
              onChange={(e) => setOtherMileageStr(e.target.value)}
              required
              placeholder="e.g. 120000"
              className={inputCls}
            />
          </Field>
        )}
        <Field label="Date" required>
          <input
            type="date"
            value={preferredDate}
            min={today}
            onChange={(e) => setPreferredDate(e.target.value)}
            required
            className={inputCls}
          />
        </Field>
        <div className="sm:col-span-2">
          <div className="mb-2 text-xs font-medium text-gray-700">
            Time <span className="text-rose-600">*</span>
          </div>
          <SlotGrid
            loading={slotsLoading}
            slots={slots ?? []}
            value={slotTime}
            onChange={setSlotTime}
            requestedDate={preferredDate}
          />
        </div>
        <Field label="What's wrong / what would you like done?">
          <textarea
            value={complaint}
            onChange={(e) => setComplaint(e.target.value)}
            rows={4}
            placeholder="e.g. routine 10,000 km service · brake squeak · aircon not cold"
            className={inputCls}
          />
        </Field>
      </Section>

      {staffPhoneBlockEnabled && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3">
          <label className="flex items-center gap-2 text-sm text-amber-900">
            <input
              type="checkbox"
              checked={phoneBlock}
              onChange={(e) => setPhoneBlock(e.target.checked)}
            />
            <span>
              <span className="font-semibold">Phone booking</span> — customer
              called in. Auto-confirm and lock this slot now.
            </span>
          </label>
        </div>
      )}

      {(formError || submitMut.isError) && (
        <div
          role="alert"
          className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
        >
          {formError ?? formatError(submitMut.error)}
        </div>
      )}

      <button
        type="submit"
        disabled={
          submitMut.isPending ||
          !slotTime ||
          !mileageChoice ||
          (mileageChoice === 'other' && !otherMileageStr.trim())
        }
        className="w-full rounded-md bg-gray-900 px-4 py-3 text-sm font-medium text-white shadow hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
      >
        {submitMut.isPending
          ? 'Submitting…'
          : phoneBlock
            ? 'Confirm phone booking'
            : 'Request appointment'}
      </button>
    </form>
  )

  if (embedded) return body

  return <PublicShell>{body}</PublicShell>
}

/** Wrapper used by /service/book — same component, inside the app's AppShell. */
export function StaffBookPage() {
  const { canAccessService } = useAuth()
  if (canAccessService === false) return null
  return (
    <AppShell>
      <div className="mb-4">
        <h1 className="text-xl font-semibold text-gray-900">
          New service appointment
        </h1>
        <p className="mt-1 text-sm text-gray-600">
          Submit on behalf of a walk-in or phone-in customer. Tick "Phone
          booking" to lock the slot immediately.
        </p>
      </div>
      <BookPage embedded staffPhoneBlockEnabled />
    </AppShell>
  )
}

// ---------- slot grid ----------

function SlotGrid({
  slots,
  loading,
  value,
  onChange,
  requestedDate,
}: {
  slots: AvailableSlot[]
  loading: boolean
  value: SlotTime | null
  onChange: (s: SlotTime) => void
  requestedDate: string
}) {
  if (loading) {
    return (
      <div className="rounded-md border border-gray-200 bg-gray-50 px-3 py-6 text-center text-xs text-gray-500">
        Loading slots…
      </div>
    )
  }
  if (slots.length === 0) {
    // RPC returns 0 rows on Sunday + past dates.
    const dow = new Date(requestedDate + 'T00:00:00').getDay()
    const reason =
      dow === 0
        ? 'The workshop is closed on Sundays. Please pick another date.'
        : 'No slots available for this date. Pick another date.'
    return (
      <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-3 text-xs text-amber-900">
        {reason}
      </div>
    )
  }

  // When the customer picks today, suppress hour slots whose start time has
  // already passed in Asia/Kuala_Lumpur. Slot "09:00:00" → hour 9; if it's
  // 14:30 KL time, hours <= 14 are past. We use Intl with timeZone='Asia/
  // Kuala_Lumpur' so the comparison is correct regardless of where the
  // visitor's browser thinks it is.
  const kl = klNow()
  const isToday = requestedDate === kl.dateYmd
  const currentHourKL = kl.hour

  return (
    <>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {SLOT_TIMES.map((t) => {
          const row = slots.find((s) => normaliseSlot(s.slot_time) === t)
          const taken = row?.taken ?? 0
          const capacity = row?.capacity ?? SLOT_CAPACITY
          const full = taken >= capacity
          const slotHour = parseInt(t.slice(0, 2), 10)
          const past = isToday && slotHour <= currentHourKL
          const selected = value === t
          const unavailable = full || past
          return (
            <button
              key={t}
              type="button"
              disabled={unavailable}
              onClick={() => onChange(t)}
              className={`group relative flex flex-col items-start rounded-md border px-3 py-2 text-left transition ${
                selected
                  ? 'border-gray-900 bg-gray-900 text-white'
                  : unavailable
                    ? 'cursor-not-allowed border-gray-200 bg-gray-100 text-gray-400'
                    : 'border-gray-300 bg-white text-gray-700 hover:border-gray-900 hover:bg-gray-50'
              }`}
              title={
                past
                  ? 'This time has already passed'
                  : full
                    ? 'This slot is fully booked'
                    : `${capacity - taken} of ${capacity} spots remaining`
              }
            >
              <span className="text-sm font-semibold">{SLOT_LABEL[t]}</span>
              <span
                className={`mt-0.5 text-[10px] ${selected ? 'text-gray-200' : 'text-gray-500'}`}
              >
                {past
                  ? 'Past'
                  : full
                    ? 'Full'
                    : `${capacity - taken} of ${capacity} open`}
              </span>
            </button>
          )
        })}
      </div>
      <p className="mt-2 text-[10px] text-gray-500">
        All slots are one hour. Workshop hours are Mon–Sat 9am–5pm.
      </p>
    </>
  )
}

/** "Now" in Asia/Kuala_Lumpur as a YYYY-MM-DD string + the local hour
 *  (0–23). Used so the slot grid can hide past times without trusting
 *  the visitor's browser clock / timezone. */
function klNow(): { dateYmd: string; hour: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kuala_Lumpur',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date())
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '00'
  const dateYmd = `${get('year')}-${get('month')}-${get('day')}`
  const hour = parseInt(get('hour'), 10)
  return { dateYmd, hour }
}

function normaliseSlot(raw: string): string {
  return raw.length === 5 ? `${raw}:00` : raw
}

// ---------- bits ----------

function PublicShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-slate-50">
      <header className="bg-gradient-to-r from-slate-700 to-slate-500 px-4 py-6 text-white sm:px-8">
        <div className="mx-auto max-w-2xl">
          <div className="text-[10px] font-medium uppercase tracking-widest text-slate-200">
            SWL Motors SDN BHD
          </div>
          <h1 className="mt-1 text-xl font-semibold sm:text-2xl">
            Workshop appointment request
          </h1>
        </div>
      </header>
      <main className="mx-auto max-w-2xl px-4 py-6 sm:px-8">{children}</main>
      <footer className="px-4 pb-8 text-center text-[11px] text-gray-400 sm:px-8">
        © SWL Motors. We will only use these details to confirm your
        appointment.
      </footer>
    </div>
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
    <fieldset className="rounded-2xl border border-gray-200 bg-white p-4">
      <legend className="px-1 text-sm font-semibold text-gray-800">
        {title}
      </legend>
      <div className="grid gap-3 sm:grid-cols-2">{children}</div>
    </fieldset>
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
    <label className="flex flex-col gap-1 text-sm sm:col-span-2 sm:[&:has(input[type=date])]:col-span-1">
      <span className="text-xs font-medium text-gray-700">
        {label}
        {required && <span className="ml-1 text-rose-600">*</span>}
      </span>
      {children}
    </label>
  )
}

const inputCls =
  'w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm outline-none focus:border-gray-900 focus:ring-2 focus:ring-gray-900/10'

// Re-export the helper so it stays alongside the slot picker. Avoids
// drive-by imports forgetting the normalisation rules.
export { formatSlot }
