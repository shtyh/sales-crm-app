import { useMemo, useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { AppShell } from '../components/AppShell'
import { useAuth } from '../lib/auth'
import { useSuppliers } from '../lib/queries'
import { formatError } from '../lib/errors'
import type { Supplier } from '../lib/types'

// ─── Supplier directory ────────────────────────────────────────────────────
//
// Read-only listing of the suppliers table imported from AUTFDV01.csv.
// Picked from the Inquiry Hub. Search filters client-side because we only
// hold ~25 rows; if it grows past a few hundred, swap in server-side.

export function SuppliersInquiryPage() {
  const { canAccessService } = useAuth()
  if (canAccessService === false) return <Navigate to="/" replace />

  const { data: suppliers, error } = useSuppliers()
  const [q, setQ] = useState('')
  const [openId, setOpenId] = useState<string | null>(null)

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    if (!needle) return suppliers ?? []
    return (suppliers ?? []).filter(
      (s) =>
        s.code.toLowerCase().includes(needle) ||
        s.name.toLowerCase().includes(needle) ||
        (s.person ?? '').toLowerCase().includes(needle) ||
        (s.phone ?? '').toLowerCase().includes(needle),
    )
  }, [suppliers, q])

  return (
    <AppShell>
      <div className="space-y-4">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold text-gray-900">
              Vendor / Supplier
            </h1>
            <p className="mt-0.5 text-sm text-gray-500">
              {suppliers ? (
                <>
                  <span className="font-medium text-gray-700">
                    {filtered.length}
                  </span>{' '}
                  of {suppliers.length} suppliers
                </>
              ) : (
                'Loading…'
              )}
            </p>
          </div>
          <Link
            to="/service/inquiry"
            className="text-xs text-gray-500 underline-offset-2 hover:text-gray-900 hover:underline"
          >
            ← Back to Inquiry
          </Link>
        </header>

        <input
          type="search"
          placeholder="Search code / name / contact…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="w-full max-w-md rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm shadow-sm outline-none focus:border-gray-900 focus:ring-2 focus:ring-gray-900/10"
        />

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
                <th className="px-3 py-2.5 text-left font-medium">Contact</th>
                <th className="px-3 py-2.5 text-left font-medium">Phone</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {!suppliers && (
                <tr>
                  <td
                    colSpan={4}
                    className="px-3 py-6 text-center text-xs text-gray-500"
                  >
                    Loading…
                  </td>
                </tr>
              )}
              {suppliers && filtered.length === 0 && (
                <tr>
                  <td
                    colSpan={4}
                    className="px-3 py-6 text-center text-xs text-gray-500"
                  >
                    No suppliers match.
                  </td>
                </tr>
              )}
              {filtered.flatMap((s) => {
                const isOpen = openId === s.id
                const row = (
                  <tr
                    key={s.id}
                    onClick={() => setOpenId(isOpen ? null : s.id)}
                    className={
                      'cursor-pointer transition hover:bg-gray-50/60 ' +
                      (isOpen ? 'bg-gray-50/80' : '')
                    }
                  >
                    <td className="px-3 py-2 font-mono text-[12px] text-gray-700">
                      {s.code}
                    </td>
                    <td className="px-3 py-2 text-gray-900">{s.name}</td>
                    <td className="px-3 py-2 text-gray-700">
                      {s.person ?? <span className="text-gray-300">—</span>}
                    </td>
                    <td className="px-3 py-2 text-gray-700">
                      {s.phone ?? <span className="text-gray-300">—</span>}
                    </td>
                  </tr>
                )
                if (!isOpen) return [row]
                return [row, <DetailRow key={s.id + '-detail'} supplier={s} />]
              })}
            </tbody>
          </table>
        </div>
      </div>
    </AppShell>
  )
}

function DetailRow({ supplier: s }: { supplier: Supplier }) {
  const addr = [s.address_line1, s.address_line2, s.address_line3]
    .filter(Boolean)
    .join(', ')
  return (
    <tr className="bg-gray-50/60">
      <td colSpan={4} className="px-3 py-3">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <KV label="Address">
            <span className="text-sm text-gray-800">
              {addr || <span className="text-gray-400">—</span>}
              {s.postcode ? ` ${s.postcode}` : ''}
            </span>
          </KV>
          <KV label="Email">{s.email ?? '—'}</KV>
          <KV label="Phone 2">{s.phone2 ?? '—'}</KV>
          <KV label="Fax">{s.fax ?? '—'}</KV>
          <KV label="GST No">{s.gst_no ?? '—'}</KV>
          <KV label="TIN No">{s.tin_no ?? '—'}</KV>
          <KV label="MSIC Code">{s.msic_code ?? '—'}</KV>
          <KV label="Activity">{s.biz_activity ?? '—'}</KV>
        </div>
      </td>
    </tr>
  )
}

function KV({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white px-3 py-2">
      <div className="text-[10px] font-medium uppercase tracking-wide text-gray-500">
        {label}
      </div>
      <div className="mt-0.5 text-sm text-gray-900">{children}</div>
    </div>
  )
}
