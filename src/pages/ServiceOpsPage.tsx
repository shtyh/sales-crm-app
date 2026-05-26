import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { AppShell } from '../components/AppShell'
import { useAuth } from '../lib/auth'
import { useProfiles, useServiceOrders } from '../lib/queries'
import { formatError } from '../lib/errors'
import { formatMYR } from '../lib/format'
import {
  SERVICE_ORDER_STATUS_LABEL,
  type Profile,
  type ServiceOrderStatus,
  type ServiceOrderWithJoins,
} from '../lib/types'

/**
 * Job Sheet / Billing — the workshop's day-to-day order table. Modelled
 * on the legacy WMS screen the team is used to: one row per service
 * order, all the columns finance + advisors used to scan at a glance,
 * a strip of action buttons across the bottom.
 *
 * Columns that depend on data we don't yet store (Inv Date, Estimated
 * Bill, Bill No, e-Inv Status) render with "—" placeholders so the
 * shape matches the old screen. They'll fill in once invoicing /
 * quoting land on service_orders.
 */

const OPEN_STATUSES: ServiceOrderStatus[] = [
  'open',
  'in_progress',
  'awaiting_parts',
]

// Map the rich enum to the OPEN/CLOSED bucket the legacy screen used —
// front-line advisors think in those two buckets, not 6 states.
function bucketOf(status: ServiceOrderStatus): 'OPEN' | 'CLOSED' | 'VOID' {
  if (status === 'cancelled') return 'VOID'
  return OPEN_STATUSES.includes(status) ? 'OPEN' : 'CLOSED'
}

type Filter = 'all' | 'open' | 'closed' | 'void'

