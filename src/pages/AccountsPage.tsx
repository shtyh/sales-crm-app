import { useMemo } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { AppShell } from '../components/AppShell'
import { useAuth } from '../lib/auth'
import { useBookings, useProfiles } from '../lib/queries'
import { formatError } from '../lib/errors'
import { formatMYR } from '../lib/format'
import type { Booking, Profile } from '../lib/types'

export function AccountsPage() {
  const { isAccountant, loading } = useAuth()
  const { data: bookings, error: bookingsErr } = useBookings()
  const { data: profiles } = useProfiles()

  const profileById = useMemo(() => {
    const m = new Map<string, Profile>()
    profiles?.forEach((p) => m.set(p.id, p))
    return m
  }, [profiles])

  // Queue 1 — bookings waiting for the accountant to verify the deposit.
  // Cancelled bookings drop off (no cash to chase).
  const depositQueue = useMemo(
    () =>
      bookings
        ?.filter(
          (b) =>
            b.deposit_status !== 'received' && b.status !== 'cancelled',
        )
        .sort(
          (a, b) =>
            new Date(a.created_at).getTime() -
            new Date(b.created_at).getTime(),
        ) ?? [],
    [bookings],
  )

  // Queue 2 — deposit is in, but final settlement still owed.
  const settlementQueue = useMemo(
    () =>
      bookings
        ?.filter(
          (b) =>
            b.deposit_status === 'received' &&
            b.payment_status !== 'paid' &&
            b.status !== 'cancelled',
        )
        .sort(
          (a, b) =>
            new Date(a.deposit_confirmed_at ?? a.created_at).getTime() -
            new Date(b.deposit_confirmed_at ?? b.created_at).getTime(),
        ) ?? [],
    [bookings],
  )

  // Queue 3 — auto-flipped to commission_status='pending' (delivered+paid),
  // waiting on the accountant's sign-off.
  const commissionQueue = useMemo(
    () =>
      bookings
        ?.filter((b) => b.commission_status === 'pending')
        .sort(
          (a, b) =>
            new Date(b.updated_at).getTime() -
            new Date(a.updated_at).getTime(),
        ) ?? [],
    [bookings],
  )

  const totals = useMemo(() => {
    let depositOwed = 0
    let settleOwed = 0
    for (const b of bookings ?? []) {
      if (b.status === 'cancelled') continue
      const net = Number(b.otr_price) - Number(b.discount_amount ?? 0)
      if (b.deposit_status !== 'received') {
        depositOwed += Number(b.booking_fee ?? 0)
      } else if (b.payment_status !== 'paid') {
        // Settlement = remaining after deposit
        settleOwed += net - Number(b.booking_fee ?? 0)
      }
    }
    return { depositOwed, settleOwed }
  }, [bookings])

  const error = bookingsErr ? formatError(bookingsErr) : null

  if (loading) {
    return (
      <AppShell>
        <div className="rounded-2xl border border-gray-200 bg-white p-10 text-center text-sm text-gray-500">
          Loading…
        </div>
      </AppShell>
    )
  }
  if (!isAccountant) {
    return <Navigate to="/" replace />
  }

  return (
    <AppShell>
      <div className="-mt-6 mb-6 -mx-4 sm:-mx-6">
        <div className="bg-gradient-to-r from-green-700 to-green-500 px-4 py-4 text-white sm:px-6 sm:py-5">
          <div className="text-[10px] font-medium uppercase tracking-widest text-green-200">
            ☆ Accountant
          </div>
          <h1 className="mt-1 text-xl font-semibold sm:text-2xl">
            Cash ledger
          </h1>
          <p className="mt-1 text-sm text-green-100">
            Verify deposits, settle final payments, then approve commissions.
            Delivery is locked until you mark payment Fully paid.
          </p>
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

      {/* ---------- Headline numbers ---------- */}
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard
          label="Pending deposit"
          value={depositQueue.length}
          accent={depositQueue.length > 0 ? 'amber' : 'neutral'}
          hint="bookings without confirmed cash"
        />
        <StatCard
          label="Pending settlement"
          value={settlementQueue.length}
          accent={settlementQueue.length > 0 ? 'blue' : 'neutral'}
          hint="deposit in, final owed"
        />
        <StatCard
          label="Commission to review"
          value={commissionQueue.length}
          accent={commissionQueue.length > 0 ? 'rose' : 'neutral'}
        />
        <StatMoney
          label="Cash expected"
          value={totals.depositOwed + totals.settleOwed}
        />
      </div>

      {/* ---------- Queue 1: pending deposits ---------- */}
      <Queue
        tone="amber"
        icon="⏳"
        title="Pending deposit — verify cash in bank"
        rows={depositQueue}
        profileById={profileById}
        amountFor={(b) => Number(b.booking_fee ?? 0)}
        amountLabel="Booking fee"
        emptyText="No bookings waiting on deposit verification."
      />

      {/* ---------- Queue 2: pending final settlement ---------- */}
      <Queue
        tone="blue"
        icon="💳"
        title="Pending final settlement"
        rows={settlementQueue}
        profileById={profileById}
        amountFor={(b) =>
          Number(b.otr_price) -
          Number(b.discount_amount ?? 0) -
          Number(b.booking_fee ?? 0)
        }
        amountLabel="Balance owed"
        emptyText="Every confirmed booking is fully settled. 🎉"
      />

      {/* ---------- Queue 3: commission review ---------- */}
      <Queue
        tone="rose"
        icon="📊"
        title="Commission ready for review"
        rows={commissionQueue}
        profileById={profileById}
        amountFor={(b) =>
          Number(b.otr_price) - Number(b.discount_amount ?? 0)
        }
        amountLabel="Net sale"
        emptyText="No commissions waiting for your sign-off."
      />
    </AppShell>
  )
}

