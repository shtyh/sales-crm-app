import { useEffect, useMemo } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  useCustomers,
  useServiceOrder,
  useServiceOrderItems,
  useVehicles,
} from '../lib/queries'
import { formatError } from '../lib/errors'
import { formatMYR } from '../lib/format'
import { SST_LABOUR_LABEL, labourSST } from '../lib/tax'

/**
 * Printable quotation. Renders as a single A4-ish page laid out to
 * mirror the workshop's legacy estimate template:
 *
 *   [company header]            [Quotation title + no/date]
 *   --------------------------------------------------------
 *   Customer Information        Vehicle info
 *   --------------------------------------------------------
 *   Item | Description | Qty | U/Price | Discount | Amount
 *   --------------------------------------------------------
 *   E & O.E.                            Subtotal
 *                                        Service Tax @ 8%
 *                                        Total Payable
 *   --------------------------------------------------------
 *   T&Cs (validity, 50% deposit, windscreen clause)
 *   --------------------------------------------------------
 *   Authorized Signatory     |     Customer Signature
 *
 * Auto-fires window.print() on first mount; print CSS hides the
 * top action strip so the paper output is just the form.
 */
export function QuotationPage() {
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

  const totals = useMemo(() => {
    let subtotal = 0
    let tax = 0
    for (const it of items ?? []) {
      const amt = Number(it.line_total) || 0
      subtotal += amt
      if (it.kind === 'labour') tax += labourSST(amt)
    }
    return {
      subtotal,
      tax,
      total: subtotal + tax,
    }
  }, [items])

  // Auto-trigger print once everything's loaded. We wait one tick so
  // the layout has measured + fonts have settled before the dialog
  // grabs the snapshot.
  useEffect(() => {
    if (!order || !items) return
    const t = setTimeout(() => {
      window.print()
    }, 300)
    return () => clearTimeout(t)
  }, [order, items])

  if (isLoading) {
    return (
      <div className="p-10 text-center text-sm text-gray-500">
        Loading quotation…
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

  const todayLocal = new Date().toLocaleDateString('en-MY')
  const jobDate = new Date(order.opened_at).toLocaleDateString('en-MY')

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

      {/* ---------- The quotation sheet ---------- */}
      <div className="mx-auto my-6 max-w-4xl bg-white p-8 shadow-md print:my-0 print:max-w-full print:p-6 print:shadow-none">
        {/* Header strip */}
        <div className="flex items-start justify-between border-b-2 border-gray-900 pb-3">
          <div>
            <div className="text-xl font-bold tracking-tight text-gray-900">
              SWL MOTORS SDN BHD
            </div>
            <div className="mt-0.5 text-[11px] text-gray-700">
              Proton Authorised Dealer · Bukit Mertajam, Penang
            </div>
            <div className="mt-1 grid grid-cols-2 gap-x-4 text-[11px] text-gray-700">
              <div>Company Reg No: —</div>
              <div>Tel No: —</div>
              <div>&nbsp;</div>
              <div>H/P No: —</div>
            </div>
          </div>
          <div className="text-right">
            <div className="text-2xl font-bold tracking-wide text-gray-900">
              Quotation
            </div>
            <div className="mt-1 grid grid-cols-[auto_1fr] gap-x-2 text-[11px] text-gray-700">
              <span className="text-right">Quotation No:</span>
              <span className="text-left font-mono">
                {order.order_no ?? '—'}
              </span>
              <span className="text-right">Quotation Date:</span>
              <span className="text-left">{todayLocal}</span>
              <span className="text-right">Page No:</span>
              <span className="text-left">1</span>
            </div>
          </div>
        </div>

        {/* Customer + Vehicle */}
        <div className="mt-4 grid grid-cols-2 gap-6 border-b border-gray-300 pb-3 text-[11px]">
          <div>
            <div className="mb-1 text-xs font-semibold uppercase tracking-wider text-gray-500">
              Customer Information
            </div>
            <Row label="A/c Code" value="—" />
            <Row label="Name" value={customer?.name ?? '—'} />
            <Row label="Address" value={customer?.address ?? '—'} multiline />
            <Row label="Tel No" value={customer?.phone ?? '—'} />
          </div>
          <div>
            <div className="mb-1 text-xs font-semibold uppercase tracking-wider text-gray-500">
              Vehicle
            </div>
            <Row label="Reg No" value={vehicle?.registration_no ?? '—'} />
            <Row
              label="Model"
              value={
                vehicle
                  ? `${vehicle.model}${vehicle.variant ? ` ${vehicle.variant}` : ''}`
                  : '—'
              }
            />
            <Row label="Chassis" value={vehicle?.chassis_no ?? '—'} />
            <Row label="Reg.Date" value={jobDate} />
            <Row
              label="KM"
              value={
                order.mileage_in != null ? String(order.mileage_in) : '—'
              }
            />
          </div>
        </div>

        {/* Line items */}
        <table className="mt-3 w-full border-collapse text-[11px]">
          <thead>
            <tr className="border-b border-gray-900 text-left text-[10px] uppercase tracking-wider text-gray-700">
              <th className="w-10 py-1.5 font-semibold">Item</th>
              <th className="py-1.5 font-semibold">Description</th>
              <th className="w-16 py-1.5 text-right font-semibold">Qty</th>
              <th className="w-24 py-1.5 text-right font-semibold">
                U/Price
              </th>
              <th className="w-20 py-1.5 text-right font-semibold">
                Discount
              </th>
              <th className="w-28 py-1.5 text-right font-semibold">Amount</th>
            </tr>
          </thead>
          <tbody>
            {(items ?? []).map((it, idx) => (
              <tr
                key={it.id}
                className="border-b border-gray-100 align-top"
              >
                <td className="py-1.5">{idx + 1}</td>
                <td className="py-1.5">
                  <span className="mr-1 inline-flex rounded bg-gray-100 px-1 text-[9px] uppercase text-gray-600">
                    {it.kind}
                  </span>
                  {it.description}
                </td>
                <td className="py-1.5 text-right tabular-nums">
                  {Number(it.quantity).toFixed(2)}
                </td>
                <td className="py-1.5 text-right tabular-nums">
                  {formatMYR(Number(it.unit_price))}
                </td>
                <td className="py-1.5 text-right tabular-nums text-gray-500">
                  —
                </td>
                <td className="py-1.5 text-right tabular-nums">
                  {formatMYR(Number(it.line_total))}
                </td>
              </tr>
            ))}
            {(items ?? []).length === 0 && (
              <tr>
                <td
                  colSpan={6}
                  className="py-6 text-center text-gray-400"
                >
                  No line items on this quotation.
                </td>
              </tr>
            )}
            {/* Pad short quotations so the totals don't crowd the items. */}
            {Array.from({ length: Math.max(0, 8 - (items ?? []).length) }).map(
              (_, i) => (
                <tr key={`pad-${i}`} className="border-b border-gray-100">
                  <td className="py-1.5">&nbsp;</td>
                  <td />
                  <td />
                  <td />
                  <td />
                  <td />
                </tr>
              ),
            )}
          </tbody>
        </table>

        {/* Totals strip */}
        <div className="mt-3 grid grid-cols-[1fr_auto] gap-4 text-[11px]">
          <div className="text-gray-500 italic">E &amp; O.E.</div>
          <div className="grid grid-cols-[auto_8rem] gap-x-3 text-right">
            <span>SubTotal</span>
            <span className="tabular-nums">{formatMYR(totals.subtotal)}</span>
            <span>Service Tax @ {SST_LABOUR_LABEL.replace('SST ', '')}</span>
            <span className="tabular-nums">{formatMYR(totals.tax)}</span>
            <span className="mt-1 border-t border-gray-900 pt-1 font-semibold">
              Total Payable
            </span>
            <span className="mt-1 border-t border-gray-900 pt-1 tabular-nums font-semibold">
              {formatMYR(totals.total)}
            </span>
          </div>
        </div>

        {/* Terms */}
        <div className="mt-6 space-y-1 border-t border-gray-300 pt-3 text-[10px] leading-snug text-gray-700">
          <p>Validity of this estimate is 14 days from the date of the quote.</p>
          <p>
            We would mention that above estimate is based on our initial
            inspection and does not include any additional parts or labour
            which may be required after work has commenced. Occasionally worn
            or damaged parts are discovered after work has started and needed
            for repairs or replacement. However, should this occur, we would
            advise you. Please be informed that a deposit of 50% of the above
            estimate is payable before commencement of the work. Payment may
            be made in cash, credit card, cheque or online transfer.
          </p>
          <p>
            * You must also agree to pay the full amount for the renewal of
            the windscreen breakage in the event of inadvertent breakage in
            the course of renewing the rubber seal or any other repair
            requiring the removal of the windscreen.
          </p>
        </div>

        {/* Signatures */}
        <div className="mt-10 grid grid-cols-2 gap-12 text-[11px]">
          <div>
            <div className="border-t border-gray-900 pt-1 text-gray-700">
              Authorized Signatory
            </div>
          </div>
          <div>
            <div className="border-t border-gray-900 pt-1 text-gray-700">
              Customer Signature · Acknowledge of Receipt
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function Row({
  label,
  value,
  multiline,
}: {
  label: string
  value: string
  multiline?: boolean
}) {
  return (
    <div className="grid grid-cols-[5.5rem_1fr] gap-2 py-0.5">
      <span className="text-gray-600">{label}:</span>
      <span
        className={multiline ? 'whitespace-pre-wrap text-gray-900' : 'text-gray-900'}
      >
        {value}
      </span>
    </div>
  )
}
