import { useEffect, useState } from 'react'

/**
 * The super_admin can flip the top-nav between two "workspaces" so they
 * can focus on one side of the business at a time. This isn't a security
 * boundary — they keep every permission they had — it's a visual filter
 * that hides nav links that don't belong to the active workspace.
 *
 * For every other role the workspace state is ignored; their nav is
 * already gated to whatever fits their role.
 */
export type Workspace = 'sales' | 'service'

const STORAGE_KEY = 'swl_workspace'
// Custom event so two components inside the same tab stay in sync when
// the toggle is flipped (the native `storage` event only fires on
// *other* tabs). We dispatch it ourselves on every setWorkspace.
const EVENT_NAME = 'swl-workspace-change'

function load(): Workspace {
  if (typeof window === 'undefined') return 'sales'
  return window.localStorage.getItem(STORAGE_KEY) === 'service'
    ? 'service'
    : 'sales'
}

export function useWorkspace() {
  const [workspace, setLocal] = useState<Workspace>(load)

  useEffect(() => {
    function refresh() {
      setLocal(load())
    }
    window.addEventListener(EVENT_NAME, refresh)
    // Cross-tab sync — flipping the toggle in tab A updates tab B too.
    window.addEventListener('storage', refresh)
    return () => {
      window.removeEventListener(EVENT_NAME, refresh)
      window.removeEventListener('storage', refresh)
    }
  }, [])

  function setWorkspace(next: Workspace) {
    window.localStorage.setItem(STORAGE_KEY, next)
    window.dispatchEvent(new Event(EVENT_NAME))
    setLocal(next)
  }

  return { workspace, setWorkspace }
}
