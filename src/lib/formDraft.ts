import { useCallback, useEffect, useRef } from 'react'

/**
 * Auto-save a form's state to localStorage and hydrate it back on the
 * next mount. Designed for the workshop's flaky-wifi use case: an SA
 * starts filling a service order, the tab crashes / network blinks, they
 * reopen the page and pick up exactly where they left off.
 *
 * Usage pattern (non-invasive — keeps individual useState calls intact):
 *
 *   const form = { customerId, vehicleId, complaint, mileageIn, notes }
 *   const clearDraft = useFormDraft('so-intake-draft', form, (d) => {
 *     setCustomerId(d.customerId)
 *     setVehicleId(d.vehicleId)
 *     // …
 *   })
 *   // After a successful submit:
 *   clearDraft()
 *
 * The hydration effect fires exactly once on mount so a draft only
 * pre-fills an *empty* form. The save effect debounces writes by 300ms
 * to keep localStorage churn low while the user is typing.
 */
export function useFormDraft<T extends object>(
  key: string,
  form: T,
  applyDraft: (draft: T) => void,
): () => void {
  // Track first render — hydration only runs then, so a draft never
  // clobbers later in-progress user input.
  const hydrated = useRef(false)
  // Keep a stable reference to the apply callback so the hydration
  // effect's deps stay [key].
  const applyRef = useRef(applyDraft)
  useEffect(() => {
    applyRef.current = applyDraft
  })

  useEffect(() => {
    if (hydrated.current) return
    hydrated.current = true
    try {
      const raw = window.localStorage.getItem(key)
      if (!raw) return
      const parsed = JSON.parse(raw) as T
      applyRef.current(parsed)
    } catch {
      // Corrupt JSON / quota / private-mode — silently ignore. Draft
      // recovery is best-effort.
    }
  }, [key])

  // Debounced save on every state change after hydration.
  useEffect(() => {
    if (!hydrated.current) return
    const t = window.setTimeout(() => {
      try {
        window.localStorage.setItem(key, JSON.stringify(form))
      } catch {
        // Quota exceeded / safari private — drop the save silently.
      }
    }, 300)
    return () => window.clearTimeout(t)
  }, [key, form])

  return useCallback(() => {
    try {
      window.localStorage.removeItem(key)
    } catch {
      /* ignore */
    }
  }, [key])
}
