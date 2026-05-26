import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { AppShell } from '../components/AppShell'
import { useAuth } from '../lib/auth'
import { useServiceOrders } from '../lib/queries'
import { formatError } from '../lib/errors'
import {
  QUOTE_STATUS_LABEL,
  SERVICE_ORDER_STATUS_LABEL,
  type ServiceOrderStatus,
  type ServiceOrderWithJoins,
} from '../lib/types'

/**
 * Service Advisor home page. RLS already filters service_orders to
 * "your own only" when the caller is a service_advisor, so this page can
 * just call useServiceOrders() and trust the result.
 *
 * Layout mirrors the Sales-side DashboardPage:
 *   [ Today's appts ] [ My jobs ] [ Quotes waiting ] [ Pending payment ]
 *   ─── Status buckets (waiting / in progress / completed / collected) ───
 *
 * NO low-stock alert, NO revenue/voided cards, NO staff performance —
 * per the spec, an SA stays scoped to their own queue.
 */
export function ServiceAdvisorDashboardPage() {
  const { profile } = useAuth()
  const { data: orders, error } = useServiceOrders()

  const stats = useMemo(() => bucket(orders), [orders])

  return (
    <AppShell>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">My job orders</h1>
          <p className="mt-1 text-sm text-gray-500">
            {profile?.full_name ? `Hi ${profile.full_name} · ` : ''}
            {new Date().toLocaleDateString('en-MY', {
              weekday: 'long',
              day: '2-digit',
              month: 'long',
            })}
          </p>
        </div>
        <Link
          to="/service-orders/new"
          className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-gray-800"
        >
          + New job order
        </Link>
      </div>

      {error && (
        <div
          role="alert"
          className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
        >
          {formatError(error)}
        </div>
      )}

      {/* ---------- Summary cards ---------- */}
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard
          label="Today's intake"
          value={stats.todayIntake}
          tone="blue"
          hint="Opened today"
        />
        <StatCard
          label="In my queue"
          value={stats.activeCount}
          tone="amber"
          hint="Not yet completed"
        />
        <StatCard
          label="Quotes waiting"
          value={stats.quotesWaiting}
          tone="orange"
          hint="Awaiting customer approval"
        />
        <StatCard
          label="Pending payment"
          value={stats.pendingPayment}
          tone="rose"
          hint="Completed, not collected"
        />
      </div>

      {/* ---------- Status buckets ----------
          Four columns matching the user-facing labels in the brief: waiting /
          in progress / completed / pending payment. We map each label to one
          or more underlying ServiceOrderStatus values. */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Bucket
          title="Waiting"
          hint="Open · awaiting parts"
          orders={stats.waiting}
          emptyText="Nothing waiting."
        />
        <Bucket
          title="In progress"
          hint="Currently being worked on"
          orders={stats.inProgress}
          emptyText="Nobody's wrenching right now."
        />
        <Bucket
          title="Completed"
          hint="Work done, ready for collection"
          orders={stats.completed}
          emptyText="No completed jobs."
        />
        <Bucket
          title="Recently collected"
          hint="Last 7 days"
          orders={stats.recentlyCollected}
          emptyText="No collections yet."
        />
      </div>
    </AppShell>
  )
}

// ---------- Stats / bucketing ---------------------------------------------

interface SaStats {
  todayIntake: number
  activeCount: number
  quotesWaiting: number
  pendingPayment: number
  waiting: ServiceOrderWithJoins[]
  inProgress: ServiceOrderWithJoins[]
  completed: ServiceOrderWithJoins[]
  recentlyCollected: ServiceOrderWithJoins[]
}

function bucket(orders: ServiceOrderWithJoins[] | undefined): SaStats {
  const empty: SaStats = {
    todayIntake: 0,
    activeCount: 0,
    quotesWaiting: 0,
    pendingPayment: 0,
    waiting: [],
    inProgress: [],
    completed: [],
    recentlyCollected: [],
  }
  if (!orders) return empty

  const today = startOfDay(new Date())
  const sevenDaysAgo = new Date(today.getTime() - 7 * 86_400_000)

  let todayIntake = 0
  let quotesWaiting = 0
  let pendingPayment = 0
  const waiting: ServiceOrderWithJoins[] = []
  const inProgress: ServiceOrderWithJoins[] = []
  const completed: ServiceOrderWithJoins[] = []
  const recentlyCollected: ServiceOrderWithJoins[] = []

  for (const o of orders) {
    if (new Date(o.opened_at) >= today) todayIntake += 1
    if (o.quote_status === 'sent') quotesWaiting += 1
    if (o.status === 'completed') pendingPayment += 1
    switch (o.status) {
      case 'open':
      case 'awaiting_parts':
        waiting.push(o)
        break
      case 'in_progress':
        inProgress.push(o)
        break
      case 'completed':
        completed.push(o)
        break
      case 'collected':
        if (o.collected_at && new Date(o.collected_at) >= sevenDaysAgo) {
          recentlyCollected.push(o)
        }
        break
      // 'cancelled' is intentionally left out of the SA's daily view.
    }
  }

  const activeCount =
    waiting.length + inProgress.length + completed.length

  return {
    todayIntake,
    activeCount,
    quotesWaiting,
    pendingPayment,
    waiting,
    inProgress,
    completed,
    recentlyCollected,
  }
}

function startOfDay(d: Date): Date {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  return x
}

// ---------- Sub-components ------------------------------------------------

function StatCard({
  label,
  value,
  hint,
  tone,
}: {
  label: string
  value: number
  hint?: string
  tone: 'blue' | 'amber' | 'orange' | 'rose'
}) {
  const colour = {
    blue: 'text-blue-700',
    amber: 'text-amber-700',
    orange: 'text-orange-700',
    rose: 'text-rose-700',
  }[tone]
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-4">
      <div className="text-[11px] font-medium text-gray-500">{label}</div>
      <div className={`mt-1 tabular-nums text-2xl font-semibold ${colour}`}>
        {value}
      </div>
      {hint && <div className="mt-0.5 text-[10px] text-gray-400">{hint}</div>}
    </div>
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

function Bucket({
  title,
  hint,
  orders,
  emptyText,
}: {
  title: string
  hint: string
  orders: ServiceOrderWithJoins[]
  emptyText: string
}) {
  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-5">
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="text-sm font-semibold text-gray-900">{title}</h2>
        <span className="text-[11px] text-gray-500">
          {orders.length} · {hint}
        </span>
      </div>
      {orders.length === 0 ? (
        <p className="text-sm text-gray-500">{emptyText}</p>
      ) : (
        <ul className="divide-y divide-gray-100">
          {orders.map((o) => (
            <li key={o.id}>
              <Link
                to={`/service-orders/${o.id}`}
                className="-mx-2 flex items-center justify-between gap-3 rounded-lg px-2 py-2.5 hover:bg-gray-50"
              >
                <div className="min-w-0">
                  <div className="font-mono text-xs text-gray-600">
                    {o.order_no ?? '— draft —'}
                  </div>
                  <div className="truncate text-sm text-gray-900">
                    {o.vehicle?.registration_no ?? '—'} · {o.customer?.name ?? '—'}
                  </div>
                  {o.complaint && (
                    <div className="truncate text-xs text-gray-500">
                      {o.complaint}
                    </div>
                  )}
                </div>
                <div className="shrink-0 text-right">
                  <span
                    className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_PILL[o.status]}`}
                  >
                    {SERVICE_ORDER_STATUS_LABEL[o.status]}
                  </span>
                  {o.quote_status === 'sent' && (
                    <div className="mt-0.5 text-[10px] text-orange-700">
                      {QUOTE_STATUS_LABEL.sent}
                    </div>
                  )}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
