import { useMemo, useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { AppShell } from '../components/AppShell'
import { useAuth } from '../lib/auth'
import { useReceiptItems, useStockReceipts } from '../lib/queries'
import { formatError } from '../lib/errors'
import { formatMYR } from '../lib/format'
import type { StockReceiptRow } from '../lib/types'

// ─── Stock Purchase History ────────────────────────────────────────────────
//
// Browse every receipt booked in via the Stock Received module. Click a
// row to expand the line items. Search matches DO / invoice / supplier
// / receipt no.

export function StockPurchaseHistoryPage() {
  const { canAccessService } = useAuth()
  if (canAccessService === false) return <Navigate to="/" replace />

  // Fetch the most recent 200 — workshop-scale, fine without pagination.
  const { data: receipts, error } = useStockReceipts(200)
  const [q, setQ] = useState('')
  const [openId, setOpenId] = useState<string | null>(null)

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    if (!needle) return receipts ?? []
    return (receipts ?? []).filter((r) => {
      const fields = [
        String(r.receipt_no),
        r.receipt_date,
        r.do_no ?? '',
        r.invoice_no ?? '',
        r.supplier_code ?? '',
        r.supplier_name ?? '',
      ]
      return fields.some((f) => f.toLowerCase().includes(needle))
    })
  }, [receipts, q])

  const totals = useMemo(() => {
    let qty = 0
    let cost = 0
    for (const r of filtered) {
      qty += Number(r.total_qty) || 0
      cost += Number(r.total_cost) || 0
    }
    return { qty, cost, count: filtered.length }
  }, [filtered])

  return (
    <AppShell>
      <div className="space-y-4">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold text-gray-900">
              Stock Purchase History
            </h1>
            <p className="mt-0.5 text-sm text-gray-500">
              {receipts ? (
                <>
                  <span className="font-medium text-gray-700">
                    {totals.count}
                  </span>{' '}
                  receipts · {totals.qty.toLocaleString('en-MY')} units ·{' '}
                  RM {formatMYR(totals.cost)}
                </>
              ) : (
                'Loading…'
              )}
            </p>
          </div>
          <div className="flex gap-3">
            <Link
              to="/service/stock/receive"
              className="text-xs text-gray-500 underline-offset-2 hover:text-gray-900 hover:underline"
            >
              + New receipt
            </Link>
            <Link
              to="/service/inquiry"
              className="text-xs text-gray-500 underline-offset-2 hover:text-gray-900 hover:underline"
            >
              ← Back to Inquiry
            </Link>
          </div>
        </header>

        <input
          type="search"
          placeholder="Search DO, invoice no, supplier, receipt #…"
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
                <th className="px-3 py-2.5 text-right font-medium">Receipt</th>
                <th className="px-3 py-2.5 text-left font-medium">Date</th>
                <th className="px-3 py-2.5 text-left font-medium">Supplier</th>
                <th className="px-3 py-2.5 text-left font-medium">DO No</th>
                <th className="px-3 py-2.5 text-left font-medium">Invoice</th>
                <th className="px-3 py-2.5 text-right font-medium">Items</th>
                <th className="px-3 py-2.5 text-right font-medium">Qty</th>
                <th className="px-3 py-2.5 text-right font-medium">
                  Total (RM)
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {!receipts && (
                <tr>
                  <td
                    colSpan={8}
                    className="px-3 py-6 text-center text-xs text-gray-500"
                  >
                    Loading…
                  </td>
                </tr>
              )}
              {receipts && filtered.length === 0 && (
                <tr>
                  <td
                    colSpan={8}
                    className="px-3 py-6 text-center text-xs text-gray-500"
                  >
                    No receipts match.
                  </td>
                </tr>
              )}
              {filtered.flatMap((r) => {
                const isOpen = openId === r.id
                const row = (
                  <tr
                    key={r.id}
                    onClick={() => setOpenId(isOpen ? null : r.id)}
                    className={
                      'cursor-pointer transition hover:bg-gray-50/60 ' +
                      (isOpen ? 'bg-gray-50/80' : '')
                    }
                  >
                    <td className="px-3 py-2 text-right tabular-nums text-gray-700">
                      #{r.receipt_no}
                    </td>
                    <td className="px-3 py-2 text-gray-900">
                      {r.receipt_date}
                    </td>
                    <td className="px-3 py-2 text-gray-700">
                      {r.supplier_name ? (
                        <>
                          <span className="font-mono text-[11px] text-gray-500">
                            {r.supplier_code}
                          </span>{' '}
                          {r.supplier_name}
                        </>
                      ) : (
                        <span className="text-gray-400">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2 font-mono text-[11px] text-gray-700">
                      {r.do_no || <span className="text-gray-300">—</span>}
                    </td>
                    <td className="px-3 py-2 text-gray-700">
                      {r.invoice_no || (
                        <span className="text-gray-300">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-gray-700">
                      {r.item_count}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-gray-700">
                      {Number(r.total_qty)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums font-medium text-gray-900">
                      {formatMYR(Number(r.total_cost))}
                    </td>
                  </tr>
                )
                if (!isOpen) return [row]
                return [
                  row,
                  <ItemsRow key={r.id + '-items'} receipt={r} />,
                ]
              })}
            </tbody>
          </table>
        </div>
      </div>
    </AppShell>
  )
}

function ItemsRow({ receipt }: { receipt: StockReceiptRow }) {
  const { data: items, isLoading } = useReceiptItems(receipt.id)
  return (
    <tr className="bg-gray-50/60">
      <td colSpan={8} className="px-3 py-3">
        <div className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">
          Items received
          {receipt.remarks ? (
            <span className="ml-2 font-normal normal-case text-gray-600">
              · {receipt.remarks}
            </span>
          ) : null}
        </div>
        <div className="mt-2 overflow-x-auto rounded-lg border border-gray-200 bg-white">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 text-[10px] uppercase tracking-wider text-gray-500">
              <tr>
                <th className="px-3 py-1.5 text-left font-medium">Part no</th>
                <th className="px-3 py-1.5 text-left font-medium">Name</th>
                <th className="px-3 py-1.5 text-right font-medium">Qty</th>
                <th className="px-3 py-1.5 text-right font-medium">
                  Unit cost
                </th>
                <th className="px-3 py-1.5 text-right font-medium">
                  Line total
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {isLoading && (
                <tr>
                  <td
                    colSpan={5}
                    className="px-3 py-3 text-center text-xs text-gray-500"
                  >
                    Loading…
                  </td>
                </tr>
              )}
              {items?.length === 0 && !isLoading && (
                <tr>
                  <td
                    colSpan={5}
                    className="px-3 py-3 text-center text-xs text-gray-400"
                  >
                    (Empty receipt)
                  </td>
                </tr>
              )}
              {items?.map((i) => (
                <tr key={i.id}>
                  <td className="px-3 py-1 font-mono text-[12px] text-gray-700">
                    {i.part_no}
                  </td>
                  <td className="px-3 py-1 text-gray-900">{i.part_name}</td>
                  <td className="px-3 py-1 text-right tabular-nums text-gray-700">
                    {Number(i.qty)}
                  </td>
                  <td className="px-3 py-1 text-right tabular-nums text-gray-700">
                    {formatMYR(Number(i.unit_cost))}
                  </td>
                  <td className="px-3 py-1 text-right tabular-nums font-medium text-gray-900">
                    {formatMYR(Number(i.line_total))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </td>
    </tr>
  )
}
