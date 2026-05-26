import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { AppShell } from '../components/AppShell'
import { useAuth } from '../lib/auth'
import { useParts, useServiceOrders } from '../lib/queries'
import { formatError } from '../lib/errors'
import {
  SERVICE_ORDER_STATUS_LABEL,
  type ServiceOrderStatus,
  type ServiceOrderWithJoins,
} from '../lib/types'

// How many days an open job can sit before it's flagged as overdue. Cheap
// to tweak if the workshop wants a tighter or looser SLA.
const OVERDUE_DAYS = 3

/**
 * Workshop operations dashboard. The landing page for every workshop role
 * (service_manager / service_advisor / store_keeper / mechanic) and for
 * the super_admin when they're in Service workspace.
 *
 * Layout (mirrors AdminDashboardPage on the sales side):
 *   [ Open jobs ] [ Completed today ] [ Revenue today ] [ Voided* ]
 *   ─── Active job orders (table, color-coded by status / overdue) ───
 *   ─── Low-stock parts ───
 *   ─── Voided (cancelled) orders — super_admin only ───
 *
 * The fourth summary card and the cancelled-orders section are only
 * rendered for super_admin, matching "super admin sees everything
 * including voided transactions".
 */
export function ServiceOpsPage() {
  const { isSuperAdmin } = useAuth()
  const { data: orders, error: ordersErr } = useServiceOrders()
  const { data: parts, error: partsErr } = useParts()

  const stats = useMemo(() => computeStats(orders), [orders])
  const lowStock = useMemo(
    () =>
      (parts ?? [])
        .filter((p) => p.is_active && Number(p.stock_qty) <= Number(p.reorder_level))
        .sort((a, b) => {
          // Most-critical first: largest deficit, then alphabetical part_no
          const dA = Number(a.reorder_level) - Number(a.stock_qty)
          const dB = Number(b.reorder_level) - Number(b.stock_qty)
          return dB - dA || a.part_no.localeCompare(b.part_no)
        }),
    [parts],
  )

  const error = ordersErr
    ? formatError(ordersErr)
    : partsErr
      ? formatError(partsErr)
      : null

  return (
    <AppShell>
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-gray-900">
          Service Dashboard
        </h1>
        <p className="mt-1 text-sm text-gray-500">
          {new Date().toLocaleDateString('en-MY', {
            weekday: 'long',
            day: '2-digit',
            month: 'long',
            year: 'numeric',
          })}
        </p>
      </div>

      {error && (
        <div
          role="alert"
          className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
        >
          {error}
        </div>
      )}

      {/* ---------- Summary cards ----------
          Note: full class names spelled out (not interpolated) so Tailwind's
          JIT compiler can see them. */}
      <div
        className={
          isSuperAdmin
            ? 'mb-6 grid grid-cols-1 gap-3 sm:grid-cols-4'
            : 'mb-6 grid grid-cols-1 gap-3 sm:grid-cols-3'
        }
      >
        <StatCard
          label="Open jobs"
          value={stats.openCount}
          hint={
            stats.overdueCount > 0
              ? `${stats.overdueCount} overdue (> ${OVERDUE_DAYS} days)`
              : 'All within SLA'
          }
          tone={stats.overdueCount > 0 ? 'rose' : 'amber'}
        />
        <StatCard
          label="Completed today"
          value={stats.completedToday}
          hint="Marked done today"
          tone="blue"
        />
        <StatCard
          label="Revenue today"
          value={formatMyr(stats.revenueToday)}
          hint="Collected today"
          tone="green"
        />
        {isSuperAdmin && (
          <StatCard
            label="Voided today"
            value={stats.voidedToday}
            hint="Cancelled orders"
            tone="gray"
          />
        )}
      </div>

      {/* ---------- Active job orders ---------- */}
      <Section title="🛠 Active job orders" right={
        orders ? `${stats.activeOrders.length} active` : '—'
      }>
        {!orders && !error && (
          <p className="text-sm text-gray-500">Loading…</p>
        )}
        {orders && stats.activeOrders.length === 0 && (
          <p className="text-sm text-gray-500">
            No active jobs right now. New intake will appear here automatically.
          </p>
        )}
        {orders && stats.activeOrders.length > 0 && (
          <JobsTable orders={stats.activeOrders} />
        )}
      </Section>

      {/* ---------- Low stock ---------- */}
      <Section
        title="📦 Low-stock parts"
        right={parts ? `${lowStock.length} below reorder level` : '—'}
        className="mt-6"
      >
        {!parts && !partsErr && (
          <p className="text-sm text-gray-500">Loading…</p>
        )}
        {parts && lowStock.length === 0 && (
          <p className="text-sm text-gray-500">
            ✓ All active parts are above their reorder level.
          </p>
        )}
        {parts && lowStock.length > 0 && (
          <ul className="divide-y divide-gray-100">
            {lowStock.map((p) => {
              const deficit = Number(p.reorder_level) - Number(p.stock_qty)
              return (
                <li
                  key={p.id}
                  className="flex flex-wrap items-center justify-between gap-2 py-2.5 first:pt-0 last:pb-0"
                >
                  <div className="min-w-0">
                    <div className="font-mono text-xs text-gray-600">
                      {p.part_no}
                    </div>
                    <div className="text-sm text-gray-900">
                      {p.name}
                      {p.brand && (
                        <span className="ml-2 text-xs text-gray-500">
                          {p.brand}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="text-right text-sm">
                    <div className="tabular-nums text-rose-700">
                      {Number(p.stock_qty).toLocaleString()} {p.unit}
                    </div>
                    <div className="text-[11px] text-gray-500">
                      reorder @ {Number(p.reorder_level).toLocaleString()} ·
                      short {deficit.toLocaleString()}
                    </div>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </Section>

      {/* ---------- Voided (super_admin only) ---------- */}
      {isSuperAdmin && (
        <Section
          title="🗑 Voided transactions"
          right={
            orders ? `${stats.cancelledRecent.length} in last 7 days` : '—'
          }
          className="mt-6"
        >
          {!orders && (
            <p className="text-sm text-gray-500">Loading…</p>
          )}
          {orders && stats.cancelledRecent.length === 0 && (
            <p className="text-sm text-gray-500">
              No cancellations in the last 7 days.
            </p>
          )}
          {orders && stats.cancelledRecent.length > 0 && (
            <JobsTable orders={stats.cancelledRecent} />
          )}
        </Section>
      )}
    </AppShell>
  )
}

// ---------- Stats computation ---------------------------------------------

interface DashboardStats {
  openCount: number
  overdueCount: number
  completedToday: number
  revenueToday: number
  voidedToday: number
  activeOrders: ServiceOrderWithJoins[]
  cancelledRecent: ServiceOrderWithJoins[]
}

const OPEN_STATUSES: ServiceOrderStatus[] = [
  'open',
  'in_progress',
  'awaiting_parts',
]

function computeStats(
  orders: ServiceOrderWithJoins[] | undefined,
): DashboardStats {
  const empty: DashboardStats = {
    openCount: 0,
    overdueCount: 0,
    completedToday: 0,
    revenueToday: 0,
    voidedToday: 0,
    activeOrders: [],
    cancelledRecent: [],
  }
  if (!orders) return empty

  const today = startOfToday()
  const cutoffOverdue = new Date(today.getTime() - OVERDUE_DAYS * 86_400_000)
  const cutoffRecent = new Date(today.getTime() - 7 * 86_400_000)

  const active: ServiceOrderWithJoins[] = []
  const cancelled: ServiceOrderWithJoins[] = []
  let openCount = 0
  let overdueCount = 0
  let completedToday = 0
  let revenueToday = 0
  let voidedToday = 0

  for (const o of orders) {
    if (OPEN_STATUSES.includes(o.status)) {
      active.push(o)
      openCount += 1
      if (new Date(o.opened_at) < cutoffOverdue) overdueCount += 1
    }
    if (o.status === 'completed' && isSameDay(o.completed_at, today)) {
      completedToday += 1
    }
    if (o.status === 'collected' && isSameDay(o.collected_at, today)) {
      revenueToday += Number(o.total_amount) || 0
    }
    if (o.status === 'cancelled') {
      if (isSameDay(o.updated_at, today)) voidedToday += 1
      if (new Date(o.updated_at) >= cutoffRecent) cancelled.push(o)
    }
  }

  // Active table: overdue first, then by opened_at ascending (oldest first
  // so the SM sees what's been sitting longest).
  active.sort((a, b) => {
    const aOver = new Date(a.opened_at) < cutoffOverdue ? 0 : 1
    const bOver = new Date(b.opened_at) < cutoffOverdue ? 0 : 1
    if (aOver !== bOver) return aOver - bOver
    return new Date(a.opened_at).getTime() - new Date(b.opened_at).getTime()
  })

  cancelled.sort(
    (a, b) =>
      new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime(),
  )

  return {
    openCount,
    overdueCount,
    completedToday,
    revenueToday,
    voidedToday,
    activeOrders: active,
    cancelledRecent: cancelled,
  }
}

function startOfToday(): Date {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d
}

function isSameDay(iso: string | null, day: Date): boolean {
  if (!iso) return false
  const d = new Date(iso)
  return (
    d.getFullYear() === day.getFullYear() &&
    d.getMonth() === day.getMonth() &&
    d.getDate() === day.getDate()
  )
}

function formatMyr(n: number): string {
  return new Intl.NumberFormat('en-MY', {
    style: 'currency',
    currency: 'MYR',
    maximumFractionDigits: 0,
  }).format(n)
}

// ---------- Sub-components ------------------------------------------------

function StatCard({
  label,
  value,
  hint,
  tone,
}: {
  label: string
  value: number | string
  hint?: string
  tone: 'rose' | 'amber' | 'blue' | 'green' | 'gray'
}) {
  const colour = {
    rose: 'text-rose-700',
    amber: 'text-amber-700',
    blue: 'text-blue-700',
    green: 'text-green-700',
    gray: 'text-gray-700',
  }[tone]
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-4">
      <div className="text-[11px] font-medium text-gray-500">{label}</div>
      <div className={`mt-1 tabular-nums text-2xl font-semibold ${colour}`}>
        {value}
      </div>
      {hint && (
        <div className="mt-0.5 text-[10px] text-gray-400">{hint}</div>
      )}
    </div>
  )
}

function Section({
  title,
  right,
  children,
  className = '',
}: {
  title: string
  right?: string
  children: React.ReactNode
  className?: string
}) {
  return (
    <section
      className={`rounded-2xl border border-gray-200 bg-white p-5 ${className}`}
    >
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-gray-900">{title}</h2>
        {right && <span className="text-xs text-gray-500">{right}</span>}
      </div>
      {children}
    </section>
  )
}

const STATUS_PILL: Record<ServiceOrderStatus, string> = {
  open: 'bg-gray-100 text-gray-700',
  in_progress: 'bg-amber-100 text-amber-800',
  awaiting_parts: 'bg-orange-100 text-orange-800',
  completed: 'bg-blue-100 text-blue-800',
  collected: 'bg-green-100 text-green-800',
  cancelled: 'bg-rose-100 text-rose-700',
}

function JobsTable({ orders }: { orders: ServiceOrderWithJoins[] }) {
  const now = Date.now()
  const overdueMs = OVERDUE_DAYS * 86_400_000
  return (
    <div className="overflow-hidden rounded-lg border border-gray-100">
      <table className="min-w-full divide-y divide-gray-100 text-sm">
        <thead className="bg-gray-50 text-xs uppercase tracking-wider text-gray-500">
          <tr>
            <th className="px-3 py-2 text-left font-medium">Order</th>
            <th className="px-3 py-2 text-left font-medium">Vehicle</th>
            <th className="px-3 py-2 text-left font-medium">Customer</th>
            <th className="px-3 py-2 text-left font-medium">Mechanic</th>
            <th className="px-3 py-2 text-left font-medium">Opened</th>
            <th className="px-3 py-2 text-left font-medium">Status</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {orders.map((o) => {
            const ageMs = now - new Date(o.opened_at).getTime()
            const isOverdue =
              OPEN_STATUSES.includes(o.status) && ageMs > overdueMs
            return (
              <tr
                key={o.id}
                className={
                  isOverdue
                    ? 'bg-rose-50/60 border-l-4 border-l-rose-400'
                    : 'hover:bg-gray-50'
                }
                title={isOverdue ? 'Overdue — open more than 3 days' : undefined}
              >
                <td className="whitespace-nowrap px-3 py-2 font-mono text-xs text-gray-700">
                  {o.order_no ?? '—'}
                </td>
                <td className="px-3 py-2">
                  <div className="font-mono text-xs text-gray-700">
                    {o.vehicle?.registration_no ?? '—'}
                  </div>
                  <div className="text-xs text-gray-500">
                    {o.vehicle?.model}
                    {o.vehicle?.variant ? ` · ${o.vehicle.variant}` : ''}
                  </div>
                </td>
                <td className="px-3 py-2 text-gray-900">
                  {o.customer?.name ?? '—'}
                </td>
                <td className="px-3 py-2 text-gray-700">
                  {o.technician?.name ?? <span className="text-gray-400">Unassigned</span>}
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-gray-600">
                  {relativeDays(o.opened_at)}
                </td>
                <td className="px-3 py-2">
                  <span
                    className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_PILL[o.status]}`}
                  >
                    {SERVICE_ORDER_STATUS_LABEL[o.status]}
                  </span>
                  {isOverdue && (
                    <span className="ml-2 inline-flex rounded-full bg-rose-200/70 px-2 py-0.5 text-[10px] font-semibold uppercase text-rose-900">
                      Overdue
                    </span>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
      <div className="border-t border-gray-100 bg-gray-50 px-3 py-2 text-right text-[11px] text-gray-500">
        <Link to="/vehicles" className="underline-offset-2 hover:underline">
          Go to vehicles →
        </Link>
      </div>
    </div>
  )
}

function relativeDays(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime()
  const days = Math.floor(ms / 86_400_000)
  if (days === 0) return 'Today'
  if (days === 1) return '1 day ago'
  return `${days} days ago`
}
