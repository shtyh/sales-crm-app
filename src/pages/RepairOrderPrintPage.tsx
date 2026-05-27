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
import { formatMYR } from '../lib/format'
import { SST_LABOUR_LABEL, labourSST } from '../lib/tax'

/**
 * Printable Repair Order — 1:1 layout port of the legacy WMS
 * `jobsheet.xls` template ("Job Sheet or Repair Order" branch of the
 * Job Sheet Selection dialog).
 *
 *   [letterhead]                                    [meta strip]
 *   ──────────────────────────────────────────────────────────
 *   Customer Type · Appointment / Walk-in           Mileage
 *   Waiting Status                                  Time in / out
 *   Vehicle No · Chassis · Engine · Model           S.Advisor / Mech
 *   Reg Date · Customer · Tel                       Next Srv Day/KM
 *   ──────────────────────────────────────────────────────────
 *   No | Item Code | Description | Qty | U/Price | Dis.% | Amt | Tax | Total
 *   Material Section
 *   ──────────────────────────────────────────────────────────
 *   CUSTOMER'S COMPLAINT / REMARK (1–6)              Estimated Charges
 *   CUSTOMER'S REQUEST - ADDITIONAL JOB (1–2)
 *   ──────────────────────────────────────────────────────────
 *   Vehicle Inventory Checklist (right)             Signatures (left)
 *   ──────────────────────────────────────────────────────────
 *   Long legal disclaimer + storage clause
 *
 * Auto-fires window.print() once layout settles.
 */
