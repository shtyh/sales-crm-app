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
import type { Profile } from './types'

type AuthState = {
  /** Current Supabase session (null when signed out). */
  session: Session | null
  /** Convenience: the user behind the current session. */
  user: User | null
  /** The signed-in user's profile row (loaded after session is established). */
  profile: Profile | null
  /** True if the current user has the admin flag in their profile. */
  isAdmin: boolean
  /** True until the initial session + profile load has resolved. */
  loading: boolean
  /** Re-fetch the profile (e.g. after the user changes their display name). */
  refreshProfile: () => Promise<void>
}

const AuthContext = createContext<AuthState>({
  session: null,
  user: null,
  profile: null,
  isAdmin: false,
  loading: true,
  refreshProfile: async () => {},
})

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
    } catch {
      setProfile(null)
    }
  }, [])

  useEffect(() => {
    let alive = true

    // Initial hydration from the locally cached session.
    supabase.auth.getSession().then(async ({ data }) => {
      if (!alive) return
      setSession(data.session)
      await loadProfileFor(data.session?.user?.id)
      if (alive) setLoading(false)
    })

    // React to sign-in / sign-out / token refresh.
    const { data: sub } = supabase.auth.onAuthStateChange(async (_event, next) => {
      setSession(next)
      await loadProfileFor(next?.user?.id)
    })

    return () => {
      alive = false
      sub.subscription.unsubscribe()
    }
  }, [loadProfileFor])

  const refreshProfile = useCallback(async () => {
    await loadProfileFor(session?.user?.id)
  }, [loadProfileFor, session?.user?.id])

  const value = useMemo<AuthState>(
    () => ({
      session,
      user: session?.user ?? null,
      profile,
      isAdmin: !!profile?.is_admin,
      loading,
      refreshProfile,
    }),
    [session, profile, loading, refreshProfile],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  return useContext(AuthContext)
}

/** Sign out the current user. */
export async function signOut() {
  await supabase.auth.signOut()
}
