import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { AppShell } from '../components/AppShell'
import { useAuth } from '../lib/auth'
import { useBookings } from '../lib/queries'
import { formatError } from '../lib/errors'
import { formatMYR } from '../lib/format'
import type { BookingStatus } from '../lib/types'

const STATUS_ORDER: BookingStatus[] = [
  'pending',
  'confirmed',
  'delivered',
  'cancelled',
]
const STATUS_LABEL: Record<BookingStatus, string> = {
  pending: 'Pending',
  confirmed: 'Confirmed',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
}
const STATUS_BAR: Record<BookingStatus, string> = {
  pending: 'bg-amber-400',
  confirmed: 'bg-blue-500',
  delivered: 'bg-green-500',
  cancelled: 'bg-gray-300',
}
const STATUS_BADGE: Record<BookingStatus, string> = {
  pending: 'bg-amber-100 text-amber-800',
  confirmed: 'bg-blue-100 text-blue-800',
  delivered: 'bg-green-100 text-green-800',
  cancelled: 'bg-gray-100 text-gray-600',
}

export function DashboardPage() {
  const { user } = useAuth()
  const displayName =
    (user?.user_metadata?.full_name as string | undefined) ?? user?.email ?? ''

  const { data: bookings, error: queryError } = useBookings()
  const error = queryError ? formatError(queryError) : null

  // Derived stats — recompute whenever bookings change.
  const stats = useMemo(() => {
    if (!bookings) return null

    // Status breakdown (over ALL bookings, not just active)
    const total = bookings.length
    const byStatus = STATUS_ORDER.map((s) => {
      const count = bookings.filter((b) => b.status === s).length
      return { status: s, count, pct: total > 0 ? count / total : 0 }
    })

    const recent = bookings.slice(0, 5)

    // Commission totals on the SA's own bookings.
    let earned = 0    // approved or paid
    let pending = 0   // not_eligible + pending — what *might* be earned
    let paid = 0
    let projected = 0 // sum of commission_amount across all non-cancelled bookings
    for (const b of bookings) {
      if (b.status === 'cancelled') continue
      const amt = Number(b.commission_amount ?? 0)
      projected += amt
      if (b.commission_status === 'paid') {
        paid += amt
        earned += amt
      } else if (b.commission_status === 'approved') {
        earned += amt
      } else if (
        b.commission_status === 'pending' ||
        b.commission_status === 'not_eligible'
      ) {
        pending += amt
      }
    }

    return {
      byStatus,
      recent,
      total,
      commission: { earned, pending, paid, projected },
    }
  }, [bookings])

  return (
    <AppShell>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">
            Hi, {displayName}
          </h1>
          <p className="mt-1 text-sm text-gray-500">
            Here's how things are going.
          </p>
        </div>
        <Link
          to="/bookings/new"
          className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-gray-800"
        >
          + New booking
        </Link>
      </div>

      {error && (
        <div
          role="alert"
          className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
        >
          {error}
        </div>
      )}

      {!stats && !error && (
        <div className="rounded-2xl border border-gray-200 bg-white p-10 text-center text-sm text-gray-500">
          Loading…
        </div>
      )}

      {stats && stats.total === 0 && (
        <div className="rounded-2xl border border-dashed border-gray-300 bg-white p-10 text-center">
          <div className="mb-2 text-3xl">📋</div>
          <p className="font-medium text-gray-900">No bookings yet</p>
          <p className="mt-1 text-sm text-gray-500">
            Create your first booking to see numbers here.
          </p>
          <Link
            to="/bookings/new"
            className="mt-4 inline-block rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800"
          >
            + New booking
          </Link>
        </div>
      )}

      {stats && stats.total > 0 && (
        <>
          {/* ---------- My commission ---------- */}
          <div className="mb-6 grid grid-cols-3 gap-3">
            <CommissionStat
              label="Paid out"
              value={stats.commission.paid}
              tone="green"
            />
            <CommissionStat
              label="Approved · waiting payout"
              value={stats.commission.earned - stats.commission.paid}
              tone="blue"
            />
            <CommissionStat
              label="Projected (active)"
              value={stats.commission.pending}
              tone="amber"
              hint="not yet earned; cancel/discount can change this"
            />
          </div>

          {/* ---------- Status breakdown ---------- */}
          <div className="mb-6">
            <BreakdownCard title="By status">
              <ul className="space-y-2.5">
                {stats.byStatus.map((s) => (
                  <li key={s.status}>
                    <div className="mb-1 flex items-center justify-between text-xs">
                      <span className="text-gray-700">
                        {STATUS_LABEL[s.status]}
                      </span>
                      <span className="text-gray-500">
                        {s.count}{' '}
                        <span className="text-gray-400">
                          ({Math.round(s.pct * 100)}%)
                        </span>
                      </span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-gray-100">
                      <div
                        className={`h-full ${STATUS_BAR[s.status]} transition-all`}
                        style={{ width: `${s.pct * 100}%` }}
                      />
                    </div>
                  </li>
                ))}
              </ul>
            </BreakdownCard>
          </div>

          {/* ---------- Recent bookings ---------- */}
          <BreakdownCard
            title="Recent bookings"
            action={
              <Link
                to="/bookings"
                className="text-xs font-medium text-gray-900 hover:underline"
              >
                See all →
              </Link>
            }
          >
            <ul className="divide-y divide-gray-100">
              {stats.recent.map((b) => (
                <li key={b.id}>
                  <Link
                    to={`/bookings/${b.id}`}
                    className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0 hover:bg-gray-50"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium text-gray-900">
                        {b.customer_name}
                      </div>
                      <div className="truncate text-xs text-gray-500">
                        {b.vehicle_model}
                        {b.vehicle_variant ? ` · ${b.vehicle_variant}` : ''}
                      </div>
                    </div>
                    <div className="shrink-0 text-right">
                      <span
                        className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_BADGE[b.status]}`}
                      >
                        {b.status}
                      </span>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          </BreakdownCard>
        </>
      )}
    </AppShell>
  )
}

// ----- small layout helpers -------------------------------------------------

function CommissionStat({
  label,
  value,
  tone,
  hint,
}: {
  label: string
  value: number
  tone: 'green' | 'blue' | 'amber'
  hint?: string
}) {
  // Negative commission (over-discounted) goes red regardless of requested
  // tone — the SA needs to see they're underwater.
  const negative = value < 0
  const t = negative
    ? 'text-rose-700'
    : tone === 'green'
      ? 'text-green-700'
      : tone === 'blue'
        ? 'text-blue-700'
        : 'text-amber-700'
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-4">
      <div className="text-[11px] font-medium text-gray-500">{label}</div>
      <div className={`mt-1 tabular-nums text-lg font-semibold ${t}`}>
        {formatMYR(value)}
      </div>
      {hint && <div className="mt-0.5 text-[10px] text-gray-400">{hint}</div>}
    </div>
  )
}

function BreakdownCard({
  title,
  action,
  children,
}: {
  title: string
  action?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-5">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-gray-900">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  )
}
