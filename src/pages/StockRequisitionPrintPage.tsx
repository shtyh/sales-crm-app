import { useEffect, useMemo } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Letterhead } from '../components/Letterhead'
import {
  useCustomers,
  useServiceOrder,
  useServiceOrderItems,
  useVehicles,
} from '../lib/queries'
import { formatError } from '../lib/errors'

/**
 * Printable Material Requisition Form — 1:1 layout port of the legacy
 * WMS `jobsheetstd.xls` template. ("Stock Requisition" branch of the
 * Job Sheet Selection dialog.) Used by the store / parts counter to
 * issue stock against an open RO.
 *
 *   [letterhead]                                    [title strip]
 *   ──────────────────────────────────────────────────────────
 *   RO Date / Page No                R.Order No
 *   Customer · Tel                    Vehicle · Model · Mileage
 *   Time In / Out · Part Return?      S.Advisor · Mechanic
 *   ──────────────────────────────────────────────────────────
 *   Stock Code | Material / Description | Qty | Remark | Mechanic
 *   Material Section · Non Stock / Third Party Stock
 *   ──────────────────────────────────────────────────────────
 *   JOB REMARKS (1–7)
 *   ──────────────────────────────────────────────────────────
 *   Authorised Signature                     Taken by
 *
 * Auto-fires window.print() once layout settles.
 */
