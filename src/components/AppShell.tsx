import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  Link,
  NavLink,
  useLocation,
  useNavigate,
} from 'react-router-dom'
import { useAuth, signOut } from '../lib/auth'
import { useOnlineStatus } from '../lib/online'

/** URL prefixes that mean "we're on the workshop / service side." Used to
 *  flip the nav into Service mode without needing a separate workspace
 *  state — the current route IS the workspace. */
const SERVICE_PREFIXES = ['/service', '/service-orders', '/vehicles']
function isServicePath(pathname: string): boolean {
  return SERVICE_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(p + '/') || pathname.startsWith(p + '?'),
  )
}

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
  const location = useLocation()
  const online = useOnlineStatus()
  const navigate = useNavigate()
  const onServicePath = isServicePath(location.pathname)
  // Both the brand logo and the Home nav link send the user to the
  // dashboard for the side they're currently on, so clicking Home from
  // /service/* doesn't bump them back into the Sales workspace.
  const homePath = onServicePath ? '/service' : '/'
  const displayName =
    (user?.user_metadata?.full_name as string | undefined) ?? user?.email ?? ''
  const email = user?.email ?? ''

  // Decide which side of the nav to show. Driven by the current URL so
  // the workshop nav only shows up on workshop pages, and vice-versa.
  //   * workshop-only roles: always service.
  //   * super_admin + any other admin on a /service* URL: service nav.
  //   * everyone else: sales nav.
  // For super_admin the SideSwitcher pill (rendered near the avatar)
  // lets them hop between sides explicitly; for other roles the route
  // guards already gate them out of the wrong side.
  let showSales: boolean
  let showService: boolean
  if (isWorkshopOnly) {
    showSales = false
    showService = true
  } else if (onServicePath) {
    showSales = false
    showService = true
  } else {
    showSales = true
    showService = false
  }

  const canCreateBooking =
    role === 'sales_advisor' ||
    role === 'sales_manager' ||
    role === 'super_admin'

  // Single source of truth for the primary nav links, shared by the
  // desktop inline nav and the mobile hamburger drawer so the two can't
  // drift. Visibility mirrors the role/side gating used inline before.
  const navItems: { to: string; label: string; end?: boolean }[] = []
  if (!isFinanceAdmin) navItems.push({ to: homePath, label: 'Home', end: true })
  if (showSales) navItems.push({ to: '/bookings', label: 'Bookings' })
  if (showSales && canViewCustomers)
    navItems.push({ to: '/customers', label: 'Customers' })
  if (showSales && isAdmin) navItems.push({ to: '/cars', label: 'Inventory' })
  if (showService && isAdmin)
    navItems.push({ to: '/service-orders/new', label: '+ Job order' })
  if (showService && isSuperAdmin)
    navItems.push({ to: '/service/appointments', label: 'Appointments' })
  if (showSales && isFinanceAdmin)
    navItems.push({ to: '/finance', label: 'Finance' })
  if (showSales && (isFinanceAdmin || role === 'sales_manager'))
    navItems.push({ to: '/reconciliation', label: 'Reconcile' })
  if (showSales && canApproveDiscount)
    navItems.push({ to: '/commissions', label: 'Commissions' })
  if (showSales && (role === 'sales_advisor' || role === 'sales_manager'))
    navItems.push({ to: '/commission-verify', label: 'Verify Commission' })

  async function handleSignOut() {
    await signOut()
    navigate('/login', { replace: true })
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="border-b border-gray-200 bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <div className="flex min-w-0 items-center gap-1 sm:gap-4">
            <Link to={homePath} className="flex items-center gap-2">
              <span className="text-xl">🚗</span>
              <span className="hidden font-semibold text-gray-900 sm:inline">
                SWL Motors
              </span>
            </Link>
            {/* Phone: collapse the links into a hamburger drawer. */}
            <MobileNav
              navItems={navItems}
              isSuperAdmin={isSuperAdmin}
              onService={onServicePath}
              onSwitch={(to) => navigate(to === 'service' ? '/service' : '/')}
            />
            {/* sm+: the full inline nav. */}
            <nav className="ml-1 hidden items-center gap-1 sm:ml-3 sm:flex">
              {navItems.map((item) => (
                <NavLink
                  key={item.label}
                  to={item.to}
                  end={item.end}
                  className={navLinkClass}
                >
                  {item.label}
                </NavLink>
              ))}
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
              <div className="hidden sm:block">
                <SideSwitcher
                  onService={onServicePath}
                  onSwitch={(to) =>
                    navigate(to === 'service' ? '/service' : '/')
                  }
                />
              </div>
            )}
            <UserMenu
              displayName={displayName}
              email={isSuperAdmin ? '' : email}
              online={online}
              isSuperAdmin={isSuperAdmin}
              showAttendance={role !== 'sales_advisor'}
              hasTeamView={
                role === 'super_admin' ||
                role === 'sales_manager' ||
                role === 'service_manager'
              }
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
  showAttendance,
  hasTeamView,
  onSignOut,
}: {
  displayName: string
  email: string
  online: boolean
  isSuperAdmin: boolean
  showAttendance: boolean
  hasTeamView: boolean
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
          {showAttendance && (
            <>
              <MenuLink to="/clock-in" onClick={() => setOpen(false)}>
                🕒 Clock in / out
              </MenuLink>
              <MenuLink to="/attendance" onClick={() => setOpen(false)}>
                My attendance
              </MenuLink>
              {hasTeamView && (
                <MenuLink
                  to="/admin/attendance"
                  onClick={() => setOpen(false)}
                >
                  Team attendance
                </MenuLink>
              )}
            </>
          )}
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
 * Phone-only hamburger that collapses the primary nav links — and, for
 * super_admin, the Sales/Service switcher — into a dropdown drawer, so the
 * top bar stays tidy instead of overflowing into truncated links and a
 * clipped avatar. Hidden at `sm` and up, where the inline nav takes over.
 * Closes on outside click, Escape, link tap, or any route change.
 */
function MobileNav({
  navItems,
  isSuperAdmin,
  onService,
  onSwitch,
}: {
  navItems: { to: string; label: string; end?: boolean }[]
  isSuperAdmin: boolean
  onService: boolean
  onSwitch: (to: 'sales' | 'service') => void
}) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const location = useLocation()

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

  // Collapse on any navigation — covers both link taps and the
  // Sales/Service switch navigating to the other side's landing.
  useEffect(() => {
    setOpen(false)
  }, [location.pathname])

  return (
    <div className="relative sm:hidden" ref={wrapRef}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Navigation menu"
        className="flex h-9 w-9 items-center justify-center rounded-lg text-gray-700 transition hover:bg-gray-100"
      >
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          aria-hidden="true"
        >
          {open ? (
            <>
              <line x1="6" y1="6" x2="18" y2="18" />
              <line x1="6" y1="18" x2="18" y2="6" />
            </>
          ) : (
            <>
              <line x1="3" y1="6" x2="21" y2="6" />
              <line x1="3" y1="12" x2="21" y2="12" />
              <line x1="3" y1="18" x2="21" y2="18" />
            </>
          )}
        </svg>
      </button>

      {open && (
        <div
          role="menu"
          className="absolute left-0 z-20 mt-2 w-56 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-lg"
        >
          <nav className="py-1">
            {navItems.map((item) => (
              <NavLink
                key={item.label}
                to={item.to}
                end={item.end}
                onClick={() => setOpen(false)}
                className={({ isActive }) =>
                  `block px-4 py-2 text-sm transition ${
                    isActive
                      ? 'bg-gray-900 text-white'
                      : 'text-gray-700 hover:bg-gray-50'
                  }`
                }
              >
                {item.label}
              </NavLink>
            ))}
          </nav>
          {isSuperAdmin && (
            <div className="border-t border-gray-100 px-4 py-3">
              <div className="mb-1.5 text-xs font-medium uppercase tracking-wide text-gray-400">
                Workspace
              </div>
              <SideSwitcher onService={onService} onSwitch={onSwitch} />
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/**
 * Two-pill segmented control for super_admin to hop between the Sales
 * landing (`/`) and the Service appointments view (`/service/appointments`).
 * The nav itself derives its side from the URL (`onServicePath`), so this
 * pill is purely a *navigation* action — not a state toggle. Re-introduced
 * 2026-05-29 after the URL-driven nav split shipped, so super_admin still
 * has a one-click way to cross sides.
 */
function SideSwitcher({
  onService,
  onSwitch,
}: {
  onService: boolean
  onSwitch: (to: 'sales' | 'service') => void
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
        onClick={() => onSwitch('sales')}
        className={pill(!onService)}
        title="Go to Sales home"
      >
        Sales
      </button>
      <button
        type="button"
        onClick={() => onSwitch('service')}
        className={pill(onService)}
        title="Go to Service appointments"
      >
        Service
      </button>
    </div>
  )
}
