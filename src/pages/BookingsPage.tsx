import { useMemo, useState } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { AppShell } from '../components/AppShell'
import { useAuth } from '../lib/auth'
import { useBookings, useProfiles } from '../lib/queries'
import { formatError } from '../lib/errors'
import type { BookingStatus, Profile } from '../lib/types'

const filterInputClass =
  'rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm outline-none focus:border-gray-900 focus:ring-2 focus:ring-gray-900/10'

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
  const { isAdmin, canAccessSales } = useAuth()
  // Sales-side page: workshop-only roles (service_*, store_keeper, mechanic)
  // shouldn't see the bookings list. Bounce them to /.
  if (canAccessSales === false) return <Navigate to="/" replace />

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

  // ----- Filters --------------------------------------------------------
  // Owner filter only makes sense for admins (an SA sees only their own
  // bookings). Every other filter applies to all roles.
  const [ownerFilter, setOwnerFilter] = useState<string>('')
  const [dateFrom, setDateFrom] = useState<string>('')
  // The date range is always [From → today]; today is computed once per render
  // so a long-open tab still picks up the current day after midnight.
  const today = new Date().toISOString().slice(0, 10)
  const [statusFilter, setStatusFilter] = useState<'' | BookingStatus>('')
  const [modelFilter, setModelFilter] = useState<string>('')
  const [variantFilter, setVariantFilter] = useState<string>('')
  const [colourFilter, setColourFilter] = useState<string>('')

  // Owner dropdown options — restrict to profiles that actually own a
  // booking in the visible set so the list doesn't bloat with every user.
  const ownerOptions = useMemo(() => {
    if (!bookings || !profiles) return [] as Profile[]
    const ownerIds = new Set(bookings.map((b) => b.owner_id))
    return profiles
      .filter((p) => ownerIds.has(p.id))
      .sort((a, b) =>
        (a.full_name || a.email || '').localeCompare(
          b.full_name || b.email || '',
        ),
      )
  }, [bookings, profiles])

  // Model / variant / colour options are derived from the bookings actually
  // on screen. Variants are filtered to the selected model so the dropdown
  // doesn't suggest combinations that don't exist.
  const modelOptions = useMemo(() => {
    if (!bookings) return [] as string[]
    return Array.from(
      new Set(bookings.map((b) => b.vehicle_model).filter(Boolean)),
    ).sort()
  }, [bookings])

  const variantOptions = useMemo(() => {
    if (!bookings) return [] as string[]
    return Array.from(
      new Set(
        bookings
          .filter((b) => !modelFilter || b.vehicle_model === modelFilter)
          .map((b) => b.vehicle_variant)
          .filter(Boolean),
      ),
    ).sort()
  }, [bookings, modelFilter])

  const colourOptions = useMemo(() => {
    if (!bookings) return [] as string[]
    return Array.from(
      new Set(bookings.map((b) => b.vehicle_color).filter(Boolean)),
    ).sort()
  }, [bookings])

  const filteredBookings = useMemo(() => {
    if (!bookings) return undefined
    return bookings.filter((b) => {
      if (ownerFilter && b.owner_id !== ownerFilter) return false
      // booking_date is YYYY-MM-DD so a lexicographic compare is fine.
      // When the user picks a From date, the implicit upper bound is today —
      // we never surface future-dated bookings while a date filter is on.
      if (dateFrom) {
        if (b.booking_date < dateFrom) return false
        if (b.booking_date > today) return false
      }
      if (statusFilter && b.status !== statusFilter) return false
      if (modelFilter && b.vehicle_model !== modelFilter) return false
      if (variantFilter && b.vehicle_variant !== variantFilter) return false
      if (colourFilter && b.vehicle_color !== colourFilter) return false
      return true
    })
  }, [
    bookings,
    ownerFilter,
    dateFrom,
    today,
    statusFilter,
    modelFilter,
    variantFilter,
    colourFilter,
  ])

  const filtersActive = !!(
    ownerFilter ||
    dateFrom ||
    statusFilter ||
    modelFilter ||
    variantFilter ||
    colourFilter
  )
  function clearFilters() {
    setOwnerFilter('')
    setDateFrom('')
    setStatusFilter('')
    setModelFilter('')
    setVariantFilter('')
    setColourFilter('')
  }

  // If the user changes the model filter, the previously-selected variant
  // may no longer exist for that model; reset it to avoid an empty result.
  function handleModelChange(next: string) {
    setModelFilter(next)
    if (next && variantFilter) {
      const stillValid = bookings?.some(
        (b) => b.vehicle_model === next && b.vehicle_variant === variantFilter,
      )
      if (!stillValid) setVariantFilter('')
    }
  }

  return (
    <AppShell>
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Bookings</h1>
          <p className="mt-1 text-sm text-gray-500">
            {filtersActive && filteredBookings
              ? `${filteredBookings.length} of ${bookings?.length ?? 0} shown`
              : isAdmin
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

      {/* Filter toolbar — only render once we have at least one booking, so
          empty-state and filters don't fight for the same screen real estate. */}
      {bookings && bookings.length > 0 && (
        <div className="mb-4 flex flex-wrap items-end gap-3 rounded-xl border border-gray-200 bg-white p-3">
          {isAdmin && (
            <label className="flex flex-col gap-1 text-xs text-gray-600">
              <span className="font-medium">Sales advisor</span>
              <select
                value={ownerFilter}
                onChange={(e) => setOwnerFilter(e.target.value)}
                className={filterInputClass}
              >
                <option value="">All</option>
                {ownerOptions.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.full_name || p.email}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="flex flex-col gap-1 text-xs text-gray-600">
            <span className="font-medium">From</span>
            <input
              type="date"
              value={dateFrom}
              max={today}
              onChange={(e) => setDateFrom(e.target.value)}
              className={filterInputClass}
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-gray-600">
            <span className="font-medium">Status</span>
            <select
              value={statusFilter}
              onChange={(e) =>
                setStatusFilter(e.target.value as '' | BookingStatus)
              }
              className={filterInputClass}
            >
              <option value="">All</option>
              <option value="pending">Pending</option>
              <option value="confirmed">Confirmed</option>
              <option value="delivered">Delivered</option>
              <option value="cancelled">Cancelled</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-gray-600">
            <span className="font-medium">Model</span>
            <select
              value={modelFilter}
              onChange={(e) => handleModelChange(e.target.value)}
              className={filterInputClass}
            >
              <option value="">All</option>
              {modelOptions.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-gray-600">
            <span className="font-medium">Variant</span>
            <select
              value={variantFilter}
              onChange={(e) => setVariantFilter(e.target.value)}
              className={filterInputClass}
              disabled={variantOptions.length === 0}
            >
              <option value="">All</option>
              {variantOptions.map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-gray-600">
            <span className="font-medium">Colour</span>
            <select
              value={colourFilter}
              onChange={(e) => setColourFilter(e.target.value)}
              className={filterInputClass}
            >
              <option value="">All</option>
              {colourOptions.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
          {filtersActive && (
            <button
              type="button"
              onClick={clearFilters}
              className="self-end rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
            >
              Clear
            </button>
          )}
        </div>
      )}

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

      {bookings &&
        bookings.length > 0 &&
        filteredBookings &&
        filteredBookings.length === 0 && (
          <div className="rounded-2xl border border-dashed border-gray-300 bg-white p-10 text-center text-sm text-gray-500">
            No bookings match the current filters.
            <button
              type="button"
              onClick={clearFilters}
              className="ml-2 font-medium text-gray-900 underline-offset-2 hover:underline"
            >
              Clear filters
            </button>
          </div>
        )}

      {filteredBookings && filteredBookings.length > 0 && (
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
                {filteredBookings.map((b) => (
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
            {filteredBookings.map((b) => (
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
