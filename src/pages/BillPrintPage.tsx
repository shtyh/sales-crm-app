import { useEffect, useMemo } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import {
  useCustomers,
  useServiceOrder,
  useServiceOrderItems,
  useVehicles,
} from '../lib/queries'
import { Letterhead } from '../components/Letterhead'
import { formatError } from '../lib/errors'
import { formatMYR } from '../lib/format'
import { SST_LABOUR_LABEL, labourSST } from '../lib/tax'

/**
 * Printable cash bill / invoice — 1:1 layout port of the legacy WMS
 * cashbill.xls template the workshop has been printing since the
 * dBase / VB6 days. Sectioned exactly as the legacy:
 *
 *   [company letterhead]      [Invoice / Cash Bill title + meta]
 *   ───────────────────────────────────────────────────────────
 *   A/c Code · Name             Vehicle No · Chassis · Engine
 *                               Car Model · Reg.Date · Mileage
 *                               TIN No · Currency
 *   ───────────────────────────────────────────────────────────
 *   Job No · Date · Job Type · Mechanic · S.Advisor
 *   ───────────────────────────────────────────────────────────
 *   Item | Description | Qty | U/Price | Dis (%) | Amount | Tax | Total
 *   ───────────────────────────────────────────────────────────
 *   Next Service Date / KM           SubTotal / Service Tax /
 *                                    Total Payable
 *   ───────────────────────────────────────────────────────────
 *   ACKNOWLEDGEMENT / Signature line
 *
 * Routed at `/service-orders/:id/bill`. URL params (used to flex the
 * title strip):
 *   ?type=cash               → "Cash Bill"
 *   ?type=invoice            → "Invoice"             (default)
 *   ?type=cash-distribution  → "Cash Bill"           (legacy default)
 *   ?type=invoice-distribution
 *                            → "Invoice"
 *   ?type=delivery-order     → "Delivery Order"
 *   ?type=service-coupon     → "Service Coupon Bill"
 *
 * Optional `?no=CD002449` overrides the printed bill number; legacy
 * WMS auto-generates this client-side. Until our service-side billing
 * ledger lands we fall back to the service-order `order_no`.
 *
 * Auto-fires window.print() once layout settles so "click Print →
 * paper" is one round-trip.
 */

type BillingType =
  | 'cash'
  | 'invoice'
  | 'cash-distribution'
  | 'invoice-distribution'
  | 'delivery-order'
  | 'service-coupon'

const TITLE_FOR: Record<BillingType, string> = {
  cash: 'Cash Bill',
  invoice: 'Invoice',
  'cash-distribution': 'Cash Bill',
  'invoice-distribution': 'Invoice',
  'delivery-order': 'Delivery Order',
  'service-coupon': 'Service Coupon Bill',
}

