import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { AppShell } from '../components/AppShell'
import { useAuth } from '../lib/auth'
import { useCars } from '../lib/queries'
import { formatError } from '../lib/errors'
import { formatMYR } from '../lib/format'
import {
  CAR_STATUS_LABEL,
  FLOOR_STOCK_LABEL,
  type CarStatus,
  type FloorStockStatus,
} from '../lib/types'

const CAR_STATUS_BADGE: Record<CarStatus, string> = {
  in_stock: 'bg-gray-100 text-gray-700',
  reserved: 'bg-amber-100 text-amber-800',
  delivered: 'bg-green-100 text-green-800',
  returned: 'bg-red-100 text-red-700',
}

const FS_BADGE: Record<FloorStockStatus, string> = {
  locked: 'bg-rose-100 text-rose-800',
  pending_settlement: 'bg-amber-100 text-amber-800',
  overdue: 'bg-red-200 text-red-900',
  paid_off: 'bg-green-100 text-green-800',
}

export function CarsPage() {
  const navigate = useNavigate()
  const { canEditCarAttributes } = useAuth()
  const { data: cars, error: carsErr } = useCars()
  const [filter, setFilter] = useState<'all' | CarStatus>('all')

  const filtered = useMemo(
    () =>
      filter === 'all'
        ? cars ?? []
        : (cars ?? []).filter((c) => c.status === filter),
    [cars, filter],
  )

  const error = carsErr ? formatError(carsErr) : null

  return (
    <AppShell>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Inventory</h1>
          <p className="mt-1 text-sm text-gray-500">
            {cars?.length ?? 0} car{cars?.length === 1 ? '' : 's'} on file.
          </p>
        </div>
        {canEditCarAttributes && (
          <Link
            to="/cars/new"
            className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-gray-800"
          >
            + New car
          </Link>
        )}
      </div>

      {/* Status filter chips */}
      <div className="mb-4 flex flex-wrap gap-2">
        {(['all', 'in_stock', 'reserved', 'delivered', 'returned'] as const).map(
          (s) => (
            <button
              key={s}
              type="button"
              onClick={() => setFilter(s)}
              className={`rounded-full px-3 py-1 text-xs font-medium transition ${
                filter === s
                  ? 'bg-gray-900 text-white'
                  : 'bg-white text-gray-700 ring-1 ring-gray-200 hover:bg-gray-50'
              }`}
            >
              {s === 'all' ? 'All' : CAR_STATUS_LABEL[s]}
            </button>
          ),
        )}
      </div>

      {error && (
        <div
          role="alert"
          className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
        >
          {error}
        </div>
      )}

      {!cars && !error && (
        <div className="rounded-2xl border border-gray-200 bg-white p-10 text-center text-sm text-gray-500">
          Loading…
        </div>
      )}

      {cars && filtered.length === 0 && (
        <div className="rounded-2xl border border-dashed border-gray-300 bg-white p-10 text-center">
          <div className="mb-2 text-3xl">🚗</div>
          <p className="font-medium text-gray-900">
            {filter === 'all' ? 'No cars yet' : 'No cars in this status'}
          </p>
        </div>
      )}

      {filtered.length > 0 && (
        <>
          {/* Desktop table */}
          <div className="hidden overflow-hidden rounded-2xl border border-gray-200 bg-white sm:block">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead className="bg-gray-50 text-xs uppercase tracking-wider text-gray-500">
                <tr>
                  <th className="px-4 py-3 text-left font-medium">Chassis</th>
                  <th className="px-4 py-3 text-left font-medium">Vehicle</th>
                  <th className="px-4 py-3 text-left font-medium">Arrived</th>
                  <th className="px-4 py-3 text-left font-medium">Status</th>
                  <th className="px-4 py-3 text-left font-medium">
                    Floor stock
                  </th>
                  <th className="px-4 py-3 text-right font-medium">
                    Financed
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filtered.map((c) => (
                  <tr
                    key={c.id}
                    onClick={() => navigate(`/cars/${c.id}`)}
                    className="cursor-pointer hover:bg-gray-50"
                  >
                    <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-gray-600">
                      {c.chassis_no}
                    </td>
                    <td className="px-4 py-3">
                      <div className="text-gray-900">{c.model}</div>
                      {(c.variant || c.color) && (
                        <div className="text-xs text-gray-500">
                          {c.variant}
                          {c.variant && c.color ? ' · ' : ''}
                          {c.color}
                        </div>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-gray-600">
                      {c.arrived_at}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${CAR_STATUS_BADGE[c.status]}`}
                      >
                        {CAR_STATUS_LABEL[c.status]}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${FS_BADGE[c.floor_stock_status]}`}
                      >
                        {FLOOR_STOCK_LABEL[c.floor_stock_status]}
                      </span>
                      {c.floor_stock_due &&
                        c.floor_stock_status !== 'paid_off' && (
                          <div className="mt-0.5 text-[10px] text-gray-500">
                            due {c.floor_stock_due}
                          </div>
                        )}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums text-gray-900">
                      {c.financed_amount != null
                        ? formatMYR(Number(c.financed_amount))
                        : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <ul className="space-y-3 sm:hidden">
            {filtered.map((c) => (
              <li key={c.id}>
                <Link
                  to={`/cars/${c.id}`}
                  className="block rounded-2xl border border-gray-200 bg-white p-4 active:bg-gray-50"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate font-medium text-gray-900">
                        {c.model}
                        {c.variant ? ` · ${c.variant}` : ''}
                      </div>
                      <div className="font-mono text-xs text-gray-500">
                        {c.chassis_no}
                      </div>
                    </div>
                    <span
                      className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${CAR_STATUS_BADGE[c.status]}`}
                    >
                      {CAR_STATUS_LABEL[c.status]}
                    </span>
                  </div>
                  <div className="mt-3 flex items-center justify-between gap-2">
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ${FS_BADGE[c.floor_stock_status]}`}
                    >
                      {FLOOR_STOCK_LABEL[c.floor_stock_status]}
                    </span>
                    <span className="tabular-nums text-sm text-gray-900">
                      {c.financed_amount != null
                        ? formatMYR(Number(c.financed_amount))
                        : '—'}
                    </span>
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
