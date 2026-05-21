import { Link } from 'react-router-dom'
import { AppShell } from '../components/AppShell'
import { useAuth } from '../lib/auth'

export function DashboardPage() {
  const { user } = useAuth()
  const displayName =
    (user?.user_metadata?.full_name as string | undefined) ?? user?.email ?? ''

  return (
    <AppShell>
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-gray-900">
          Welcome, {displayName}
        </h1>
        <p className="mt-1 text-sm text-gray-500">
          Manage your bookings and pipeline from here.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {/* Primary feature — live */}
        <Link
          to="/bookings"
          className="group rounded-2xl border border-gray-200 bg-white p-5 transition hover:border-gray-300 hover:shadow-sm"
        >
          <div className="text-lg">📋</div>
          <div className="mt-1 font-medium text-gray-900">Bookings</div>
          <div className="mt-1 text-sm text-gray-500">
            Create + track your bookings
          </div>
          <div className="mt-3 text-xs font-medium text-gray-900 group-hover:underline">
            Open →
          </div>
        </Link>

        {/* Placeholders — coming soon */}
        <div className="rounded-2xl border border-dashed border-gray-300 bg-white p-5 text-gray-500">
          <div className="text-lg">📞</div>
          <div className="mt-1 font-medium">Follow-ups</div>
          <div className="mt-1 text-sm">Reminders & call logs (soon)</div>
        </div>
        <div className="rounded-2xl border border-dashed border-gray-300 bg-white p-5 text-gray-500">
          <div className="text-lg">📊</div>
          <div className="mt-1 font-medium">Reports</div>
          <div className="mt-1 text-sm">Pipeline & sales stats (soon)</div>
        </div>
      </div>
    </AppShell>
  )
}
