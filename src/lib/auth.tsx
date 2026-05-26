import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import type { Session, User } from '@supabase/supabase-js'
import { supabase } from './supabase'
import { getProfile } from './profiles'
import type { AppRole, Profile } from './types'

type AuthState = {
  session: Session | null
  user: User | null
  profile: Profile | null
  /** Caller's role, or null while loading / signed out. */
  role: AppRole | null
  /** Back-compat: true for any non-SA role (matches DB's is_admin column). */
  isAdmin: boolean
  isSuperAdmin: boolean
  isFinanceAdmin: boolean
  /** Sales manager (or super_admin god mode) — only roles allowed to cancel. */
  canCancel: boolean
  /** sales_manager (or super_admin) — Approve/Reject SA discount requests. */
  canApproveDiscount: boolean
  /** accountant (or super_admin) — write deposit/payment status. */
  canEditFinanceStatus: boolean
  /** sales_manager (or super_admin) — change a booking's owner_id. */
  canReassign: boolean
  /** general_admin (or super_admin) — write a car's vehicle attributes. */
  canEditCarAttributes: boolean
  /** finance_admin (or super_admin) — write a car's floor-stock fields. */
  canEditCarFloorStock: boolean
  /** general_admin or sales_manager (or super_admin) — assign bookings.car_id. */
  canAssignCar: boolean
  /** general_admin (or super_admin) — write JPJ tracking fields. */
  canEditJpj: boolean
  /**
   * super_admin / sales_manager / general_admin — only these can browse the
   * shared customers directory. SA + finance stay scoped to their own
   * booking flow.
   */
  canViewCustomers: boolean
  /**
   * Workshop-only roles: service_advisor / service_manager / store_keeper /
   * mechanic. They have no business on the sales side, so we hide every
   * sales nav link and bounce them off /bookings, /cars, /finance, etc.
   * super_admin is NOT workshop-only — they use the workspace toggle to
   * choose a side.
   */
  isWorkshopOnly: boolean
  /** Inverse of isWorkshopOnly. Used as the redirect gate on sales pages. */
  canAccessSales: boolean
  loading: boolean
  refreshProfile: () => Promise<void>
}

const AuthContext = createContext<AuthState>({
  session: null,
  user: null,
  profile: null,
  role: null,
  isAdmin: false,
  isSuperAdmin: false,
  isFinanceAdmin: false,
  canCancel: false,
  canApproveDiscount: false,
  canEditFinanceStatus: false,
  canReassign: false,
  canEditCarAttributes: false,
  canEditCarFloorStock: false,
  canAssignCar: false,
  canEditJpj: false,
  canViewCustomers: false,
  isWorkshopOnly: false,
  canAccessSales: false,
  loading: true,
  refreshProfile: async () => {},
})

