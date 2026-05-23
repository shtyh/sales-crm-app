import { useMemo } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { AppShell } from '../components/AppShell'
import { useAuth } from '../lib/auth'
import { useBookings, useProfiles } from '../lib/queries'
import { formatError } from '../lib/errors'
import type { BookingStatus, Profile } from '../lib/types'

const STATUS_STYLES: Record<BookingStatus, string> = {
  pending: 'bg-amber-100 text-amber-800',
  confirmed: 'bg-blue-100 text-blue-800',
  delivered: 'bg-green-100 text-green-800',
  cancelled: 'bg-gray-100 text-gray-600',
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-MY', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })
}

export function BookingsPage() {
  const navigate = useNavigate()
  const { isAdmin } = useAuth()

  const { data: bookings, error: bookingsErr } = useBookings()
  // Only admins use the owner column → only admins need the profile lookup.
  const { data: profiles, error: profilesErr } = useProfiles(isAdmin)
  const error =
    bookingsErr || profilesErr
      ? formatError(bookingsErr ?? profilesErr)
      : null

  const profileById = useMemo(() => {
    const m = new Map<string, Profile>()
    profiles?.forEach((p) => m.set(p.id, p))
    return m
  }, [profiles])

  function ownerDisplay(ownerId: string) {
    const p = profileById.get(ownerId)
    return p?.full_name || p?.email || '—'
  }

  return (
    <AppShell>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Bookings</h1>
          <p className="mt-1 text-sm text-gray-500">
            {isAdmin
              ? 'All bookings across the team.'
              : "All bookings you've created."}
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

      {!bookings && !error && (
        <div className="rounded-2xl border border-gray-200 bg-white p-10 text-center text-sm text-gray-500">
          Loading…
        </div>
      )}

      {bookings && bookings.length === 0 && (
        <div className="rounded-2xl border border-dashed border-gray-300 bg-white p-10 text-center">
          <div className="mb-2 text-3xl">📋</div>
          <p className="font-medium text-gray-900">No bookings yet</p>
          <p className="mt-1 text-sm text-gray-500">
            Create your first booking to get started.
          </p>
          <Link
            to="/bookings/new"
            className="mt-4 inline-block rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800"
          >
            + New booking
          </Link>
        </div>
      )}

      {bookings && bookings.length > 0 && (
        <>
          {/* Desktop table */}
          <div className="hidden overflow-hidden rounded-2xl border border-gray-200 bg-white sm:block">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead className="bg-gray-50 text-xs uppercase tracking-wider text-gray-500">
                <tr>
                  <th className="px-4 py-3 text-left font-medium">Code</th>
                  <th className="px-4 py-3 text-left font-medium">Customer</th>
                  <th className="px-4 py-3 text-left font-medium">Vehicle</th>
                  <th className="px-4 py-3 text-left font-medium">Status</th>
                  {isAdmin && (
                    <th className="px-4 py-3 text-left font-medium">Owner</th>
                  )}
                  <th className="px-4 py-3 text-left font-medium">Date</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {bookings.map((b) => (
                  <tr
                    key={b.id}
                    onClick={() => navigate(`/bookings/${b.id}`)}
                    className="cursor-pointer hover:bg-gray-50"
                  >
                    <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-gray-600">
                      {b.code}
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-medium text-gray-900">
                        {b.customer_name}
                      </div>
                      <div className="text-xs text-gray-500">
                        {b.customer_phone}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="text-gray-900">{b.vehicle_model}</div>
                      {b.vehicle_variant && (
                        <div className="text-xs text-gray-500">
                          {b.vehicle_variant}
                          {b.vehicle_color ? ` · ${b.vehicle_color}` : ''}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[b.status]}`}
                      >
                        {b.status}
                      </span>
                    </td>
                    {isAdmin && (
                      <td className="whitespace-nowrap px-4 py-3 text-gray-700">
                        {ownerDisplay(b.owner_id)}
                      </td>
                    )}
                    <td className="whitespace-nowrap px-4 py-3 text-gray-600">
                      {formatDate(b.booking_date)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <ul className="space-y-3 sm:hidden">
            {bookings.map((b) => (
              <li key={b.id}>
                <Link
                  to={`/bookings/${b.id}`}
                  className="block rounded-2xl border border-gray-200 bg-white p-4 transition active:bg-gray-50"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="font-medium text-gray-900">
                        {b.customer_name}
                      </div>
                      <div className="text-xs text-gray-500">
                        {b.customer_phone}
                      </div>
                    </div>
                    <span
                      className={`inline-flex shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[b.status]}`}
                    >
                      {b.status}
                    </span>
                  </div>
                  <div className="mt-3">
                    <div className="text-sm text-gray-900">
                      {b.vehicle_model}
                      {b.vehicle_variant ? ` · ${b.vehicle_variant}` : ''}
                    </div>
                    <div className="text-xs text-gray-500">
                      {b.code} · {formatDate(b.booking_date)}
                      {isAdmin && (
                        <>
                          {' '}· by {ownerDisplay(b.owner_id)}
                        </>
                      )}
                    </div>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </AppShell>
  )
}
