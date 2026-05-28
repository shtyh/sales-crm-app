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
 * Stock On Hand / Closing Stock report — port of the legacy WMS
 * `restk-closingstk.xls`. Wired to the Stock Control tile on the
 * service dashboard.
 *
 * The legacy report has these columns:
 *   No | Group | S/Grp | Code | Description | LOC | BIN |
 *   Qty Received | Qty Issued | Qty Bal | Amt Rec | Amt Issued |
 *   Amt on Hand
 *
 * Today's parts_inventory only stores the current on-hand snapshot
 * (no movement ledger yet), so Qty Received / Qty Issued / Amt Rec /
 * Amt Issued render as `—`. Qty Bal = stock_qty; Amt on Hand =
 * stock_qty × unit_cost. Group rolls up by `category` (OIL vs PRT),
 * with a sub-total per category and a grand total at the bottom.
 *
 * Toggle "Print mode" hides the AppShell nav so the page can be sent
 * straight to a printer / saved as PDF.
 */
export function StockOnHandPage() {
  const { canAccessService } = useAuth()
  if (canAccessService === false) return <Navigate to="/" replace />

  const { data: parts, error: partsErr } = useParts()
  const [q, setQ] = useState('')
  const [includeInactive, setIncludeInactive] = useState(false)
  const [printMode, setPrintMode] = useState(false)

  const filtered = useMemo(() => {
    let list: Part[] = parts ?? []
    if (!includeInactive) list = list.filter((p) => p.is_active)
    const needle = q.trim().toLowerCase()
    if (needle) {
      list = list.filter((p) => {
        return (
          p.part_no.toLowerCase().includes(needle) ||
          p.name.toLowerCase().includes(needle) ||
          (p.brand ?? '').toLowerCase().includes(needle) ||
          (p.description ?? '').toLowerCase().includes(needle)
        )
      })
    }
    return list
  }, [parts, q, includeInactive])

  const grouped = useMemo(() => {
    // Stable order: OIL first (per the legacy report), then PRT.
    const buckets: Record<PartCategory, Part[]> = { OIL: [], PRT: [] }
    for (const p of filtered) {
      buckets[p.category].push(p)
    }
    // Sort each bucket by brand then code so the rows look like the
    // legacy report (which is ordered roughly by Group within Category).
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
    let amtOnHand = 0
    const perCat: Record<PartCategory, { qtyBal: number; amtOnHand: number }> = {
      OIL: { qtyBal: 0, amtOnHand: 0 },
      PRT: { qtyBal: 0, amtOnHand: 0 },
    }
    for (const p of filtered) {
      const cost = Number(p.unit_cost) || 0
      const qty = Number(p.stock_qty) || 0
      const hand = qty * cost
      qtyBal += qty
      amtOnHand += hand
      perCat[p.category].qtyBal += qty
      perCat[p.category].amtOnHand += hand
    }
    return { qtyBal, amtOnHand, perCat }
  }, [filtered])

  const today = new Date()
  const todayLocal = today.toLocaleDateString('en-MY')
  const todayDow = today
    .toLocaleDateString('en-US', { weekday: 'short' })
    .toUpperCase()
  const error = partsErr ? formatError(partsErr) : null

  const content = (
    <>
      {/* On-screen toolbar — hidden when printing */}
      <div className="print:hidden mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search part no, name, brand, description…"
            className="w-72 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm outline-none focus:border-gray-900 focus:ring-2 focus:ring-gray-900/10"
          />
          <label className="inline-flex items-center gap-1.5 text-xs text-gray-700">
            <input
              type="checkbox"
              checked={includeInactive}
              onChange={(e) => setIncludeInactive(e.target.checked)}
            />
            Include inactive
          </label>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setPrintMode((v) => !v)}
            className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
          >
            {printMode ? 'Exit print mode' : 'Print mode'}
          </button>
          <button
            type="button"
            onClick={() => window.print()}
            className="rounded-md bg-gray-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-gray-800"
          >
            🖨 Print
          </button>
        </div>
      </div>

      <div className="mx-auto max-w-6xl bg-white p-6 shadow-sm print:my-0 print:max-w-full print:p-0 print:shadow-none">
        <Letterhead
          title="Closing Stock — By Group"
          meta={[
            ['Page No:', '1'],
            ['Printed Date:', `${todayLocal} ${todayDow}`],
            ['Stock As Of:', todayLocal],
          ]}
        />

        {error && (
          <div
            role="alert"
            className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700"
          >
            {error}
          </div>
        )}

        {/* Items table — one block per category */}
        <table className="mt-3 w-full border-collapse text-[11px]">
          <thead className="bg-gray-50">
            <tr className="border-b border-gray-900 text-left text-gray-700">
              <th className="py-1 pr-2 font-semibold">No</th>
              <th className="py-1 pr-2 font-semibold">Group</th>
              <th className="py-1 pr-2 font-semibold">S/Grp</th>
              <th className="py-1 pr-2 font-semibold">Code</th>
              <th className="py-1 pr-2 font-semibold">Description</th>
              <th className="py-1 pr-2 font-semibold">LOC</th>
              <th className="py-1 pr-2 font-semibold">BIN</th>
              <th className="py-1 pr-2 text-right font-semibold">Qty Recv.</th>
              <th className="py-1 pr-2 text-right font-semibold">Qty Issued</th>
              <th className="py-1 pr-2 text-right font-semibold">Qty Bal</th>
              <th className="py-1 pr-2 text-right font-semibold">Amt Rec.</th>
              <th className="py-1 pr-2 text-right font-semibold">Amt Issued</th>
              <th className="py-1 pl-2 text-right font-semibold">Amt on Hand</th>
            </tr>
          </thead>
          <tbody>
            {!parts && !error && (
              <tr>
                <td
                  colSpan={13}
                  className="py-8 text-center text-sm text-gray-500"
                >
                  Loading…
                </td>
              </tr>
            )}
            {parts && filtered.length === 0 && (
              <tr>
                <td
                  colSpan={13}
                  className="py-8 text-center text-sm text-gray-500"
                >
                  No parts match the current filter.
                </td>
              </tr>
            )}
            {(['OIL', 'PRT'] as PartCategory[]).flatMap((cat) => {
              const rows = grouped[cat]
              if (rows.length === 0) return []
              const head = (
                <tr key={`head-${cat}`} className="bg-gray-100">
                  <td
                    colSpan={13}
                    className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-gray-700"
                  >
                    Category: {PART_CATEGORY_LABEL[cat]}
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
                    className={`align-top ${p.is_active ? '' : 'opacity-60'}`}
                  >
                    <td className="py-1 pr-2 tabular-nums text-gray-700">
                      {idx + 1}
                    </td>
                    <td className="py-1 pr-2 text-gray-700">
                      {p.brand ?? <span className="text-gray-300">—</span>}
                    </td>
                    <td className="py-1 pr-2 text-gray-400">—</td>
                    <td className="py-1 pr-2 font-mono text-gray-900">
                      {p.part_no}
                    </td>
                    <td className="py-1 pr-2 text-gray-900">
                      {p.name}
                      {p.description && (
                        <div className="text-[9px] text-gray-500">
                          {p.description}
                        </div>
                      )}
                    </td>
                    <td className="py-1 pr-2 text-gray-700">
                      {p.location ?? <span className="text-gray-300">—</span>}
                    </td>
                    <td className="py-1 pr-2 text-gray-300">—</td>
                    <td className="py-1 pr-2 text-right tabular-nums text-gray-300">
                      —
                    </td>
                    <td className="py-1 pr-2 text-right tabular-nums text-gray-300">
                      —
                    </td>
                    <td className="py-1 pr-2 text-right tabular-nums text-gray-900">
                      {qty}
                    </td>
                    <td className="py-1 pr-2 text-right tabular-nums text-gray-300">
                      —
                    </td>
                    <td className="py-1 pr-2 text-right tabular-nums text-gray-300">
                      —
                    </td>
                    <td className="py-1 pl-2 text-right tabular-nums text-gray-900">
                      {formatMYR(hand)}
                    </td>
                  </tr>
                )
              })
              const sub = totals.perCat[cat]
              const subTotal = (
                <tr key={`sub-${cat}`} className="border-y border-gray-300 bg-gray-50">
                  <td
                    colSpan={9}
                    className="py-1 pr-2 text-right text-[10px] font-semibold uppercase tracking-wider text-gray-700"
                  >
                    Sub Total · {PART_CATEGORY_LABEL[cat]}
                  </td>
                  <td className="py-1 pr-2 text-right tabular-nums font-semibold">
                    {sub.qtyBal}
                  </td>
                  <td className="py-1 pr-2 text-right tabular-nums text-gray-300">
                    —
                  </td>
                  <td className="py-1 pr-2 text-right tabular-nums text-gray-300">
                    —
                  </td>
                  <td className="py-1 pl-2 text-right tabular-nums font-semibold">
                    {formatMYR(sub.amtOnHand)}
                  </td>
                </tr>
              )
              return [head, ...items, subTotal]
            })}
            {parts && filtered.length > 0 && (
              <tr className="border-t-2 border-gray-900 bg-gray-100">
                <td
                  colSpan={9}
                  className="py-1.5 pr-2 text-right text-xs font-bold uppercase tracking-wider text-gray-900"
                >
                  Grand Total
                </td>
                <td className="py-1.5 pr-2 text-right tabular-nums text-sm font-bold">
                  {totals.qtyBal}
                </td>
                <td className="py-1.5 pr-2 text-right text-gray-300">—</td>
                <td className="py-1.5 pr-2 text-right text-gray-300">—</td>
                <td className="py-1.5 pl-2 text-right tabular-nums text-sm font-bold">
                  {formatMYR(totals.amtOnHand)}
                </td>
              </tr>
            )}
          </tbody>
        </table>

        <div className="mt-3 text-[10px] italic text-gray-500 print:hidden">
          Qty Received / Qty Issued / Amt Rec / Amt Issued render as `—` until
          we add a stock-movements ledger. Today's Qty Bal comes straight from
          `parts_inventory.stock_qty`; Amt on Hand = qty × unit cost.
        </div>
      </div>
    </>
  )

  if (printMode) {
    return <div className="min-h-screen bg-white px-4 py-4">{content}</div>
  }
  return <AppShell>{content}</AppShell>
}
