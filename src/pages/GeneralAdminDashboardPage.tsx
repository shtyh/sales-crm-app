import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { AppShell } from '../components/AppShell'
import { useAuth } from '../lib/auth'
import {
  useAllAttachments,
  useBookings,
  useCustomers,
  useUpdateBooking,
} from '../lib/queries'
import { formatError } from '../lib/errors'
import {
  JPJ_STATUS_LABEL,
  type Attachment,
  type Booking,
  type Customer,
  type JpjStatus,
} from '../lib/types'

type DocCheck = {
  ic: boolean
  phone: boolean
  address: boolean
  bankTransaction: boolean
  lou: boolean // satisfied either by an LOU upload or by cash payment
}

/** Days between a YYYY-MM-DD anchor and today (floored, never negative). */
function daysSince(anchor: string | null): number {
  if (!anchor) return 0
  const ms = Date.now() - new Date(anchor).getTime()
  return Math.max(0, Math.floor(ms / 86400000))
}

/** A booking is paying cash if the finance team marked the loan bank as
 *  'cash' (case-insensitive). When that's true, no LOU is expected. */
function isCashDeal(b: Booking): boolean {
  return (b.loan_bank ?? '').trim().toLowerCase() === 'cash'
}

function checkDocs(
  b: Booking,
  customer: Customer | undefined,
  byBooking: Map<string, Set<string>>,
): DocCheck {
  // Customer snapshot fields on the booking itself are the fallback for
  // older bookings that haven't been migrated to a customer FK yet.
  const ic = (customer?.nric || b.customer_nric || '').trim().length > 0
  const phone = (customer?.phone || b.customer_phone || '').trim().length > 0
  const address = (customer?.address || '').trim().length > 0
  const kinds = byBooking.get(b.id) ?? new Set<string>()
  const bankTransaction = kinds.has('bank_transaction')
  const louUploaded = kinds.has('lou')
  return {
    ic,
    phone,
    address,
    bankTransaction,
    lou: louUploaded || isCashDeal(b),
  }
}

function isAllDocsComplete(d: DocCheck): boolean {
  return d.ic && d.phone && d.address && d.bankTransaction && d.lou
}

function missingDocList(d: DocCheck): string[] {
  const out: string[] = []
  if (!d.ic) out.push('IC')
  if (!d.phone) out.push('Phone')
  if (!d.address) out.push('Address')
  if (!d.bankTransaction) out.push('Bank transaction')
  if (!d.lou) out.push('LOU')
  return out
}

type Tab = 'all' | 'docs' | 'jpj' | 'ready'

