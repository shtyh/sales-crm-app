import { useMemo, useState, type FormEvent } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { AppShell } from '../components/AppShell'
import { useAuth } from '../lib/auth'
import {
  useBookings,
  useCommissionPayouts,
  useCreatePayout,
  useProfiles,
  useUpdateBooking,
} from '../lib/queries'
import { formatError } from '../lib/errors'
import { formatMYR } from '../lib/format'
import type { Booking, CommissionPayout, Profile } from '../lib/types'

const today = () => new Date().toISOString().slice(0, 10)

export function CommissionsPage() {
  const { canApproveDiscount, loading } = useAuth()
  const { data: bookings, error: bookingsErr } = useBookings()
  const { data: profiles } = useProfiles()
  const { data: payouts } = useCommissionPayouts(canApproveDiscount)
  const updateMut = useUpdateBooking()
  const payoutMut = useCreatePayout()

  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [batchLabel, setBatchLabel] = useState('')
  const [batchPaidAt, setBatchPaidAt] = useState(today())
  const [batchNotes, setBatchNotes] = useState('')

  const profileById = useMemo(() => {
    const m = new Map<string, Profile>()
    profiles?.forEach((p) => m.set(p.id, p))
    return m
  }, [profiles])

  const pendingReview = useMemo(
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

  const awaitingPayout = useMemo(
    () =>
      bookings
        ?.filter(
          (b) =>
            b.commission_status === 'approved' &&
            b.commission_payout_id == null,
        )
        .sort(
          (a, b) =>
            new Date(b.updated_at).getTime() -
            new Date(a.updated_at).getTime(),
        ) ?? [],
    [bookings],
  )

  const selectedTotal = useMemo(() => {
    let n = 0
    for (const b of awaitingPayout) {
      if (selected.has(b.id)) n += Number(b.commission_amount ?? 0)
    }
    return n
  }, [awaitingPayout, selected])

  // Map payout_id → aggregate of attached bookings, for the past-payouts list.
  const payoutSummaries = useMemo(() => {
    type Sum = { count: number; total: number }
    const acc = new Map<string, Sum>()
    for (const b of bookings ?? []) {
      if (!b.commission_payout_id) continue
      const s = acc.get(b.commission_payout_id) ?? { count: 0, total: 0 }
      s.count += 1
      s.total += Number(b.commission_amount ?? 0)
      acc.set(b.commission_payout_id, s)
    }
    return acc
  }, [bookings])

  if (loading) {
    return (
      <AppShell>
        <div className="rounded-2xl border border-gray-200 bg-white p-10 text-center text-sm text-gray-500">
          Loading…
        </div>
      </AppShell>
    )
  }
  if (!canApproveDiscount) return <Navigate to="/" replace />

  const showError =
    error ?? (bookingsErr ? formatError(bookingsErr) : null)

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function selectAllAwaiting() {
    setSelected(new Set(awaitingPayout.map((b) => b.id)))
  }
  function clearSelection() {
    setSelected(new Set())
  }

  async function handleDecision(
    b: Booking,
    decision: 'approved' | 'rejected',
  ) {
    setError(null)
    try {
      await updateMut.mutateAsync({
        id: b.id,
        patch: { commission_status: decision } as never,
      })
    } catch (e) {
      setError(formatError(e))
    }
  }

  async function handleCreateBatch(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (selected.size === 0) {
      setError('Pick at least one booking to include in the batch.')
      return
    }
    if (!batchLabel.trim()) {
      setError('Give the batch a label, e.g. "May 2026 — 1st half".')
      return
    }
    try {
      await payoutMut.mutateAsync({
        input: {
          label: batchLabel.trim(),
          paid_at: batchPaidAt,
          notes: batchNotes.trim() || null,
        },
        bookingIds: [...selected],
      })
      clearSelection()
      setBatchLabel('')
      setBatchNotes('')
      setBatchPaidAt(today())
    } catch (e) {
      setError(formatError(e))
    }
  }

  return (
    <AppShell>
      <div className="-mt-6 mb-6 -mx-4 sm:-mx-6">
        <div className="bg-gradient-to-r from-blue-700 to-blue-500 px-4 py-4 text-white sm:px-6 sm:py-5">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <div className="text-[10px] font-medium uppercase tracking-widest text-blue-200">
                ☆ Sales Manager
              </div>
              <h1 className="mt-1 text-xl font-semibold sm:text-2xl">
                Commissions
              </h1>
              <p className="mt-1 text-sm text-blue-100">
                Review what's pending, then bundle approved ones into a payout
                batch (twice a month).
              </p>
            </div>
            {/* super_admin shortcut to the rate table — the most common
                follow-up question when you land here is "where do I set the
                base amount?" */}
            <Link
              to="/admin/commissions"
              className="shrink-0 rounded-lg border border-blue-300 bg-white/10 px-3 py-1.5 text-xs font-medium text-white hover:bg-white/20"
            >
              ⚙ Edit base rates →
            </Link>
          </div>
        </div>
      </div>

      {showError && (
        <div
          role="alert"
          className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
        >
          {showError}
        </div>
      )}

      {/* ---------- Pending review ---------- */}
      <section className="mb-6 rounded-2xl border border-amber-200 bg-amber-50/30 p-5">
        <h2 className="mb-3 text-sm font-semibold text-amber-900">
          ⏳ Pending review — {pendingReview.length}
        </h2>
        {pendingReview.length === 0 ? (
          <div className="rounded-lg border border-dashed border-gray-200 bg-white p-6 text-center text-sm text-gray-500">
            Nothing waiting on your sign-off.
          </div>
        ) : (
          <ul className="divide-y divide-amber-200">
            {pendingReview.map((b) => (
              <li
                key={b.id}
                className="flex flex-wrap items-center gap-3 py-3 first:pt-0 last:pb-0"
              >
                <BookingMini b={b} profileById={profileById} />
                <CommissionFigure
                  base={Number(b.base_commission ?? 0)}
                  discount={Number(b.discount_amount ?? 0)}
                  amount={Number(b.commission_amount ?? 0)}
                />
                <div className="flex shrink-0 gap-2">
                  <button
                    type="button"
                    onClick={() => handleDecision(b, 'approved')}
                    disabled={updateMut.isPending}
                    className="rounded-lg bg-green-600 px-3 py-1 text-xs font-medium text-white hover:bg-green-700 disabled:opacity-50"
                  >
                    Approve
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDecision(b, 'rejected')}
                    disabled={updateMut.isPending}
                    className="rounded-lg bg-red-600 px-3 py-1 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-50"
                  >
                    Reject
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ---------- Approved · awaiting payout ---------- */}
      <section className="mb-6 rounded-2xl border border-blue-200 bg-blue-50/30 p-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-blue-900">
            ✓ Approved · awaiting payout — {awaitingPayout.length}
          </h2>
          {awaitingPayout.length > 0 && (
            <div className="flex gap-2 text-xs">
              <button
                type="button"
                onClick={selectAllAwaiting}
                className="rounded border border-blue-300 bg-white px-2 py-0.5 text-blue-800 hover:bg-blue-100"
              >
                Select all
              </button>
              <button
                type="button"
                onClick={clearSelection}
                className="rounded border border-blue-300 bg-white px-2 py-0.5 text-blue-800 hover:bg-blue-100"
              >
                Clear
              </button>
            </div>
          )}
        </div>

        {awaitingPayout.length === 0 ? (
          <div className="rounded-lg border border-dashed border-gray-200 bg-white p-6 text-center text-sm text-gray-500">
            All approved commissions have already been paid out.
          </div>
        ) : (
          <>
            <ul className="mb-4 divide-y divide-blue-200">
              {awaitingPayout.map((b) => (
                <li
                  key={b.id}
                  className="flex flex-wrap items-center gap-3 py-3 first:pt-0 last:pb-0"
                >
                  <label className="flex shrink-0 cursor-pointer items-center gap-2">
                    <input
                      type="checkbox"
                      checked={selected.has(b.id)}
                      onChange={() => toggleSelect(b.id)}
                      className="h-4 w-4 rounded border-gray-300"
                    />
                  </label>
                  <BookingMini b={b} profileById={profileById} />
                  <CommissionFigure
                    base={Number(b.base_commission ?? 0)}
                    discount={Number(b.discount_amount ?? 0)}
                    amount={Number(b.commission_amount ?? 0)}
                  />
                </li>
              ))}
            </ul>

            {/* Batch creation form */}
            <form
              onSubmit={handleCreateBatch}
              className="rounded-xl border border-blue-300 bg-white p-4"
            >
              <h3 className="mb-3 text-sm font-semibold text-blue-900">
                Create payout batch ({selected.size} selected ·{' '}
                {formatMYR(selectedTotal)})
              </h3>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <label className="block text-sm sm:col-span-1">
                  <span className="mb-1 block font-medium text-gray-700">
                    Batch label
                  </span>
                  <input
                    type="text"
                    required
                    value={batchLabel}
                    onChange={(e) => setBatchLabel(e.target.value)}
                    placeholder="e.g. May 2026 — 1st half"
                    className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm outline-none focus:border-gray-900 focus:ring-2 focus:ring-gray-900/10"
                  />
                </label>
                <label className="block text-sm sm:col-span-1">
                  <span className="mb-1 block font-medium text-gray-700">
                    Paid on
                  </span>
                  <input
                    type="date"
                    required
                    value={batchPaidAt}
                    onChange={(e) => setBatchPaidAt(e.target.value)}
                    className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm outline-none focus:border-gray-900 focus:ring-2 focus:ring-gray-900/10"
                  />
                </label>
                <label className="block text-sm sm:col-span-1">
                  <span className="mb-1 block font-medium text-gray-700">
                    Notes
                  </span>
                  <input
                    type="text"
                    value={batchNotes}
                    onChange={(e) => setBatchNotes(e.target.value)}
                    placeholder="optional"
                    className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm outline-none focus:border-gray-900 focus:ring-2 focus:ring-gray-900/10"
                  />
                </label>
              </div>
              <div className="mt-3 flex justify-end">
                <button
                  type="submit"
                  disabled={
                    payoutMut.isPending || selected.size === 0 || !batchLabel
                  }
                  className="rounded-lg bg-blue-700 px-4 py-2 text-sm font-medium text-white hover:bg-blue-800 disabled:opacity-50"
                >
                  {payoutMut.isPending ? 'Creating…' : 'Create batch'}
                </button>
              </div>
            </form>
          </>
        )}
      </section>

      {/* ---------- Past payouts ---------- */}
      <section className="rounded-2xl border border-gray-200 bg-white p-5">
        <h2 className="mb-3 text-sm font-semibold text-gray-900">
          Past payouts — {payouts?.length ?? 0}
        </h2>
        {!payouts || payouts.length === 0 ? (
          <div className="rounded-lg border border-dashed border-gray-200 p-6 text-center text-sm text-gray-500">
            No payout batches yet.
          </div>
        ) : (
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50 text-xs uppercase tracking-wider text-gray-500">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Label</th>
                <th className="px-3 py-2 text-left font-medium">Paid on</th>
                <th className="px-3 py-2 text-right font-medium">Bookings</th>
                <th className="px-3 py-2 text-right font-medium">Total</th>
                <th className="px-3 py-2 text-left font-medium">Notes</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {payouts.map((p: CommissionPayout) => {
                const sum = payoutSummaries.get(p.id) ?? {
                  count: 0,
                  total: 0,
                }
                return (
                  <tr key={p.id} className="hover:bg-gray-50">
                    <td className="px-3 py-2 font-medium text-gray-900">
                      {p.label}
                    </td>
                    <td className="px-3 py-2 text-gray-700">{p.paid_at}</td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {sum.count}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums font-semibold">
                      {formatMYR(sum.total)}
                    </td>
                    <td className="px-3 py-2 text-gray-600">
                      {p.notes || (
                        <span className="italic text-gray-400">—</span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </section>
    </AppShell>
  )
}

function BookingMini({
  b,
  profileById,
}: {
  b: Booking
  profileById: Map<string, Profile>
}) {
  const owner = profileById.get(b.owner_id)
  return (
    <Link
      to={`/bookings/${b.id}`}
      className="min-w-0 flex-1 hover:underline"
    >
      <div className="truncate text-sm font-medium text-gray-900">
        {b.customer_name}{' '}
        <span className="font-mono text-xs text-gray-500">{b.code}</span>
      </div>
      <div className="truncate text-xs text-gray-500">
        {b.vehicle_model}
        {b.vehicle_variant ? ` · ${b.vehicle_variant}` : ''} · by{' '}
        <span className="font-medium">
          {owner?.full_name || owner?.email || '—'}
        </span>
      </div>
    </Link>
  )
}

function CommissionFigure({
  base,
  discount,
  amount,
}: {
  base: number
  discount: number
  amount: number
}) {
  return (
    <div className="shrink-0 text-right">
      <div className="text-[10px] text-gray-500">
        {formatMYR(base)} − {formatMYR(discount)}
      </div>
      <div className="tabular-nums text-sm font-semibold text-blue-700">
        {formatMYR(amount)}
      </div>
    </div>
  )
}
