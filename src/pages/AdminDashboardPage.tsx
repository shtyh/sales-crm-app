import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { AppShell } from '../components/AppShell'
import { useAuth } from '../lib/auth'
import { useBookings, useProfiles, useUpdateBooking } from '../lib/queries'
import { formatError } from '../lib/errors'
import { formatMYR } from '../lib/format'
import type { Booking, Profile } from '../lib/types'

export function AdminDashboardPage() {
  const { profile: currentProfile, isSuperAdmin, canApproveDiscount } = useAuth()

  const { data: profiles, error: profilesErr } = useProfiles()
  const { data: bookings, error: bookingsErr } = useBookings()
  const approveMut = useUpdateBooking()
  const [approvalError, setApprovalError] = useState<string | null>(null)
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

  async function handleApprovalDecision(
    booking: Booking,
    decision: 'approved' | 'rejected',
  ) {
    setApprovalError(null)
    try {
      await approveMut.mutateAsync({
        id: booking.id,
        patch: { approval_status: decision },
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

  return (
    <AppShell>
      {/* Banner — red for super_admin (god mode), purple for regular admin
          roles, so it's visually obvious at a glance which hat you're wearing. */}
      <div className="-mt-6 mb-6 -mx-4 sm:-mx-6">
        <div
          className={`px-4 py-4 text-white sm:px-6 sm:py-5 ${
            isSuperAdmin
              ? 'bg-gradient-to-r from-rose-700 to-rose-500'
              : 'bg-gradient-to-r from-purple-700 to-purple-500'
          }`}
        >
          <div
            className={`text-[10px] font-medium uppercase tracking-widest ${
              isSuperAdmin ? 'text-rose-200' : 'text-purple-200'
            }`}
          >
            {isSuperAdmin ? '★ Super Admin' : '☆ Admin'}
          </div>
          <h1 className="mt-1 text-xl font-semibold sm:text-2xl">
            Hi, {currentProfile?.full_name || currentProfile?.email}
          </h1>
          <p
            className={`mt-1 text-sm ${
              isSuperAdmin ? 'text-rose-100' : 'text-purple-100'
            }`}
          >
            {isSuperAdmin
              ? "God mode — you can override every check below."
              : "You're in admin mode. Manage staff and system settings here."}
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

      {!stats && !error && (
        <div className="rounded-2xl border border-gray-200 bg-white p-10 text-center text-sm text-gray-500">
          Loading…
        </div>
      )}

      {stats && (
        <>
          {/* ---------- Stats ---------- */}
          <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatCard
              label="Pending bookings"
              value={pendingCount}
              accent={pendingCount > 0 ? 'warn' : 'neutral'}
              hint="awaiting deposit"
            />
            <StatCard label="Total users" value={stats.total} />
            <StatCard label="Admins" value={stats.admins} accent="purple" />
            <StatCard label="Sales staff" value={stats.staff} />
          </div>

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
                  return (
                    <li
                      key={b.id}
                      className="flex flex-wrap items-center gap-3 py-3 first:pt-0 last:pb-0"
                    >
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
                    </li>
                  )
                })}
              </ul>
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
                          <div className="tabular-nums text-sm text-gray-900">
                            {formatMYR(b.otr_price)}
                          </div>
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
              <ActionLink
                disabled
                icon="📈"
                title="Reports"
                subtitle="Coming soon"
              />
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
                  <div className="tabular-nums text-sm text-gray-900">
                    {formatMYR(b.otr_price)}
                  </div>
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

function StatCard({
  label,
  value,
  hint,
  accent = 'neutral',
}: {
  label: string
  value: number
  hint?: string
  accent?: 'neutral' | 'purple' | 'warn'
}) {
  const valueTone =
    accent === 'purple'
      ? 'text-purple-700'
      : accent === 'warn'
        ? 'text-amber-700'
        : 'text-gray-900'
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
