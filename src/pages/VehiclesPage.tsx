import { useMemo, useState } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { AppShell } from '../components/AppShell'
import { useAuth } from '../lib/auth'
import { useVehicles } from '../lib/queries'
import { formatError } from '../lib/errors'

/**
 * Vehicles directory — every car the workshop has on file. Matches the
 * Customers / Bookings list visual language (table on desktop, cards on
 * mobile, search above the table, count subtitle).
 *
 * Access: any signed-in non-SA role. SAs aren't gated at the DB layer
 * (vehicles_select is open), but the workshop UI is wholly outside
 * their workflow so we keep the link out of their nav.
 */
export function VehiclesPage() {
  const navigate = useNavigate()
  const { isAdmin, canAccessService } = useAuth()
  // Workshop-side directory. Sales staff bounced even if they type
  // /vehicles directly.
  if (canAccessService === false) return <Navigate to="/" replace />

  const { data: vehicles, error: vehiclesErr } = useVehicles(isAdmin)
  const [q, setQ] = useState('')

  const filtered = useMemo(() => {
    if (!vehicles) return undefined
    const needle = q.trim().toLowerCase()
    if (!needle) return vehicles
    return vehicles.filter((v) => {
      return (
        v.registration_no.toLowerCase().includes(needle) ||
        (v.chassis_no ?? '').toLowerCase().includes(needle) ||
        (v.customer?.name ?? '').toLowerCase().includes(needle) ||
        (v.customer?.nric ?? '').toLowerCase().includes(needle) ||
        (v.customer?.phone ?? '').toLowerCase().includes(needle) ||
        v.model.toLowerCase().includes(needle)
      )
    })
  }, [vehicles, q])

  const error = vehiclesErr ? formatError(vehiclesErr) : null

  return (
    <AppShell>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Vehicles</h1>
          <p className="mt-1 text-sm text-gray-500">
            {filtered && q
              ? `${filtered.length} of ${vehicles?.length ?? 0} shown`
              : `${vehicles?.length ?? 0} vehicle${vehicles?.length === 1 ? '' : 's'} on file.`}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search plate, customer, NRIC…"
            className="w-full max-w-xs rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm outline-none focus:border-gray-900 focus:ring-2 focus:ring-gray-900/10"
          />
          <Link
            to="/vehicles/new"
            className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-gray-800"
          >
            + New vehicle
          </Link>
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

      {!vehicles && !error && (
        <div className="rounded-2xl border border-gray-200 bg-white p-10 text-center text-sm text-gray-500">
          Loading…
        </div>
      )}

      {vehicles && vehicles.length === 0 && (
        <div className="rounded-2xl border border-dashed border-gray-300 bg-white p-10 text-center">
          <div className="mb-2 text-3xl">🚗</div>
          <p className="font-medium text-gray-900">No vehicles on file yet</p>
          <p className="mt-1 text-sm text-gray-500">
            Add the first one when a customer brings a car in.
          </p>
          <Link
            to="/vehicles/new"
            className="mt-4 inline-block rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800"
          >
            + New vehicle
          </Link>
        </div>
      )}

      {filtered && filtered.length === 0 && vehicles && vehicles.length > 0 && (
        <div className="rounded-2xl border border-dashed border-gray-300 bg-white p-10 text-center text-sm text-gray-500">
          No vehicles match “{q}”.
        </div>
      )}

      {filtered && filtered.length > 0 && (
        <>
          {/* Desktop table */}
          <div className="hidden overflow-hidden rounded-2xl border border-gray-200 bg-white sm:block">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead className="bg-gray-50 text-xs uppercase tracking-wider text-gray-500">
                <tr>
                  <th className="px-4 py-3 text-left font-medium">Plate</th>
                  <th className="px-4 py-3 text-left font-medium">Vehicle</th>
                  <th className="px-4 py-3 text-left font-medium">Customer</th>
                  <th className="px-4 py-3 text-right font-medium">Mileage</th>
                  <th className="px-4 py-3 text-right font-medium">Year</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filtered.map((v) => (
                  <tr
                    key={v.id}
                    onClick={() => navigate(`/vehicles/${v.id}`)}
                    className="cursor-pointer hover:bg-gray-50"
                  >
                    <td className="whitespace-nowrap px-4 py-3 font-mono font-medium text-gray-900">
                      {v.registration_no}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5">
                        <span className="text-gray-900">{v.model}</span>
                        {v.vehicle_type && (
                          <span
                            className="rounded-md bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] font-medium text-slate-700"
                            title={v.vehicle_type.name}
                          >
                            {v.vehicle_type.code}
                          </span>
                        )}
                      </div>
                      {(v.variant || v.color) && (
                        <div className="text-xs text-gray-500">
                          {v.variant}
                          {v.variant && v.color ? ' · ' : ''}
                          {v.color}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="text-gray-900">
                        {v.customer?.name ?? '—'}
                      </div>
                      {v.customer?.phone && (
                        <div className="text-xs text-gray-500">
                          {v.customer.phone}
                        </div>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums text-gray-700">
                      {v.mileage != null ? v.mileage.toLocaleString() : '—'}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums text-gray-700">
                      {v.year ?? '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <ul className="space-y-3 sm:hidden">
            {filtered.map((v) => (
              <li key={v.id}>
                <Link
                  to={`/vehicles/${v.id}`}
                  className="block rounded-2xl border border-gray-200 bg-white p-4 transition active:bg-gray-50"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="font-mono font-medium text-gray-900">
                        {v.registration_no}
                      </div>
                      <div className="text-sm text-gray-700">{v.model}</div>
                      {(v.variant || v.color) && (
                        <div className="text-xs text-gray-500">
                          {v.variant}
                          {v.variant && v.color ? ' · ' : ''}
                          {v.color}
                        </div>
                      )}
                    </div>
                    {v.year && (
                      <span className="shrink-0 rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-700">
                        {v.year}
                      </span>
                    )}
                  </div>
                  <div className="mt-2 text-xs text-gray-600">
                    👤 {v.customer?.name ?? '—'}
                    {v.customer?.phone && (
                      <span className="ml-2">📞 {v.customer.phone}</span>
                    )}
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
