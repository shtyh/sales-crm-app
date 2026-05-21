/**
 * Extract a human-readable message from any value thrown by Supabase, fetch,
 * or our own code. Falls back to JSON or `String(e)` only when nothing else
 * is available — never returns `"[object Object]"`.
 */
export function formatError(e: unknown): string {
  if (typeof e === 'string') return e
  if (e instanceof Error) return e.message

  if (e && typeof e === 'object') {
    const obj = e as Record<string, unknown>
    if (typeof obj.message === 'string' && obj.message) return obj.message
    if (typeof obj.error_description === 'string' && obj.error_description)
      return obj.error_description
    if (typeof obj.error === 'string' && obj.error) return obj.error
    if (typeof obj.details === 'string' && obj.details) return obj.details
    if (typeof obj.hint === 'string' && obj.hint) return obj.hint
    try {
      return JSON.stringify(e)
    } catch {
      /* fall through */
    }
  }

  return String(e)
}
