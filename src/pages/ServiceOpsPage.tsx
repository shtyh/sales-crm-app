import { useEffect, useMemo, useState } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { AppShell } from '../components/AppShell'
import { useAuth } from '../lib/auth'
import { useProfiles, useServiceOrders } from '../lib/queries'
import { formatError } from '../lib/errors'
import { formatMYR } from '../lib/format'
import {
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
  const { isSuperAdmin, canAccessService } = useAuth()
  if (canAccessService === false) return <Navigate to="/" replace />
  const { data: orders, error: ordersErr } = useServiceOrders()
  const { data: profiles } = useProfiles()
  const [filter, setFilter] = useState<Filter>('all')
  const [q, setQ] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [historyOpen, setHistoryOpen] = useState(false)

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
  const selectedOrder =
    (selectedId && rows.find((o) => o.id === selectedId)) || null

  // Auto-select the first visible row whenever rows change and the
  // current selection drops out of view (or no row is selected yet).
  // Mirrors the legacy WMS, which always keeps a row highlighted so
  // row-scoped actions like "Billing history" stay reachable.
  useEffect(() => {
    if (rows.length === 0) {
      if (selectedId !== null) setSelectedId(null)
      return
    }
    if (!selectedId || !rows.some((o) => o.id === selectedId)) {
      setSelectedId(rows[0].id)
    }
  }, [rows, selectedId])

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
              const isSelected = o.id === selectedId
              return (
                <tr
                  key={o.id}
                  onClick={() => setSelectedId(o.id)}
                  className={`cursor-pointer ${
                    isSelected
                      ? 'bg-blue-50 ring-1 ring-inset ring-blue-300'
                      : 'hover:bg-gray-50'
                  }`}
                >
                  <td className="whitespace-nowrap px-3 py-2 font-mono">
                    <Link
                      to={`/service-orders/${o.id}`}
                      onClick={(e) => e.stopPropagation()}
                      className="text-gray-900 hover:underline"
                    >
                      {o.order_no ?? '—'}
                    </Link>
                    <Link
                      to={`/service-orders/${o.id}/billing`}
                      onClick={(e) => e.stopPropagation()}
                      title="Open billing screen"
                      className="ml-2 text-[10px] font-semibold uppercase text-blue-700 hover:underline"
                    >
                      Bill
                    </Link>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 font-mono text-gray-900">
                    {o.vehicle?.registration_no ?? '—'}
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
          <ActionButton
            disabled={!selectedOrder}
            onClick={() => setHistoryOpen(true)}
            title={
              selectedOrder
                ? 'View billing history for the selected job'
                : 'Select a job row first'
            }
          >
            Billing history
          </ActionButton>
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
          {selectedOrder ? (
            <>
              Acting on{' '}
              <span className="font-mono text-gray-700">
                {selectedOrder.order_no ?? '—'}
              </span>{' '}
              · click another row to switch. Greyed buttons are placeholders —
              tell us which to wire first.
            </>
          ) : (
            <>
              Greyed buttons are placeholders — tell us which to wire first.
            </>
          )}
        </div>
      </div>

      {historyOpen && selectedOrder && (
        <BillingHistoryDialog
          anchor={selectedOrder}
          allOrders={orders ?? []}
          onClose={() => setHistoryOpen(false)}
        />
      )}
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
  onClick,
  children,
}: {
  to?: string
  disabled?: boolean
  primary?: boolean
  danger?: boolean
  title?: string
  onClick?: () => void
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
      onClick={onClick}
      title={title ?? (onClick ? undefined : 'Not yet wired up')}
      className={`${base} ${tone}${dim}`}
    >
      {children}
    </button>
  )
}

// ---------- Billing History dialog (port of legacy WMS popup) ----------

/**
 * 1:1 port of the legacy "Billing History" dialog. Opens from the action
 * bar with a job row selected; shows every service order for the same
 * vehicle (registration_no) or chassis (chassis_no) — toggled by the
 * radio group at the bottom. Drill-in actions match the legacy buttons:
 * View JobSheet → /service-orders/:id, View Billing Item →
 * /service-orders/:id/billing, Remark → inline expand of notes /
 * diagnosis on the selected history row.
 */
