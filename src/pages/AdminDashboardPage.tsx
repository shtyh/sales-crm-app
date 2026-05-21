import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { AppShell } from '../components/AppShell'
import { useAuth } from '../lib/auth'
import { listProfiles } from '../lib/profiles'
import { formatError } from '../lib/errors'
import type { Profile } from '../lib/types'

export function AdminDashboardPage() {
  const { profile: currentProfile } = useAuth()

  const [profiles, setProfiles] = useState<Profile[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    listProfiles()
      .then((rows) => alive && setProfiles(rows))
      .catch((e) => alive && setError(formatError(e)))
    return () => {
      alive = false
    }
  }, [])

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
      {/* Distinct purple banner so admin pages are visually obviously admin */}
      <div className="-mt-6 mb-6 -mx-4 sm:-mx-6">
        <div className="bg-gradient-to-r from-purple-700 to-purple-500 px-4 py-4 text-white sm:px-6 sm:py-5">
          <div className="text-[10px] font-medium uppercase tracking-widest text-purple-200">
            ☆ Admin
          </div>
          <h1 className="mt-1 text-xl font-semibold sm:text-2xl">
            Hi, {currentProfile?.full_name || currentProfile?.email}
          </h1>
          <p className="mt-1 text-sm text-purple-100">
            You're in admin mode. Manage staff and system settings here.
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
          <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3">
            <StatCard label="Total users" value={stats.total} />
            <StatCard label="Admins" value={stats.admins} accent="purple" />
            <StatCard label="Sales staff" value={stats.staff} />
          </div>

          {/* ---------- Quick actions ---------- */}
          <section className="mb-6 rounded-2xl border border-gray-200 bg-white p-5">
            <h2 className="mb-3 text-sm font-semibold text-gray-900">
              Quick actions
            </h2>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              <ActionLink
                to="/admin/users"
                icon="👥"
                title="Manage users"
                subtitle="Rename, grant/revoke admin"
              />
              <ActionLink
                disabled
                icon="📊"
                title="All bookings"
                subtitle="Coming soon"
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

function StatCard({
  label,
  value,
  accent = 'neutral',
}: {
  label: string
  value: number
  accent?: 'neutral' | 'purple'
}) {
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-4">
      <div className="text-xs font-medium text-gray-500">{label}</div>
      <div
        className={`mt-1 text-2xl font-semibold tabular-nums ${
          accent === 'purple' ? 'text-purple-700' : 'text-gray-900'
        }`}
      >
        {value}
      </div>
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
