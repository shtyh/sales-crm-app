import { Link, useParams } from 'react-router-dom'
import { useAppointmentByToken } from '../lib/queries'
import { formatError } from '../lib/errors'
import {
  APPOINTMENT_PERIOD_LABEL,
  APPOINTMENT_STATUS_LABEL,
  formatSlot,
  type PublicServiceAppointment,
} from '../lib/types'

/**
 * Public read-back for a submitted appointment.
 *
 * Customer lands here after /book → submit. The page polls (window
 * focus) so an open tab refreshes when staff confirms server-side.
 * Once `status='confirmed'` the row is effectively frozen (workshop
 * UI doesn't let staff edit confirmed rows, and the customer never
 * had write access), so the page renders read-only — that's the
 * "slot lock" the customer sees.
 */
export function BookStatusPage() {
  const { token } = useParams<{ token: string }>()
  const { data, isLoading, error } = useAppointmentByToken(token)

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="bg-gradient-to-r from-slate-700 to-slate-500 px-4 py-6 text-white sm:px-8">
        <div className="mx-auto max-w-2xl">
          <div className="text-[10px] font-medium uppercase tracking-widest text-slate-200">
            SWL Motors SDN BHD
          </div>
          <h1 className="mt-1 text-xl font-semibold sm:text-2xl">
            Your appointment
          </h1>
        </div>
      </header>

      <main className="mx-auto max-w-2xl px-4 py-6 sm:px-8">
        {isLoading && <div className="text-sm text-gray-500">Loading…</div>}
        {error && (
          <div
            role="alert"
            className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
          >
            {formatError(error)}
          </div>
        )}
        {!isLoading && !error && !data && (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-4 text-sm text-amber-900">
            We couldn't find a booking for this link. Double-check the URL,
            or{' '}
            <Link to="/book" className="underline">
              submit a new request
            </Link>
            .
          </div>
        )}
        {data && <Status row={data} />}
      </main>

      <footer className="px-4 pb-8 text-center text-[11px] text-gray-400 sm:px-8">
        © SWL Motors. Bookmark this page — it updates automatically once
        we confirm.
      </footer>
    </div>
  )
}

function Status({ row }: { row: PublicServiceAppointment }) {
  const dateLabel = new Date(row.preferred_date + 'T00:00:00').toLocaleDateString(
    'en-MY',
    { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' },
  )
  const timeLabel = row.slot_time
    ? formatSlot(row.slot_time)
    : APPOINTMENT_PERIOD_LABEL[row.preferred_period]

  const banner = (() => {
    switch (row.status) {
      case 'confirmed':
        return (
          <div className="rounded-2xl border border-green-200 bg-green-50 px-4 py-4 text-sm text-green-900">
            <div className="text-base font-semibold">
              ✓ Confirmed for {dateLabel} at {timeLabel}
            </div>
            <div className="mt-1 text-xs">
              See you then. Please bring your IC and the vehicle's service
              book if you have one.
            </div>
          </div>
        )
      case 'rejected':
        return (
          <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-4 text-sm text-rose-900">
            <div className="text-base font-semibold">
              ✗ This slot wasn't available
            </div>
            {row.rejected_reason && (
              <div className="mt-1 text-xs">
                Reason from the workshop: {row.rejected_reason}
              </div>
            )}
            <div className="mt-3">
              <Link
                to="/book"
                className="inline-flex rounded-md bg-rose-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-rose-800"
              >
                Pick another date
              </Link>
            </div>
          </div>
        )
      case 'cancelled':
        return (
          <div className="rounded-2xl border border-gray-200 bg-gray-50 px-4 py-4 text-sm text-gray-800">
            <div className="text-base font-semibold">This booking was cancelled.</div>
            <div className="mt-3">
              <Link
                to="/book"
                className="inline-flex rounded-md bg-gray-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-gray-800"
              >
                Make a new request
              </Link>
            </div>
          </div>
        )
      default:
        return (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-4 text-sm text-amber-900">
            <div className="text-base font-semibold">
              ⏳ Pending — we'll confirm shortly
            </div>
            <div className="mt-1 text-xs">
              You'll get a call to confirm. Refresh this page if you want
              to check the latest status.
            </div>
          </div>
        )
    }
  })()

  return (
    <div className="space-y-4">
      {banner}

      <section className="rounded-2xl border border-gray-200 bg-white p-4 text-sm text-gray-800">
        <div className="mb-3 text-[10px] font-medium uppercase tracking-widest text-gray-500">
          Booking summary · {APPOINTMENT_STATUS_LABEL[row.status]}
        </div>
        <dl className="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
          <Item label="Customer" value={row.customer_name} />
          <Item label="Phone" value={row.customer_phone} />
          <Item
            label="Email"
            value={row.customer_email ?? <Muted>—</Muted>}
          />
          <Item label="Date" value={dateLabel} />
          <Item label="Time" value={timeLabel} />
          <Item label="Vehicle" value={row.vehicle_reg} mono />
          <Item
            label="Chassis"
            value={row.vehicle_chassis ?? <Muted>—</Muted>}
            mono
          />
          <Item
            label="Model"
            value={row.vehicle_model ?? <Muted>—</Muted>}
          />
        </dl>
        {row.complaint && (
          <div className="mt-3 border-t border-gray-100 pt-3">
            <div className="text-[10px] font-medium uppercase tracking-wider text-gray-500">
              Notes
            </div>
            <div className="mt-1 whitespace-pre-wrap text-sm">
              {row.complaint}
            </div>
          </div>
        )}
      </section>
    </div>
  )
}

function Item({
  label,
  value,
  mono,
}: {
  label: string
  value: React.ReactNode
  mono?: boolean
}) {
  return (
    <div>
      <dt className="text-[10px] font-medium uppercase tracking-wider text-gray-500">
        {label}
      </dt>
      <dd className={`text-sm text-gray-900 ${mono ? 'font-mono' : ''}`}>
        {value}
      </dd>
    </div>
  )
}

function Muted({ children }: { children: React.ReactNode }) {
  return <span className="text-gray-400">{children}</span>
}
