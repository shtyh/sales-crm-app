import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { AppShell } from '../components/AppShell'
import { useBookings, useCustomers } from '../lib/queries'
import { formatError } from '../lib/errors'

/**
 * Customers directory. Lists every customer (any authenticated user can
 * read), with search by name / NRIC / phone and a per-customer booking
 * count derived from the bookings cache.
 *
 * Clicking a row jumps to that customer's most recent booking — until we
 * build a dedicated /customers/:id page, that's the natural "drill-in"
 * (most useful info for the SA is the booking, not customer metadata).
 */
export function CustomersPage() {
  const { data: customers, error: customersErr } = useCustomers()
  const { data: bookings } = useBookings()
  const [q, setQ] = useState('')

  // Booking-count index, plus the latest booking id per customer for
  // click-through. Booking list is already sorted by booking_date desc by
  // useBookings, so the first match per customer is the most recent.
  const indexByCustomerId = useMemo(() => {
    const map = new Map<
      string,
      { count: number; latestBookingId: string | null }
    >()
    bookings?.forEach((b) => {
      if (!b.customer_id) return
      const cur = map.get(b.customer_id)
      if (cur) {
        cur.count += 1
        if (cur.latestBookingId == null) cur.latestBookingId = b.id
      } else {
        map.set(b.customer_id, { count: 1, latestBookingId: b.id })
      }
    })
    return map
  }, [bookings])

  const filtered = useMemo(() => {
    if (!customers) return undefined
    const needle = q.trim().toLowerCase()
    if (!needle) return customers
    return customers.filter((c) => {
      return (
        c.name.toLowerCase().includes(needle) ||
        c.nric.toLowerCase().includes(needle) ||
        c.phone.toLowerCase().includes(needle) ||
        (c.email ?? '').toLowerCase().includes(needle)
      )
    })
  }, [customers, q])

  const error = customersErr ? formatError(customersErr) : null

  return (
    <AppShell>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Customers</h1>
          <p className="mt-1 text-sm text-gray-500">
            {filtered && q
              ? `${filtered.length} of ${customers?.length ?? 0} shown`
              : `${customers?.length ?? 0} customers on file.`}
          </p>
        </div>
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search name, NRIC, phone…"
          className="w-full max-w-xs rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm outline-none focus:border-gray-900 focus:ring-2 focus:ring-gray-900/10"
        />
      </div>

      {error && (
        <div
          role="alert"
          className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
        >
          {error}
        </div>
      )}

      {!customers && !error && (
        <div className="rounded-2xl border border-gray-200 bg-white p-10 text-center text-sm text-gray-500">
          Loading…
        </div>
      )}

      {customers && customers.length === 0 && (
        <div className="rounded-2xl border border-dashed border-gray-300 bg-white p-10 text-center text-sm text-gray-500">
          No customers on file yet. They'll appear here once you create a
          booking.
        </div>
      )}

      {filtered && filtered.length === 0 && customers && customers.length > 0 && (
        <div className="rounded-2xl border border-dashed border-gray-300 bg-white p-10 text-center text-sm text-gray-500">
          No customers match “{q}”.
        </div>
      )}

      {filtered && filtered.length > 0 && (
        <>
          {/* Desktop table */}
          <div className="hidden overflow-hidden rounded-2xl border border-gray-200 bg-white sm:block">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead className="bg-gray-50 text-xs uppercase tracking-wider text-gray-500">
                <tr>
                  <th className="px-4 py-3 text-left font-medium">Name</th>
                  <th className="px-4 py-3 text-left font-medium">NRIC</th>
                  <th className="px-4 py-3 text-left font-medium">Phone</th>
                  <th className="px-4 py-3 text-left font-medium">Email</th>
                  <th className="px-4 py-3 text-right font-medium">Bookings</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filtered.map((c) => {
                  const ix = indexByCustomerId.get(c.id) ?? {
                    count: 0,
                    latestBookingId: null,
                  }
                  const target = ix.latestBookingId
                    ? `/bookings/${ix.latestBookingId}`
                    : null
                  const Row = (
                    <>
                      <td className="px-4 py-3 font-medium text-gray-900">
                        {c.name}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-gray-600">
                        {c.nric}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-gray-700">
                        {c.phone}
                      </td>
                      <td className="px-4 py-3 text-gray-700">
                        {c.email ?? <span className="text-gray-400">—</span>}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums text-gray-900">
                        {ix.count}
                      </td>
                    </>
                  )
                  return target ? (
                    <tr
                      key={c.id}
                      className="cursor-pointer hover:bg-gray-50"
                      onClick={() => {
                        window.location.href = target
                      }}
                    >
                      {Row}
                    </tr>
                  ) : (
                    <tr key={c.id}>{Row}</tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <ul className="space-y-3 sm:hidden">
            {filtered.map((c) => {
              const ix = indexByCustomerId.get(c.id) ?? {
                count: 0,
                latestBookingId: null,
              }
              const inner = (
                <div className="rounded-2xl border border-gray-200 bg-white p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-medium text-gray-900">{c.name}</div>
                      <div className="font-mono text-xs text-gray-500">
                        {c.nric}
                      </div>
                    </div>
                    <span className="shrink-0 rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-700">
                      {ix.count} booking{ix.count === 1 ? '' : 's'}
                    </span>
                  </div>
                  <div className="mt-2 text-xs text-gray-600">
                    📞 {c.phone}
                    {c.email && <span className="ml-2">✉ {c.email}</span>}
                  </div>
                </div>
              )
              return (
                <li key={c.id}>
                  {ix.latestBookingId ? (
                    <Link
                      to={`/bookings/${ix.latestBookingId}`}
                      className="block transition active:opacity-70"
                    >
                      {inner}
                    </Link>
                  ) : (
                    inner
                  )}
                </li>
              )
            })}
          </ul>
        </>
      )}
    </AppShell>
  )
}