export function ServiceOpsPage() {
  const { isSuperAdmin } = useAuth()
  const { data: orders, error: ordersErr } = useServiceOrders()
  const { data: profiles } = useProfiles()
  const [filter, setFilter] = useState<Filter>('all')
  const [q, setQ] = useState('')

  const profileById = useMemo(() => {
    const m = new Map<string, Profile>()
    profiles?.forEach((p) => m.set(p.id, p))
    return m
  }, [profiles])

  const rows = useMemo(() => {
    let list: ServiceOrderWithJoins[] = orders ?? []
    if (filter !== 'all') {
      list = list.filter((o) => {
        const b = bucketOf(o.status)
        return (
          (filter === 'open' && b === 'OPEN') ||
          (filter === 'closed' && b === 'CLOSED') ||
          (filter === 'void' && b === 'VOID')
        )
      })
    }
    const needle = q.trim().toLowerCase()
    if (needle) {
      list = list.filter((o) => {
        return (
          (o.order_no ?? '').toLowerCase().includes(needle) ||
          (o.vehicle?.registration_no ?? '').toLowerCase().includes(needle) ||
          (o.vehicle?.chassis_no ?? '').toLowerCase().includes(needle) ||
          (o.customer?.name ?? '').toLowerCase().includes(needle)
        )
      })
    }
    return list
  }, [orders, filter, q])

  const totals = useMemo(() => {
    let open = 0
    let closed = 0
    let voided = 0
    let billed = 0
    let outstanding = 0
    for (const o of orders ?? []) {
      const b = bucketOf(o.status)
      if (b === 'OPEN') open++
      else if (b === 'CLOSED') closed++
      else voided++
      const amt = Number(o.total_amount ?? 0)
      billed += amt
      // No service-side payment ledger yet — treat collected as fully
      // paid, anything else as still owed.
      if (o.status !== 'collected' && o.status !== 'cancelled') {
        outstanding += amt
      }
    }
    return { open, closed, voided, billed, outstanding }
  }, [orders])

  const today = new Date()
  const error = ordersErr ? formatError(ordersErr) : null

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
                Job Sheet / Billing Section
              </h1>
            </div>
            <div className="text-xs text-slate-100">
              <div>
                <span className="text-slate-300">Today:</span>{' '}
                {today.toLocaleDateString('en-MY')}
              </div>
              <div>
                <span className="text-slate-300">Transaction:</span>{' '}
                {today.toLocaleDateString('en-MY')}
              </div>
            </div>
          </div>
        </div>
      </div>

      {error && (
        <div
          role="alert"
          className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
        >
          {error}
        </div>
      )}

      {/* ---------- Headline counters ---------- */}
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-5">
        <Counter label="Open" value={totals.open} tone="amber" />
        <Counter label="Closed" value={totals.closed} tone="green" />
        {isSuperAdmin && (
          <Counter label="Voided" value={totals.voided} tone="gray" />
        )}
        <Counter
          label="Billed (RM)"
          value={formatMYR(totals.billed)}
          tone="neutral"
        />
        <Counter
          label="Outstanding (RM)"
          value={formatMYR(totals.outstanding)}
          tone={totals.outstanding > 0 ? 'red' : 'neutral'}
        />
      </div>

      {/* ---------- Filter + search ---------- */}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          <Chip active={filter === 'all'} onClick={() => setFilter('all')}>
            All
          </Chip>
          <Chip active={filter === 'open'} onClick={() => setFilter('open')}>
            Open
          </Chip>
          <Chip
            active={filter === 'closed'}
            onClick={() => setFilter('closed')}
          >
            Closed
          </Chip>
          {isSuperAdmin && (
            <Chip
              active={filter === 'void'}
              onClick={() => setFilter('void')}
            >
              Void
            </Chip>
          )}
        </div>
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search job no, reg, chassis, customer…"
          className="w-full max-w-xs rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm outline-none focus:border-gray-900 focus:ring-2 focus:ring-gray-900/10"
        />
      </div>

      {/* ---------- Table ---------- */}
      <div className="overflow-x-auto rounded-2xl border border-gray-200 bg-white">
        <table className="min-w-full divide-y divide-gray-200 text-xs">
          <thead className="bg-gray-50 uppercase tracking-wider text-gray-500">
            <tr>
              <Th>Job No</Th>
              <Th>Car / Account</Th>
              <Th>Chassis No</Th>
              <Th>Job Date</Th>
              <Th>Inv Date</Th>
              <Th>Status</Th>
              <Th alignRight>Amt Billed</Th>
              <Th alignRight>Estimated</Th>
              <Th>Paid</Th>
              <Th alignRight>O/S Amount</Th>
              <Th>Bill No</Th>
              <Th>S.A</Th>
              <Th>Mech</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {!orders && !error && (
              <tr>
                <td
                  colSpan={13}
                  className="px-3 py-8 text-center text-sm text-gray-500"
                >
                  Loading…
                </td>
              </tr>
            )}
            {orders && rows.length === 0 && (
              <tr>
                <td
                  colSpan={13}
                  className="px-3 py-8 text-center text-sm text-gray-500"
                >
                  No job sheets match the current filter.
                </td>
              </tr>
            )}
            {rows.map((o) => {
              const sa = o.service_advisor_id
                ? profileById.get(o.service_advisor_id)
                : null
              const paid = o.status === 'collected'
              const amt = Number(o.total_amount ?? 0)
              const outstanding = paid ? 0 : amt
              return (
                <tr key={o.id} className="hover:bg-gray-50">
                  <td className="whitespace-nowrap px-3 py-2 font-mono">
                    <Link
                      to={`/service-orders/${o.id}`}
                      className="text-gray-900 hover:underline"
                    >
                      {o.order_no ?? '—'}
                    </Link>
                    <Link
                      to={`/service-orders/${o.id}/billing`}
                      title="Open billing screen"
                      className="ml-2 text-[10px] font-semibold uppercase text-blue-700 hover:underline"
                    >
                      Bill
                    </Link>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2">
                    <div className="font-mono text-gray-900">
                      {o.vehicle?.registration_no ?? '—'}
                    </div>
                    <div className="text-[10px] text-gray-500">
                      {o.customer?.name ?? '—'}
                    </div>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 font-mono text-gray-600">
                    {o.vehicle?.chassis_no ?? '—'}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-gray-700">
                    {fmtDate(o.opened_at)}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-gray-400">
                    —
                  </td>
                  <td className="whitespace-nowrap px-3 py-2">
                    <StatusPill bucket={bucketOf(o.status)} />
                    <div className="mt-0.5 text-[10px] text-gray-500">
                      {SERVICE_ORDER_STATUS_LABEL[o.status]}
                    </div>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-gray-900">
                    {amt > 0 ? formatMYR(amt) : '—'}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-gray-400">
                    —
                  </td>
                  <td className="whitespace-nowrap px-3 py-2">
                    <span
                      className={
                        paid
                          ? 'font-semibold text-green-700'
                          : 'font-semibold text-rose-700'
                      }
                    >
                      {paid ? 'Y' : 'N'}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">
                    {outstanding > 0 ? (
                      <span className="text-rose-700">
                        {formatMYR(outstanding)}
                      </span>
                    ) : (
                      <span className="text-gray-400">—</span>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 font-mono text-gray-400">
                    —
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-gray-700">
                    {sa?.full_name || sa?.email || '—'}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-gray-700">
                    {o.technician?.name ?? (
                      <span className="text-gray-400">Unassigned</span>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* ---------- Action bar ---------- */}
      <div className="mt-4 rounded-2xl border border-gray-200 bg-white p-4">
        <div className="mb-2 text-[10px] font-medium uppercase tracking-widest text-gray-500">
          Actions
        </div>
        <div className="flex flex-wrap gap-2">
          <ActionButton to="/service-orders/new" primary>
            + New Job Sheet
          </ActionButton>
          <ActionButton to="/vehicles">Vehicle info</ActionButton>
          <ActionButton disabled title="Click a job row to edit it">
            Edit Job Sheet
          </ActionButton>
          <ActionButton disabled>Billing details</ActionButton>
          <ActionButton disabled>Billing history</ActionButton>
          <ActionButton disabled>Create billing</ActionButton>
          <ActionButton disabled>Payment</ActionButton>
          <ActionButton disabled>Print Job Sheet</ActionButton>
          <ActionButton disabled>Print quotation</ActionButton>
          <ActionButton disabled>Submit e-Invoice</ActionButton>
          <ActionButton disabled>Credit note</ActionButton>
          <ActionButton disabled>Debit note</ActionButton>
          <ActionButton disabled>Warranty claim</ActionButton>
          {isSuperAdmin && (
            <ActionButton disabled danger>
              ★ Delete record
            </ActionButton>
          )}
        </div>
        <div className="mt-2 text-[10px] text-gray-500">
          Greyed buttons are placeholders — tell us which to wire first.
        </div>
      </div>
    </AppShell>
  )
}

// ---------- helpers ----------

function fmtDate(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleDateString('en-MY', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  })
}

function Counter({
  label,
  value,
  tone,
}: {
  label: string
  value: number | string
  tone: 'amber' | 'green' | 'gray' | 'red' | 'neutral'
}) {
  const t = {
    amber: 'text-amber-700',
    green: 'text-green-700',
    gray: 'text-gray-700',
    red: 'text-red-700',
    neutral: 'text-gray-900',
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
      className={`px-3 py-2 font-medium ${alignRight ? 'text-right' : 'text-left'}`}
    >
      {children}
    </th>
  )
}

function StatusPill({ bucket }: { bucket: 'OPEN' | 'CLOSED' | 'VOID' }) {
  const cls =
    bucket === 'OPEN'
      ? 'bg-amber-100 text-amber-800'
      : bucket === 'CLOSED'
        ? 'bg-green-100 text-green-800'
        : 'bg-gray-200 text-gray-700'
  return (
    <span
      className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ${cls}`}
    >
      {bucket}
    </span>
  )
}

function ActionButton({
  to,
  disabled,
  primary,
  danger,
  title,
  children,
}: {
  to?: string
  disabled?: boolean
  primary?: boolean
  danger?: boolean
  title?: string
  children: React.ReactNode
}) {
  const base =
    'rounded-md px-3 py-1.5 text-xs font-medium transition disabled:cursor-not-allowed'
  const tone = primary
    ? 'bg-gray-900 text-white hover:bg-gray-800'
    : danger
      ? 'border border-red-300 bg-white text-red-700 hover:bg-red-50'
      : 'border border-gray-300 bg-white text-gray-700 hover:bg-gray-50'
  const dim = disabled ? ' opacity-50' : ''
  if (to && !disabled) {
    return (
      <Link to={to} className={`${base} ${tone}${dim}`} title={title}>
        {children}
      </Link>
    )
  }
  return (
    <button
      type="button"
      disabled={disabled}
      title={title ?? 'Not yet wired up'}
      className={`${base} ${tone}${dim}`}
    >
      {children}
    </button>
  )
}
