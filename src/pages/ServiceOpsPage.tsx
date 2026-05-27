import { useEffect, useMemo, useState } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { AppShell } from '../components/AppShell'
import { useAuth } from '../lib/auth'
import {
  useProfiles,
  useServiceOrders,
  useUpdateServiceOrder,
} from '../lib/queries'
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
  const [paymentOpen, setPaymentOpen] = useState(false)
  const [printOpen, setPrintOpen] = useState(false)
  const [jobSheetOpen, setJobSheetOpen] = useState(false)

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
          <ActionButton
            disabled={!selectedOrder}
            onClick={() => setJobSheetOpen(true)}
            title={
              selectedOrder
                ? 'Open the Job Sheet print selector (Stock Requisition / Repair Order)'
                : 'Select a job row first'
            }
          >
            Print Job Sheet
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
          <ActionButton
            disabled={!selectedOrder}
            onClick={() => setPaymentOpen(true)}
            title={
              selectedOrder
                ? 'Record a direct payment against the selected job'
                : 'Select a job row first'
            }
          >
            Payment
          </ActionButton>
          <ActionButton
            disabled={!selectedOrder}
            onClick={() => setPrintOpen(true)}
            title={
              selectedOrder
                ? 'Open the Print Billing dialog for the selected job'
                : 'Select a job row first'
            }
          >
            Print
          </ActionButton>
          <ActionButton
            disabled={!selectedOrder}
            to={
              selectedOrder
                ? `/service-orders/${selectedOrder.id}/quotation`
                : undefined
            }
            title={
              selectedOrder
                ? 'Open the printable quotation for the selected job'
                : 'Select a job row first'
            }
          >
            Print quotation
          </ActionButton>
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

      {paymentOpen && selectedOrder && (
        <DirectPaymentDialog
          order={selectedOrder}
          onClose={() => setPaymentOpen(false)}
        />
      )}

      {printOpen && selectedOrder && (
        <PrintBillingDialog
          order={selectedOrder}
          onClose={() => setPrintOpen(false)}
        />
      )}

      {jobSheetOpen && selectedOrder && (
        <JobSheetSelectionDialog
          order={selectedOrder}
          onClose={() => setJobSheetOpen(false)}
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
      className={`whitespace-nowrap px-3 py-2 font-medium ${alignRight ? 'text-right' : 'text-left'}`}
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

// ---------- Direct Payment dialog (port of legacy WMS popup) ----------

type PaymentType = 'cash' | 'card' | 'ewallet' | 'transfer'

const PAYMENT_TYPE_LABEL: Record<PaymentType, string> = {
  cash: 'Cash',
  card: 'Credit Card / Debit Card',
  ewallet: 'eWallet',
  transfer: 'Bank Transfer',
}

/**
 * 1:1 port of the legacy WMS "Direct Payment Section" popup. Opens from
 * the action bar against the selected job. Pre-fills Account No from
 * the vehicle / customer, Bill No from order_no, Billing Amount from
 * service_orders.total_amount. There's no service-side payments ledger
 * yet, so Total Payment is 0 and Outstanding == Billing. Clicking OK
 * with `This Payment >= Outstanding` flips the order's status to
 * `collected` (the workshop's equivalent of "fully paid"); partial
 * payments aren't tracked yet and show an inline notice.
 */
function DirectPaymentDialog({
  order,
  onClose,
}: {
  order: ServiceOrderWithJoins
  onClose: () => void
}) {
  const updateMut = useUpdateServiceOrder()

  const billing = Number(order.total_amount ?? 0)
  const totalPaid = order.status === 'collected' ? billing : 0
  const outstanding = Math.max(0, billing - totalPaid)

  const today = new Date().toISOString().slice(0, 10)

  const accountNo =
    order.vehicle?.account_no || order.customer?.name || 'CASH'
  const billNo = order.order_no ?? ''

  const [collectionDate, setCollectionDate] = useState(today)
  const [paymentType, setPaymentType] = useState<PaymentType>('cash')
  const [thisPaymentStr, setThisPaymentStr] = useState('0.00')

  const thisPayment = Number(thisPaymentStr) || 0
  const remaining = Math.max(0, outstanding - thisPayment)

  const alreadyCollected = order.status === 'collected'
  const fullSettle = !alreadyCollected && thisPayment >= outstanding &&
    outstanding > 0
  const partialUnsupported = !alreadyCollected && thisPayment > 0 &&
    thisPayment < outstanding

  async function handleOk() {
    if (alreadyCollected) {
      onClose()
      return
    }
    if (fullSettle) {
      try {
        await updateMut.mutateAsync({
          id: order.id,
          patch: {
            status: 'collected',
          },
        })
        onClose()
      } catch (err) {
        alert(formatError(err))
      }
    }
    // Partial payment: do nothing — message is shown inline.
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Direct Payment Section"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[95vh] w-full max-w-3xl flex-col overflow-hidden rounded-lg border border-gray-300 bg-white shadow-xl"
      >
        {/* Title bar */}
        <div className="flex items-center justify-between border-b border-gray-200 bg-gray-100 px-3 py-1.5">
          <div className="text-sm font-semibold text-gray-800">
            Direct Payment Section
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

        <div className="flex-1 overflow-auto px-4 py-3">
          {/* Section header */}
          <div className="mb-3 text-sm font-semibold text-gray-800">
            Direct Payment
          </div>

          {/* Account / Bill No */}
          <div className="mb-3 grid grid-cols-[110px_1fr] gap-x-3 gap-y-2 text-xs">
            <Label>Account No</Label>
            <ReadOnlyField value={accountNo} />
            <Label>Bill No</Label>
            <ReadOnlyField value={billNo} />
          </div>

          <Fieldset legend="Payment Details">
            <div className="grid gap-3 md:grid-cols-2">
              {/* Left column — read-only "Previous Payment Information" */}
              <div className="rounded-md border border-gray-200 px-3 py-2">
                <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-gray-500">
                  Previous Payment Information
                </div>
                <Row label="Billing Amount">
                  <ReadOnlyNum value={billing} />
                </Row>
                <Row label="Total Payment">
                  <ReadOnlyNum value={totalPaid} />
                </Row>
                <Row label="Outstanding Amount">
                  <ReadOnlyNum
                    value={outstanding}
                    className={
                      outstanding > 0 ? 'text-rose-700' : 'text-gray-700'
                    }
                  />
                </Row>
              </div>

              {/* Right column — editable entry */}
              <div className="rounded-md border border-gray-200 px-3 py-2">
                <Row label="Collection Date">
                  <input
                    type="date"
                    value={collectionDate}
                    onChange={(e) => setCollectionDate(e.target.value)}
                    className={inputCls}
                  />
                </Row>
                <Row label="Payment Type">
                  <select
                    value={paymentType}
                    onChange={(e) =>
                      setPaymentType(e.target.value as PaymentType)
                    }
                    className={inputCls}
                  >
                    {(Object.keys(PAYMENT_TYPE_LABEL) as PaymentType[]).map(
                      (t) => (
                        <option key={t} value={t}>
                          {PAYMENT_TYPE_LABEL[t]}
                        </option>
                      ),
                    )}
                  </select>
                </Row>
                <Row label="This Payment">
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={thisPaymentStr}
                    onChange={(e) => setThisPaymentStr(e.target.value)}
                    className={`${inputCls} text-right tabular-nums`}
                  />
                </Row>
                <Row label={<span className="text-rose-700">Outstanding Remaining</span>}>
                  <ReadOnlyNum
                    value={remaining}
                    className={
                      remaining > 0 ? 'text-rose-700' : 'text-green-700'
                    }
                  />
                </Row>
              </div>
            </div>
          </Fieldset>

          {/* Notices */}
          {alreadyCollected && (
            <div className="mt-3 rounded-md border border-green-200 bg-green-50 px-3 py-2 text-xs text-green-800">
              This job is already marked collected — no outstanding amount.
            </div>
          )}
          {partialUnsupported && (
            <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
              Partial payments aren't tracked yet (no service-side payments
              ledger). Enter the full outstanding amount to settle this job,
              or close and wait for the partial-payment flow.
            </div>
          )}
          {updateMut.isError && (
            <div className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
              {formatError(updateMut.error)}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 border-t border-gray-200 bg-gray-50 px-4 py-3">
          <button
            type="button"
            onClick={handleOk}
            disabled={updateMut.isPending || (!fullSettle && !alreadyCollected)}
            title={
              alreadyCollected
                ? 'Already collected — closes the dialog'
                : fullSettle
                  ? 'Settle this job and mark it collected'
                  : 'Enter at least the outstanding amount to enable OK'
            }
            className="rounded-md bg-gray-900 px-4 py-1.5 text-xs font-medium text-white hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {updateMut.isPending ? 'Saving…' : 'OK'}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-gray-300 bg-white px-4 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  )
}

// ---------- shared form helpers for the payment dialog ----------

const inputCls =
  'w-full rounded-md border border-gray-300 bg-white px-2 py-1 text-xs outline-none focus:border-gray-900 focus:ring-2 focus:ring-gray-900/10 disabled:bg-gray-100 disabled:text-gray-400'

function Label({ children }: { children: React.ReactNode }) {
  return (
    <label className="self-center text-xs font-medium text-gray-700">
      {children}
    </label>
  )
}

function ReadOnlyField({ value }: { value: string }) {
  return (
    <input
      readOnly
      value={value}
      className="w-full rounded-md border border-gray-300 bg-gray-50 px-2 py-1 text-xs text-gray-700"
    />
  )
}

function ReadOnlyNum({
  value,
  className = '',
}: {
  value: number
  className?: string
}) {
  return (
    <input
      readOnly
      value={value.toFixed(2)}
      className={`w-full rounded-md border border-gray-300 bg-gray-50 px-2 py-1 text-right text-xs tabular-nums text-gray-700 ${className}`}
    />
  )
}

function Row({
  label,
  children,
}: {
  label: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div className="mb-1.5 grid grid-cols-[120px_1fr] items-center gap-2">
      <label className="text-xs font-medium text-gray-700">{label}</label>
      <div>{children}</div>
    </div>
  )
}

function Fieldset({
  legend,
  dim,
  children,
}: {
  legend: string
  dim?: boolean
  children: React.ReactNode
}) {
  return (
    <fieldset
      className={`rounded-lg border border-gray-200 px-3 pb-3 pt-1 ${dim ? 'opacity-60' : ''}`}
    >
      <legend className="px-1 text-xs font-semibold text-gray-700">
        {legend}
      </legend>
      {children}
    </fieldset>
  )
}

// ---------- Print Billing dialog (port of legacy WMS popup) ----------

type BillingTypeOption = {
  value: string
  label: string
}

const BILLING_TYPES: BillingTypeOption[] = [
  { value: 'cash', label: 'Cash' },
  { value: 'invoice', label: 'Invoice' },
  { value: 'cash-distribution', label: 'Cash-Distribution' },
  { value: 'invoice-distribution', label: 'Invoice-Distribution' },
  { value: 'delivery-order', label: 'Delivery Order' },
  { value: 'service-coupon', label: 'Service Coupon Bill/Closed Bill' },
]

/**
 * 1:1 port of the legacy WMS "Print Billing" dialog. Opens from the
 * Print action button with a job selected. Fields mirror the legacy
 * exactly (Billing Number, Billing Type, Standard/Pre-printed format,
 * Quotation No / Delivery Order No / Days Completed / Time Completed /
 * Remark, plus the Next Service block). The actual print output lives
 * at `/service-orders/:id/bill?type=...` — clicking Print or Preview
 * opens it in a new tab, which auto-fires window.print() on load.
 */
function PrintBillingDialog({
  order,
  onClose,
}: {
  order: ServiceOrderWithJoins
  onClose: () => void
}) {
  const billNo = order.order_no ?? ''
  const [billingType, setBillingType] = useState<string>('cash-distribution')
  const [format, setFormat] = useState<'standard' | 'pre-printed'>('standard')
  const [quotationNo, setQuotationNo] = useState('')
  const [deliveryOrderNo, setDeliveryOrderNo] = useState('')
  const [daysCompleted, setDaysCompleted] = useState('0')
  const [timeCompleted, setTimeCompleted] = useState(
    new Date().toLocaleTimeString('en-MY', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }),
  )
  const [remark, setRemark] = useState('')
  const [serviceDay, setServiceDay] = useState('90')
  const [serviceKm, setServiceKm] = useState('5000')
  const [nextServiceDate, setNextServiceDate] = useState(() => {
    const d = new Date()
    d.setDate(d.getDate() + 90)
    return d.toISOString().slice(0, 10)
  })
  const [nextServiceKm, setNextServiceKm] = useState(() => {
    const m = Number(order.mileage_in ?? 0)
    return String(m > 0 ? m + 5000 : 5000)
  })

  function buildUrl(): string {
    const params = new URLSearchParams()
    params.set('type', billingType)
    if (format) params.set('format', format)
    if (remark.trim()) params.set('remark', remark.trim())
    if (daysCompleted) params.set('days', daysCompleted)
    if (timeCompleted) params.set('time', timeCompleted)
    if (nextServiceDate) params.set('nextDate', nextServiceDate)
    if (nextServiceKm) params.set('nextKm', nextServiceKm)
    return `/service-orders/${order.id}/bill?${params.toString()}`
  }

  function openInNewTab() {
    window.open(buildUrl(), '_blank', 'noopener,noreferrer')
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Print Billing"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[95vh] w-full max-w-2xl flex-col overflow-hidden rounded-lg border border-gray-300 bg-white shadow-xl"
      >
        {/* Title bar */}
        <div className="flex items-center justify-between border-b border-gray-200 bg-gray-100 px-3 py-1.5">
          <div className="text-sm font-semibold text-gray-800">
            Print Billing
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

        <div className="flex-1 overflow-auto px-4 py-3">
          {/* Top strip — Present Bill + Billing Number + format */}
          <div className="mb-3 grid grid-cols-[140px_1fr_auto] items-center gap-x-3 gap-y-2 text-xs">
            <label className="text-gray-700">Present Bill number :</label>
            <input
              readOnly
              value={billNo}
              className="rounded-md border border-gray-300 bg-gray-50 px-2 py-1 font-mono text-xs"
            />
            <div className="row-span-2 flex flex-col gap-1 pl-3 text-xs">
              <label className="inline-flex items-center gap-1.5">
                <input
                  type="radio"
                  name="bill-format"
                  checked={format === 'standard'}
                  onChange={() => setFormat('standard')}
                />
                Standard Format
              </label>
              <label className="inline-flex items-center gap-1.5">
                <input
                  type="radio"
                  name="bill-format"
                  checked={format === 'pre-printed'}
                  onChange={() => setFormat('pre-printed')}
                />
                Pre-printed Format
              </label>
            </div>
            <label className="text-gray-700">Billing Number :</label>
            <input
              readOnly
              value={billNo}
              className="rounded-md border border-amber-300 bg-amber-50 px-2 py-1 font-mono text-xs"
            />
            <label className="text-gray-700">Billing Type :</label>
            <select
              value={billingType}
              onChange={(e) => setBillingType(e.target.value)}
              className={dialogInputCls}
            >
              {BILLING_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>

          {/* Printing Bill block */}
          <fieldset className="rounded-lg border border-gray-200 px-3 pb-3 pt-1">
            <legend className="px-1 text-xs font-semibold text-gray-700">
              Printing Bill
            </legend>
            <PrintRow label="Quotation Number">
              <input
                value={quotationNo}
                onChange={(e) => setQuotationNo(e.target.value)}
                className={`${dialogInputCls} font-mono`}
                placeholder="QN…"
              />
            </PrintRow>
            <PrintRow label="Delivery Order Number">
              <input
                value={deliveryOrderNo}
                onChange={(e) => setDeliveryOrderNo(e.target.value)}
                className={`${dialogInputCls} font-mono`}
              />
            </PrintRow>
            <PrintRow label="Days Completed">
              <input
                type="number"
                min={0}
                value={daysCompleted}
                onChange={(e) => setDaysCompleted(e.target.value)}
                className={`${dialogInputCls} text-right tabular-nums`}
              />
            </PrintRow>
            <PrintRow label="Time Completed">
              <input
                value={timeCompleted}
                onChange={(e) => setTimeCompleted(e.target.value)}
                className={`${dialogInputCls} tabular-nums`}
                placeholder="HH:MM"
              />
            </PrintRow>
            <PrintRow label="Remark">
              <input
                value={remark}
                onChange={(e) => setRemark(e.target.value)}
                className={dialogInputCls}
              />
            </PrintRow>
          </fieldset>

          {/* Next Service Remark block */}
          <fieldset className="mt-3 rounded-lg border border-gray-200 px-3 pb-3 pt-1">
            <legend className="px-1 text-xs font-semibold text-gray-700">
              Next Service Remark
            </legend>
            <div className="grid grid-cols-2 gap-x-4">
              <div>
                <div className="mb-1 text-[11px] font-medium text-gray-700">
                  How Many Service Day and KM
                </div>
                <PrintRow label="Service Day">
                  <input
                    type="number"
                    min={0}
                    value={serviceDay}
                    onChange={(e) => setServiceDay(e.target.value)}
                    className={`${dialogInputCls} text-right tabular-nums`}
                  />
                </PrintRow>
                <PrintRow label="Service KM">
                  <input
                    type="number"
                    min={0}
                    value={serviceKm}
                    onChange={(e) => setServiceKm(e.target.value)}
                    className={`${dialogInputCls} text-right tabular-nums`}
                  />
                </PrintRow>
              </div>
              <div>
                <div className="mb-1 text-[11px] font-medium text-gray-700">
                  Next Service Date and Mileage
                </div>
                <PrintRow label="Next Service Date">
                  <input
                    type="date"
                    value={nextServiceDate}
                    onChange={(e) => setNextServiceDate(e.target.value)}
                    className={dialogInputCls}
                  />
                </PrintRow>
                <PrintRow label="Next Service KM">
                  <input
                    type="number"
                    min={0}
                    value={nextServiceKm}
                    onChange={(e) => setNextServiceKm(e.target.value)}
                    className={`${dialogInputCls} text-right tabular-nums`}
                  />
                </PrintRow>
              </div>
            </div>
          </fieldset>

          <div className="mt-3 rounded-md border border-blue-100 bg-blue-50 px-3 py-2 text-[11px] text-blue-900">
            Print opens the bill in a new tab and auto-launches your
            browser's print dialog — choose "Save as PDF" or send to the
            printer there.
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-2 border-t border-gray-200 bg-gray-50 px-4 py-3">
          <div className="text-[10px] text-gray-500">
            Pre-printed format support coming soon — Standard is wired today.
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={openInNewTab}
              className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
            >
              Preview
            </button>
            <button
              type="button"
              onClick={() => {
                openInNewTab()
                onClose()
              }}
              className="rounded-md bg-gray-900 px-4 py-1.5 text-xs font-medium text-white hover:bg-gray-800"
            >
              Print
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

const dialogInputCls =
  'w-full rounded-md border border-gray-300 bg-white px-2 py-1 text-xs outline-none focus:border-gray-900 focus:ring-2 focus:ring-gray-900/10'

function PrintRow({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="mb-1.5 grid grid-cols-[140px_1fr] items-center gap-2">
      <label className="text-xs font-medium text-gray-700">{label}</label>
      <div>{children}</div>
    </div>
  )
}

// ---------- Job Sheet Selection dialog ----------

/**
 * 1:1 port of the legacy WMS "Job Sheet Selection" popup. Two big
 * tiles — Stock Requisition (Material Requisition Form, jobsheetstd
 * template) and Job Sheet or Repair Order (jobsheet template) — open
 * the matching print page in a new tab so the browser's print dialog
 * fires immediately.
 */
function JobSheetSelectionDialog({
  order,
  onClose,
}: {
  order: ServiceOrderWithJoins
  onClose: () => void
}) {
  function openInNewTab(path: string) {
    window.open(path, '_blank', 'noopener,noreferrer')
    onClose()
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Job Sheet Selection"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md overflow-hidden rounded-lg border border-gray-300 bg-white shadow-xl"
      >
        <div className="flex items-center justify-between border-b border-gray-200 bg-gray-100 px-3 py-1.5">
          <div className="text-sm font-semibold text-gray-800">
            Job Sheet Selection
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

        <div className="px-4 py-3">
          <div className="mb-3 text-sm font-semibold text-gray-800">
            Please Select The Job Sheet Type
          </div>
          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() =>
                openInNewTab(
                  `/service-orders/${order.id}/stock-requisition`,
                )
              }
              className="flex h-28 flex-col items-center justify-center gap-2 rounded-md border-2 border-gray-300 bg-white px-3 py-2 text-sm font-semibold text-gray-800 hover:border-gray-900 hover:bg-gray-50"
            >
              <span className="text-2xl">📦</span>
              Stock Requisition
              <span className="text-[10px] font-normal text-gray-500">
                Material Requisition Form
              </span>
            </button>
            <button
              type="button"
              onClick={() =>
                openInNewTab(`/service-orders/${order.id}/repair-order`)
              }
              className="flex h-28 flex-col items-center justify-center gap-2 rounded-md border-2 border-gray-300 bg-white px-3 py-2 text-sm font-semibold text-gray-800 hover:border-gray-900 hover:bg-gray-50"
            >
              <span className="text-2xl">🔧</span>
              Job Sheet / Repair Order
              <span className="text-[10px] font-normal text-gray-500">
                Customer-signed RO
              </span>
            </button>
          </div>
          <div className="mt-3 text-[10px] text-gray-500">
            Each opens in a new tab and auto-launches your browser's print
            dialog. Use "Save as PDF" there for a digital copy.
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-gray-200 bg-gray-50 px-4 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
