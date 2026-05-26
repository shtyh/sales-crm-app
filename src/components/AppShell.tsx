import type { ReactNode } from 'react'
import { Link, NavLink, useNavigate } from 'react-router-dom'
import { useAuth, signOut } from '../lib/auth'
import { useOnlineStatus } from '../lib/online'
import { useWorkspace, type Workspace } from '../lib/workspace'

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
 *
 * Super admin gets a Sales/Service workspace toggle that filters the nav
 * to one side of the business at a time — purely visual, no permission
 * change. Every other role ignores the workspace and sees their usual
 * role-gated nav.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const {
    user,
    role,
    isAdmin,
    isSuperAdmin,
    isFinanceAdmin,
    canApproveDiscount,
    canViewCustomers,
    isWorkshopOnly,
  } = useAuth()
  const { workspace, setWorkspace } = useWorkspace()
  const online = useOnlineStatus()
  const navigate = useNavigate()
  const displayName =
    (user?.user_metadata?.full_name as string | undefined) ?? user?.email ?? ''

  // Decide which side(s) of the nav to show:
  //   * super_admin: the workspace toggle picks one side at a time.
  //   * workshop-only roles (service_*, store_keeper, mechanic): always
  //     service-only; they have no business on the sales nav.
  //   * sales-side & admin roles (sales_advisor, sales_manager,
  //     general_admin, finance_admin): sales nav only; the Vehicles / Job
  //     order links are service-team turf.
  let showSales: boolean
  let showService: boolean
  if (isSuperAdmin) {
    showSales = workspace === 'sales'
    showService = workspace === 'service'
  } else if (isWorkshopOnly) {
    showSales = false
    showService = true
  } else {
    showSales = true
    showService = false
  }

  // Booking creation is for the sales floor + super_admin only.
  // general_admin and finance_admin can view bookings but not open new ones.
  const canCreateBooking =
    role === 'sales_advisor' ||
    role === 'sales_manager' ||
    role === 'super_admin'

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
            <nav className="ml-2 flex items-center gap-1 sm:ml-4">
              <NavLink to="/" end className={navLinkClass}>
                Home
              </NavLink>
              {showSales && (
                <NavLink to="/bookings" className={navLinkClass}>
                  Bookings
                </NavLink>
              )}
              {showSales && canViewCustomers && (
                <NavLink to="/customers" className={navLinkClass}>
                  Customers
                </NavLink>
              )}
              {showSales && isAdmin && (
                <NavLink to="/cars" className={navLinkClass}>
                  Inventory
                </NavLink>
              )}
              {showService && isAdmin && (
                <NavLink to="/vehicles" className={navLinkClass}>
                  Vehicles
                </NavLink>
              )}
              {showService && isAdmin && (
                <NavLink to="/service-orders/new" className={navLinkClass}>
                  + Job order
                </NavLink>
              )}
              {showSales && isFinanceAdmin && (
                <NavLink to="/finance" className={navLinkClass}>
                  Finance
                </NavLink>
              )}
              {showSales && canApproveDiscount && (
                <NavLink to="/commissions" className={navLinkClass}>
                  Commissions
                </NavLink>
              )}
              {showSales && isSuperAdmin && (
                <NavLink
                  to="/admin/commissions"
                  className={navLinkClass}
                  title="Set base commission per car model"
                >
                  Rates
                </NavLink>
              )}
              {showSales && canCreateBooking && (
                <NavLink to="/bookings/new" className={navLinkClass}>
                  + New
                </NavLink>
              )}
            </nav>
          </div>
          <div className="flex items-center gap-3 text-sm">
            <OnlineDot online={online} />
            {isSuperAdmin && (
              <WorkspaceToggle
                workspace={workspace}
                onChange={setWorkspace}
              />
            )}
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

/**
 * Tiny status pip — green when the browser thinks it's online, red when
 * offline. We keep the dot visible always (not just when offline) so it
 * doubles as a "this app is connected, you're good" confidence signal.
 */
function OnlineDot({ online }: { online: boolean }) {
  return (
    <span
      title={
        online
          ? 'Online — changes are saving to the server'
          : 'Offline — your changes are saved locally and will retry'
      }
      aria-label={online ? 'Online' : 'Offline'}
      className={`inline-block h-2 w-2 rounded-full ${
        online ? 'bg-green-500' : 'bg-red-500 animate-pulse'
      }`}
    />
  )
}

/**
 * Two-pill segmented control for the super_admin's Sales / Service
 * workspace toggle. Renders nothing for any other role (the parent
 * already gates rendering, but keep it self-contained for clarity).
 */
function WorkspaceToggle({
  workspace,
  onChange,
}: {
  workspace: Workspace
  onChange: (next: Workspace) => void
}) {
  const pill = (active: boolean) =>
    `rounded-md px-2.5 py-1 text-xs font-medium transition ${
      active
        ? 'bg-white text-gray-900 shadow-sm'
        : 'text-gray-500 hover:text-gray-800'
    }`
  return (
    <div
      role="group"
      aria-label="Workspace"
      className="flex items-center rounded-lg border border-gray-200 bg-gray-100 p-0.5"
    >
      <button
        type="button"
        onClick={() => onChange('sales')}
        className={pill(workspace === 'sales')}
        title="Show sales-side nav"
      >
        Sales
      </button>
      <button
        type="button"
        onClick={() => onChange('service')}
        className={pill(workspace === 'service')}
        title="Show service-side nav"
      >
        Service
      </button>
    </div>
  )
}
