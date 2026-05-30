import { useMemo } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { AppShell } from '../components/AppShell'
import { FinanceDocVerifyQueue } from '../components/FinanceDocVerifyQueue'
import { useAuth } from '../lib/auth'
import {
  useBookings,
  useCars,
  useInvoices,
  usePayments,
  useProfiles,
} from '../lib/queries'
import { formatError } from '../lib/errors'
import { formatMYR } from '../lib/format'
import {
  FLOOR_STOCK_LABEL,
  INVOICE_STATUS_LABEL,
  type FloorStockStatus,
  type InvoiceStatus,
  type Profile,
} from '../lib/types'

const FS_BADGE: Record<FloorStockStatus, string> = {
  locked: 'bg-rose-100 text-rose-800',
  pending_settlement: 'bg-amber-100 text-amber-800',
  overdue: 'bg-red-200 text-red-900',
  paid_off: 'bg-green-100 text-green-800',
}

const INVOICE_BADGE: Record<InvoiceStatus, string> = {
  draft: 'bg-gray-100 text-gray-700',
  issued: 'bg-amber-100 text-amber-800',
  paid: 'bg-green-100 text-green-800',
}

/** YYYY-MM-DD → boolean (is the due date in the past?). */
function isOverdue(due: string | null, status: FloorStockStatus) {
  if (status === 'paid_off' || !due) return false
  return new Date(due).getTime() < new Date().setHours(0, 0, 0, 0)
}

/** Days between a YYYY-MM-DD anchor and today (floored, never negative). */
function daysSince(anchor: string | null): number {
  if (!anchor) return 0
  const ms = Date.now() - new Date(anchor).getTime()
  return Math.max(0, Math.floor(ms / 86400000))
}

