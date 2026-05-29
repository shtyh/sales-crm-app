import { useEffect, useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { AppShell } from '../components/AppShell'
import { useAuth } from '../lib/auth'
import { PARTS_PAGE_SIZE, usePartsSearch } from '../lib/queries'
import { formatError } from '../lib/errors'

// ─── Parts List (read-only browser) ─────────────────────────────────────────
//
// parts_inventory is ~80k rows after the AUTFTP02 import. This page is a
// reference browser: server-side search (part_no OR name), category +
// active-only filters, 50/page pagination. Editing was rolled back on
// 2026-05-29 — every field shown here is sourced from the principal's
// catalogue and shouldn't drift from it.

export function PartsListPage() {
  const { role, loading, canAccessService } = useAuth()
  // Workshop staff (and super_admin) can read; SA bounces.
  if (canAccessService === false) return <Navigate to="/" replace />
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
  })
  const totalPages = data
    ? Math.max(1, Math.ceil(data.total / PARTS_PAGE_SIZE))
    : 1

  return (
    <AppShell>
      <div className="space-y-5">
        {/* Header */}
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold text-gray-900">Parts List</h1>
            <p className="mt-0.5 text-sm text-gray-500">
              {data ? (
                <>
                  <span className="font-medium text-gray-700">
                    {data.total.toLocaleString('en-MY')}
                  </span>{' '}
                  parts in catalogue
                </>
              ) : (
                'Loading the inventory master…'
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
            className="min-w-[18rem] flex-1 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm shadow-sm outline-none focus:border-gray-900 focus:ring-2 focus:ring-gray-900/10"
          />
          <select
            value={category}
            onChange={(e) => {
              setCategory(e.target.value as '' | 'OIL' | 'PRT')
              setPage(0)
            }}
            className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm shadow-sm"
          >
            <option value="">All categories</option>
            <option value="PRT">PRT — Parts</option>
            <option value="OIL">OIL — Oils &amp; fluids</option>
          </select>
        </div>

        {error && (
          <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
            {formatError(error)}
          </p>
        )}

        {/* Table */}
        <div className="overflow-x-auto rounded-2xl border border-gray-200 bg-white shadow-sm">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr className="text-[11px] uppercase tracking-wider text-gray-500">
                <Th>Part no</Th>
                <Th>Name</Th>
                <Th center>Cat</Th>
                <Th center>Unit</Th>
                <Th right>Price (RM)</Th>
                <Th right>Qty</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 text-sm">
              {isLoading && (
                <tr>
                  <td
                    colSpan={6}
                    className="px-3 py-6 text-center text-sm text-gray-500"
                  >
                    Loading…
                  </td>
                </tr>
              )}
              {!isLoading && data && data.rows.length === 0 && (
                <tr>
                  <td
                    colSpan={6}
                    className="px-3 py-6 text-center text-sm text-gray-500"
                  >
                    No parts match the current filter.
                  </td>
                </tr>
              )}
              {!isLoading &&
                data?.rows.map((p, i) => (
                  <tr
                    key={p.id}
                    className={
                      (i % 2 === 0 ? 'bg-white' : 'bg-gray-50/40') +
                      ' transition hover:bg-gray-100/60'
                    }
                  >
                    <td className="whitespace-nowrap px-3 py-2 font-mono text-[12px] text-gray-700">
                      {p.part_no}
                    </td>
                    <td className="px-3 py-2 text-gray-900">{p.name}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-center">
                      <CategoryBadge category={p.category} />
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-center text-gray-700">
                      {p.unit}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-gray-700">
                      {formatMoney(p.unit_price)}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-gray-700">
                      {formatQty(p.stock_qty)}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {data && data.total > 0 && (
          <div className="flex items-center justify-between gap-3 text-sm">
            <button
              type="button"
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={page === 0}
              className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium shadow-sm transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              ← Prev
            </button>
            <span className="text-xs text-gray-500">
              Page <span className="font-medium text-gray-700">{page + 1}</span>{' '}
              of{' '}
              <span className="font-medium text-gray-700">{totalPages}</span>
            </span>
            <button
              type="button"
              onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
              disabled={page >= totalPages - 1}
              className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium shadow-sm transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Next →
            </button>
          </div>
        )}
      </div>
    </AppShell>
  )
}

// ─── Bits ──────────────────────────────────────────────────────────────────

function Th({
  children,
  right,
  center,
}: {
  children: React.ReactNode
  right?: boolean
  center?: boolean
}) {
  const align = right ? 'text-right' : center ? 'text-center' : 'text-left'
  return (
    <th className={`px-3 py-2.5 font-medium ${align}`}>{children}</th>
  )
}

function CategoryBadge({ category }: { category: 'OIL' | 'PRT' }) {
  const cls =
    category === 'OIL'
      ? 'bg-amber-100 text-amber-800'
      : 'bg-slate-100 text-slate-700'
  return (
    <span
      className={`inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-medium ${cls}`}
    >
      {category}
    </span>
  )
}

function formatMoney(n: number): string {
  return n.toLocaleString('en-MY', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

function formatQty(n: number): string {
  return Number.isInteger(n) ? n.toString() : n.toLocaleString('en-MY')
}
