import { useEffect, useRef, useState, type ReactNode } from 'react'
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
 * Page chrome shared by every authenticated screen. Header layout:
 *
 *   [brand]  [primary nav...]                  [+New] [toggle] [avatar▾]
 *
 * The avatar dropdown is the consolidation point for the right-hand cluster
 * (online status, name/email, super-admin tools, logout) — keeping the
 * top bar visually quiet when there's nothing the user needs to react to.
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
  const email = user?.email ?? ''

  // Decide which side(s) of the nav to show:
  //   * super_admin: the workspace toggle picks one side at a time.
  //   * workshop-only roles (service_*, store_keeper, mechanic): always
  //     service-only.
  //   * everyone else: sales nav only.
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

  // Super admin no longer sees + New booking — they shouldn't be creating
  // bookings in real life, and hiding it keeps their nav cleaner.
  const canCreateBooking =
    role === 'sales_advisor' || role === 'sales_manager'

  async function handleSignOut() {
    await signOut()
    navigate('/login', { replace: true })
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="border-b border-gray-200 bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <div className="flex min-w-0 items-center gap-1 sm:gap-4">
            <Link to="/" className="flex items-center gap-2">
              <span className="text-xl">🚗</span>
              <span className="hidden font-semibold text-gray-900 sm:inline">
                SWL Motors
              </span>
            </Link>
            <nav className="ml-1 flex items-center gap-1 sm:ml-3">
              {!isFinanceAdmin && (
                <NavLink to="/" end className={navLinkClass}>
                  Home
                </NavLink>
              )}
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
            </nav>
          </div>

          <div className="flex items-center gap-2">
            {showSales && canCreateBooking && (
              <NavLink
                to="/bookings/new"
                className="rounded-lg bg-gray-900 px-3 py-1.5 text-sm font-medium text-white shadow-sm transition hover:bg-gray-800"
              >
                + New
              </NavLink>
            )}
            {isSuperAdmin && (
              <WorkspaceToggle
                workspace={workspace}
                onChange={setWorkspace}
              />
            )}
            <UserMenu
              displayName={displayName}
              email={isSuperAdmin ? '' : email}
              online={online}
              isSuperAdmin={isSuperAdmin}
              onSignOut={handleSignOut}
            />
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
 * Avatar + dropdown housing the user's account info, super-admin shortcuts,
 * and the Logout action. Closes on outside click or Escape.
 */
function UserMenu({
  displayName,
  email,
  online,
  isSuperAdmin,
  onSignOut,
}: {
  displayName: string
  email: string
  online: boolean
  isSuperAdmin: boolean
  onSignOut: () => void
}) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) return
    function onDown(e: MouseEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  const initials = (displayName || email)
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase() ?? '')
    .join('') || '?'

  return (
    <div className="relative" ref={wrapRef}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        title={displayName}
        className={`relative flex h-9 w-9 items-center justify-center rounded-full text-sm font-semibold text-white shadow-sm transition ${
          isSuperAdmin
            ? 'bg-rose-600 hover:bg-rose-700'
            : 'bg-gray-700 hover:bg-gray-800'
        }`}
      >
        {initials}
        <span
          aria-label={online ? 'Online' : 'Offline'}
          title={online ? 'Online' : 'Offline'}
          className={`absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-white ${
            online ? 'bg-green-500' : 'bg-red-500 animate-pulse'
          }`}
        />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 z-20 mt-2 w-64 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-lg"
        >
          <div className="border-b border-gray-100 px-4 py-3">
            <div className="truncate text-sm font-medium text-gray-900">
              {displayName || 'Signed in'}
            </div>
            {email && (
              <div className="truncate text-xs text-gray-500">{email}</div>
            )}
            <div className="mt-1 text-xs text-gray-500">
              <span
                className={`mr-1 inline-block h-1.5 w-1.5 rounded-full align-middle ${
                  online ? 'bg-green-500' : 'bg-red-500'
                }`}
              />
              {online ? 'Online' : 'Offline'}
            </div>
          </div>
          <MenuLink to="/account" onClick={() => setOpen(false)}>
            Account
          </MenuLink>
          {isSuperAdmin && (
            <>
              <MenuLink to="/admin/users" onClick={() => setOpen(false)}>
                <span className="text-rose-700">★</span> Manage users
              </MenuLink>
              <MenuLink
                to="/admin/commissions"
                onClick={() => setOpen(false)}
              >
                Commission rates
              </MenuLink>
            </>
          )}
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false)
              onSignOut()
            }}
            className="block w-full border-t border-gray-100 px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-50"
          >
            Logout
          </button>
        </div>
      )}
    </div>
  )
}

function MenuLink({
  to,
  onClick,
  children,
}: {
  to: string
  onClick: () => void
  children: ReactNode
}) {
  return (
    <Link
      to={to}
      role="menuitem"
      onClick={onClick}
      className="block px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
    >
      {children}
    </Link>
  )
}

/**
 * Two-pill segmented control for the super_admin's Sales / Service
 * workspace toggle. Renders nothing for any other role.
 */
function WorkspaceToggle({
  workspace,
  onChange,
}: {
  workspace: Workspace
  onChange: (next: Workspace) => void
}) {
  const pill = (active: boolean) =>
    `rounded-md px-2 py-1 text-xs font-medium transition ${
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
