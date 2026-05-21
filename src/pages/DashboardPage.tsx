import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { AppShell } from '../components/AppShell'
import { useAuth } from '../lib/auth'
import { listBookings } from '../lib/bookings'
import { formatError } from '../lib/errors'
import { formatMYR, isThisMonth } from '../lib/format'
import { MONTHLY_INCENTIVE, computeIncentive } from '../data/incentives'
import type { Booking, BookingStatus } from '../lib/types'

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

  const [bookings, setBookings] = useState<Booking[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    listBookings()
      .then((rows) => alive && setBookings(rows))
      .catch((e) => alive && setError(formatError(e)))
    return () => {
      alive = false
    }
  }, [])

  // Derived stats — recompute whenever bookings change.
  const stats = useMemo(() => {
    if (!bookings) return null

    const active = bookings.filter((b) => b.status !== 'cancelled')
    const pipelineValue = active
      .filter((b) => b.status !== 'delivered')
      .reduce((sum, b) => sum + Number(b.otr_price), 0)

    const thisMonthCount = bookings.filter((b) =>
      isThisMonth(b.booking_date),
    ).length

    // Use the dedicated delivered_at timestamp (set automatically when status
    // flips to 'delivered'). Falls back to booking_date for any legacy rows
    // that don't yet have delivered_at populated.
    const deliveredThisMonth = bookings.filter(
      (b) =>
        b.status === 'delivered' &&
        isThisMonth(b.delivered_at ?? b.booking_date),
    ).length

    const incentive = computeIncentive(deliveredThisMonth)

    const pendingCount = bookings.filter((b) => b.status === 'pending').length

    // Status breakdown (over ALL bookings, not just active)
    const total = bookings.length
    const byStatus = STATUS_ORDER.map((s) => {
      const count = bookings.filter((b) => b.status === s).length
      return { status: s, count, pct: total > 0 ? count / total : 0 }
    })

    // Model breakdown — top 5 by count (active bookings only)
    const modelCounts = new Map<string, number>()
    active.forEach((b) => {
      modelCounts.set(b.vehicle_model, (modelCounts.get(b.vehicle_model) ?? 0) + 1)
    })
    const sortedModels = [...modelCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
    const maxModelCount = sortedModels[0]?.[1] ?? 0

    const recent = bookings.slice(0, 5)

    return {
      thisMonthCount,
      pipelineValue,
      pendingCount,
      deliveredThisMonth,
      incentive,
      byStatus,
      models: sortedModels,
      maxModelCount,
      recent,
      total,
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
          {/* ---------- Top stat cards ---------- */}
          <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatCard
              label="This month"
              value={stats.thisMonthCount.toString()}
              hint="bookings"
            />
            <StatCard
              label="Pipeline value"
              value={formatMYR(stats.pipelineValue, { compact: true })}
              hint="active, not yet delivered"
            />
            <StatCard
              label="Pending"
              value={stats.pendingCount.toString()}
              hint="awaiting confirmation"
              tone={stats.pendingCount > 0 ? 'warn' : 'neutral'}
            />
            <StatCard
              label="Delivered"
              value={stats.deliveredThisMonth.toString()}
              hint="this month"
              tone="success"
            />
          </div>

          {/* ---------- Monthly incentive hero ---------- */}
          <IncentiveCard incentive={stats.incentive} className="mb-6" />

          {/* ---------- Breakdown row ---------- */}
          <div className="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
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

            <BreakdownCard title="By model (active)">
              {stats.models.length === 0 ? (
                <p className="text-sm text-gray-500">
                  No active bookings yet.
                </p>
              ) : (
                <ul className="space-y-2.5">
                  {stats.models.map(([model, count]) => (
                    <li key={model}>
                      <div className="mb-1 flex items-center justify-between text-xs">
                        <span className="text-gray-700">{model}</span>
                        <span className="text-gray-500">{count}</span>
                      </div>
                      <div className="h-2 overflow-hidden rounded-full bg-gray-100">
                        <div
                          className="h-full bg-gray-700 transition-all"
                          style={{
                            width: `${
                              stats.maxModelCount > 0
                                ? (count / stats.maxModelCount) * 100
                                : 0
                            }%`,
                          }}
                        />
                      </div>
                    </li>
                  ))}
                </ul>
              )}
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
                      <div className="tabular-nums text-sm text-gray-900">
                        {formatMYR(b.otr_price)}
                      </div>
                      <span
                        className={`mt-1 inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_BADGE[b.status]}`}
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

// ----- monthly incentive hero ----------------------------------------------

function IncentiveCard({
  incentive,
  className = '',
}: {
  incentive: ReturnType<typeof computeIncentive>
  className?: string
}) {
  const pct = Math.min(100, Math.round(incentive.progress * 100))
  const ruleText = `RM ${MONTHLY_INCENTIVE.rewardPerTier} per ${MONTHLY_INCENTIVE.carsPerTier} delivered`

  return (
    <section
      className={`overflow-hidden rounded-2xl border border-amber-200 bg-gradient-to-br from-amber-50 to-white p-5 sm:p-6 ${className}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="text-xs font-medium uppercase tracking-wider text-amber-700">
            💰 Monthly incentive
          </div>
          <div className="mt-2 text-3xl font-bold tabular-nums text-gray-900 sm:text-4xl">
            {formatMYR(incentive.earned)}
          </div>
          <div className="mt-1 text-sm text-gray-600">
            earned this month
            {incentive.tiersAchieved > 0 && (
              <>
                {' '}· {incentive.tiersAchieved}× tier{' '}
                {incentive.tiersAchieved === 1 ? '' : 's'}
              </>
            )}
          </div>
        </div>
        <div className="text-right">
          <div className="text-xs text-gray-500">Rule</div>
          <div className="mt-1 text-sm text-gray-700">{ruleText}</div>
        </div>
      </div>

      <div className="mt-5">
        <div className="mb-1.5 flex items-center justify-between text-xs">
          <span className="text-gray-700">
            {incentive.delivered} delivered this month
          </span>
          <span className="tabular-nums text-gray-500">
            {incentive.delivered} / {incentive.nextTierAt}
          </span>
        </div>
        <div className="h-3 overflow-hidden rounded-full bg-amber-100">
          <div
            className="h-full bg-amber-500 transition-all"
            style={{ width: `${pct}%` }}
          />
        </div>
        <div className="mt-2 text-xs text-gray-600">
          {incentive.carsToNext === 0 ? (
            <>🎉 Just unlocked!</>
          ) : (
            <>
              Deliver{' '}
              <strong>
                {incentive.carsToNext} more car
                {incentive.carsToNext === 1 ? '' : 's'}
              </strong>{' '}
              to unlock <strong>{formatMYR(incentive.nextTierReward)}</strong>.
            </>
          )}
        </div>
      </div>
    </section>
  )
}

// ----- small layout helpers -------------------------------------------------

type Tone = 'neutral' | 'warn' | 'success'
const TONE_STYLES: Record<Tone, string> = {
  neutral: 'text-gray-900',
  warn: 'text-amber-700',
  success: 'text-green-700',
}

function StatCard({
  label,
  value,
  hint,
  tone = 'neutral',
}: {
  label: string
  value: string
  hint?: string
  tone?: Tone
}) {
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-4">
      <div className="text-xs font-medium text-gray-500">{label}</div>
      <div className={`mt-1 text-2xl font-semibold ${TONE_STYLES[tone]}`}>
        {value}
      </div>
      {hint && (
        <div className="mt-0.5 text-xs text-gray-400">{hint}</div>
      )}
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