// ----- helpers -------------------------------------------------------------

function Queue({
  tone,
  icon,
  title,
  rows,
  profileById,
  amountFor,
  amountLabel,
  emptyText,
}: {
  tone: 'amber' | 'blue' | 'rose'
  icon: string
  title: string
  rows: Booking[]
  profileById: Map<string, Profile>
  amountFor: (b: Booking) => number
  amountLabel: string
  emptyText: string
}) {
  const styles = {
    amber: {
      border: 'border-amber-200',
      bg: 'bg-amber-50/30',
      text: 'text-amber-900',
      divide: 'divide-amber-200',
    },
    blue: {
      border: 'border-blue-200',
      bg: 'bg-blue-50/30',
      text: 'text-blue-900',
      divide: 'divide-blue-200',
    },
    rose: {
      border: 'border-rose-200',
      bg: 'bg-rose-50/30',
      text: 'text-rose-900',
      divide: 'divide-rose-200',
    },
  }[tone]

  return (
    <section
      className={`mb-6 rounded-2xl border ${styles.border} ${styles.bg} p-5`}
    >
      <div className="mb-3 flex items-center justify-between">
        <h2 className={`text-sm font-semibold ${styles.text}`}>
          {icon} {title} — {rows.length}
        </h2>
        <Link
          to="/bookings"
          className={`text-xs font-medium ${styles.text} hover:underline`}
        >
          See all bookings →
        </Link>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-lg border border-dashed border-gray-200 bg-white p-6 text-center text-sm text-gray-500">
          {emptyText}
        </div>
      ) : (
        <ul className={`divide-y ${styles.divide}`}>
          {rows.map((b) => {
            const owner = profileById.get(b.owner_id)
            return (
              <li key={b.id}>
                <Link
                  to={`/bookings/${b.id}`}
                  className="flex items-center gap-3 py-3 first:pt-0 last:pb-0 hover:bg-white/50"
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-gray-900">
                      {b.customer_name}{' '}
                      <span className="font-mono text-xs text-gray-500">
                        {b.code}
                      </span>
                    </div>
                    <div className="truncate text-xs text-gray-500">
                      {b.vehicle_model}
                      {b.vehicle_variant ? ` · ${b.vehicle_variant}` : ''} ·
                      by{' '}
                      <span className="font-medium">
                        {owner?.full_name || owner?.email || '—'}
                      </span>
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="text-[10px] text-gray-500">
                      {amountLabel}
                    </div>
                    <div className="tabular-nums text-sm font-semibold text-gray-900">
                      {formatMYR(amountFor(b))}
                    </div>
                  </div>
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

function StatCard({
  label,
  value,
  hint,
  accent = 'neutral',
}: {
  label: string
  value: number
  hint?: string
  accent?: 'neutral' | 'amber' | 'blue' | 'rose'
}) {
  const tone =
    accent === 'amber'
      ? 'text-amber-700'
      : accent === 'blue'
        ? 'text-blue-700'
        : accent === 'rose'
          ? 'text-rose-700'
          : 'text-gray-900'
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-4">
      <div className="text-xs font-medium text-gray-500">{label}</div>
      <div className={`mt-1 text-2xl font-semibold tabular-nums ${tone}`}>
        {value}
      </div>
      {hint && <div className="mt-0.5 text-xs text-gray-400">{hint}</div>}
    </div>
  )
}

function StatMoney({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-4">
      <div className="text-xs font-medium text-gray-500">{label}</div>
      <div className="mt-1 text-lg font-semibold tabular-nums text-gray-900">
        {formatMYR(value)}
      </div>
    </div>
  )
}