export function GeneralAdminDashboardPage() {
  const { isSuperAdmin, role } = useAuth()
  const isGA = role === 'general_admin' || isSuperAdmin

  const { data: bookings, error: bookingsErr } = useBookings()
  const { data: customers } = useCustomers()
  const { data: attachments, error: attErr } = useAllAttachments(isGA)
  const update = useUpdateBooking()
  const [tab, setTab] = useState<Tab>('all')
  const [updateError, setUpdateError] = useState<string | null>(null)

  const customerById = useMemo(() => {
    const m = new Map<string, Customer>()
    customers?.forEach((c) => m.set(c.id, c))
    return m
  }, [customers])

  // Set of attachment kinds we've seen per booking. Cheap to compute once.
  const kindsByBooking = useMemo(() => {
    const m = new Map<string, Set<string>>()
    for (const a of (attachments as Attachment[] | undefined) ?? []) {
      const s = m.get(a.booking_id) ?? new Set<string>()
      s.add(a.kind)
      m.set(a.booking_id, s)
    }
    return m
  }, [attachments])

  // Active = not cancelled and not already delivered. Those are the only
  // bookings GA still has work to do on.
  const activeBookings = useMemo(
    () =>
      (bookings ?? []).filter(
        (b) => b.status !== 'cancelled' && b.status !== 'delivered',
      ),
    [bookings],
  )

  // Buckets the dashboard cares about.
  type WithDocs = Booking & { __docs: DocCheck }
  const enriched = useMemo<WithDocs[]>(() => {
    return activeBookings.map((b) => ({
      ...b,
      __docs: checkDocs(
        b,
        b.customer_id ? customerById.get(b.customer_id) : undefined,
        kindsByBooking,
      ),
    }))
  }, [activeBookings, customerById, kindsByBooking])

  const pendingDocs = useMemo(
    () => enriched.filter((b) => !isAllDocsComplete(b.__docs)),
    [enriched],
  )
  const jpjSubmitted = useMemo(
    () => enriched.filter((b) => b.jpj_status === 'submitted'),
    [enriched],
  )
  const readyToDeliver = useMemo(
    () =>
      enriched.filter(
        (b) =>
          isAllDocsComplete(b.__docs) &&
          !!b.insurance_company &&
          b.payment_status === 'paid' &&
          b.jpj_status === 'registered' &&
          !!b.car_id,
      ),
    [enriched],
  )

  const error =
    bookingsErr || attErr
      ? formatError(bookingsErr ?? attErr)
      : updateError

  async function saveJpj(
    id: string,
    patch: { jpj_status?: JpjStatus; jpj_submitted_at?: string | null; jpj_expected_completion?: string | null },
  ) {
    setUpdateError(null)
    try {
      await update.mutateAsync({ id, patch })
    } catch (e) {
      setUpdateError(formatError(e))
    }
  }

  if (!isGA) {
    // Defensive — RoleHome routes general_admin here, but if someone
    // navigates directly we send them home.
    return (
      <AppShell>
        <div className="rounded-2xl border border-gray-200 bg-white p-10 text-center text-sm text-gray-500">
          This dashboard is for General Admin only.
        </div>
      </AppShell>
    )
  }

  return (
    <AppShell>
      <div className="-mt-6 mb-6 -mx-4 sm:-mx-6">
        <div className="bg-gradient-to-r from-purple-700 to-purple-500 px-4 py-4 text-white sm:px-6 sm:py-5">
          <div className="text-[10px] font-medium uppercase tracking-widest text-purple-200">
            ☆ General Admin
          </div>
          <h1 className="mt-1 text-xl font-semibold sm:text-2xl">
            Sales operations
          </h1>
          <p className="mt-1 text-sm text-purple-100">
            Document collection, JPJ registration, and delivery readiness.
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
      <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Stat
          label="Waiting for documents"
          value={pendingDocs.length}
          tone={pendingDocs.length > 0 ? 'amber' : 'neutral'}
        />
        <Stat
          label="Submitted to JPJ"
          value={jpjSubmitted.length}
          tone="blue"
        />
        <Stat
          label="Ready to deliver"
          value={readyToDeliver.length}
          tone={readyToDeliver.length > 0 ? 'green' : 'neutral'}
        />
      </div>

      {/* ---------- Filter chips ---------- */}
      <div className="mb-4 flex flex-wrap gap-2">
        <Chip active={tab === 'all'} onClick={() => setTab('all')}>
          All
        </Chip>
        <Chip active={tab === 'docs'} onClick={() => setTab('docs')}>
          Pending documents
        </Chip>
        <Chip active={tab === 'jpj'} onClick={() => setTab('jpj')}>
          JPJ status
        </Chip>
        <Chip active={tab === 'ready'} onClick={() => setTab('ready')}>
          Ready to deliver
        </Chip>
      </div>

      {(tab === 'all' || tab === 'docs') && (
        <Section
          title={`📄 Pending documents — ${pendingDocs.length}`}
          right={
            <span className="text-xs text-gray-500">
              tap a row to open the booking and upload
            </span>
          }
        >
          {pendingDocs.length === 0 ? (
            <Empty>Every active booking has all its paperwork in.</Empty>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200 text-sm">
                <thead className="bg-gray-50 text-xs uppercase tracking-wider text-gray-500">
                  <tr>
                    <Th>Booking</Th>
                    <Th>Customer</Th>
                    <Th>Missing</Th>
                    <Th alignRight>Days waiting</Th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {pendingDocs.map((b) => {
                    const missing = missingDocList(b.__docs)
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
                        <td className="px-3 py-2">
                          <div className="flex flex-wrap gap-1">
                            {missing.map((m) => (
                              <span
                                key={m}
                                className="inline-flex rounded-full bg-rose-100 px-2 py-0.5 text-xs font-medium text-rose-800"
                              >
                                {m}
                              </span>
                            ))}
                          </div>
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">
                          <span
                            className={
                              days > 14
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
      )}

      {(tab === 'all' || tab === 'jpj') && (
        <Section
          title={`🏛️ JPJ status — ${enriched.filter((b) => b.jpj_status !== 'not_submitted').length} active`}
          right={
            <span className="text-xs text-gray-500">
              update status inline; saves on change
            </span>
          }
        >
          {enriched.length === 0 ? (
            <Empty>No active bookings yet.</Empty>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200 text-sm">
                <thead className="bg-gray-50 text-xs uppercase tracking-wider text-gray-500">
                  <tr>
                    <Th>Booking</Th>
                    <Th>Vehicle</Th>
                    <Th>JPJ status</Th>
                    <Th>Submitted</Th>
                    <Th>Expected</Th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {enriched.map((b) => (
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
                        {b.vehicle_model}
                        {b.vehicle_variant ? ` · ${b.vehicle_variant}` : ''}
                      </td>
                      <td className="px-3 py-2">
                        <select
                          value={b.jpj_status}
                          onChange={(e) =>
                            saveJpj(b.id, {
                              jpj_status: e.target.value as JpjStatus,
                            })
                          }
                          className="rounded-md border border-gray-300 bg-white px-2 py-1 text-xs focus:border-purple-500 focus:outline-none"
                          disabled={update.isPending}
                        >
                          {(Object.keys(JPJ_STATUS_LABEL) as JpjStatus[]).map(
                            (s) => (
                              <option key={s} value={s}>
                                {JPJ_STATUS_LABEL[s]}
                              </option>
                            ),
                          )}
                        </select>
                      </td>
                      <td className="px-3 py-2">
                        <input
                          type="date"
                          value={b.jpj_submitted_at ?? ''}
                          onChange={(e) =>
                            saveJpj(b.id, {
                              jpj_submitted_at: e.target.value || null,
                            })
                          }
                          className="rounded-md border border-gray-300 bg-white px-2 py-1 text-xs focus:border-purple-500 focus:outline-none"
                          disabled={update.isPending}
                        />
                      </td>
                      <td className="px-3 py-2">
                        <input
                          type="date"
                          value={b.jpj_expected_completion ?? ''}
                          onChange={(e) =>
                            saveJpj(b.id, {
                              jpj_expected_completion: e.target.value || null,
                            })
                          }
                          className="rounded-md border border-gray-300 bg-white px-2 py-1 text-xs focus:border-purple-500 focus:outline-none"
                          disabled={update.isPending}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Section>
      )}

      {(tab === 'all' || tab === 'ready') && (
        <Section title={`🚚 Ready to deliver — ${readyToDeliver.length}`}>
          {readyToDeliver.length === 0 ? (
            <Empty>
              Nothing fully cleared yet. A booking shows here once docs are
              complete, insurance is recorded, payment is paid in full, and
              JPJ status is "Registered".
            </Empty>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200 text-sm">
                <thead className="bg-gray-50 text-xs uppercase tracking-wider text-gray-500">
                  <tr>
                    <Th>Booking</Th>
                    <Th>Customer</Th>
                    <Th>Vehicle</Th>
                    <Th>Docs</Th>
                    <Th>Insurance</Th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {readyToDeliver.map((b) => (
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
                      <td className="px-3 py-2 text-gray-700">
                        {b.vehicle_model}
                        {b.vehicle_variant ? ` · ${b.vehicle_variant}` : ''}
                      </td>
                      <td className="px-3 py-2 text-green-700">✓ complete</td>
                      <td className="px-3 py-2 text-gray-700">
                        {b.insurance_company}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Section>
      )}
    </AppShell>
  )
}

// ---------- presentational helpers ----------

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
      <div className="mb-3 flex items-center justify-between gap-2">
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
  tone?: 'neutral' | 'amber' | 'blue' | 'green'
}) {
  const t =
    tone === 'amber'
      ? 'text-amber-700'
      : tone === 'blue'
        ? 'text-blue-700'
        : tone === 'green'
          ? 'text-green-700'
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

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full px-3 py-1 text-xs font-medium transition ${
        active
          ? 'bg-gray-900 text-white'
          : 'border border-gray-300 bg-white text-gray-700 hover:bg-gray-50'
      }`}
    >
      {children}
    </button>
  )
}
