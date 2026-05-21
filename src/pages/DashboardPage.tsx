import { useAuth, signOut } from '../lib/auth'

const PLACEHOLDER_SECTIONS = [
  { title: 'Customers', subtitle: 'Leads + buyers (coming soon)' },
  { title: 'Deals', subtitle: 'Pipeline & bookings (coming soon)' },
  { title: 'Quotations', subtitle: 'Quote builder (coming soon)' },
]

export function DashboardPage() {
  const { user } = useAuth()
  const displayName =
    (user?.user_metadata?.full_name as string | undefined) ?? user?.email ?? ''

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="border-b border-gray-200 bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3 sm:px-6">
          <div className="flex items-center gap-2">
            <span className="text-xl">🚗</span>
            <span className="font-semibold text-gray-900">
              SWL Motors CRM
            </span>
          </div>
          <div className="flex items-center gap-3 text-sm">
            <span className="hidden text-gray-600 sm:inline">
              {displayName}
            </span>
            <button
              onClick={signOut}
              className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700 transition hover:bg-gray-50"
            >
              Logout
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
        <div className="mb-6">
          <h1 className="text-xl font-semibold text-gray-900">
            Welcome, {displayName}
          </h1>
          <p className="mt-1 text-sm text-gray-500">
            You're signed in. The real workspace will be built here.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {PLACEHOLDER_SECTIONS.map((s) => (
            <div
              key={s.title}
              className="rounded-2xl border border-dashed border-gray-300 bg-white p-5 text-left"
            >
              <div className="font-medium text-gray-900">{s.title}</div>
              <div className="mt-1 text-sm text-gray-500">{s.subtitle}</div>
            </div>
          ))}
        </div>
      </main>
    </div>
  )
}