export function FinancePage() {
  const { isFinanceAdmin, loading } = useAuth()

  const { data: cars, error: carsErr } = useCars()
  const { data: bookings, error: bookingsErr } = useBookings()
  const { data: profiles } = useProfiles()
  const { data: payments, error: paymentsErr } = usePayments(isFinanceAdmin)
  const { data: invoices, error: invoicesErr } = useInvoices(isFinanceAdmin)

  const profileById = useMemo(() => {
    const m = new Map<string, Profile>()
    profiles?.forEach((p) => m.set(p.id, p))
    return m
  }, [profiles])

  // Sum of money received per booking (across all payment receipts).
  const paidByBooking = useMemo(() => {
    const m = new Map<string, number>()
    for (const p of payments ?? []) {
      m.set(p.booking_id, (m.get(p.booking_id) ?? 0) + Number(p.amount))
    }
    return m
  }, [payments])

  // Active = not cancelled. Cancelled bookings drop out of every queue.
  const activeBookings = useMemo(
    () => bookings?.filter((b) => b.status !== 'cancelled') ?? [],
    [bookings],
  )

  // Insurance is "pending" when either the insurer hasn't been chosen
  // OR the premium amount hasn't been keyed in yet. Both pieces are
  // finance-admin owned.
  const pendingInsurance = useMemo(
    () =>
      activeBookings.filter(
        (b) =>
          !b.insurance_company ||
          b.insurance_amount == null ||
          Number(b.insurance_amount) <= 0,
      ),
    [activeBookings],
  )

  // Outstanding cash = OTR − (sum of every payment receipt + bank loan
  // amount). Only rows with a positive shortfall belong on the dashboard.
  // Sorted by largest shortfall first so the worst gaps surface first.
  type PendingRow = (typeof activeBookings)[number] & {
    __outstanding: number
  }
  const pendingPayment = useMemo<PendingRow[]>(() => {
    return activeBookings
      .map((b) => {
        const paid = paidByBooking.get(b.id) ?? 0
        const loan = Number(b.loan_amount ?? 0)
        const outstanding = Number(b.otr_price) - paid - loan
        return { ...b, __outstanding: outstanding }
      })
      .filter((b) => b.__outstanding > 0)
      .sort((a, b) => b.__outstanding - a.__outstanding)
  }, [activeBookings, paidByBooking])

  // Down-payment collection: the SA's agreed down_payment vs what's actually
  // been received (Σ down-payment receipts = total_received_down_payment, from
  // the doc-verification flow). Lists bookings still short by > RM1.
  type DpRow = (typeof activeBookings)[number] & { __dpOutstanding: number }
  const pendingDownPayment = useMemo<DpRow[]>(() => {
    return activeBookings
      .map((b) => {
        const expected = Number(b.down_payment ?? 0)
        const received = Number(b.total_received_down_payment ?? 0)
        return { ...b, __dpOutstanding: expected - received }
      })
      .filter((b) => Number(b.down_payment ?? 0) > 0 && b.__dpOutstanding > 1)
      .sort((a, b) => b.__dpOutstanding - a.__dpOutstanding)
  }, [activeBookings])

  // Invoices, newest first (the table itself is already paginated visually
  // — we cap the rows below).
  const invoiceRows = useMemo(
    () => [...(invoices ?? [])],
    [invoices],
  )

  const totalInvoices = useMemo(
    () =>
      (invoices ?? [])
        .filter((i) => i.status !== 'draft')
        .reduce((sum, i) => sum + Number(i.total_amount), 0),
    [invoices],
  )

  const totalCommission = useMemo(
    () =>
      activeBookings.reduce(
        (sum, b) => sum + Number(b.commission_amount ?? 0),
        0,
      ),
    [activeBookings],
  )

  // Per-SA commission rollup for the bottom table.
  const commissionBySA = useMemo(() => {
    type Row = {
      owner_id: string
      name: string
      sales: number
      amount: number
      pendingCount: number
      paidCount: number
    }
    const m = new Map<string, Row>()
    for (const b of activeBookings) {
      const prof = profileById.get(b.owner_id)
      const name = prof?.full_name || prof?.email || '—'
      const row =
        m.get(b.owner_id) ??
        ({
          owner_id: b.owner_id,
          name,
          sales: 0,
          amount: 0,
          pendingCount: 0,
          paidCount: 0,
        } as Row)
      row.sales += 1
      row.amount += Number(b.commission_amount ?? 0)
      if (b.commission_status === 'paid') row.paidCount += 1
      else if (b.commission_status === 'pending' || b.commission_status === 'approved')
        row.pendingCount += 1
      m.set(b.owner_id, row)
    }
    return [...m.values()].sort((a, b) => b.amount - a.amount)
  }, [activeBookings, profileById])

  // ---- existing floor stock + LOU state (kept as bottom sections) ----
  const inventoryQueue = useMemo(() => {
    if (!cars) return []
    return [...cars]
      .filter((c) => c.floor_stock_status !== 'paid_off')
      .sort((a, b) => {
        if (a.floor_stock_due == null) return 1
        if (b.floor_stock_due == null) return -1
        return a.floor_stock_due.localeCompare(b.floor_stock_due)
      })
  }, [cars])

  const louQueue = useMemo(
    () =>
      bookings
        ?.filter((b) => b.loan_status === 'pending' && b.status !== 'cancelled')
        .slice(0, 20) ?? [],
    [bookings],
  )

  const error =
    carsErr || bookingsErr || paymentsErr || invoicesErr
      ? formatError(carsErr ?? bookingsErr ?? paymentsErr ?? invoicesErr)
      : null

  if (loading) {
    return (
      <AppShell>
        <div className="rounded-2xl border border-gray-200 bg-white p-10 text-center text-sm text-gray-500">
          Loading…
        </div>
      </AppShell>
    )
  }
  if (!isFinanceAdmin) {
    return <Navigate to="/" replace />
  }

  return (
    <AppShell>
      <div className="-mt-6 mb-6 -mx-4 sm:-mx-6">
        <div className="bg-gradient-to-r from-amber-700 to-amber-500 px-4 py-4 text-white sm:px-6 sm:py-5">
          <div className="text-[10px] font-medium uppercase tracking-widest text-amber-200">
            ☆ Finance Admin
          </div>
          <h1 className="mt-1 text-xl font-semibold sm:text-2xl">
            Finance overview
          </h1>
          <p className="mt-1 text-sm text-amber-100">
            Insurance, payment collection, invoices and commission at a glance.
          </p>
        </div>
      </div>

      {error && (
        <div
          role="alert"
          className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
        >
          {error}
        </div>
      )}

      {/* ---------- Headline cards ---------- */}
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat
          label="Pending insurance"
          value={pendingInsurance.length}
          tone={pendingInsurance.length > 0 ? 'amber' : 'neutral'}
        />
        <Stat
          label="Pending payment"
          value={pendingPayment.length}
          tone={pendingPayment.length > 0 ? 'red' : 'neutral'}
        />
        <StatMoney label="Invoices issued" value={totalInvoices} />
        <StatMoney label="Total commission" value={totalCommission} />
      </div>

      {/* ---------- Document verification queue ---------- */}
      <FinanceDocVerifyQueue />

      {/* ---------- Pending insurance ---------- */}
      <Section title={`🛡️ Pending insurance — ${pendingInsurance.length}`}>
        {pendingInsurance.length === 0 ? (
          <Empty>All bookings have an insurer and premium recorded.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead className="bg-gray-50 text-xs uppercase tracking-wider text-gray-500">
                <tr>
                  <Th>Booking</Th>
                  <Th>Customer</Th>
                  <Th>Vehicle</Th>
                  <Th>Insurer</Th>
                  <Th alignRight>Premium (RM)</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {pendingInsurance.map((b) => (
                  <tr key={b.id} className="hover:bg-gray-50">
                    <td className="whitespace-nowrap px-3 py-2">
                      <Link
                        to={`/bookings/${b.id}`}
                        className="font-mono text-xs text-gray-900 hover:underline"
                      >
                        {b.code}
                      </Link>
                    </td>
                    <td className="px-3 py-2 text-gray-700">{b.customer_name}</td>
                    <td className="px-3 py-2 text-gray-700">
                      {b.vehicle_model}
                      {b.vehicle_variant ? ` · ${b.vehicle_variant}` : ''}
                    </td>
                    <td className="px-3 py-2">
                      {b.insurance_company ? (
                        <span className="text-gray-700">{b.insurance_company}</span>
                      ) : (
                        <span className="italic text-amber-700">— not set —</span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">
                      {b.insurance_amount != null && Number(b.insurance_amount) > 0 ? (
                        formatMYR(Number(b.insurance_amount))
                      ) : (
                        <span className="italic text-amber-700">— not set —</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      {/* ---------- Pending payment ---------- */}
      <Section
        title={`💵 Pending payment — ${pendingPayment.length}`}
        right={
          <span className="text-xs text-gray-500">
            shortfall = OTR − (deposits + downpayment + loan)
          </span>
        }
      >
        {pendingPayment.length === 0 ? (
          <Empty>
            Every active booking is fully covered by deposit + downpayment +
            loan.
          </Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead className="bg-gray-50 text-xs uppercase tracking-wider text-gray-500">
                <tr>
                  <Th>Booking</Th>
                  <Th>Customer</Th>
                  <Th alignRight>OTR</Th>
                  <Th alignRight>Received</Th>
                  <Th alignRight>Loan</Th>
                  <Th alignRight>Shortfall</Th>
                  <Th alignRight>Days waiting</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {pendingPayment.map((b) => {
                  const paid = paidByBooking.get(b.id) ?? 0
                  const loan = Number(b.loan_amount ?? 0)
                  const days = daysSince(b.booking_date)
                  return (
                    <tr key={b.id} className="hover:bg-gray-50">
                      <td className="whitespace-nowrap px-3 py-2">
                        <Link
                          to={`/bookings/${b.id}`}
                          className="font-mono text-xs text-gray-900 hover:underline"
                        >
                          {b.code}
                        </Link>
                      </td>
                      <td className="px-3 py-2 text-gray-700">
                        {b.customer_name}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-gray-700">
                        {formatMYR(Number(b.otr_price))}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-gray-700">
                        {formatMYR(paid)}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-gray-700">
                        {loan > 0 ? formatMYR(loan) : <span className="text-gray-400">—</span>}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums font-semibold text-red-700">
                        {formatMYR(b.__outstanding)}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">
                        <span
                          className={
                            days > 30
                              ? 'font-semibold text-red-700'
                              : 'text-gray-700'
                          }
                        >
                          {days}d
                        </span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      {/* ---------- Pending down payment ---------- */}
      <Section
        title={`🪙 Pending down payment — ${pendingDownPayment.length}`}
        right={
          <span className="text-xs text-gray-500">
            agreed down payment − received receipts
          </span>
        }
      >
        {pendingDownPayment.length === 0 ? (
          <Empty>
            Every booking with an agreed down payment has received it in full.
          </Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead className="bg-gray-50 text-xs uppercase tracking-wider text-gray-500">
                <tr>
                  <Th>Booking</Th>
                  <Th>Customer</Th>
                  <Th>Vehicle</Th>
                  <Th alignRight>Agreed</Th>
                  <Th alignRight>Received</Th>
                  <Th alignRight>Outstanding</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {pendingDownPayment.map((b) => (
                  <tr key={b.id} className="hover:bg-gray-50">
                    <td className="whitespace-nowrap px-3 py-2">
                      <Link
                        to={`/bookings/${b.id}`}
                        className="font-mono text-xs text-gray-900 hover:underline"
                      >
                        {b.code}
                      </Link>
                    </td>
                    <td className="px-3 py-2 text-gray-700">{b.customer_name}</td>
                    <td className="px-3 py-2 text-gray-700">{b.vehicle_model}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-gray-700">
                      {formatMYR(Number(b.down_payment ?? 0))}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-gray-700">
                      {formatMYR(Number(b.total_received_down_payment ?? 0))}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums font-semibold text-amber-700">
                      {formatMYR(b.__dpOutstanding)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      {/* ---------- Invoices ---------- */}
      <Section title={`🧾 Invoices — ${invoiceRows.length}`}>
        {invoiceRows.length === 0 ? (
          <Empty>No invoices recorded yet.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead className="bg-gray-50 text-xs uppercase tracking-wider text-gray-500">
                <tr>
                  <Th>Invoice #</Th>
                  <Th>Booking</Th>
                  <Th alignRight>Amount</Th>
                  <Th>Status</Th>
                  <Th>Date</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {invoiceRows.slice(0, 25).map((inv) => {
                  const booking = bookings?.find((b) => b.id === inv.booking_id)
                  return (
                    <tr key={inv.id} className="hover:bg-gray-50">
                      <td className="whitespace-nowrap px-3 py-2 font-mono text-xs text-gray-900">
                        {inv.invoice_number ?? (
                          <span className="italic text-gray-400">— draft —</span>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2">
                        {booking ? (
                          <Link
                            to={`/bookings/${booking.id}`}
                            className="font-mono text-xs text-gray-900 hover:underline"
                          >
                            {booking.code}
                          </Link>
                        ) : (
                          <span className="text-gray-400">—</span>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-gray-900">
                        {formatMYR(Number(inv.total_amount))}
                      </td>
                      <td className="px-3 py-2">
                        <span
                          className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${INVOICE_BADGE[inv.status]}`}
                        >
                          {INVOICE_STATUS_LABEL[inv.status]}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-xs text-gray-600">
                        {inv.invoice_date}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      {/* ---------- Commission by SA ---------- */}
      <Section title={`💼 Commission by SA — ${commissionBySA.length}`}>
        {commissionBySA.length === 0 ? (
          <Empty>No commission attributed yet.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead className="bg-gray-50 text-xs uppercase tracking-wider text-gray-500">
                <tr>
                  <Th>Sales advisor</Th>
                  <Th alignRight>Sales</Th>
                  <Th alignRight>Commission</Th>
                  <Th>Pending</Th>
                  <Th>Paid</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {commissionBySA.map((row) => (
                  <tr key={row.owner_id} className="hover:bg-gray-50">
                    <td className="px-3 py-2 text-gray-900">{row.name}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-gray-700">
                      {row.sales}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-gray-900">
                      {formatMYR(row.amount)}
                    </td>
                    <td className="px-3 py-2 text-amber-700 tabular-nums">
                      {row.pendingCount}
                    </td>
                    <td className="px-3 py-2 text-green-700 tabular-nums">
                      {row.paidCount}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      {/* ---------- Inventory financing (existing floor-stock block) ---------- */}
      <Section
        title={`🚗 Inventory financing — ${inventoryQueue.length} open`}
        right={
          <Link
            to="/cars"
            className="text-xs font-medium text-gray-900 hover:underline"
          >
            All cars →
          </Link>
        }
      >
        {inventoryQueue.length === 0 ? (
          <Empty>🎉 Every car is paid off.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead className="bg-gray-50 text-xs uppercase tracking-wider text-gray-500">
                <tr>
                  <Th>Chassis</Th>
                  <Th>Vehicle</Th>
                  <Th>Bank</Th>
                  <Th alignRight>Financed</Th>
                  <Th>Status</Th>
                  <Th>Due</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {inventoryQueue.map((c) => {
                  const overdueDate = isOverdue(
                    c.floor_stock_due,
                    c.floor_stock_status,
                  )
                  return (
                    <tr key={c.id} className="hover:bg-gray-50">
                      <td className="whitespace-nowrap px-3 py-2">
                        <Link
                          to={`/cars/${c.id}`}
                          className="font-mono text-xs text-gray-900 hover:underline"
                        >
                          {c.chassis_no}
                        </Link>
                      </td>
                      <td className="px-3 py-2 text-gray-700">
                        {c.model}
                        {c.variant ? ` · ${c.variant}` : ''}
                      </td>
                      <td className="px-3 py-2 text-gray-700">
                        {c.floor_stock_bank || (
                          <span className="italic text-gray-400">— not set —</span>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-gray-900">
                        {c.financed_amount != null
                          ? formatMYR(Number(c.financed_amount))
                          : '—'}
                      </td>
                      <td className="px-3 py-2">
                        <span
                          className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${FS_BADGE[c.floor_stock_status]}`}
                        >
                          {FLOOR_STOCK_LABEL[c.floor_stock_status]}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-xs">
                        {c.floor_stock_due ? (
                          <span
                            className={
                              overdueDate
                                ? 'font-semibold text-red-700'
                                : 'text-gray-600'
                            }
                          >
                            {c.floor_stock_due}
                            {overdueDate && ' · past due'}
                          </span>
                        ) : (
                          <span className="italic text-gray-400">— not set —</span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      {/* ---------- Pending LOU ledger ---------- */}
      <Section
        title={`📋 Pending LOU — ${louQueue.length}`}
        right={
          <span className="text-xs text-gray-500">
            loan_status = pending; awaiting bank decision
          </span>
        }
      >
        {louQueue.length === 0 ? (
          <Empty>No bank approvals waiting.</Empty>
        ) : (
          <ul className="divide-y divide-gray-100">
            {louQueue.map((b) => {
              const owner = profileById.get(b.owner_id)
              return (
                <li key={b.id}>
                  <Link
                    to={`/bookings/${b.id}`}
                    className="flex items-center gap-3 py-3 first:pt-0 last:pb-0 hover:bg-gray-50"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium text-gray-900">
                        {b.customer_name}{' '}
                        <span className="font-mono text-xs text-gray-500">
                          {b.code}
                        </span>
                      </div>
                      <div className="truncate text-xs text-gray-500">
                        {b.vehicle_model}
                        {b.vehicle_variant ? ` · ${b.vehicle_variant}` : ''} ·
                        by{' '}
                        <span className="font-medium">
                          {owner?.full_name || owner?.email || '—'}
                        </span>
                        {b.loan_bank ? ` · ${b.loan_bank}` : ''}
                      </div>
                    </div>
                  </Link>
                </li>
              )
            })}
          </ul>
        )}
      </Section>

    </AppShell>
  )
}

// ---------- small presentational helpers ----------

function Section({
  title,
  right,
  children,
}: {
  title: string
  right?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <section className="mb-6 rounded-2xl border border-gray-200 bg-white p-5">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-gray-900">{title}</h2>
        {right}
      </div>
      {children}
    </section>
  )
}

function Th({
  children,
  alignRight,
}: {
  children: React.ReactNode
  alignRight?: boolean
}) {
  return (
    <th
      className={`px-3 py-2 font-medium ${alignRight ? 'text-right' : 'text-left'}`}
    >
      {children}
    </th>
  )
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-gray-200 p-6 text-center text-sm text-gray-500">
      {children}
    </div>
  )
}

function Stat({
  label,
  value,
  tone = 'neutral',
}: {
  label: string
  value: number
  tone?: 'neutral' | 'red' | 'amber'
}) {
  const t =
    tone === 'red'
      ? 'text-red-700'
      : tone === 'amber'
        ? 'text-amber-700'
        : 'text-gray-900'
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-4">
      <div className="text-xs font-medium text-gray-500">{label}</div>
      <div className={`mt-1 text-2xl font-semibold tabular-nums ${t}`}>
        {value}
      </div>
    </div>
  )
}

function StatMoney({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-4">
      <div className="text-xs font-medium text-gray-500">{label}</div>
      <div className="mt-1 text-lg font-semibold tabular-nums text-gray-900">
        {formatMYR(value)}
      </div>
    </div>
  )
}