export function BillPrintPage() {
  const { id = '' } = useParams<{ id: string }>()
  const [params] = useSearchParams()
  const billingType = (params.get('type') ?? 'cash-distribution') as BillingType
  const overrideNo = params.get('no')
  const remark = params.get('remark') ?? ''
  const days = params.get('days') ?? '0'
  const time = params.get('time') ?? ''
  const nextDate = params.get('nextDate') ?? ''
  const nextKm = params.get('nextKm') ?? ''

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

  const totals = useMemo(() => {
    let subtotal = 0
    let tax = 0
    for (const it of items ?? []) {
      const amt = Number(it.line_total) || 0
      subtotal += amt
      if (it.kind === 'labour') tax += labourSST(amt)
    }
    return { subtotal, tax, total: subtotal + tax }
  }, [items])

  useEffect(() => {
    if (!order || !items) return
    const t = setTimeout(() => window.print(), 300)
    return () => clearTimeout(t)
  }, [order, items])

  if (isLoading) {
    return (
      <div className="p-10 text-center text-sm text-gray-500">
        Loading bill…
      </div>
    )
  }
  if (!order || orderErr) {
    return (
      <div className="p-10 text-center text-sm text-red-700">
        {orderErr ? formatError(orderErr) : 'Order not found.'}
      </div>
    )
  }

  const today = new Date()
  const todayLocal = today.toLocaleDateString('en-MY')
  const todayDow = today.toLocaleDateString('en-US', { weekday: 'short' }).toUpperCase()
  const jobDate = new Date(order.opened_at).toLocaleDateString('en-MY')
  const title = TITLE_FOR[billingType]
  const billNo = overrideNo || order.order_no || '—'

  return (
    <div className="min-h-screen bg-gray-100 print:bg-white">
      {/* ---------- on-screen toolbar (hidden when printing) ---------- */}
      <div className="print:hidden border-b border-gray-200 bg-white">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-4 py-2 text-sm">
          <Link
            to={`/service-orders/${id}/billing`}
            className="text-gray-500 hover:text-gray-700"
          >
            ← Back to billing
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

      {/* ---------- The bill sheet ---------- */}
      <div className="mx-auto my-6 max-w-4xl bg-white p-8 shadow-md print:my-0 print:max-w-full print:p-6 print:shadow-none">
        {/* Header strip */}
        <Letterhead
          title={title}
          meta={[
            ['Page No:', '1'],
            [
              billingType === 'invoice' ||
              billingType === 'invoice-distribution'
                ? 'Invoice No:'
                : 'Bill No:',
              <span className="font-mono">{billNo}</span>,
            ],
            [
              billingType === 'invoice' ||
              billingType === 'invoice-distribution'
                ? 'Invoice Date:'
                : 'Bill Date:',
              `${todayLocal} ${todayDow}`,
            ],
          ]}
        />

        {/* Account + Vehicle block */}
        <div className="mt-3 grid grid-cols-2 gap-6 text-[11px] text-gray-800">
          <dl className="grid grid-cols-[110px_1fr] gap-y-0.5">
            <dt className="text-gray-500">A/c Code :</dt>
            <dd className="font-mono">
              {vehicle?.account_no || (customer ? '' : 'CASH')}
            </dd>
            <dt className="text-gray-500">Name :</dt>
            <dd>{customer?.name ?? '—'}</dd>
            <dt className="text-gray-500">Address :</dt>
            <dd className="whitespace-pre-wrap">
              {customer?.address ?? <span className="text-gray-300">—</span>}
            </dd>
            <dt className="text-gray-500">Phone :</dt>
            <dd className="font-mono">{customer?.phone ?? '—'}</dd>
            <dt className="text-gray-500">TIN No :</dt>
            <dd className="font-mono">
              {customer?.tin_no ?? <span className="text-gray-300">—</span>}
            </dd>
            <dt className="text-gray-500">Currency :</dt>
            <dd>MYR</dd>
          </dl>
          <dl className="grid grid-cols-[120px_1fr] gap-y-0.5">
            <dt className="text-gray-500">Vehicle No :</dt>
            <dd className="font-mono">{vehicle?.registration_no ?? '—'}</dd>
            <dt className="text-gray-500">Chassis No :</dt>
            <dd className="font-mono">
              {vehicle?.chassis_no ?? <span className="text-gray-300">—</span>}
            </dd>
            <dt className="text-gray-500">Engine No :</dt>
            <dd className="font-mono">
              {vehicle?.engine_no ?? <span className="text-gray-300">—</span>}
            </dd>
            <dt className="text-gray-500">Car Model :</dt>
            <dd>{vehicle?.model ?? '—'}</dd>
            <dt className="text-gray-500">Reg. Date :</dt>
            <dd>
              {vehicle?.registration_date
                ? new Date(vehicle.registration_date).toLocaleDateString('en-MY')
                : <span className="text-gray-300">—</span>}
            </dd>
            <dt className="text-gray-500">Mileage :</dt>
            <dd>
              {order.mileage_in != null
                ? `${Number(order.mileage_in).toLocaleString('en-US')} KM`
                : <span className="text-gray-300">—</span>}
            </dd>
          </dl>
        </div>

        {/* Job meta strip */}
        <div className="mt-3 grid grid-cols-3 gap-x-6 border-y border-gray-300 py-2 text-[11px] text-gray-800">
          <div>
            <span className="text-gray-500">Job No :</span>{' '}
            <span className="font-mono">{order.order_no ?? '—'}</span>
          </div>
          <div>
            <span className="text-gray-500">Job Date :</span> {jobDate}
          </div>
          <div>
            <span className="text-gray-500">Date Printed :</span> {todayLocal}
          </div>
          <div>
            <span className="text-gray-500">Mechanic :</span>{' '}
            {/* technician fk lives on the service_order; not joined here */}
            <span className="text-gray-400">—</span>
          </div>
          <div>
            <span className="text-gray-500">S.Advisor :</span>{' '}
            <span className="text-gray-400">—</span>
          </div>
          <div>
            <span className="text-gray-500">Days Completed :</span> {days}
          </div>
          {time && (
            <div>
              <span className="text-gray-500">Time Completed :</span> {time}
            </div>
          )}
        </div>

        {/* Items table */}
        <table className="mt-4 w-full border-collapse text-[11px]">
          <thead>
            <tr className="border-b border-gray-900 text-left text-gray-700">
              <th className="py-1 pr-2 font-semibold">Item</th>
              <th className="py-1 pr-2 font-semibold">Description</th>
              <th className="py-1 pr-2 text-right font-semibold">Qty</th>
              <th className="py-1 pr-2 font-semibold">Unit</th>
              <th className="py-1 pr-2 text-right font-semibold">U/Price</th>
              <th className="py-1 pr-2 text-right font-semibold">Dis (%)</th>
              <th className="py-1 pr-2 text-right font-semibold">Amount</th>
              <th className="py-1 text-right font-semibold">Tax</th>
              <th className="py-1 pl-2 text-right font-semibold">Total (RM)</th>
            </tr>
          </thead>
          <tbody>
            {(items ?? []).length === 0 ? (
              <tr>
                <td
                  colSpan={9}
                  className="py-6 text-center text-gray-400 italic"
                >
                  No line items billed.
                </td>
              </tr>
            ) : (
              (items ?? []).map((it, idx) => {
                const amt = Number(it.line_total) || 0
                const tax = it.kind === 'labour' ? labourSST(amt) : 0
                return (
                  <tr key={it.id} className="align-top">
                    <td className="py-1 pr-2 text-gray-700 tabular-nums">
                      {idx + 1}
                    </td>
                    <td className="py-1 pr-2 text-gray-900">
                      <div>{it.description ?? '—'}</div>
                      <div className="text-[9px] uppercase tracking-wider text-gray-400">
                        {it.kind === 'labour' ? 'Labour' : 'Material'}
                      </div>
                    </td>
                    <td className="py-1 pr-2 text-right tabular-nums">
                      {Number(it.quantity ?? 0)}
                    </td>
                    <td className="py-1 pr-2 text-gray-500">UNIT</td>
                    <td className="py-1 pr-2 text-right tabular-nums">
                      {formatMYR(Number(it.unit_price) || 0)}
                    </td>
                    <td className="py-1 pr-2 text-right tabular-nums text-gray-400">
                      0
                    </td>
                    <td className="py-1 pr-2 text-right tabular-nums">
                      {formatMYR(amt)}
                    </td>
                    <td className="py-1 text-right tabular-nums text-gray-500">
                      {tax > 0 ? formatMYR(tax) : '—'}
                    </td>
                    <td className="py-1 pl-2 text-right tabular-nums font-semibold">
                      {formatMYR(amt + tax)}
                    </td>
                  </tr>
                )
              })
            )}
            {/* Pad short bills so totals don't crowd the items */}
            {(items?.length ?? 0) > 0 && (items?.length ?? 0) < 8 && (
              <tr>
                <td colSpan={9} className="h-32" />
              </tr>
            )}
          </tbody>
        </table>

        {/* Totals + Next Service strip */}
        <div className="mt-3 grid grid-cols-2 gap-6 border-t-2 border-gray-900 pt-3 text-[11px]">
          <div className="text-gray-700">
            {(nextDate || nextKm) && (
              <div className="space-y-0.5">
                {nextDate && (
                  <div>
                    <span className="text-gray-500">Next Service Date :</span>{' '}
                    {new Date(nextDate).toLocaleDateString('en-MY')}
                  </div>
                )}
                {nextKm && (
                  <div>
                    <span className="text-gray-500">Next Service KM :</span>{' '}
                    {Number(nextKm).toLocaleString('en-US')}
                  </div>
                )}
              </div>
            )}
            {remark && (
              <div className="mt-3">
                <div className="text-gray-500">Remark :</div>
                <div className="whitespace-pre-wrap">{remark}</div>
              </div>
            )}
            <div className="mt-4 text-[10px] italic text-gray-500">
              E & O.E.
            </div>
          </div>
          <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 text-right">
            <dt className="text-gray-700">SubTotal :</dt>
            <dd className="font-mono tabular-nums">
              {formatMYR(totals.subtotal)}
            </dd>
            <dt className="text-gray-700">Service Tax {SST_LABOUR_LABEL} :</dt>
            <dd className="font-mono tabular-nums">{formatMYR(totals.tax)}</dd>
            <dt className="border-t border-gray-900 pt-1 text-base font-bold text-gray-900">
              Total Payable :
            </dt>
            <dd className="border-t border-gray-900 pt-1 font-mono text-base font-bold tabular-nums">
              {formatMYR(totals.total)}
            </dd>
          </dl>
        </div>

        {/* Thank-you + ACKNOWLEDGEMENT */}
        <div className="mt-6 text-[11px] text-gray-700">
          <div className="italic">Thank you for using our services.</div>
        </div>
        <div className="mt-6 border-t border-gray-300 pt-3 text-[11px] text-gray-800">
          <div className="font-semibold uppercase tracking-wider text-gray-700">
            Acknowledgement
          </div>
          <div className="mt-2 leading-relaxed">
            I _________________________ I/C No
            _____________________________ acknowledge receipt of the
            vehicle in good order &amp; condition.
          </div>
          <div className="mt-10 grid grid-cols-2 gap-x-8 text-[11px]">
            <div className="border-t border-gray-700 pt-1 text-center text-gray-700">
              Customer's / Representative's Signature
            </div>
            <div className="border-t border-gray-700 pt-1 text-center text-gray-700">
              Date / Time
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