export function RepairOrderPrintPage() {
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
    return { subtotal, tax, total: subtotal + tax }
  }, [items])

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

  const today = new Date()
  const todayLocal = today.toLocaleDateString('en-MY')
  const todayDow = today.toLocaleDateString('en-US', { weekday: 'short' }).toUpperCase()
  const roDate = new Date(order.opened_at).toLocaleDateString('en-MY')
  const timeIn = new Date(order.opened_at).toLocaleTimeString('en-MY', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })

  const isAppointment = order.appointment_type === 'by_appointment'

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
          title="Repair Order"
          meta={[
            ['Page No:', '1'],
            ['Print Date:', `${todayLocal} ${todayDow}`],
            [
              'RO No:',
              <span className="font-mono">{order.order_no ?? '—'}</span>,
            ],
            ['RO Date:', roDate],
          ]}
        />

        {/* Top info grid — customer/vehicle on left, time/staff/srv on right */}
        <div className="mt-3 grid grid-cols-2 gap-6 border-b border-gray-300 pb-3 text-[11px] text-gray-800">
          <dl className="grid grid-cols-[120px_1fr] gap-y-0.5">
            <dt className="text-gray-500">Customer Type :</dt>
            <dd>{isAppointment ? 'Appointment' : 'Walk-in'}</dd>
            <dt className="text-gray-500">Waiting Status :</dt>
            <dd>Y &nbsp;/&nbsp; N</dd>
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
            <dt className="text-gray-500">Model :</dt>
            <dd>{vehicle?.model ?? '—'}</dd>
            <dt className="text-gray-500">Reg. Date :</dt>
            <dd>
              {vehicle?.registration_date
                ? new Date(vehicle.registration_date).toLocaleDateString('en-MY')
                : <span className="text-gray-300">—</span>}
            </dd>
            <dt className="text-gray-500">Customer :</dt>
            <dd>{customer?.name ?? <span className="text-gray-300">—</span>}</dd>
            <dt className="text-gray-500">Tel No :</dt>
            <dd className="font-mono">
              {customer?.phone ?? <span className="text-gray-300">—</span>}
            </dd>
          </dl>
          <dl className="grid grid-cols-[120px_1fr] gap-y-0.5">
            <dt className="text-gray-500">Mileage :</dt>
            <dd>
              {order.mileage_in != null
                ? `${Number(order.mileage_in).toLocaleString('en-US')} KM`
                : <span className="text-gray-300">—</span>}
            </dd>
            <dt className="text-gray-500">Time In :</dt>
            <dd className="tabular-nums">{timeIn}</dd>
            <dt className="text-gray-500">Time Out :</dt>
            <dd className="text-gray-300">—</dd>
            <dt className="text-gray-500">S.Advisor :</dt>
            <dd className="text-gray-300">—</dd>
            <dt className="text-gray-500">Mechanic :</dt>
            <dd>—</dd>
            <dt className="text-gray-500">Next Srv Day :</dt>
            <dd className="text-gray-300">—</dd>
            <dt className="text-gray-500">Next Srv KM :</dt>
            <dd className="text-gray-300">—</dd>
          </dl>
        </div>

        {/* Items table */}
        <table className="mt-3 w-full border-collapse text-[11px]">
          <thead>
            <tr className="border-b border-gray-900 text-left text-gray-700">
              <th className="py-1 pr-2 font-semibold">No</th>
              <th className="py-1 pr-2 font-semibold">Item Code</th>
              <th className="py-1 pr-2 font-semibold">Description</th>
              <th className="py-1 pr-2 text-right font-semibold">Qty</th>
              <th className="py-1 pr-2 text-right font-semibold">U/Price</th>
              <th className="py-1 pr-2 text-right font-semibold">Dis.%</th>
              <th className="py-1 pr-2 text-right font-semibold">Total Amt</th>
              <th className="py-1 pr-2 text-right font-semibold">Tax Amt</th>
              <th className="py-1 pl-2 text-right font-semibold">Total (RM)</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td
                colSpan={9}
                className="pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-gray-500"
              >
                Material Section
              </td>
            </tr>
            {(items ?? []).length === 0 ? (
              <tr>
                <td colSpan={9} className="py-4 text-center text-gray-400 italic">
                  No line items.
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
                    <td className="py-1 pr-2 font-mono text-gray-700">
                      {/* Item Code is the part_no on stock items; not joined */}
                      <span className="text-gray-300">—</span>
                    </td>
                    <td className="py-1 pr-2 text-gray-900">
                      <div>{it.description ?? '—'}</div>
                      <div className="text-[9px] uppercase tracking-wider text-gray-400">
                        {it.kind === 'labour' ? 'Labour' : 'Part'}
                      </div>
                    </td>
                    <td className="py-1 pr-2 text-right tabular-nums">
                      {Number(it.quantity ?? 0)}
                    </td>
                    <td className="py-1 pr-2 text-right tabular-nums">
                      {formatMYR(Number(it.unit_price) || 0)}
                    </td>
                    <td className="py-1 pr-2 text-right tabular-nums text-gray-400">
                      0
                    </td>
                    <td className="py-1 pr-2 text-right tabular-nums">
                      {formatMYR(amt)}
                    </td>
                    <td className="py-1 pr-2 text-right tabular-nums text-gray-500">
                      {tax > 0 ? formatMYR(tax) : '—'}
                    </td>
                    <td className="py-1 pl-2 text-right tabular-nums font-semibold">
                      {formatMYR(amt + tax)}
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>

        {/* Complaint / additional-job + estimated charges */}
        <div className="mt-4 grid grid-cols-[1fr_auto] gap-x-6 border-t-2 border-gray-900 pt-3 text-[11px]">
          <div>
            <div className="font-semibold uppercase tracking-wider text-gray-700">
              Customer's Complaint / Remark
            </div>
            <ol className="mt-1 list-decimal pl-5 text-gray-800">
              {(order.complaint ?? '')
                .split(/\r?\n/)
                .filter(Boolean)
                .slice(0, 6)
                .map((line, i) => (
                  <li key={i}>{line}</li>
                ))}
              {!order.complaint && (
                <li className="list-none text-gray-300">—</li>
              )}
            </ol>
            <div className="mt-3 font-semibold uppercase tracking-wider text-gray-700">
              Customer's Request — Additional Job
            </div>
            <ol className="mt-1 list-decimal pl-5 text-gray-800">
              {(order.notes ?? '')
                .split(/\r?\n/)
                .filter(Boolean)
                .slice(0, 2)
                .map((line, i) => (
                  <li key={i}>{line}</li>
                ))}
              {!order.notes && <li className="list-none text-gray-300">—</li>}
            </ol>
          </div>
          <div className="min-w-[200px]">
            <div className="rounded-md border border-gray-300 px-3 py-2">
              <div className="text-[10px] uppercase tracking-wider text-gray-500">
                Estimated Charges
              </div>
              <div className="mt-1 text-[10px] italic text-gray-500">
                Please refer back
              </div>
              <div className="mt-2 flex items-baseline justify-between border-t border-gray-300 pt-1">
                <span className="text-gray-700">RM</span>
                <span className="font-mono text-base font-semibold tabular-nums">
                  {formatMYR(totals.total)}
                </span>
              </div>
              <div className="mt-1 text-[10px] text-gray-500">
                SubTotal {formatMYR(totals.subtotal)} · Service Tax{' '}
                {SST_LABOUR_LABEL} {formatMYR(totals.tax)}
              </div>
            </div>
          </div>
        </div>

        {/* Vehicle inventory checklist */}
        <div className="mt-4 grid grid-cols-2 gap-6 border-t border-gray-300 pt-3 text-[11px] text-gray-800">
          <div>
            <div className="font-semibold uppercase tracking-wider text-gray-700">
              Signatures
            </div>
            <div className="mt-10 grid grid-cols-2 gap-4">
              <div className="border-t border-gray-700 pt-1 text-center">
                Customer Signature
              </div>
              <div className="border-t border-gray-700 pt-1 text-center">
                Service Advisor
              </div>
            </div>
          </div>
          <div>
            <div className="font-semibold uppercase tracking-wider text-gray-700">
              Vehicle Inventory Checklist
            </div>
            <ul className="mt-1 grid grid-cols-2 gap-x-3 gap-y-0.5">
              {[
                'Radio',
                'Service Booklet',
                'Spare Tire',
                'Fuel Level',
                'Cigarette Lighter',
                'Jack',
                'Tool Kit',
              ].map((label) => (
                <li
                  key={label}
                  className="flex items-center gap-2 text-gray-700"
                >
                  <span className="inline-block h-3 w-3 border border-gray-500" />
                  {label}
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* Legal disclaimer */}
        <div className="mt-4 border-t border-gray-300 pt-2 text-[9px] leading-relaxed text-gray-600">
          I hereby authorise the above repairs and any related work and supply
          of materials arising therefrom. The vehicle may be driven on the
          road for testing purposes or otherwise in carrying out such repairs.
          Any claim for damage caused to the vehicle during the course of the
          road test or repairs arising from any accident or otherwise is
          limited to the rectification free of cost. No claim for incidental
          or consequential losses is admissible. The vehicle, its accessories
          and contents are at all times at my risk whatever the cause of any
          damage thereto or theft or loss thereof. Any claim for faulty
          workmanship is limited solely to the rectification free of cost of
          such faulty work; no claim for loss consequential or otherwise being
          admissible. I also agree to pay storage charge at a rate decided by
          the Service Centre if I do not collect my vehicle within three (3)
          days of the date of completion of its repairs, and I will not hold
          the workshop liable for any loss of belongings or damages to my
          vehicle during its storage. We shall issue an invoice once the
          vehicle is ready for collection. In the event of late collection
          (3 days after the invoice date), we shall charge a storage fee of
          RM 30.00 per day.
        </div>
      </div>
    </div>
  )
}
