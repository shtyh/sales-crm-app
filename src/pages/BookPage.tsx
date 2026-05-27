import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AppShell } from '../components/AppShell'
import { useAuth } from '../lib/auth'
import { useSubmitAppointment } from '../lib/queries'
import { formatError } from '../lib/errors'
import {
  APPOINTMENT_PERIOD_LABEL,
  type AppointmentPeriod,
} from '../lib/types'

/**
 * Customer-facing service-booking form.
 *
 * Two entry points, same component:
 *   /book          — public route, rendered standalone (no AppShell, no
 *                    auth required). Customer fills + submits, lands on
 *                    /book/<token> for the status read-back.
 *   /service/book  — staff path, rendered inside AppShell. Same form,
 *                    but the submit_appointment RPC tags the row
 *                    `source='staff'` because the caller is signed in.
 *
 * Field set: customer (name, phone, optional NRIC + email), vehicle
 * (reg, optional chassis + model), and the request (preferred date +
 * AM/PM + complaint). No real calendar capacity yet — staff confirms
 * the slot manually from /service/appointments, which is what locks the
 * row down for the customer.
 */
export function BookPage({ embedded = false }: { embedded?: boolean }) {
  const navigate = useNavigate()
  const submitMut = useSubmitAppointment()

  const [customerName, setCustomerName] = useState('')
  const [customerPhone, setCustomerPhone] = useState('')
  const [customerNric, setCustomerNric] = useState('')
  const [customerEmail, setCustomerEmail] = useState('')
  const [vehicleReg, setVehicleReg] = useState('')
  const [vehicleChassis, setVehicleChassis] = useState('')
  const [vehicleModel, setVehicleModel] = useState('')
  const today = new Date().toISOString().slice(0, 10)
  const [preferredDate, setPreferredDate] = useState(today)
  const [preferredPeriod, setPreferredPeriod] =
    useState<AppointmentPeriod>('am')
  const [complaint, setComplaint] = useState('')
  const [formError, setFormError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setFormError(null)

    const name = customerName.trim()
    const phone = customerPhone.trim()
    const reg = vehicleReg.trim().toUpperCase()
    if (!name || !phone || !reg) {
      setFormError('Please fill in your name, phone, and vehicle reg.')
      return
    }
    try {
      const token = await submitMut.mutateAsync({
        customer_name: name,
        customer_phone: phone,
        customer_nric: customerNric.trim() || null,
        customer_email: customerEmail.trim() || null,
        vehicle_reg: reg,
        vehicle_chassis: vehicleChassis.trim() || null,
        vehicle_model: vehicleModel.trim() || null,
        preferred_date: preferredDate,
        preferred_period: preferredPeriod,
        complaint: complaint.trim() || null,
      })
      navigate(`/book/${token}`)
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
            Tell us a little about you and your car. We'll confirm your slot
            by phone after we receive your request.
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
        <Field label="NRIC (optional)">
          <input
            value={customerNric}
            onChange={(e) => setCustomerNric(e.target.value)}
            inputMode="numeric"
            placeholder="12-digit IC, no dashes"
            className={inputCls}
          />
        </Field>
        <Field label="Email (optional)">
          <input
            type="email"
            value={customerEmail}
            onChange={(e) => setCustomerEmail(e.target.value)}
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
        <Field label="Chassis no (optional)">
          <input
            value={vehicleChassis}
            onChange={(e) => setVehicleChassis(e.target.value)}
            className={`${inputCls} font-mono uppercase`}
          />
        </Field>
        <Field label="Model (optional)">
          <input
            value={vehicleModel}
            onChange={(e) => setVehicleModel(e.target.value)}
            placeholder="e.g. Proton X50"
            className={inputCls}
          />
        </Field>
      </Section>

      <Section title="Your request">
        <Field label="Preferred date" required>
          <input
            type="date"
            value={preferredDate}
            min={today}
            onChange={(e) => setPreferredDate(e.target.value)}
            required
            className={inputCls}
          />
        </Field>
        <Field label="Preferred time" required>
          <div className="flex gap-2">
            {(Object.keys(APPOINTMENT_PERIOD_LABEL) as AppointmentPeriod[]).map(
              (p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setPreferredPeriod(p)}
                  className={`flex-1 rounded-md border px-3 py-2 text-sm font-medium transition ${
                    preferredPeriod === p
                      ? 'border-gray-900 bg-gray-900 text-white'
                      : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'
                  }`}
                >
                  {APPOINTMENT_PERIOD_LABEL[p]}
                </button>
              ),
            )}
          </div>
        </Field>
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
        disabled={submitMut.isPending}
        className="w-full rounded-md bg-gray-900 px-4 py-3 text-sm font-medium text-white shadow hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
      >
        {submitMut.isPending ? 'Submitting…' : 'Request appointment'}
      </button>
    </form>
  )

  if (embedded) return body

  return <PublicShell>{body}</PublicShell>
}

/** Wrapper used by /service/book — same component, inside the app's AppShell. */
export function StaffBookPage() {
  const { canAccessService } = useAuth()
  if (canAccessService === false) {
    // Sales-side staff don't have a service workspace — bounce them home.
    return null
  }
  return (
    <AppShell>
      <div className="mb-4">
        <h1 className="text-xl font-semibold text-gray-900">
          New service appointment
        </h1>
        <p className="mt-1 text-sm text-gray-600">
          Submit on behalf of a walk-in / phone-in. The customer can be
          handed the confirmation page link afterwards.
        </p>
      </div>
      <BookPage embedded />
    </AppShell>
  )
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
