import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { AppShell } from '../components/AppShell'
import { useAuth } from '../lib/auth'
import { useBookings, useProfiles, useUpdateBooking } from '../lib/queries'
import { formatError } from '../lib/errors'
import { formatMYR } from '../lib/format'
import { supabase } from '../lib/supabase'
import type { Booking, Profile } from '../lib/types'

type BannerStyle = {
  bg: string
  label: string
  labelTone: string
  textTone: string
  tagline: string
}

const BANNER: Partial<Record<NonNullable<ReturnType<typeof useAuth>['role']>, BannerStyle>> = {
  super_admin: {
    bg: 'bg-gradient-to-r from-rose-700 to-rose-500',
    label: '★ Super Admin',
    labelTone: 'text-rose-200',
    textTone: 'text-rose-100',
    tagline: 'God mode — you can override every check below.',
  },
  sales_manager: {
    bg: 'bg-gradient-to-r from-blue-700 to-blue-500',
    label: '☆ Sales Manager',
    labelTone: 'text-blue-200',
    textTone: 'text-blue-100',
    tagline:
      "Your team's funnel + discount sign-offs are below. Approve fast — SAs are blocked on you.",
  },
  general_admin: {
    bg: 'bg-gradient-to-r from-purple-700 to-purple-500',
    label: '☆ General Admin',
    labelTone: 'text-purple-200',
    textTone: 'text-purple-100',
    tagline: "You're in admin mode. Manage day-to-day bookings here.",
  },
  finance_admin: {
    bg: 'bg-gradient-to-r from-amber-700 to-amber-500',
    label: '☆ Finance Admin',
    labelTone: 'text-amber-200',
    textTone: 'text-amber-100',
    tagline:
      'Loan / insurance / deposit / payment statuses are yours to maintain.',
  },
  accountant: {
    bg: 'bg-gradient-to-r from-green-700 to-green-500',
    label: '☆ Accountant',
    labelTone: 'text-green-200',
    textTone: 'text-green-100',
    tagline: 'Deposit + payment status and cancellations flow through you.',
  },
}

const FALLBACK_BANNER: BannerStyle = {
  bg: 'bg-gradient-to-r from-purple-700 to-purple-500',
  label: '☆ Admin',
  labelTone: 'text-purple-200',
  textTone: 'text-purple-100',
  tagline: "You're in admin mode.",
}

