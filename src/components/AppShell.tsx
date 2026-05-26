import type { ReactNode } from 'react'
import { Link, NavLink, useNavigate } from 'react-router-dom'
import { useAuth, signOut } from '../lib/auth'
// Top-nav exposes /commissions only to roles that have anything to do there.

const navLinkClass = ({ isActive }: { isActive: boolean }) =>
  `rounded-lg px-2.5 py-1 text-sm transition ${
    isActive
      ? 'bg-gray-900 text-white'
      : 'text-gray-700 hover:bg-gray-100'
  }`

/**
 * Page chrome shared by every authenticated screen: top bar with brand,
 * the signed-in user, and a sign-out button. Pages render their own content
 * inside the `<main>` slot.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const {
    user,
    isAdmin,
    isSuperAdmin,
    isFinanceAdmin,
    canApproveDiscount,
    canViewCustomers,
  } = useAuth()
  const navigate = useNavigate()
  const displayName =
    (user?.user_metadata?.full_name as string | undefined) ?? user?.email ?? ''

  async function handleSignOut() {
    await signOut()
    navigate('/login', { replace: true })
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="border-b border-gray-200 bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <div className="flex items-center gap-1 sm:gap-4">
            <Link to="/" className="flex items-center gap-2">
              <span className="text-xl">🚗</span>
              <span className="hidden font-semibold text-gray-900 sm:inline">
                SWL Motors CRM
              </span>
            </Link>
            {/* Primary nav — always present so users can reach the booking
                list even when the dashboard widgets happen to be empty. */}
            <nav className="ml-2 flex items-center gap-1 sm:ml-4">
              <NavLink to="/" end className={navLinkClass}>
                Home
              </NavLink>
              <NavLink to="/bookings" className={navLinkClass}>
                Bookings
              </NavLink>
              {canViewCustomers && (
                <NavLink to="/customers" className={navLinkClass}>
                  Customers
                </NavLink>
              )}
              {isAdmin && (
                <NavLink to="/cars" className={navLinkClass}>
                  Inventory
                </NavLink>
              )}
              {isFinanceAdmin && (
                <NavLink to="/finance" className={navLinkClass}>
                  Finance
                </NavLink>
              )}
              {canApproveDiscount && (
                <NavLink to="/commissions" className={navLinkClass}>
                  Commissions
                </NavLink>
              )}
              {isSuperAdmin && (
                <NavLink
                  to="/admin/commissions"
                  className={navLinkClass}
                  title="Set base commission per car model"
                >
                  Rates
                </NavLink>
              )}
              <NavLink to="/bookings/new" className={navLinkClass}>
                + New
              </NavLink>
            </nav>
          </div>
          <div className="flex items-center gap-3 text-sm">
            {isSuperAdmin && (
              <Link
                to="/admin/users"
                className="rounded-full bg-rose-100 px-2.5 py-0.5 text-xs font-medium text-rose-800 hover:bg-rose-200"
                title="Super admin tools"
              >
                ★ Super Admin
              </Link>
            )}
            <Link
              to="/account"
              className="hidden text-gray-600 hover:text-gray-900 sm:inline"
              title="Account settings"
            >
              {displayName}
            </Link>
            <button
              onClick={handleSignOut}
              className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700 transition hover:bg-gray-50"
            >
              Logout
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-6 sm:px-6 sm:py-8">
        {children}
      </main>
    </div>
  )
}
