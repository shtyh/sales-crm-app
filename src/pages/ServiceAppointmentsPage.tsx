import { useMemo, useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { AppShell } from '../components/AppShell'
import { useAuth } from '../lib/auth'
import {
  useAppointments,
  useCancelAppointment,
  useConfirmAppointment,
  useRejectAppointment,
} from '../lib/queries'
import { formatError } from '../lib/errors'
import {
  APPOINTMENT_PERIOD_LABEL,
  APPOINTMENT_STATUS_LABEL,
  type AppointmentStatus,
  type ServiceAppointment,
} from '../lib/types'

type Filter = 'pending' | 'confirmed' | 'rejected' | 'all'

/**
 * Workshop staff queue for customer-submitted appointment requests.
 *
 * RLS already gates write actions to service_manager / service_advisor /
 * super_admin; mechanics + store_keepers can read but the Confirm /
 * Reject buttons render disabled with a tooltip for them.
 *
 * Confirming flips the row to `status='confirmed'` and the public
 * /book/<token> page locks read-only on next refresh.
 */
export function ServiceAppointmentsPage() {
  const { role, canAccessService } = useAuth()
  if (canAccessService === false) return <Navigate to="/" replace />

  const { data: appts, error } = useAppointments()
  const [filter, setFilter] = useState<Filter>('pending')
  const [q, setQ] = useState('')

  const canModerate =
    role === 'service_manager' ||
    role === 'service_advisor' ||
    role === 'super_admin'

  const rows = useMemo(() => {
    let list: ServiceAppointment[] = appts ?? []
    if (filter !== 'all') {
      list = list.filter((a) => a.status === filter)
    }
    const needle = q.trim().toLowerCase()
    if (needle) {
      list = list.filter(
        (a) =>
          a.customer_name.toLowerCase().includes(needle) ||
          a.customer_phone.toLowerCase().includes(needle) ||
          a.vehicle_reg.toLowerCase().includes(needle) ||
          (a.vehicle_chassis ?? '').toLowerCase().includes(needle),
      )
    }
    return list
  }, [appts, filter, q])

  const totals = useMemo(() => {
    const t: Record<AppointmentStatus, number> = {
      pending: 0,
      confirmed: 0,
      rejected: 0,
      cancelled: 0,
    }
    for (const a of appts ?? []) t[a.status]++
    return t
  }, [appts])

  return (
    <AppShell>
      <div className="-mt-6 mb-4 -mx-4 sm:-mx-6">
        <div className="bg-gradient-to-r from-slate-700 to-slate-500 px-4 py-4 text-white sm:px-6">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <div className="text-[10px] font-medium uppercase tracking-widest text-slate-200">
                Workshop Management System
              </div>
              <h1 className="mt-1 text-lg font-semibold sm:text-xl">
                Customer appointment requests
              </h1>
            </div>
            <div className="flex flex-wrap gap-2">
              <Link
                to="/service/book"
                className="rounded-md bg-white px-3 py-1.5 text-xs font-medium text-gray-900 hover:bg-gray-100"
              >
                + New on behalf of customer
              </Link>
              <Link
                to="/book"
                target="_blank"
                rel="noreferrer"
                className="rounded-md border border-slate-200 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-600/40"
              >
                Open public form ↗
              </Link>
            </div>
          </div>
        </div>
      </div>

      {error && (
        <div
          role="alert"
          className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
        >
          {formatError(error)}
        </div>
      )}

      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Counter label="Pending" value={totals.pending} tone="amber" />
        <Counter label="Confirmed" value={totals.confirmed} tone="green" />
        <Counter label="Rejected" value={totals.rejected} tone="rose" />
        <Counter label="Cancelled" value={totals.cancelled} tone="gray" />
      </div>

      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          <Chip active={filter === 'pending'} onClick={() => setFilter('pending')}>
            Pending
          </Chip>
          <Chip
            active={filter === 'confirmed'}
            onClick={() => setFilter('confirmed')}
          >
            Confirmed
          </Chip>
          <Chip
            active={filter === 'rejected'}
            onClick={() => setFilter('rejected')}
          >
            Rejected
          </Chip>
          <Chip active={filter === 'all'} onClick={() => setFilter('all')}>
            All
          </Chip>
        </div>
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search name, phone, reg, chassis…"
          className="w-full max-w-xs rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm outline-none focus:border-gray-900 focus:ring-2 focus:ring-gray-900/10"
        />
      </div>

      <div className="overflow-x-auto rounded-2xl border border-gray-200 bg-white">
        <table className="min-w-full divide-y divide-gray-200 text-xs">
          <thead className="bg-gray-50 uppercase tracking-wider text-gray-500">
            <tr>
              <Th>Date</Th>
              <Th>Time</Th>
              <Th>Customer</Th>
              <Th>Phone</Th>
              <Th>Vehicle</Th>
              <Th>Complaint</Th>
              <Th>Source</Th>
              <Th>Status</Th>
              <Th>Submitted</Th>
              <Th alignRight>Actions</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {!appts && !error && (
              <tr>
                <td
                  colSpan={10}
                  className="px-3 py-8 text-center text-sm text-gray-500"
                >
                  Loading…
                </td>
              </tr>
            )}
            {appts && rows.length === 0 && (
              <tr>
                <td
                  colSpan={10}
                  className="px-3 py-8 text-center text-sm text-gray-500"
                >
                  No appointments match the current filter.
                </td>
              </tr>
            )}
            {rows.map((a) => (
              <Row key={a.id} row={a} canModerate={canModerate} />
            ))}
          </tbody>
        </table>
      </div>
    </AppShell>
  )
}

function Row({
  row,
  canModerate,
}: {
  row: ServiceAppointment
  canModerate: boolean
}) {
  const confirmMut = useConfirmAppointment()
  const rejectMut = useRejectAppointment()
  const cancelMut = useCancelAppointment()
  const [rejecting, setRejecting] = useState(false)
  const [reason, setReason] = useState('')

  const dateLabel = new Date(row.preferred_date + 'T00:00:00').toLocaleDateString(
    'en-MY',
    { day: '2-digit', month: '2-digit', year: 'numeric' },
  )
  const subLabel = new Date(row.created_at).toLocaleString('en-MY', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })

  const isPending = row.status === 'pending'
  const busy = confirmMut.isPending || rejectMut.isPending || cancelMut.isPending

  return (
    <>
      <tr className="hover:bg-gray-50">
        <td className="whitespace-nowrap px-3 py-2 text-gray-700">{dateLabel}</td>
        <td className="whitespace-nowrap px-3 py-2 text-gray-700">
          {APPOINTMENT_PERIOD_LABEL[row.preferred_period]}
        </td>
        <td className="whitespace-nowrap px-3 py-2 text-gray-900">
          {row.customer_name}
        </td>
        <td className="whitespace-nowrap px-3 py-2 font-mono text-gray-700">
          <a
            href={`tel:${row.customer_phone}`}
            className="hover:underline"
          >
            {row.customer_phone}
          </a>
        </td>
        <td className="whitespace-nowrap px-3 py-2">
          <div className="font-mono text-gray-900">{row.vehicle_reg}</div>
          {row.vehicle_model && (
            <div className="text-[10px] text-gray-500">{row.vehicle_model}</div>
          )}
        </td>
        <td className="max-w-xs truncate px-3 py-2 text-gray-700" title={row.complaint ?? ''}>
          {row.complaint ?? <span className="text-gray-400">—</span>}
        </td>
        <td className="whitespace-nowrap px-3 py-2 text-[10px] uppercase tracking-wider text-gray-500">
          {row.source}
        </td>
        <td className="whitespace-nowrap px-3 py-2">
          <StatusPill status={row.status} />
        </td>
        <td className="whitespace-nowrap px-3 py-2 text-[10px] text-gray-500">
          {subLabel}
        </td>
        <td className="whitespace-nowrap px-3 py-2 text-right">
          <div className="inline-flex gap-1">
            {isPending && (
              <>
                <button
                  type="button"
                  disabled={!canModerate || busy}
                  onClick={() => confirmMut.mutate(row.id)}
                  title={
                    canModerate
                      ? 'Confirm — locks the slot for the customer'
                      : 'Only Service Manager / Service Advisor / Super Admin can confirm'
                  }
                  className="rounded-md border border-green-200 bg-white px-2 py-1 text-[11px] font-medium text-green-700 hover:bg-green-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Confirm
                </button>
                <button
                  type="button"
                  disabled={!canModerate || busy}
                  onClick={() => setRejecting((r) => !r)}
                  className="rounded-md border border-rose-200 bg-white px-2 py-1 text-[11px] font-medium text-rose-700 hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Reject
                </button>
              </>
            )}
            {!isPending && row.status === 'confirmed' && canModerate && (
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  if (
                    confirm(
                      'Cancel this confirmed appointment? The customer will see the cancelled status on the booking link.',
                    )
                  ) {
                    cancelMut.mutate(row.id)
                  }
                }}
                className="rounded-md border border-gray-200 bg-white px-2 py-1 text-[11px] font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Cancel
              </button>
            )}
            <a
              href={`/book/${row.token}`}
              target="_blank"
              rel="noreferrer"
              className="rounded-md border border-gray-200 bg-white px-2 py-1 text-[11px] font-medium text-gray-700 hover:bg-gray-50"
              title="Open the customer-facing read-back page"
            >
              View
            </a>
          </div>
        </td>
      </tr>
      {rejecting && isPending && (
        <tr className="bg-rose-50/60">
          <td colSpan={10} className="px-3 py-3">
            <div className="flex flex-wrap items-center gap-2">
              <label className="text-xs font-medium text-rose-900">
                Reject reason (shown to the customer):
              </label>
              <input
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="e.g. Workshop fully booked that day — try another date."
                className="flex-1 rounded-md border border-rose-200 bg-white px-2 py-1 text-xs outline-none focus:border-rose-700 focus:ring-2 focus:ring-rose-700/10"
              />
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  rejectMut.mutate(
                    { id: row.id, reason },
                    {
                      onSuccess: () => {
                        setRejecting(false)
                        setReason('')
                      },
                    },
                  )
                }}
                className="rounded-md bg-rose-900 px-3 py-1 text-xs font-medium text-white hover:bg-rose-800 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Send rejection
              </button>
              <button
                type="button"
                onClick={() => {
                  setRejecting(false)
                  setReason('')
                }}
                className="rounded-md border border-rose-200 bg-white px-3 py-1 text-xs font-medium text-rose-900 hover:bg-rose-100"
              >
                Cancel
              </button>
            </div>
            {rejectMut.isError && (
              <div className="mt-2 text-xs text-red-700">
                {formatError(rejectMut.error)}
              </div>
            )}
          </td>
        </tr>
      )}
    </>
  )
}

