import { useMemo, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { AppShell } from '../components/AppShell'
import { Letterhead } from '../components/Letterhead'
import { useAuth } from '../lib/auth'
import { useStockIssued } from '../lib/queries'
import { formatError } from '../lib/errors'
import { formatMYR } from '../lib/format'
import type { StockIssuedRow } from '../lib/types'

/**
 * Stock Issued List — `/service/stock/issued`.
 *
 * Port of the legacy WMS "Stock Issued List" report. Lists every part-issue
 * transaction (a `service_order_items` row with kind='part') in a date range,
 * sourced via the `stock_issued_list` RPC (server-side join to the job for
 * date + bill no, and to the part master for code / group). Flat list (no
 * sub-group grouping — we don't store the legacy SubGroup), Amount = the
 * line's selling total. Grand total + Excel export + print mode.
 *
 * NB: this fills in once the service-history import lands; until then
 * `service_order_items` is near-empty so the report shows little/nothing.
 */
type SortKey = 'product' | 'job'

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate(),
  ).padStart(2, '0')}`
}

function fmtDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('en-MY', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  })
}

export function StockIssuedListPage() {
  const { canAccessService } = useAuth()
  if (canAccessService === false) return <Navigate to="/" replace />

  const now = new Date()
  const [from, setFrom] = useState(
    ymd(new Date(now.getFullYear(), now.getMonth(), 1)),
  )
  const [to, setTo] = useState(ymd(now))
  const [sortBy, setSortBy] = useState<SortKey>('product')
  const [q, setQ] = useState('')
  const [printMode, setPrintMode] = useState(false)

  const { data: rows, error, isLoading } = useStockIssued(from, to)

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    let list = (rows ?? []).slice()
    if (needle) {
      list = list.filter(
        (r) =>
          r.part_no.toLowerCase().includes(needle) ||
          (r.part_name ?? '').toLowerCase().includes(needle) ||
          (r.order_no ?? '').toLowerCase().includes(needle),
      )
    }
    list.sort((a, b) => {
      if (sortBy === 'job') {
        const j = (a.order_no ?? '').localeCompare(b.order_no ?? '')
        return j !== 0 ? j : a.issued_at.localeCompare(b.issued_at)
      }
      const p = a.part_no.localeCompare(b.part_no)
      return p !== 0 ? p : a.issued_at.localeCompare(b.issued_at)
    })
    return list
  }, [rows, q, sortBy])

  const totals = useMemo(() => {
    let qty = 0
    let amt = 0
    for (const r of filtered) {
      qty += Number(r.qty) || 0
      amt += Number(r.amount) || 0
    }
    return { qty, amt, count: filtered.length }
  }, [filtered])

  const err = error ? formatError(error) : null

  const content = (
    <>
      {/* On-screen toolbar — hidden when printing */}
      <div className="print:hidden mb-4 flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-xs font-medium text-gray-600">
            <span className="mb-1 block">Date from</span>
            <input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-sm shadow-sm outline-none focus:border-gray-900 focus:ring-2 focus:ring-gray-900/10"
            />
          </label>
          <label className="text-xs font-medium text-gray-600">
            <span className="mb-1 block">Date to</span>
            <input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-sm shadow-sm outline-none focus:border-gray-900 focus:ring-2 focus:ring-gray-900/10"
            />
          </label>
          <label className="text-xs font-medium text-gray-600">
            <span className="mb-1 block">Sort by</span>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as SortKey)}
              className="rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-sm shadow-sm outline-none focus:border-gray-900 focus:ring-2 focus:ring-gray-900/10"
            >
              <option value="product">Product (part code)</option>
              <option value="job">Job / Bill no</option>
            </select>
          </label>
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search part no, name, job no…"
            className="w-64 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm shadow-sm outline-none focus:border-gray-900 focus:ring-2 focus:ring-gray-900/10"
          />
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() =>
              downloadCsv(
                buildCsv(filtered, totals, from, to),
                `stock-issued-${from}_${to}.csv`,
              )
            }
            className="rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-800 shadow-sm hover:bg-emerald-100"
          >
            📊 Export Excel
          </button>
          <button
            type="button"
            onClick={() => setPrintMode((v) => !v)}
            className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 shadow-sm hover:bg-gray-50"
          >
            {printMode ? 'Exit print mode' : 'Print mode'}
          </button>
          <button
            type="button"
            onClick={() => window.print()}
            className="rounded-lg bg-gray-900 px-3 py-1.5 text-xs font-medium text-white shadow-sm hover:bg-gray-800"
          >
            🖨 Print / PDF
          </button>
        </div>
      </div>

      <div className="mx-auto max-w-5xl rounded-2xl border border-gray-200 bg-white p-6 shadow-sm print:my-0 print:max-w-full print:rounded-none print:border-0 print:p-0 print:shadow-none">
        <Letterhead
          title="Stock Issued List"
          meta={[
            ['Period:', `${fmtDate(from)} — ${fmtDate(to)}`],
            ['Transactions:', totals.count.toLocaleString('en-MY')],
          ]}
        />

        {err && (
          <div
            role="alert"
            className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
          >
            {err}
          </div>
        )}

        <div className="mt-5 overflow-x-auto rounded-xl border border-gray-200">
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50">
              <tr className="text-[11px] uppercase tracking-wider text-gray-500">
                <th className="px-3 py-2.5 text-right font-medium">No</th>
                <th className="px-3 py-2.5 text-left font-medium">Date</th>
                <th className="px-3 py-2.5 text-left font-medium">Type</th>
                <th className="px-3 py-2.5 text-left font-medium">Job / Bill</th>
                <th className="px-3 py-2.5 text-left font-medium">Group</th>
                <th className="px-3 py-2.5 text-left font-medium">Code</th>
                <th className="px-3 py-2.5 text-left font-medium">
                  Description
                </th>
                <th className="px-3 py-2.5 text-right font-medium">Qty</th>
                <th className="px-3 py-2.5 text-right font-medium">
                  Amt Issued (RM)
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {isLoading && (
                <tr>
                  <td
                    colSpan={9}
                    className="px-3 py-8 text-center text-sm text-gray-500"
                  >
                    Loading…
                  </td>
                </tr>
              )}
              {!isLoading && filtered.length === 0 && (
                <tr>
                  <td
                    colSpan={9}
                    className="px-3 py-8 text-center text-sm text-gray-500"
                  >
                    No stock issued in this date range.
                  </td>
                </tr>
              )}
              {filtered.map((r, idx) => (
                <tr
                  key={`${r.order_no}-${r.part_no}-${r.issued_at}-${idx}`}
                  className={
                    (idx % 2 === 0 ? 'bg-white' : 'bg-gray-50/40') +
                    ' transition hover:bg-gray-100/60'
                  }
                >
                  <td className="px-3 py-1.5 text-right tabular-nums text-gray-400">
                    {idx + 1}
                  </td>
                  <td className="whitespace-nowrap px-3 py-1.5 text-gray-700">
                    {fmtDate(r.issued_at)}
                  </td>
                  <td className="px-3 py-1.5 text-gray-500">ISU</td>
                  <td className="whitespace-nowrap px-3 py-1.5 font-mono text-[12px] text-gray-700">
                    {r.order_no ?? <span className="text-gray-300">—</span>}
                  </td>
                  <td className="px-3 py-1.5 text-gray-600">
                    {r.brand ?? <span className="text-gray-300">—</span>}
                  </td>
                  <td className="whitespace-nowrap px-3 py-1.5 font-mono text-[12px] text-gray-900">
                    {r.part_no}
                  </td>
                  <td className="px-3 py-1.5 text-gray-900">
                    {r.part_name ?? '—'}
                  </td>
                  <td className="whitespace-nowrap px-3 py-1.5 text-right tabular-nums font-medium text-gray-900">
                    {Number(r.qty) || 0}
                  </td>
                  <td className="whitespace-nowrap px-3 py-1.5 text-right tabular-nums text-gray-900">
                    {formatMYR(Number(r.amount) || 0)}
                  </td>
                </tr>
              ))}
              {filtered.length > 0 && (
                <tr className="border-t-2 border-gray-900 bg-gray-100">
                  <td
                    colSpan={7}
                    className="px-3 py-2 text-right text-xs font-bold uppercase tracking-wider text-gray-900"
                  >
                    Grand Total · {totals.count.toLocaleString('en-MY')} lines
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-sm font-bold text-gray-900">
                    {totals.qty.toLocaleString('en-MY')}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-sm font-bold text-gray-900">
                    {formatMYR(totals.amt)}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  )

  if (printMode) {
    return <div className="min-h-screen bg-white px-4 py-4">{content}</div>
  }
  return <AppShell>{content}</AppShell>
}

// ─── CSV export ────────────────────────────────────────────────────────────

function csvField(v: string | number | null | undefined): string {
  if (v === null || v === undefined) return ''
  const s = String(v)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

function buildCsv(
  rows: StockIssuedRow[],
  totals: { qty: number; amt: number; count: number },
  from: string,
  to: string,
): string {
  const lines: string[] = []
  lines.push(`Stock Issued List,${csvField(`Period: ${from} to ${to}`)}`)
  lines.push('')
  lines.push(
    [
      'No',
      'Date',
      'Type',
      'Job / Bill',
      'Group',
      'Code',
      'Description',
      'Qty',
      'Amt Issued (RM)',
    ]
      .map(csvField)
      .join(','),
  )
  rows.forEach((r, i) => {
    lines.push(
      [
        i + 1,
        fmtDate(r.issued_at),
        'ISU',
        r.order_no ?? '',
        r.brand ?? '',
        r.part_no,
        r.part_name ?? '',
        Number(r.qty) || 0,
        (Number(r.amount) || 0).toFixed(2),
      ]
        .map(csvField)
        .join(','),
    )
  })
  lines.push(
    [
      '',
      '',
      '',
      '',
      '',
      '',
      `Grand Total (${totals.count} lines)`,
      totals.qty,
      totals.amt.toFixed(2),
    ]
      .map(csvField)
      .join(','),
  )
  return lines.join('\r\n')
}

function downloadCsv(csv: string, filename: string): void {
  const BOM = '﻿'
  const blob = new Blob([BOM + csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
