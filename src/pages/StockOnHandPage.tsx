import { useMemo, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { AppShell } from '../components/AppShell'
import { Letterhead } from '../components/Letterhead'
import { useAuth } from '../lib/auth'
import { useParts } from '../lib/queries'
import { formatError } from '../lib/errors'
import { formatMYR } from '../lib/format'
import {
  PART_CATEGORY_LABEL,
  type Part,
  type PartCategory,
} from '../lib/types'

/**
 * Closing Stock Report — `/service/stock/closing`.
 *
 * Sourced live from `parts_inventory` (which is itself synced from the
 * monthly Closing_Stock XLSX — see CLAUDE.md). Columns kept lean: the
 * legacy WMS report had S/Grp + LOC + BIN + Qty Recv + Qty Issued +
 * Amt Rec + Amt Issued which we don't have movement data for; those
 * were rendered as "—" and just added noise. Trimmed 2026-05-29 to:
 *
 *   No | Group | Code | Description | Qty | Amt on Hand
 *
 * Per-category subtotals + a grand total at the bottom. "Print mode"
 * hides the AppShell so the page sends straight to a printer.
 *
 * Export: an "Excel" button downloads the current filtered view as
 * UTF-8 CSV with a BOM, so it opens cleanly in Excel-on-Windows /
 * Numbers / Google Sheets without garbled MYR digits.
 */
export function StockOnHandPage() {
  const { canAccessService } = useAuth()
  if (canAccessService === false) return <Navigate to="/" replace />

  const { data: parts, error: partsErr } = useParts()
  const [q, setQ] = useState('')
  const [printMode, setPrintMode] = useState(false)

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    let list = parts ?? []
    if (needle) {
      list = list.filter(
        (p) =>
          p.part_no.toLowerCase().includes(needle) ||
          p.name.toLowerCase().includes(needle) ||
          (p.brand ?? '').toLowerCase().includes(needle),
      )
    }
    return list
  }, [parts, q])

  const grouped = useMemo(() => {
    // OIL first, then PRT — matches the legacy XLSX ordering.
    const buckets: Record<PartCategory, Part[]> = { OIL: [], PRT: [] }
    for (const p of filtered) buckets[p.category].push(p)
    for (const k of Object.keys(buckets) as PartCategory[]) {
      buckets[k].sort((a, b) => {
        const g = (a.brand ?? '').localeCompare(b.brand ?? '')
        if (g !== 0) return g
        return a.part_no.localeCompare(b.part_no)
      })
    }
    return buckets
  }, [filtered])

  const totals = useMemo(() => {
    let qtyBal = 0
    let qtyRecv = 0
    let qtyIss = 0
    let amtOnHand = 0
    const blank = () => ({ qtyBal: 0, qtyRecv: 0, qtyIss: 0, amtOnHand: 0 })
    const perCat: Record<PartCategory, ReturnType<typeof blank>> = {
      OIL: blank(),
      PRT: blank(),
    }
    for (const p of filtered) {
      const cost = Number(p.unit_cost) || 0
      const qty = Number(p.stock_qty) || 0
      const recv = Number(p.qty_received) || 0
      const iss = Number(p.qty_issued) || 0
      const hand = qty * cost
      qtyBal += qty
      qtyRecv += recv
      qtyIss += iss
      amtOnHand += hand
      perCat[p.category].qtyBal += qty
      perCat[p.category].qtyRecv += recv
      perCat[p.category].qtyIss += iss
      perCat[p.category].amtOnHand += hand
    }
    return { qtyBal, qtyRecv, qtyIss, amtOnHand, perCat }
  }, [filtered])

  const today = new Date()
  const todayLocal = today.toLocaleDateString('en-MY', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })
  const error = partsErr ? formatError(partsErr) : null

  const content = (
    <>
      {/* On-screen toolbar — hidden when printing */}
      <div className="print:hidden mb-4 flex flex-wrap items-center justify-between gap-3">
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search part no, name, group…"
          className="w-80 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm shadow-sm outline-none focus:border-gray-900 focus:ring-2 focus:ring-gray-900/10"
        />
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() =>
              downloadCsv(
                buildCsv(grouped, totals, todayLocal),
                `closing-stock-${csvDateStamp()}.csv`,
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
          title="Closing Stock Report"
          meta={[
            ['Stock As Of:', todayLocal],
            [
              'Parts Shown:',
              `${filtered.length.toLocaleString('en-MY')} of ${(parts?.length ?? 0).toLocaleString('en-MY')}`,
            ],
          ]}
        />

        {error && (
          <div
            role="alert"
            className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
          >
            {error}
          </div>
        )}

        {/* Headline summary cards (also visible in print) */}
        <div className="mt-5 grid grid-cols-3 gap-3">
          <SummaryCard
            label="OIL"
            tone="amber"
            qty={totals.perCat.OIL.qtyBal}
            amt={totals.perCat.OIL.amtOnHand}
            count={grouped.OIL.length}
          />
          <SummaryCard
            label="PRT"
            tone="slate"
            qty={totals.perCat.PRT.qtyBal}
            amt={totals.perCat.PRT.amtOnHand}
            count={grouped.PRT.length}
          />
          <SummaryCard
            label="Total"
            tone="emerald"
            qty={totals.qtyBal}
            amt={totals.amtOnHand}
            count={filtered.length}
            emphasised
          />
        </div>

        {/* Items table */}
        <div className="mt-5 overflow-x-auto rounded-xl border border-gray-200">
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50">
              <tr className="text-[11px] uppercase tracking-wider text-gray-500">
                <th className="px-3 py-2.5 text-right font-medium">No</th>
                <th className="px-3 py-2.5 text-left font-medium">Group</th>
                <th className="px-3 py-2.5 text-left font-medium">Code</th>
                <th className="px-3 py-2.5 text-left font-medium">
                  Description
                </th>
                <th className="px-3 py-2.5 text-right font-medium">Recv</th>
                <th className="px-3 py-2.5 text-right font-medium">Issued</th>
                <th className="px-3 py-2.5 text-right font-medium">Bal</th>
                <th className="px-3 py-2.5 text-right font-medium">
                  Cost / Qty
                </th>
                <th className="px-3 py-2.5 text-right font-medium">
                  Amt on Hand (RM)
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {!parts && !error && (
                <tr>
                  <td
                    colSpan={9}
                    className="px-3 py-8 text-center text-sm text-gray-500"
                  >
                    Loading…
                  </td>
                </tr>
              )}
              {parts && filtered.length === 0 && (
                <tr>
                  <td
                    colSpan={9}
                    className="px-3 py-8 text-center text-sm text-gray-500"
                  >
                    No parts match the current filter.
                  </td>
                </tr>
              )}
              {(['OIL', 'PRT'] as PartCategory[]).flatMap((cat) => {
                const rows = grouped[cat]
                if (rows.length === 0) return []
                const head = (
                  <tr key={`head-${cat}`} className="bg-gray-100/80">
                    <td
                      colSpan={9}
                      className="px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-gray-700"
                    >
                      {PART_CATEGORY_LABEL[cat]}{' '}
                      <span className="text-gray-400">·</span>{' '}
                      <span className="font-normal text-gray-500">
                        {rows.length} items
                      </span>
                    </td>
                  </tr>
                )
                const items = rows.map((p, idx) => {
                  const cost = Number(p.unit_cost) || 0
                  const qty = Number(p.stock_qty) || 0
                  const hand = qty * cost
                  return (
                    <tr
                      key={p.id}
                      className={
                        (idx % 2 === 0 ? 'bg-white' : 'bg-gray-50/40') +
                        ' transition hover:bg-gray-100/60'
                      }
                    >
                      <td className="px-3 py-1.5 text-right tabular-nums text-gray-400">
                        {idx + 1}
                      </td>
                      <td className="px-3 py-1.5 text-gray-700">
                        {p.brand ?? (
                          <span className="text-gray-300">—</span>
                        )}
                      </td>
                      <td className="px-3 py-1.5 font-mono text-[12px] text-gray-900">
                        {p.part_no}
                      </td>
                      <td className="px-3 py-1.5 text-gray-900">{p.name}</td>
                      <td className="whitespace-nowrap px-3 py-1.5 text-right tabular-nums text-gray-600">
                        {p.qty_received || <span className="text-gray-300">—</span>}
                      </td>
                      <td className="whitespace-nowrap px-3 py-1.5 text-right tabular-nums text-gray-600">
                        {p.qty_issued || <span className="text-gray-300">—</span>}
                      </td>
                      <td className="whitespace-nowrap px-3 py-1.5 text-right tabular-nums font-medium text-gray-900">
                        {qty}
                      </td>
                      <td className="whitespace-nowrap px-3 py-1.5 text-right tabular-nums text-gray-700">
                        {cost > 0 ? formatMYR(cost) : <span className="text-gray-300">—</span>}
                      </td>
                      <td className="whitespace-nowrap px-3 py-1.5 text-right tabular-nums text-gray-900">
                        {formatMYR(hand)}
                      </td>
                    </tr>
                  )
                })
                const sub = totals.perCat[cat]
                const subTotal = (
                  <tr
                    key={`sub-${cat}`}
                    className="border-y border-gray-300 bg-gray-50"
                  >
                    <td
                      colSpan={4}
                      className="px-3 py-1.5 text-right text-[11px] font-semibold uppercase tracking-wider text-gray-700"
                    >
                      Subtotal · {PART_CATEGORY_LABEL[cat]}
                    </td>
                    <td className="whitespace-nowrap px-3 py-1.5 text-right tabular-nums font-semibold text-gray-700">
                      {sub.qtyRecv}
                    </td>
                    <td className="whitespace-nowrap px-3 py-1.5 text-right tabular-nums font-semibold text-gray-700">
                      {sub.qtyIss}
                    </td>
                    <td className="whitespace-nowrap px-3 py-1.5 text-right tabular-nums font-semibold text-gray-900">
                      {sub.qtyBal}
                    </td>
                    <td className="px-3" />
                    <td className="whitespace-nowrap px-3 py-1.5 text-right tabular-nums font-semibold text-gray-900">
                      {formatMYR(sub.amtOnHand)}
                    </td>
                  </tr>
                )
                return [head, ...items, subTotal]
              })}
              {parts && filtered.length > 0 && (
                <tr className="border-t-2 border-gray-900 bg-gray-100">
                  <td
                    colSpan={4}
                    className="px-3 py-2 text-right text-xs font-bold uppercase tracking-wider text-gray-900"
                  >
                    Grand Total
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-sm font-bold text-gray-700">
                    {totals.qtyRecv}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-sm font-bold text-gray-700">
                    {totals.qtyIss}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-sm font-bold text-gray-900">
                    {totals.qtyBal}
                  </td>
                  <td className="px-3" />
                  <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-sm font-bold text-gray-900">
                    {formatMYR(totals.amtOnHand)}
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

// ─── Bits ──────────────────────────────────────────────────────────────────

// ─── CSV export ────────────────────────────────────────────────────────────

/** Quote a field for RFC 4180 CSV: wrap in double quotes only if the value
 *  contains a comma, quote, or newline — and escape inner quotes by doubling
 *  them. Keeps numeric cells unquoted so Excel auto-types them. */
function csvField(v: string | number | null | undefined): string {
  if (v === null || v === undefined) return ''
  const s = typeof v === 'number' ? String(v) : String(v)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

type CatTotal = { qtyBal: number; qtyRecv: number; qtyIss: number; amtOnHand: number }
type Totals = {
  qtyBal: number
  qtyRecv: number
  qtyIss: number
  amtOnHand: number
  perCat: Record<PartCategory, CatTotal>
}

function buildCsv(
  grouped: Record<PartCategory, Part[]>,
  totals: Totals,
  stockAsOf: string,
): string {
  const lines: string[] = []
  lines.push(`Closing Stock Report,${csvField('Stock As Of: ' + stockAsOf)}`)
  lines.push('')
  lines.push(
    [
      'No',
      'Category',
      'Group',
      'Code',
      'Description',
      'Qty Received',
      'Qty Issued',
      'Qty Balance',
      'Cost / Qty',
      'Amt on Hand (RM)',
    ]
      .map(csvField)
      .join(','),
  )

  let runningNo = 0
  for (const cat of ['OIL', 'PRT'] as PartCategory[]) {
    const rows = grouped[cat]
    if (rows.length === 0) continue
    for (const p of rows) {
      runningNo++
      const cost = Number(p.unit_cost) || 0
      const qty = Number(p.stock_qty) || 0
      const recv = Number(p.qty_received) || 0
      const iss = Number(p.qty_issued) || 0
      const hand = qty * cost
      lines.push(
        [
          runningNo,
          cat,
          p.brand ?? '',
          p.part_no,
          p.name,
          recv,
          iss,
          qty,
          cost.toFixed(2),
          hand.toFixed(2),
        ]
          .map(csvField)
          .join(','),
      )
    }
    const sub = totals.perCat[cat]
    lines.push(
      [
        '',
        cat,
        '',
        '',
        `Subtotal · ${cat}`,
        sub.qtyRecv,
        sub.qtyIss,
        sub.qtyBal,
        '',
        sub.amtOnHand.toFixed(2),
      ]
        .map(csvField)
        .join(','),
    )
  }
  lines.push(
    [
      '',
      '',
      '',
      '',
      'Grand Total',
      totals.qtyRecv,
      totals.qtyIss,
      totals.qtyBal,
      '',
      totals.amtOnHand.toFixed(2),
    ]
      .map(csvField)
      .join(','),
  )
  return lines.join('\r\n')
}

/** Trigger a browser download for the given CSV text. Prepends a UTF-8 BOM
 *  so Excel-on-Windows reads non-ASCII characters correctly. */
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

function csvDateStamp(): string {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function SummaryCard({
  label,
  qty,
  amt,
  count,
  tone,
  emphasised,
}: {
  label: string
  qty: number
  amt: number
  count: number
  tone: 'amber' | 'slate' | 'emerald'
  emphasised?: boolean
}) {
  const toneCls =
    tone === 'amber'
      ? 'border-amber-200 bg-amber-50'
      : tone === 'slate'
        ? 'border-slate-200 bg-slate-50'
        : 'border-emerald-200 bg-emerald-50'
  const labelCls =
    tone === 'amber'
      ? 'text-amber-800'
      : tone === 'slate'
        ? 'text-slate-700'
        : 'text-emerald-800'
  return (
    <div
      className={`rounded-xl border px-4 py-3 ${toneCls} ${
        emphasised ? 'shadow-sm' : ''
      }`}
    >
      <div className="flex items-center justify-between">
        <span className={`text-[10px] font-semibold uppercase tracking-wider ${labelCls}`}>
          {label}
        </span>
        <span className="text-[10px] text-gray-500">
          {count.toLocaleString('en-MY')} items
        </span>
      </div>
      <div className="mt-1.5 flex items-end justify-between gap-2">
        <div>
          <div className="text-[10px] uppercase tracking-wide text-gray-500">
            Qty
          </div>
          <div className="text-base font-semibold tabular-nums text-gray-900">
            {qty.toLocaleString('en-MY')}
          </div>
        </div>
        <div className="text-right">
          <div className="text-[10px] uppercase tracking-wide text-gray-500">
            Amt on Hand (RM)
          </div>
          <div
            className={`text-base font-semibold tabular-nums text-gray-900 ${
              emphasised ? 'sm:text-lg' : ''
            }`}
          >
            {formatMYR(amt)}
          </div>
        </div>
      </div>
    </div>
  )
}