export function StockRequisitionPrintPage() {
  const { id = '' } = useParams<{ id: string }>()
  const { data: order, error: orderErr, isLoading } = useServiceOrder(id)
  const { data: items } = useServiceOrderItems(id)
  const { data: customers } = useCustomers(true)
  const { data: vehicles } = useVehicles(true)

  const customer = useMemo(
    () =>
      order?.customer_id
        ? customers?.find((c) => c.id === order.customer_id)
        : undefined,
    [order, customers],
  )
  const vehicle = useMemo(
    () =>
      order?.vehicle_id
        ? vehicles?.find((v) => v.id === order.vehicle_id)
        : undefined,
    [order, vehicles],
  )

  useEffect(() => {
    if (!order || !items) return
    const t = setTimeout(() => window.print(), 300)
    return () => clearTimeout(t)
  }, [order, items])

  if (isLoading) {
    return <div className="p-10 text-center text-sm text-gray-500">Loading…</div>
  }
  if (!order || orderErr) {
    return (
      <div className="p-10 text-center text-sm text-red-700">
        {orderErr ? formatError(orderErr) : 'Order not found.'}
      </div>
    )
  }

  const roDate = new Date(order.opened_at).toLocaleDateString('en-MY')
  const timeIn = new Date(order.opened_at).toLocaleTimeString('en-MY', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })

  return (
    <div className="min-h-screen bg-gray-100 print:bg-white">
      <div className="print:hidden border-b border-gray-200 bg-white">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-4 py-2 text-sm">
          <Link
            to={`/service/ops`}
            className="text-gray-500 hover:text-gray-700"
          >
            ← Back to job sheet
          </Link>
          <button
            type="button"
            onClick={() => window.print()}
            className="rounded-md bg-gray-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-gray-800"
          >
            🖨 Print
          </button>
        </div>
      </div>

      <div className="mx-auto my-6 max-w-4xl bg-white p-8 shadow-md print:my-0 print:max-w-full print:p-6 print:shadow-none">
        <Letterhead
          title="Material Requisition Form"
          meta={[
            ['Page No:', '1'],
            ['RO Date:', roDate],
            [
              'R.Order No:',
              <span className="font-mono">{order.order_no ?? '—'}</span>,
            ],
          ]}
        />

        {/* Top info grid */}
        <div className="mt-3 grid grid-cols-2 gap-6 border-b border-gray-300 pb-3 text-[11px] text-gray-800">
          <dl className="grid grid-cols-[120px_1fr] gap-y-0.5">
            <dt className="text-gray-500">Customer :</dt>
            <dd>{customer?.name ?? <span className="text-gray-300">—</span>}</dd>
            <dt className="text-gray-500">Tel No :</dt>
            <dd className="font-mono">
              {customer?.phone ?? <span className="text-gray-300">—</span>}
            </dd>
            <dt className="text-gray-500">Time In :</dt>
            <dd className="tabular-nums">{timeIn}</dd>
            <dt className="text-gray-500">Time Out :</dt>
            <dd className="text-gray-300">—</dd>
            <dt className="text-gray-500">Part Return? :</dt>
            <dd>Yes &nbsp;/&nbsp; No</dd>
          </dl>
          <dl className="grid grid-cols-[120px_1fr] gap-y-0.5">
            <dt className="text-gray-500">Vehicle No :</dt>
            <dd className="font-mono">{vehicle?.registration_no ?? '—'}</dd>
            <dt className="text-gray-500">Model :</dt>
            <dd>{vehicle?.model ?? <span className="text-gray-300">—</span>}</dd>
            <dt className="text-gray-500">Mileage :</dt>
            <dd>
              {order.mileage_in != null
                ? `${Number(order.mileage_in).toLocaleString('en-US')} KM`
                : <span className="text-gray-300">—</span>}
            </dd>
            <dt className="text-gray-500">S.Advisor :</dt>
            <dd className="text-gray-300">—</dd>
            <dt className="text-gray-500">Mechanic :</dt>
            <dd>—</dd>
          </dl>
        </div>

        {/* Items table */}
        <table className="mt-3 w-full border-collapse text-[11px]">
          <thead>
            <tr className="border-b border-gray-900 text-left text-gray-700">
              <th className="py-1 pr-2 font-semibold">Stock Code</th>
              <th className="py-1 pr-2 font-semibold">Material / Description</th>
              <th className="py-1 pr-2 text-right font-semibold">Qty</th>
              <th className="py-1 pr-2 font-semibold">Remark</th>
              <th className="py-1 pl-2 font-semibold">Mechanic</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td
                colSpan={5}
                className="pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-gray-500"
              >
                Material Section
              </td>
            </tr>
            {(items ?? []).filter((i) => i.kind === 'part').length === 0 ? (
              <tr>
                <td colSpan={5} className="py-4 text-center text-gray-400 italic">
                  No parts requisitioned.
                </td>
              </tr>
            ) : (
              (items ?? [])
                .filter((i) => i.kind === 'part')
                .map((it) => (
                  <tr key={it.id} className="align-top">
                    <td className="py-1 pr-2 font-mono text-gray-700">
                      {/* Stock code = parts_inventory.part_no; not joined */}
                      {it.part_id
                        ? <span className="text-gray-700">—</span>
                        : <span className="text-gray-400">Non Stock</span>}
                    </td>
                    <td className="py-1 pr-2 text-gray-900">
                      {it.description ?? '—'}
                    </td>
                    <td className="py-1 pr-2 text-right tabular-nums">
                      {Number(it.quantity ?? 0)}
                    </td>
                    <td className="py-1 pr-2 text-gray-700">—</td>
                    <td className="py-1 pl-2 text-gray-300">—</td>
                  </tr>
                ))
            )}
            {/* Visual pad so the remarks block doesn't crowd a short list */}
            <tr>
              <td colSpan={5} className="h-32 border-b border-gray-200" />
            </tr>
          </tbody>
        </table>

        {/* Job remarks */}
        <div className="mt-3 text-[11px]">
          <div className="font-semibold uppercase tracking-wider text-gray-700">
            Job Remarks
          </div>
          <ol className="mt-1 list-decimal pl-5 text-gray-800">
            {(order.complaint ?? '')
              .split(/\r?\n/)
              .filter(Boolean)
              .slice(0, 7)
              .map((line, i) => (
                <li key={i}>{line}</li>
              ))}
            {!order.complaint && <li className="list-none text-gray-300">—</li>}
          </ol>
        </div>

        {/* Signatures */}
        <div className="mt-12 grid grid-cols-2 gap-8 text-[11px] text-gray-800">
          <div className="border-t border-gray-700 pt-1 text-center">
            Authorised Signature
          </div>
          <div className="border-t border-gray-700 pt-1 text-center">
            Taken by
          </div>
        </div>
      </div>
    </div>
  )
}
