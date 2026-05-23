import { useMemo } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { AppShell } from '../components/AppShell'
import { useAuth } from '../lib/auth'
import { useBookings, useCars, useProfiles } from '../lib/queries'
import { formatError } from '../lib/errors'
import { formatMYR } from '../lib/format'
import {
  FLOOR_STOCK_LABEL,
  type FloorStockStatus,
  type Profile,
} from '../lib/types'

const FS_BADGE: Record<FloorStockStatus, string> = {
  locked: 'bg-rose-100 text-rose-800',
  pending_settlement: 'bg-amber-100 text-amber-800',
  overdue: 'bg-red-200 text-red-900',
  paid_off: 'bg-green-100 text-green-800',
}

/** YYYY-MM-DD → boolean (is the due date in the past?). */
function isOverdue(due: string | null, status: FloorStockStatus) {
  if (status === 'paid_off' || !due) return false
  return new Date(due).getTime() < new Date().setHours(0, 0, 0, 0)
}

export function FinancePage() {
  const { isFinanceAdmin, loading } = useAuth()

  const { data: cars, error: carsErr } = useCars()
  const { data: bookings, error: bookingsErr } = useBookings()
  const { data: profiles } = useProfiles()

  const profileById = useMemo(() => {
    const m = new Map<string, Profile>()
    profiles?.forEach((p) => m.set(p.id, p))
    return m
  }, [profiles])

  // Cars still on the bank's tab. Sort by due date asc — anything past due
  // floats to the top so finance can see what's bleeding interest.
  const inventoryQueue = useMemo(() => {
    if (!cars) return []
    return [...cars]
      .filter((c) => c.floor_stock_status !== 'paid_off')
      .sort((a, b) => {
        // null due dates last
        if (a.floor_stock_due == null) return 1
        if (b.floor_stock_due == null) return -1
        return a.floor_stock_due.localeCompare(b.floor_stock_due)
      })
  }, [cars])

  const totals = useMemo(() => {
    let financed = 0
    let countLocked = 0
    let countPending = 0
    let countOverdueLike = 0
    for (const c of cars ?? []) {
      if (c.floor_stock_status === 'paid_off') continue
      financed += Number(c.financed_amount ?? 0)
      if (c.floor_stock_status === 'locked') countLocked++
      if (c.floor_stock_status === 'pending_settlement') countPending++
      if (
        c.floor_stock_status === 'overdue' ||
        isOverdue(c.floor_stock_due, c.floor_stock_status)
      ) {
        countOverdueLike++
      }
    }
    return { financed, countLocked, countPending, countOverdueLike }
  }, [cars])

  // LOU queue: bookings where loan_status='pending' — finance is the one
  // talking to the bank about these.
  const louQueue = useMemo(
    () =>
      bookings
        ?.filter((b) => b.loan_status === 'pending' && b.status !== 'cancelled')
        .slice(0, 20) ?? [],
    [bookings],
  )

  const error =
    carsErr || bookingsErr ? formatError(carsErr ?? bookingsErr) : null

  if (loading) {
    return (
      <AppShell>
        <div className="rounded-2xl border border-gray-200 bg-white p-10 text-center text-sm text-gray-500">
          Loading…
        </div>
      </AppShell>
    )
  }
  // Page is intended for finance_admin and super_admin. Other roles get
  // pushed to home — they have no business here.
  if (!isFinanceAdmin) {
    return <Navigate to="/" replace />
  }

  return (
    <AppShell>
      {/* Amber banner — same accent we use on finance-only fields elsewhere. */}
      <div className="-mt-6 mb-6 -mx-4 sm:-mx-6">
        <div className="bg-gradient-to-r from-amber-700 to-amber-500 px-4 py-4 text-white sm:px-6 sm:py-5">
          <div className="text-[10px] font-medium uppercase tracking-widest text-amber-200">
            ☆ Finance Admin
          </div>
          <h1 className="mt-1 text-xl font-semibold sm:text-2xl">
            Floor stock & LOU control
          </h1>
          <p className="mt-1 text-sm text-amber-100">
            Inventory financing on top, pending bank LOUs below. Settle cars to
            paid_off so the showroom can deliver them.
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
        <Stat label="Cars not paid off" value={inventoryQueue.length} />
        <Stat
          label="Overdue"
          value={totals.countOverdueLike}
          tone={totals.countOverdueLike > 0 ? 'red' : 'neutral'}
        />
        <Stat
          label="Pending settlement"
          value={totals.countPending}
          tone="amber"
        />
        <StatMoney label="Financed (open)" value={totals.financed} />
      </div>

      {/* ---------- Inventory Financing Grid ---------- */}
      <section className="mb-6 rounded-2xl border border-gray-200 bg-white p-5">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-900">
            🚗 Inventory financing — {inventoryQueue.length} open
          </h2>
          <Link
            to="/cars"
            className="text-xs font-medium text-gray-900 hover:underline"
          >
            All cars →
          </Link>
        </div>

        {inventoryQueue.length === 0 ? (
          <div className="rounded-lg border border-dashed border-gray-200 p-6 text-center text-sm text-gray-500">
            🎉 Every car is paid off.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead className="bg-gray-50 text-xs uppercase tracking-wider text-gray-500">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Chassis</th>
                  <th className="px-3 py-2 text-left font-medium">Vehicle</th>
                  <th className="px-3 py-2 text-left font-medium">Bank</th>
                  <th className="px-3 py-2 text-right font-medium">
                    Financed
                  </th>
                  <th className="px-3 py-2 text-left font-medium">Status</th>
                  <th className="px-3 py-2 text-left font-medium">Due</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {inventoryQueue.map((c) => {
                  const overdueDate = isOverdue(
                    c.floor_stock_due,
                    c.floor_stock_status,
                  )
                  return (
                    <tr key={c.id} className="hover:bg-gray-50">
                      <td className="whitespace-nowrap px-3 py-2">
                        <Link
                          to={`/cars/${c.id}`}
                          className="font-mono text-xs text-gray-900 hover:underline"
                        >
                          {c.chassis_no}
                        </Link>
                      </td>
                      <td className="px-3 py-2 text-gray-700">
                        {c.model}
                        {c.variant ? ` · ${c.variant}` : ''}
                      </td>
                      <td className="px-3 py-2 text-gray-700">
                        {c.floor_stock_bank || (
                          <span className="italic text-gray-400">— not set —</span>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-gray-900">
                        {c.financed_amount != null
                          ? formatMYR(Number(c.financed_amount))
                          : '—'}
                      </td>
                      <td className="px-3 py-2">
                        <span
                          className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${FS_BADGE[c.floor_stock_status]}`}
                        >
                          {FLOOR_STOCK_LABEL[c.floor_stock_status]}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-xs">
                        {c.floor_stock_due ? (
                          <span
                            className={
                              overdueDate
                                ? 'font-semibold text-red-700'
                                : 'text-gray-600'
                            }
                          >
                            {c.floor_stock_due}
                            {overdueDate && ' · past due'}
                          </span>
                        ) : (
                          <span className="italic text-gray-400">— not set —</span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ---------- Pending LOU ledger ---------- */}
      <section className="rounded-2xl border border-gray-200 bg-white p-5">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-900">
            📋 Pending LOU — {louQueue.length}
          </h2>
          <span className="text-xs text-gray-500">
            loan_status = pending; awaiting bank decision
          </span>
        </div>

        {louQueue.length === 0 ? (
          <div className="rounded-lg border border-dashed border-gray-200 p-6 text-center text-sm text-gray-500">
            No bank approvals waiting.
          </div>
        ) : (
          <ul className="divide-y divide-gray-100">
            {louQueue.map((b) => {
              const owner = profileById.get(b.owner_id)
              return (
                <li key={b.id}>
                  <Link
                    to={`/bookings/${b.id}`}
                    className="flex items-center gap-3 py-3 first:pt-0 last:pb-0 hover:bg-gray-50"
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
                        {b.loan_bank ? ` · ${b.loan_bank}` : ''}
                      </div>
                    </div>
                    {/* OTR/net-price display intentionally removed
                        2026-05-23 — OTR no longer surfaced in the UI. */}
                  </Link>
                </li>
              )
            })}
          </ul>
        )}
      </section>
    </AppShell>
  )
}

function Stat({
  label,
  value,
  tone = 'neutral',
}: {
  label: string
  value: number
  tone?: 'neutral' | 'red' | 'amber'
}) {
  const t =
    tone === 'red'
      ? 'text-red-700'
      : tone === 'amber'
        ? 'text-amber-700'
        : 'text-gray-900'
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-4">
      <div className="text-xs font-medium text-gray-500">{label}</div>
      <div className={`mt-1 text-2xl font-semibold tabular-nums ${t}`}>
        {value}
      </div>
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