export function AdminDashboardPage() {
  const {
    profile: currentProfile,
    role,
    isSuperAdmin,
    canApproveDiscount,
  } = useAuth()

  const banner = (role && BANNER[role]) ?? FALLBACK_BANNER
  const isSalesManager = role === 'sales_manager'

  const { data: profiles, error: profilesErr } = useProfiles()
  const { data: bookings, error: bookingsErr } = useBookings()
  const approveMut = useUpdateBooking()
  const [approvalError, setApprovalError] = useState<string | null>(null)

  // Manual sales-digest fire. Auto-cron fires Mon-Sat at 7pm KL; this
  // button lets the ASM push the snapshot ad-hoc (e.g. mid-day update
  // before a manager's call).
  const [digestState, setDigestState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle')
  const [digestError, setDigestError] = useState<string | null>(null)
  async function sendDigestNow() {
    setDigestState('sending')
    setDigestError(null)
    const { error } = await supabase.rpc('send_sales_digest_now')
    if (error) {
      setDigestError(formatError(error))
      setDigestState('error')
      return
    }
    setDigestState('sent')
    // Reset the "sent" label after a few seconds so the button is
    // usable again without a full page refresh.
    setTimeout(() => setDigestState('idle'), 4000)
  }
  const error =
    approvalError ??
    (profilesErr || bookingsErr
      ? formatError(profilesErr ?? bookingsErr)
      : null)

  const profileById = useMemo(() => {
    const map = new Map<string, Profile>()
    profiles?.forEach((p) => map.set(p.id, p))
    return map
  }, [profiles])

  const pending = useMemo(() => {
    if (!bookings) return null
    return bookings
      .filter((b) => b.status === 'pending')
      .slice(0, 5)
  }, [bookings])

  const pendingCount = useMemo(
    () => bookings?.filter((b) => b.status === 'pending').length ?? 0,
    [bookings],
  )

  // Discount-approval queue for sales_manager / super_admin. Pending = SA
  // submitted a non-zero discount and needs the manager's blessing.
  const pendingApprovals = useMemo(
    () =>
      bookings
        ?.filter((b) => b.approval_status === 'pending')
        .slice(0, 10) ?? [],
    [bookings],
  )

  // Per-row note input for the approval queue. Manager can leave a
  // short reason (especially when rejecting) that gets persisted to
  // bookings.approval_notes.
  const [approvalNotes, setApprovalNotes] = useState<Record<string, string>>({})

  async function handleApprovalDecision(
    booking: Booking,
    decision: 'approved' | 'rejected',
  ) {
    setApprovalError(null)
    const note = (approvalNotes[booking.id] ?? '').trim()
    if (decision === 'rejected' && !note) {
      setApprovalError(
        'Add a short reason before rejecting — the SA needs to know why.',
      )
      return
    }
    try {
      await approveMut.mutateAsync({
        id: booking.id,
        patch: {
          approval_status: decision,
          approval_notes: note || null,
        },
      })
      setApprovalNotes((m) => {
        const { [booking.id]: _, ...rest } = m
        return rest
      })
    } catch (e) {
      setApprovalError(formatError(e))
    }
  }

  // Bookings whose loan was approved + not yet delivered → admin's JPJ queue.
  const readyForJpj = useMemo(
    () =>
      bookings
        ?.filter(
          (b) =>
            b.loan_status === 'approved' &&
            b.status !== 'delivered' &&
            b.status !== 'cancelled',
        )
        .slice(0, 5) ?? [],
    [bookings],
  )

  // Bookings whose loan got rejected and the deal isn't dead yet.
  const loanRejected = useMemo(
    () =>
      bookings
        ?.filter(
          (b) => b.loan_status === 'rejected' && b.status !== 'cancelled',
        )
        .slice(0, 5) ?? [],
    [bookings],
  )

  const stats = useMemo(() => {
    if (!profiles) return null
    return {
      total: profiles.length,
      admins: profiles.filter((p) => p.is_admin).length,
      staff: profiles.filter((p) => !p.is_admin).length,
      recent: [...profiles]
        .sort(
          (a, b) =>
            new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
        )
        .slice(0, 5),
    }
  }, [profiles])

  // Sales-funnel counts (manager view).
  const funnel = useMemo(() => {
    if (!bookings) {
      return { pending: 0, confirmed: 0, delivered: 0, cancelled: 0 }
    }
    return {
      pending: bookings.filter((b) => b.status === 'pending').length,
      confirmed: bookings.filter((b) => b.status === 'confirmed').length,
      delivered: bookings.filter((b) => b.status === 'delivered').length,
      cancelled: bookings.filter((b) => b.status === 'cancelled').length,
    }
  }, [bookings])

  // Manager-only leaderboard. Counts each owner's non-cancelled bookings +
  // sums net revenue (otr - discount). Top 5 by booking count.
  const leaderboard = useMemo(() => {
    if (!bookings || !profileById.size) return []
    type Row = { id: string; count: number; revenue: number }
    const acc = new Map<string, Row>()
    for (const b of bookings) {
      if (b.status === 'cancelled') continue
      const row = acc.get(b.owner_id) ?? {
        id: b.owner_id,
        count: 0,
        revenue: 0,
      }
      row.count += 1
      row.revenue += Number(b.otr_price) - Number(b.discount_amount ?? 0)
      acc.set(b.owner_id, row)
    }
    return [...acc.values()]
      .sort((a, b) => b.count - a.count || b.revenue - a.revenue)
      .slice(0, 5)
      .map((r) => {
        const p = profileById.get(r.id)
        return {
          ...r,
          name: p?.full_name || p?.email || '—',
          isManager: p?.role === 'sales_manager',
        }
      })
  }, [bookings, profileById])

  return (
    <AppShell>
      {/* Banner — colour + label switch per role so the user instantly knows
          which hat they're wearing. Style map is at the top of the file. */}
      <div className="-mt-6 mb-6 -mx-4 sm:-mx-6">
        <div className={`px-4 py-4 text-white sm:px-6 sm:py-5 ${banner.bg}`}>
          <div
            className={`text-[10px] font-medium uppercase tracking-widest ${banner.labelTone}`}
          >
            {banner.label}
          </div>
          <h1 className="mt-1 text-xl font-semibold sm:text-2xl">
            Hi, {currentProfile?.full_name || currentProfile?.email}
          </h1>
          <p className={`mt-1 text-sm ${banner.textTone}`}>{banner.tagline}</p>
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

      {!stats && !error && (
        <div className="rounded-2xl border border-gray-200 bg-white p-10 text-center text-sm text-gray-500">
          Loading…
        </div>
      )}

      {stats && (
        <>
          {/* ---------- Stats ---------- */}
          {/* Sales manager gets the team's sales funnel (the thing they
              actually monitor). Other admin roles keep the HR-style overview. */}
          {isSalesManager ? (
            <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <StatCard
                label="Discount approvals"
                value={pendingApprovals.length}
                accent={pendingApprovals.length > 0 ? 'rose' : 'neutral'}
                hint="awaiting your sign-off"
              />
              <StatCard
                label="Pending"
                value={funnel.pending}
                accent="warn"
                hint="awaiting deposit"
              />
              <StatCard
                label="Confirmed"
                value={funnel.confirmed}
                accent="blue"
                hint="deposit received"
              />
              <StatCard
                label="Delivered"
                value={funnel.delivered}
                accent="green"
                hint="closed wins"
              />
            </div>
          ) : (
            <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <StatCard
                label="Pending bookings"
                value={pendingCount}
                accent={pendingCount > 0 ? 'warn' : 'neutral'}
                hint="awaiting deposit"
              />
              <StatCard label="Total users" value={stats.total} />
              <StatCard
                label="Admins"
                value={stats.admins}
                accent="purple"
              />
              <StatCard label="Sales staff" value={stats.staff} />
            </div>
          )}

          {/* ---------- Sales digest: manual fire ---------- */}
          {(isSalesManager || isSuperAdmin) && (
            <section className="mb-6 rounded-2xl border border-gray-200 bg-white p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-gray-900">
                    📊 Daily sales digest
                  </div>
                  <div className="mt-0.5 text-xs text-gray-500">
                    Auto-sends to <span className="font-mono">@PROTON_SWL_MOTORS_SALES_bot</span> Mon–Sat at 7:00 PM. Fire an extra snapshot here if needed.
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {digestState === 'sent' && (
                    <span className="text-xs font-medium text-green-700">
                      ✓ Sent
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={sendDigestNow}
                    disabled={digestState === 'sending'}
                    className="rounded-md bg-gray-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {digestState === 'sending' ? 'Sending…' : 'Send now'}
                  </button>
                </div>
              </div>
              {digestError && (
                <div
                  role="alert"
                  className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700"
                >
                  {digestError}
                </div>
              )}
            </section>
          )}

          {/* ---------- Pending discount approvals (sales_manager queue) ---------- */}
          {canApproveDiscount && pendingApprovals.length > 0 && (
            <section className="mb-6 rounded-2xl border border-rose-200 bg-rose-50/30 p-5">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-sm font-semibold text-rose-900">
                  ⏳ Discount approvals — {pendingApprovals.length} pending
                </h2>
                <span className="text-xs text-rose-700">
                  Your sign-off needed
                </span>
              </div>
              <ul className="divide-y divide-rose-200">
                {pendingApprovals.map((b) => {
                  const owner = profileById.get(b.owner_id)
                  const busy = approveMut.isPending && approveMut.variables?.id === b.id
                  const note = approvalNotes[b.id] ?? ''
                  const commission = Number(b.base_commission ?? 0)
                  const over = Number(b.discount_amount ?? 0) - commission
                  return (
                    <li
                      key={b.id}
                      className="py-3 first:pt-0 last:pb-0"
                    >
                      <div className="flex flex-wrap items-center gap-3">
                        <Link
                          to={`/bookings/${b.id}`}
                          className="min-w-0 flex-1 hover:underline"
                        >
                          <div className="truncate text-sm font-medium text-gray-900">
                            {b.customer_name}{' '}
                            <span className="font-mono text-xs text-gray-500">
                              {b.code}
                            </span>
                          </div>
                          <div className="truncate text-xs text-gray-500">
                            {b.vehicle_model}
                            {b.vehicle_variant ? ` · ${b.vehicle_variant}` : ''}
                            {' · by '}
                            <span className="font-medium">
                              {owner?.full_name || owner?.email || '—'}
                            </span>
                          </div>
                        </Link>
                        <div className="shrink-0 text-right">
                          <div className="text-xs text-gray-500">Discount</div>
                          <div className="tabular-nums text-sm font-semibold text-rose-700">
                            −{formatMYR(b.discount_amount)}
                          </div>
                          <div className="text-[10px] text-rose-700">
                            {over > 0 ? `${formatMYR(over)} over commission` : 'within commission'}
                          </div>
                        </div>
                        <div className="flex shrink-0 gap-2">
                          <button
                            type="button"
                            onClick={() => handleApprovalDecision(b, 'approved')}
                            disabled={busy}
                            className="rounded-lg bg-green-600 px-3 py-1 text-xs font-medium text-white hover:bg-green-700 disabled:opacity-50"
                          >
                            Approve
                          </button>
                          <button
                            type="button"
                            onClick={() => handleApprovalDecision(b, 'rejected')}
                            disabled={busy}
                            className="rounded-lg bg-red-600 px-3 py-1 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-50"
                          >
                            Reject
                          </button>
                        </div>
                      </div>
                      <input
                        type="text"
                        value={note}
                        onChange={(e) =>
                          setApprovalNotes((m) => ({ ...m, [b.id]: e.target.value }))
                        }
                        placeholder="Note for SA (required when rejecting)…"
                        className="mt-2 w-full rounded-md border border-rose-200 bg-white px-2 py-1 text-xs outline-none focus:border-rose-700 focus:ring-2 focus:ring-rose-700/10"
                      />
                    </li>
                  )
                })}
              </ul>
            </section>
          )}

          {/* ---------- Team leaderboard (sales_manager only) ---------- */}
          {isSalesManager && leaderboard.length > 0 && (
            <section className="mb-6 rounded-2xl border border-blue-200 bg-blue-50/30 p-5">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-sm font-semibold text-blue-900">
                  🏆 Top performers
                </h2>
                <span className="text-xs text-blue-700">
                  by bookings (excludes cancelled)
                </span>
              </div>
              <ol className="space-y-2">
                {leaderboard.map((row, i) => (
                  <li
                    key={row.id}
                    className="flex items-center gap-3 rounded-lg bg-white px-3 py-2"
                  >
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-blue-100 text-xs font-semibold text-blue-800">
                      {i + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium text-gray-900">
                        {row.name}
                        {row.isManager && (
                          <span className="ml-1 text-[10px] text-blue-600">
                            (manager)
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-gray-500">
                        {row.count} booking{row.count === 1 ? '' : 's'}
                      </div>
                    </div>
                  </li>
                ))}
              </ol>
            </section>
          )}

          {/* ---------- Pending bookings ---------- */}
          {pending && pending.length > 0 && (
            <section className="mb-6 rounded-2xl border border-amber-200 bg-amber-50/30 p-5">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-sm font-semibold text-amber-900">
                  ⏳ Pending bookings — awaiting deposit
                </h2>
                <Link
                  to="/bookings"
                  className="text-xs font-medium text-amber-900 hover:underline"
                >
                  See all →
                </Link>
              </div>
              <ul className="divide-y divide-amber-200">
                {pending.map((b) => {
                  const owner = profileById.get(b.owner_id)
                  return (
                    <li key={b.id}>
                      <Link
                        to={`/bookings/${b.id}`}
                        className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0 hover:bg-amber-100/40"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-medium text-gray-900">
                            {b.customer_name}
                          </div>
                          <div className="truncate text-xs text-gray-500">
                            {b.vehicle_model}
                            {b.vehicle_variant ? ` · ${b.vehicle_variant}` : ''}{' '}
                            · by{' '}
                            <span className="font-medium">
                              {owner?.full_name || owner?.email || '—'}
                            </span>
                          </div>
                        </div>
                        <div className="shrink-0 text-right">
                          <div className="text-[10px] text-gray-500">
                            {b.code}
                          </div>
                        </div>
                      </Link>
                    </li>
                  )
                })}
              </ul>
            </section>
          )}

          {/* ---------- Ready for JPJ (loans approved) ---------- */}
          {readyForJpj.length > 0 && (
            <BookingListWidget
              tone="green"
              icon="✅"
              title="Loans approved — ready for JPJ"
              bookings={readyForJpj}
              profileById={profileById}
            />
          )}

          {/* ---------- Loan rejected ---------- */}
          {loanRejected.length > 0 && (
            <BookingListWidget
              tone="red"
              icon="✗"
              title="Loans rejected — needs follow-up"
              bookings={loanRejected}
              profileById={profileById}
            />
          )}

          {/* ---------- Quick actions ---------- */}
          <section className="mb-6 rounded-2xl border border-gray-200 bg-white p-5">
            <h2 className="mb-3 text-sm font-semibold text-gray-900">
              Quick actions
            </h2>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              {isSuperAdmin ? (
                <ActionLink
                  to="/admin/users"
                  icon="👥"
                  title="Manage users"
                  subtitle="Invite, rename, change roles"
                />
              ) : (
                <ActionLink
                  disabled
                  icon="👥"
                  title="Manage users"
                  subtitle="Super admin only"
                />
              )}
              <ActionLink
                to="/bookings"
                icon="📊"
                title="All bookings"
                subtitle="Full searchable list"
              />
              {isSuperAdmin ? (
                <ActionLink
                  to="/admin/commissions"
                  icon="💸"
                  title="Commission schedule"
                  subtitle="Set base RM per model"
                />
              ) : (
                <ActionLink
                  disabled
                  icon="💸"
                  title="Commission schedule"
                  subtitle="Super admin only"
                />
              )}
            </div>
          </section>

          {/* ---------- Recent users ---------- */}
          <section className="rounded-2xl border border-gray-200 bg-white p-5">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-gray-900">
                Recent users
              </h2>
              <Link
                to="/admin/users"
                className="text-xs font-medium text-gray-900 hover:underline"
              >
                See all →
              </Link>
            </div>
            <ul className="divide-y divide-gray-100">
              {stats.recent.map((p) => (
                <li
                  key={p.id}
                  className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0"
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium text-gray-900">
                      {p.full_name || (
                        <span className="italic text-gray-400">(no name)</span>
                      )}
                    </div>
                    <div className="truncate text-xs text-gray-500">
                      {p.email}
                    </div>
                  </div>
                  {p.is_admin && (
                    <span className="shrink-0 rounded-full bg-purple-100 px-2 py-0.5 text-xs font-medium text-purple-800">
                      ☆ Admin
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
    </AppShell>
  )
}

// ----- small helpers --------------------------------------------------------

const TONES = {
  amber: {
    border: 'border-amber-200',
    bg: 'bg-amber-50/30',
    text: 'text-amber-900',
    divide: 'divide-amber-200',
    hover: 'hover:bg-amber-100/40',
  },
  green: {
    border: 'border-green-200',
    bg: 'bg-green-50/40',
    text: 'text-green-900',
    divide: 'divide-green-200',
    hover: 'hover:bg-green-100/40',
  },
  red: {
    border: 'border-red-200',
    bg: 'bg-red-50/40',
    text: 'text-red-900',
    divide: 'divide-red-200',
    hover: 'hover:bg-red-100/40',
  },
} as const

function BookingListWidget({
  tone,
  icon,
  title,
  bookings,
  profileById,
}: {
  tone: keyof typeof TONES
  icon: string
  title: string
  bookings: Booking[]
  profileById: Map<string, Profile>
}) {
  const t = TONES[tone]
  return (
    <section
      className={`mb-6 rounded-2xl border ${t.border} ${t.bg} p-5`}
    >
      <div className="mb-3 flex items-center justify-between">
        <h2 className={`text-sm font-semibold ${t.text}`}>
          {icon} {title}
        </h2>
        <Link
          to="/bookings"
          className={`text-xs font-medium ${t.text} hover:underline`}
        >
          See all →
        </Link>
      </div>
      <ul className={`divide-y ${t.divide}`}>
        {bookings.map((b) => {
          const owner = profileById.get(b.owner_id)
          return (
            <li key={b.id}>
              <Link
                to={`/bookings/${b.id}`}
                className={`flex items-center gap-3 py-2.5 first:pt-0 last:pb-0 ${t.hover}`}
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-gray-900">
                    {b.customer_name}
                  </div>
                  <div className="truncate text-xs text-gray-500">
                    {b.vehicle_model}
                    {b.vehicle_variant ? ` · ${b.vehicle_variant}` : ''} · by{' '}
                    <span className="font-medium">
                      {owner?.full_name || owner?.email || '—'}
                    </span>
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  <div className="text-[10px] text-gray-500">{b.code}</div>
                </div>
              </Link>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

const STAT_TONE: Record<
  'neutral' | 'purple' | 'warn' | 'rose' | 'blue' | 'green',
  string
> = {
  neutral: 'text-gray-900',
  purple: 'text-purple-700',
  warn: 'text-amber-700',
  rose: 'text-rose-700',
  blue: 'text-blue-700',
  green: 'text-green-700',
}

function StatCard({
  label,
  value,
  hint,
  accent = 'neutral',
}: {
  label: string
  value: number
  hint?: string
  accent?: keyof typeof STAT_TONE
}) {
  const valueTone = STAT_TONE[accent]
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-4">
      <div className="text-xs font-medium text-gray-500">{label}</div>
      <div className={`mt-1 text-2xl font-semibold tabular-nums ${valueTone}`}>
        {value}
      </div>
      {hint && <div className="mt-0.5 text-xs text-gray-400">{hint}</div>}
    </div>
  )
}

function ActionLink({
  to,
  icon,
  title,
  subtitle,
  disabled = false,
}: {
  to?: string
  icon: string
  title: string
  subtitle: string
  disabled?: boolean
}) {
  const inner = (
    <div
      className={`flex items-center gap-3 rounded-xl border p-3 transition ${
        disabled
          ? 'border-dashed border-gray-200 bg-white text-gray-400'
          : 'border-gray-200 bg-white hover:border-purple-300 hover:bg-purple-50'
      }`}
    >
      <div className="text-xl">{icon}</div>
      <div className="min-w-0 flex-1">
        <div
          className={`text-sm font-medium ${
            disabled ? 'text-gray-500' : 'text-gray-900'
          }`}
        >
          {title}
        </div>
        <div className="text-xs text-gray-500">{subtitle}</div>
      </div>
      {!disabled && <div className="text-gray-400">→</div>}
    </div>
  )
  if (disabled || !to) return inner
  return <Link to={to}>{inner}</Link>
}
