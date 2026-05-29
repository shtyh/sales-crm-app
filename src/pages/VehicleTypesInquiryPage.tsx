import { useMemo, useState, type FormEvent } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { AppShell } from '../components/AppShell'
import { useAuth } from '../lib/auth'
import { useCreateVehicleType, useVehicleTypes } from '../lib/queries'
import { formatError } from '../lib/errors'

// ─── Vehicle Type directory ────────────────────────────────────────────────
//
// Read-only browse + add for the legacy WMS vehicle/model master imported
// from AUTFDV02.csv. Each row also shows how many workshop vehicles
// (vehicles table) match the type by name (case-insensitive bidirectional
// substring) — a rough "in-shop count" hint without a schema FK.

const inputClass =
  'w-full rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm shadow-sm outline-none focus:border-gray-900 focus:ring-2 focus:ring-gray-900/10'
const labelClass = 'text-[10px] font-medium uppercase tracking-wide text-gray-500'

export function VehicleTypesInquiryPage() {
  const { canAccessService, role } = useAuth()
  if (canAccessService === false) return <Navigate to="/" replace />

  const canAdd = role !== 'sales_advisor'
  const { data: types, error } = useVehicleTypes()
  const [q, setQ] = useState('')
  const [pcFilter, setPcFilter] = useState<'' | 'BW' | 'CCS'>('')
  const [addOpen, setAddOpen] = useState(false)

  const filtered = useMemo(() => {
    let list = types ?? []
    if (pcFilter) list = list.filter((t) => t.profit_center === pcFilter)
    const needle = q.trim().toLowerCase()
    if (needle) {
      list = list.filter(
        (t) =>
          t.code.toLowerCase().includes(needle) ||
          t.name.toLowerCase().includes(needle),
      )
    }
    return list
  }, [types, q, pcFilter])

  const total = types?.length ?? 0

  return (
    <AppShell>
      <div className="space-y-4">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold text-gray-900">
              Vehicle Type
            </h1>
            <p className="mt-0.5 text-sm text-gray-500">
              {types ? (
                <>
                  <span className="font-medium text-gray-700">
                    {filtered.length}
                  </span>{' '}
                  of {total} model variants
                </>
              ) : (
                'Loading…'
              )}
            </p>
          </div>
          <div className="flex items-center gap-3">
            {canAdd && (
              <button
                type="button"
                onClick={() => setAddOpen((v) => !v)}
                className="rounded-lg bg-gray-900 px-3 py-1.5 text-sm font-medium text-white shadow-sm hover:bg-gray-800"
              >
                {addOpen ? 'Cancel' : '+ New vehicle type'}
              </button>
            )}
            <Link
              to="/service/inquiry"
              className="text-xs text-gray-500 underline-offset-2 hover:text-gray-900 hover:underline"
            >
              ← Back to Inquiry
            </Link>
          </div>
        </header>

        {addOpen && (
          <AddVehicleTypeForm
            onCreated={() => setAddOpen(false)}
            onCancel={() => setAddOpen(false)}
          />
        )}

        <div className="flex flex-wrap items-center gap-2">
          <input
            type="search"
            placeholder="Search code / name…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="min-w-[18rem] flex-1 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm shadow-sm outline-none focus:border-gray-900 focus:ring-2 focus:ring-gray-900/10"
          />
          <select
            value={pcFilter}
            onChange={(e) => setPcFilter(e.target.value as '' | 'BW' | 'CCS')}
            className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm shadow-sm"
          >
            <option value="">All profit centers</option>
            <option value="BW">BW</option>
            <option value="CCS">CCS</option>
          </select>
        </div>

        {error && (
          <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
            {formatError(error)}
          </p>
        )}

        <div className="overflow-x-auto rounded-2xl border border-gray-200 bg-white shadow-sm">
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50">
              <tr className="text-[11px] uppercase tracking-wider text-gray-500">
                <th className="px-3 py-2.5 text-left font-medium">Code</th>
                <th className="px-3 py-2.5 text-left font-medium">Name</th>
                <th className="px-3 py-2.5 text-center font-medium">PC</th>
                <th
                  className="px-3 py-2.5 text-right font-medium"
                  title="Workshop vehicles whose model matches this type's name"
                >
                  In shop
                </th>
                <th className="px-3 py-2.5 text-left font-medium">
                  Legacy modified
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {!types && (
                <tr>
                  <td
                    colSpan={5}
                    className="px-3 py-6 text-center text-xs text-gray-500"
                  >
                    Loading…
                  </td>
                </tr>
              )}
              {types && filtered.length === 0 && (
                <tr>
                  <td
                    colSpan={5}
                    className="px-3 py-6 text-center text-xs text-gray-500"
                  >
                    No vehicle types match.
                  </td>
                </tr>
              )}
              {filtered.map((t, i) => (
                <tr
                  key={t.id}
                  className={
                    i % 2 === 0
                      ? 'bg-white hover:bg-gray-50/60'
                      : 'bg-gray-50/40 hover:bg-gray-100/60'
                  }
                >
                  <td className="px-3 py-1.5 font-mono text-[12px] text-gray-700">
                    {t.code}
                  </td>
                  <td className="px-3 py-1.5 text-gray-900">{t.name}</td>
                  <td className="px-3 py-1.5 text-center">
                    {t.profit_center ? (
                      <span className="inline-flex items-center rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-700">
                        {t.profit_center}
                      </span>
                    ) : (
                      <span className="text-gray-300">—</span>
                    )}
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-gray-700">
                    {t.vehicle_count > 0 ? (
                      <Link
                        to={`/vehicles?model=${encodeURIComponent(t.name)}`}
                        className="font-medium text-gray-900 hover:underline"
                      >
                        {t.vehicle_count}
                      </Link>
                    ) : (
                      <span className="text-gray-300">0</span>
                    )}
                  </td>
                  <td className="px-3 py-1.5 text-gray-500">
                    {t.legacy_modified ?? (
                      <span className="text-gray-300">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </AppShell>
  )
}

// ─── New vehicle type form ─────────────────────────────────────────────────

function AddVehicleTypeForm({
  onCreated,
  onCancel,
}: {
  onCreated: () => void
  onCancel: () => void
}) {
  const create = useCreateVehicleType()
  const [code, setCode] = useState('')
  const [name, setName] = useState('')
  const [pc, setPc] = useState<'' | 'BW' | 'CCS'>('')
  const [err, setErr] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setErr(null)
    setMsg(null)
    if (!code.trim()) return setErr('Code is required.')
    if (!name.trim()) return setErr('Name is required.')
    try {
      const created = await create.mutateAsync({
        code,
        name,
        profit_center: pc || null,
      })
      setMsg(`Saved ${created.code} · ${created.name}.`)
      setCode('')
      setName('')
      setPc('')
      setTimeout(onCreated, 600)
    } catch (e2) {
      const raw =
        e2 && typeof e2 === 'object'
          ? ((e2 as { code?: string; message?: string }).code ?? '') +
            ' ' +
            ((e2 as { message?: string }).message ?? '')
          : ''
      if (raw.includes('vehicle_types_code_key') || raw.includes('23505')) {
        setErr(`Code "${code}" already exists.`)
      } else {
        setErr(formatError(e2))
      }
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="space-y-3 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm"
    >
      <div>
        <h2 className="text-sm font-semibold text-gray-900">
          New vehicle type
        </h2>
        <p className="mt-0.5 text-xs text-gray-500">
          Code + Name are required.
        </p>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-6">
        <div className="sm:col-span-2">
          <label className={labelClass}>Code *</label>
          <input
            required
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="e.g. SAGA22A"
            className={inputClass + ' mt-1 font-mono'}
          />
        </div>
        <div className="sm:col-span-3">
          <label className={labelClass}>Name *</label>
          <input
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. SAGA 1.3 STANDARD CVT (2022)"
            className={inputClass + ' mt-1'}
          />
        </div>
        <div>
          <label className={labelClass}>Profit center</label>
          <select
            value={pc}
            onChange={(e) => setPc(e.target.value as '' | 'BW' | 'CCS')}
            className={inputClass + ' mt-1'}
          >
            <option value="">—</option>
            <option value="BW">BW</option>
            <option value="CCS">CCS</option>
          </select>
        </div>
      </div>

      {err && (
        <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {err}
        </p>
      )}
      {msg && (
        <p className="rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700">
          {msg}
        </p>
      )}

      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          disabled={create.isPending}
          className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={create.isPending}
          className="rounded-lg bg-gray-900 px-4 py-1.5 text-sm font-medium text-white shadow-sm hover:bg-gray-800 disabled:opacity-50"
        >
          {create.isPending ? 'Saving…' : 'Save'}
        </button>
      </div>
    </form>
  )
}