// ---------- bits ----------

function Counter({
  label,
  value,
  tone,
}: {
  label: string
  value: number
  tone: 'amber' | 'green' | 'rose' | 'gray'
}) {
  const t = {
    amber: 'text-amber-700',
    green: 'text-green-700',
    rose: 'text-rose-700',
    gray: 'text-gray-700',
  }[tone]
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-3">
      <div className="text-[11px] font-medium text-gray-500">{label}</div>
      <div className={`mt-1 text-lg font-semibold tabular-nums ${t}`}>
        {value}
      </div>
    </div>
  )
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full px-3 py-1 text-xs font-medium transition ${
        active
          ? 'bg-gray-900 text-white'
          : 'border border-gray-300 bg-white text-gray-700 hover:bg-gray-50'
      }`}
    >
      {children}
    </button>
  )
}

function Th({
  children,
  alignRight,
}: {
  children: React.ReactNode
  alignRight?: boolean
}) {
  return (
    <th
      className={`whitespace-nowrap px-3 py-2 font-medium ${alignRight ? 'text-right' : 'text-left'}`}
    >
      {children}
    </th>
  )
}

function StatusPill({ status }: { status: AppointmentStatus }) {
  const cls = {
    pending: 'bg-amber-100 text-amber-800',
    confirmed: 'bg-green-100 text-green-800',
    rejected: 'bg-rose-100 text-rose-800',
    cancelled: 'bg-gray-200 text-gray-700',
  }[status]
  return (
    <span
      className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ${cls}`}
    >
      {APPOINTMENT_STATUS_LABEL[status]}
    </span>
  )
}
