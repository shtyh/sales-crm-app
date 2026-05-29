import { useEffect, useRef, useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { AppShell } from '../components/AppShell'
import { useAuth } from '../lib/auth'
import {
  PARTS_PAGE_SIZE,
  usePartsSearch,
  useUpdatePart,
  type PartPatch,
} from '../lib/queries'
import { formatError } from '../lib/errors'
import type { Part } from '../lib/types'

// ─── Inline editable Parts List ─────────────────────────────────────────────
//
// 80k+ rows in `parts_inventory` after the AUTFTP02 import. The page does
// server-side search (part_no OR name) + 50/page pagination + cell-level
// inline editing. Every cell save invalidates the cache so totals on the
// Stock Menu stay accurate.

const inputClass =
  'rounded border border-gray-300 bg-white px-2 py-1 text-xs outline-none focus:border-gray-900 focus:ring-1 focus:ring-gray-900/20'

export function PartsListPage() {
  const { role, isAdmin, loading, canAccessService } = useAuth()
  // Workshop staff (non-SA) can write per parts_inventory RLS.
  if (canAccessService === false) return <Navigate to="/" replace />
  // Sales-only roles bounce.
  if (role && role === 'sales_advisor') return <Navigate to="/" replace />
  if (loading && role == null) {
    return (
      <AppShell>
        <p className="p-6 text-sm text-gray-500">Loading…</p>
      </AppShell>
    )
  }

  // Filters (server-driven).
  const [qInput, setQInput] = useState('')
  const [q, setQ] = useState('')
  const [category, setCategory] = useState<'' | 'OIL' | 'PRT'>('')
  const [activeOnly, setActiveOnly] = useState(false)
  const [page, setPage] = useState(0)

  // Debounce typing so we don't spam Supabase on every keystroke.
  useEffect(() => {
    const id = setTimeout(() => {
      setQ(qInput)
      setPage(0)
    }, 250)
    return () => clearTimeout(id)
  }, [qInput])

  const { data, isLoading, error } = usePartsSearch({
    q,
    page,
    category,
    activeOnly,
  })
  const totalPages = data ? Math.max(1, Math.ceil(data.total / PARTS_PAGE_SIZE)) : 1

  return (
    <AppShell>
      <div className="space-y-4">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold text-gray-900">Parts List</h1>
            <p className="mt-0.5 text-sm text-gray-500">
              Browse and edit the inventory master. Click any cell to update;
              changes save when the cell loses focus.
              {data && (
                <>
                  {' '}
                  <span className="text-gray-700">
                    {data.total.toLocaleString('en-MY')} parts
                  </span>{' '}
                  matching the current filter.
                </>
              )}
            </p>
          </div>
          <Link
            to="/service/stock"
            className="text-xs text-gray-500 underline-offset-2 hover:text-gray-900 hover:underline"
          >
            ← Back to Stock Menu
          </Link>
        </header>

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-2">
          <input
            placeholder="Search by part no or name…"
            value={qInput}
            onChange={(e) => setQInput(e.target.value)}
            className="min-w-[18rem] flex-1 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm outline-none focus:border-gray-900 focus:ring-2 focus:ring-gray-900/10"
          />
          <select
            value={category}
            onChange={(e) => {
              setCategory(e.target.value as '' | 'OIL' | 'PRT')
              setPage(0)
            }}
            className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm"
          >
            <option value="">All categories</option>
            <option value="PRT">PRT</option>
            <option value="OIL">OIL</option>
          </select>
          <label className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700">
            <input
              type="checkbox"
              checked={activeOnly}
              onChange={(e) => {
                setActiveOnly(e.target.checked)
                setPage(0)
              }}
            />
            Active only
          </label>
        </div>

        {error && (
          <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
            {formatError(error)}
          </p>
        )}

        {/* Table */}
        <div className="overflow-x-auto rounded-2xl border border-gray-200 bg-white shadow-sm">
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
              <tr>
                <Th>Part no</Th>
                <Th>Name</Th>
                <Th>Brand</Th>
                <Th>Cat</Th>
                <Th>Unit</Th>
                <Th right>Cost</Th>
                <Th right>Price</Th>
                <Th right>On hand</Th>
                <Th right>Reorder</Th>
                <Th>Location</Th>
                <Th>Active</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {isLoading && (
                <tr>
                  <td colSpan={11} className="px-3 py-6 text-center text-xs text-gray-500">
                    Loading…
                  </td>
                </tr>
              )}
              {!isLoading && data && data.rows.length === 0 && (
                <tr>
                  <td colSpan={11} className="px-3 py-6 text-center text-xs text-gray-500">
                    No parts match the current filter.
                  </td>
                </tr>
              )}
              {!isLoading &&
                data?.rows.map((p) => (
                  <PartRow key={p.id} part={p} disabled={!isAdmin} />
                ))}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        <div className="flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            disabled={page === 0}
            className="rounded-lg border border-gray-300 bg-white px-3 py-1 text-xs disabled:opacity-50"
          >
            ← Prev
          </button>
          <span className="text-xs text-gray-500">
            Page {page + 1} of {totalPages}
          </span>
          <button
            type="button"
            onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
            disabled={page >= totalPages - 1}
            className="rounded-lg border border-gray-300 bg-white px-3 py-1 text-xs disabled:opacity-50"
          >
            Next →
          </button>
        </div>
      </div>
    </AppShell>
  )
}

// ─── Row component ─────────────────────────────────────────────────────────

function PartRow({ part, disabled }: { part: Part; disabled: boolean }) {
  const update = useUpdatePart()
  const [error, setError] = useState<string | null>(null)

  function save(patch: PartPatch) {
    setError(null)
    update.mutate(
      { id: part.id, patch },
      {
        onError: (err) => setError(formatError(err)),
      },
    )
  }

  return (
    <tr className="hover:bg-gray-50/60">
      <td className="whitespace-nowrap px-2 py-1 font-mono text-[11px] text-gray-700">
        {part.part_no}
      </td>
      <Cell
        value={part.name}
        disabled={disabled}
        onSave={(v) => save({ name: v })}
        className="min-w-[14rem]"
      />
      <Cell
        value={part.brand ?? ''}
        disabled={disabled}
        onSave={(v) => save({ brand: v || null })}
      />
      <SelectCell
        value={part.category}
        disabled={disabled}
        options={['PRT', 'OIL']}
        onSave={(v) => save({ category: v as 'OIL' | 'PRT' })}
      />
      <Cell
        value={part.unit}
        disabled={disabled}
        onSave={(v) => save({ unit: v || 'PC' })}
      />
      <NumberCell
        value={part.unit_cost}
        disabled={disabled}
        onSave={(v) => save({ unit_cost: v })}
        money
      />
      <NumberCell
        value={part.unit_price}
        disabled={disabled}
        onSave={(v) => save({ unit_price: v })}
        money
      />
      <NumberCell
        value={part.stock_qty}
        disabled={disabled}
        onSave={(v) => save({ stock_qty: v })}
      />
      <NumberCell
        value={part.reorder_level}
        disabled={disabled}
        onSave={(v) => save({ reorder_level: v })}
      />
      <Cell
        value={part.location ?? ''}
        disabled={disabled}
        onSave={(v) => save({ location: v || null })}
      />
      <td className="whitespace-nowrap px-2 py-1 text-center">
        <input
          type="checkbox"
          checked={part.is_active}
          disabled={disabled}
          onChange={(e) => save({ is_active: e.target.checked })}
        />
      </td>
      {error && (
        <td colSpan={11} className="px-2 py-1 text-[10px] text-rose-700">
          {error}
        </td>
      )}
    </tr>
  )
}

// ─── Editable cells ────────────────────────────────────────────────────────

function Cell({
  value,
  disabled,
  onSave,
  className,
}: {
  value: string
  disabled: boolean
  onSave: (v: string) => void
  className?: string
}) {
  const [v, setV] = useState(value)
  const initial = useRef(value)
  useEffect(() => {
    setV(value)
    initial.current = value
  }, [value])

  return (
    <td className={`px-2 py-1 ${className ?? ''}`}>
      <input
        type="text"
        value={v}
        disabled={disabled}
        onChange={(e) => setV(e.target.value)}
        onBlur={() => {
          if (v !== initial.current) {
            initial.current = v
            onSave(v)
          }
        }}
        className={inputClass + ' w-full'}
      />
    </td>
  )
}

function NumberCell({
  value,
  disabled,
  onSave,
  money,
}: {
  value: number
  disabled: boolean
  onSave: (v: number) => void
  money?: boolean
}) {
  const [v, setV] = useState(String(value))
  const initial = useRef(value)
  useEffect(() => {
    setV(String(value))
    initial.current = value
  }, [value])

  return (
    <td className="px-2 py-1 text-right tabular-nums">
      <input
        type="number"
        inputMode="decimal"
        step={money ? '0.01' : '1'}
        min={0}
        value={v}
        disabled={disabled}
        onChange={(e) => setV(e.target.value)}
        onBlur={() => {
          const n = Number(v)
          if (Number.isFinite(n) && n >= 0 && n !== initial.current) {
            initial.current = n
            onSave(n)
          } else if (!Number.isFinite(n) || n < 0) {
            setV(String(initial.current))
          }
        }}
        className={inputClass + ' w-20 text-right'}
      />
    </td>
  )
}

function SelectCell({
  value,
  disabled,
  options,
  onSave,
}: {
  value: string
  disabled: boolean
  options: string[]
  onSave: (v: string) => void
}) {
  return (
    <td className="px-2 py-1">
      <select
        value={value}
        disabled={disabled}
        onChange={(e) => onSave(e.target.value)}
        className={inputClass}
      >
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </td>
  )
}

function Th({
  children,
  right,
}: {
  children: React.ReactNode
  right?: boolean
}) {
  return (
    <th
      className={`px-2 py-2 ${right ? 'text-right' : 'text-left'} font-medium`}
    >
      {children}
    </th>
  )
}