// Hard ceiling on the initial auth-hydration phase. If anything (network,
// corrupt localStorage, a browser extension shimming globals) holds us up
// longer than this, we give up and let the app render the signed-out UI
// instead of showing a permanent "Loading…" spinner.
const AUTH_INIT_TIMEOUT_MS = 5000

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)

  const loadProfileFor = useCallback(async (userId: string | undefined) => {
    if (!userId) {
      setProfile(null)
      return
    }
    try {
      const p = await getProfile(userId)
      setProfile(p)
    } catch (e) {
      // Profile read should never break login; degrade gracefully.
      console.warn('Profile load failed:', e)
      setProfile(null)
    }
  }, [])

  useEffect(() => {
    let alive = true
    let settled = false

    function settle() {
      if (!alive || settled) return
      settled = true
      setLoading(false)
    }

    // Watchdog — if getSession or anything downstream is hanging, the user
    // should still get a working login page after a few seconds rather than
    // an indefinite spinner.
    const watchdog = setTimeout(() => {
      if (alive && !settled) {
        console.warn(
          `Auth init exceeded ${AUTH_INIT_TIMEOUT_MS}ms — proceeding as signed out.`,
        )
        setSession(null)
        setProfile(null)
        settle()
      }
    }, AUTH_INIT_TIMEOUT_MS)

    async function init() {
      try {
        const { data, error } = await supabase.auth.getSession()
        if (!alive) return

        if (error) {
          // The stored token is corrupt / refresh failed. Wipe it so the next
          // load starts from a clean slate, then continue as signed out.
          console.warn('Stored session is bad, clearing it:', error.message)
          try {
            await supabase.auth.signOut()
          } catch {
            /* ignore — best effort */
          }
          setSession(null)
        } else {
          setSession(data.session)
          await loadProfileFor(data.session?.user?.id)
        }
      } catch (e) {
        console.error('Auth init failed:', e)
        try {
          await supabase.auth.signOut()
        } catch {
          /* ignore */
        }
        if (alive) {
          setSession(null)
          setProfile(null)
        }
      } finally {
        clearTimeout(watchdog)
        settle()
      }
    }
    init()

    // Live updates on sign-in / sign-out / token refresh.
    //
    // CRITICAL: the callback must return synchronously. supabase-js holds an
    // internal lock while running it, and any awaited supabase call inside
    // would try to re-acquire that same lock and deadlock — symptoms are
    // that every subsequent REST request hangs forever (no error, no
    // network entry, just "Saving…" / "Loading…" stuck on the page).
    // See https://github.com/supabase/auth-js/issues/762
    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next)
      // Defer the follow-up profile fetch out of the lock-held callstack.
      setTimeout(() => {
        if (!alive) return
        loadProfileFor(next?.user?.id).catch((e) => {
          console.error('Auth state change profile load failed:', e)
        })
      }, 0)
    })

    return () => {
      alive = false
      clearTimeout(watchdog)
      sub.subscription.unsubscribe()
    }
  }, [loadProfileFor])

  const refreshProfile = useCallback(async () => {
    await loadProfileFor(session?.user?.id)
  }, [loadProfileFor, session?.user?.id])

  const value = useMemo<AuthState>(() => {
    const role = profile?.role ?? null
    return {
      session,
      user: session?.user ?? null,
      profile,
      role,
      isAdmin: !!profile?.is_admin,
      isSuperAdmin: role === 'super_admin',
      isFinanceAdmin: role === 'finance_admin' || role === 'super_admin',
      // Accountant role removed — only sales_manager can cancel now (plus
      // super_admin via god mode bypass at the DB level).
      canCancel:
        role === 'sales_manager' || role === 'super_admin',
      canApproveDiscount:
        role === 'sales_manager' || role === 'super_admin',
      // Cash-status ownership reverted to finance_admin after dropping the
      // accountant role.
      canEditFinanceStatus:
        role === 'finance_admin' || role === 'super_admin',
      canReassign:
        role === 'sales_manager' || role === 'super_admin',
      canEditCarAttributes:
        role === 'finance_admin' || role === 'super_admin',
      canEditCarFloorStock:
        role === 'finance_admin' || role === 'super_admin',
      canAssignCar:
        role === 'general_admin' ||
        role === 'sales_manager' ||
        role === 'super_admin',
      canEditJpj:
        role === 'general_admin' || role === 'super_admin',
      canViewCustomers:
        role === 'super_admin' ||
        role === 'sales_manager' ||
        role === 'general_admin',
      isWorkshopOnly:
        role === 'service_advisor' ||
        role === 'service_manager' ||
        role === 'store_keeper' ||
        role === 'mechanic',
      canAccessSales:
        // Anyone who isn't a workshop-only role can poke at sales. Includes
        // super_admin, sales-side staff, and finance_admin. While the role
        // is still loading (null) we conservatively allow access so we
        // don't flash a redirect before profile resolves.
        role == null ||
        !(
          role === 'service_advisor' ||
          role === 'service_manager' ||
          role === 'store_keeper' ||
          role === 'mechanic'
        ),
      loading,
      refreshProfile,
    }
  }, [session, profile, loading, refreshProfile])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  return useContext(AuthContext)
}

/** Sign out the current user. */
export async function signOut() {
  await supabase.auth.signOut()
}