function BillingHistoryDialog({
  anchor,
  allOrders,
  onClose,
}: {
  anchor: ServiceOrderWithJoins
  allOrders: ServiceOrderWithJoins[]
  onClose: () => void
}) {
  const navigate = useNavigate()
  const [mode, setMode] = useState<'vehicle' | 'chassis'>('vehicle')
  const [historyId, setHistoryId] = useState<string | null>(null)
  const [showRemark, setShowRemark] = useState(false)

  const reg = anchor.vehicle?.registration_no ?? null
  const chassis = anchor.vehicle?.chassis_no ?? null

  const history = useMemo(() => {
    return allOrders.filter((o) => {
      if (mode === 'vehicle') {
        return reg && o.vehicle?.registration_no === reg
      }
      return chassis && o.vehicle?.chassis_no === chassis
    })
  }, [allOrders, mode, reg, chassis])

  const selected = historyId
    ? history.find((o) => o.id === historyId) ?? null
    : null

  const remarkText = selected
    ? [selected.complaint, selected.diagnosis, selected.notes]
        .filter((s) => s && s.trim())
        .join('\n\n') || 'No remarks recorded for this job.'
    : ''

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Billing History"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[90vh] w-full max-w-5xl flex-col overflow-hidden rounded-lg border border-gray-300 bg-white shadow-xl"
      >
        {/* Title bar */}
        <div className="flex items-center justify-between border-b border-gray-200 bg-gray-100 px-3 py-1.5">
          <div className="text-sm font-semibold text-gray-800">
            Billing History
          </div>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="rounded px-2 text-gray-500 hover:bg-gray-200 hover:text-gray-700"
          >
            ✕
          </button>
        </div>

        {/* Section header */}
        <div className="border-b border-gray-200 bg-white px-4 py-2 text-sm font-semibold text-gray-800">
          Billing History :
        </div>

        {/* Results table */}
        <div className="flex-1 overflow-auto">
          <table className="min-w-full divide-y divide-gray-200 text-xs">
            <thead className="bg-gray-50 uppercase tracking-wider text-gray-600">
              <tr>
                <Th>Job Date</Th>
                <Th>Job No</Th>
                <Th>Invoice Date</Th>
                <Th>Invoice No</Th>
                <Th>Account No</Th>
                <Th>Vehicle No</Th>
                <Th>Chassis Number</Th>
                <Th alignRight>Total</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {history.length === 0 && (
                <tr>
                  <td
                    colSpan={8}
                    className="px-3 py-12 text-center text-sm text-gray-500"
                  >
                    No billing history found for this{' '}
                    {mode === 'vehicle' ? 'vehicle number' : 'chassis number'}.
                  </td>
                </tr>
              )}
              {history.map((o) => {
                const isSel = o.id === historyId
                const amt = Number(o.total_amount ?? 0)
                return (
                  <tr
                    key={o.id}
                    onClick={() => {
                      setHistoryId(o.id)
                      setShowRemark(false)
                    }}
                    onDoubleClick={() => navigate(`/service-orders/${o.id}`)}
                    className={`cursor-pointer ${
                      isSel
                        ? 'bg-blue-100 ring-1 ring-inset ring-blue-300'
                        : 'hover:bg-gray-50'
                    }`}
                  >
                    <td className="whitespace-nowrap px-3 py-2 text-gray-700">
                      {fmtDate(o.opened_at)}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 font-mono text-gray-900">
                      {o.order_no ?? '—'}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-gray-400">
                      —
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 font-mono text-gray-400">
                      —
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 font-mono text-gray-700">
                      {o.vehicle?.account_no ?? '—'}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 font-mono text-gray-900">
                      {o.vehicle?.registration_no ?? '—'}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 font-mono text-gray-700">
                      {o.vehicle?.chassis_no ?? '—'}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-gray-900">
                      {amt > 0 ? formatMYR(amt) : '—'}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        {/* Remark popout */}
        {showRemark && selected && (
          <div className="border-t border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-900">
            <div className="mb-1 font-semibold">
              Remark — {selected.order_no ?? '—'}
            </div>
            <pre className="whitespace-pre-wrap font-sans">{remarkText}</pre>
          </div>
        )}

        {/* Footer: radio group + action buttons */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-gray-200 bg-gray-50 px-4 py-3">
          <div className="flex flex-col gap-1 text-xs text-gray-800">
            <label className="inline-flex items-center gap-2">
              <input
                type="radio"
                name="bh-mode"
                checked={mode === 'vehicle'}
                onChange={() => {
                  setMode('vehicle')
                  setHistoryId(null)
                  setShowRemark(false)
                }}
              />
              View History With Vehicle Number
            </label>
            <label className="inline-flex items-center gap-2">
              <input
                type="radio"
                name="bh-mode"
                checked={mode === 'chassis'}
                onChange={() => {
                  setMode('chassis')
                  setHistoryId(null)
                  setShowRemark(false)
                }}
              />
              View History With Chassis Number
            </label>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={!selected}
              onClick={() =>
                selected && navigate(`/service-orders/${selected.id}`)
              }
              className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              View JobSheet
            </button>
            <button
              type="button"
              disabled={!selected}
              onClick={() =>
                selected && navigate(`/service-orders/${selected.id}/billing`)
              }
              className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              View Billing Item
            </button>
            <button
              type="button"
              disabled={!selected}
              onClick={() => setShowRemark((s) => !s)}
              className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Remark
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-md bg-gray-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-gray-800"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
