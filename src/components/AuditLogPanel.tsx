import { useMemo } from 'react'
import { useAuth } from '../lib/auth'
import { useAuditForRow, useProfiles } from '../lib/queries'
import { formatError } from '../lib/errors'
import { ROLE_LABEL, type Profile } from '../lib/types'

/**
 * Renders the most recent audit entries for one row.
 * Quietly renders nothing when the caller is not super_admin (the
 * audit_log RLS would return [] anyway, but we skip the network too).
 */
export function AuditLogPanel({
  tableName,
  rowId,
}: {
  tableName: string
  rowId: string
}) {
  const { isSuperAdmin } = useAuth()
  const { data: entries, error, isLoading } = useAuditForRow(
    tableName,
    rowId,
    isSuperAdmin,
  )
  // Reuse profiles (cached); cheaper than joining server-side.
  const { data: profiles } = useProfiles(isSuperAdmin)
  const profileById = useMemo(() => {
    const m = new Map<string, Profile>()
    profiles?.forEach((p) => m.set(p.id, p))
    return m
  }, [profiles])

  if (!isSuperAdmin) return null

  return (
    <section className="mt-6 rounded-2xl border border-gray-200 bg-white p-5">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-gray-900">
          🕓 Activity
        </h2>
        <span className="text-[10px] uppercase tracking-wider text-rose-500">
          Super Admin view
        </span>
      </div>

      {error && (
        <div
          role="alert"
          className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700"
        >
          {formatError(error)}
        </div>
      )}

      {isLoading && (
        <div className="text-xs text-gray-400">Loading…</div>
      )}

      {entries && entries.length === 0 && !isLoading && (
        <div className="text-xs text-gray-500">No history yet.</div>
      )}

      {entries && entries.length > 0 && (
        <ol className="space-y-2">
          {entries.map((e) => {
            const actor = e.actor_id ? profileById.get(e.actor_id) : null
            const actorName =
              actor?.full_name ||
              actor?.email ||
              (e.actor_id ? '(deleted user)' : 'system')
            const roleLabel = e.actor_role ? ROLE_LABEL[e.actor_role] : '—'
            const changedKeys = e.changed
              ? Object.keys(e.changed).filter((k) => k !== 'id' && k !== 'created_at')
              : []

            return (
              <li
                key={e.id}
                className="rounded-lg border border-gray-100 bg-gray-50 px-3 py-2"
              >
                <div className="flex flex-wrap items-baseline gap-2 text-xs">
                  <span className="text-gray-500">
                    {formatWhen(e.occurred_at)}
                  </span>
                  <span className="font-medium text-gray-900">{actorName}</span>
                  <span className="text-[10px] text-gray-500">
                    ({roleLabel})
                  </span>
                  <span
                    className={`ml-auto rounded-full px-2 py-0.5 text-[10px] font-medium ${
                      e.operation === 'INSERT'
                        ? 'bg-green-100 text-green-800'
                        : e.operation === 'DELETE'
                          ? 'bg-red-100 text-red-700'
                          : 'bg-blue-100 text-blue-800'
                    }`}
                  >
                    {e.operation}
                  </span>
                </div>

                {e.operation === 'UPDATE' && changedKeys.length > 0 && (
                  <ul className="mt-1 space-y-0.5 text-xs">
                    {changedKeys.map((k) => (
                      <li key={k} className="flex flex-wrap gap-1">
                        <span className="font-mono text-gray-600">{k}:</span>
                        <span className="font-mono text-red-700 line-through">
                          {fmt(e.old_values?.[k])}
                        </span>
                        <span className="text-gray-400">→</span>
                        <span className="font-mono text-green-700">
                          {fmt(e.changed?.[k])}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}

                {e.operation === 'INSERT' && (
                  <div className="mt-1 text-xs text-gray-500">
                    Created with {changedKeys.length} field
                    {changedKeys.length === 1 ? '' : 's'}.
                  </div>
                )}

                {e.operation === 'DELETE' && (
                  <div className="mt-1 text-xs text-red-700">
                    Hard-deleted.
                  </div>
                )}
              </li>
            )
          })}
        </ol>
      )}
    </section>
  )
}

function formatWhen(iso: string) {
  return new Date(iso).toLocaleString('en-MY', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function fmt(v: unknown): string {
  if (v === null || v === undefined) return '∅'
  if (typeof v === 'string') return v.length > 40 ? `${v.slice(0, 40)}…` : v
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  return JSON.stringify(v).slice(0, 60)
}
