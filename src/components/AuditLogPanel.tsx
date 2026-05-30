import { useMemo } from 'react'
import { useAuth } from '../lib/auth'
import {
  useAuditForBooking,
  useAuditForRow,
  useAuditForTable,
  useProfiles,
} from '../lib/queries'
import { formatError } from '../lib/errors'
import { ROLE_LABEL, type AuditLogEntry, type Profile } from '../lib/types'

/** Cached id→profile map, gated on super_admin (RLS would empty it anyway). */
function useProfileMap(enabled: boolean) {
  const { data: profiles } = useProfiles(enabled)
  return useMemo(() => {
    const m = new Map<string, Profile>()
    profiles?.forEach((p) => m.set(p.id, p))
    return m
  }, [profiles])
}

/**
 * Most recent audit entries for one row. Quietly renders nothing when the
 * caller is not super_admin (audit_log RLS returns [] anyway; we also skip
 * the network).
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
  const profileById = useProfileMap(isSuperAdmin)
  if (!isSuperAdmin) return null
  return (
    <ActivityShell
      title="🕓 Activity"
      error={error}
      isLoading={isLoading}
      entries={entries}
      profileById={profileById}
    />
  )
}

/**
 * A booking's Activity: its own field changes PLUS document upload/removal
 * events (`booking_attachments`, surfaced via the audit trigger). Super-admin
 * only, same as AuditLogPanel.
 */
export function BookingActivityLog({ bookingId }: { bookingId: string }) {
  const { isSuperAdmin } = useAuth()
  const { data: entries, error, isLoading } = useAuditForBooking(
    bookingId,
    isSuperAdmin,
  )
  const profileById = useProfileMap(isSuperAdmin)
  if (!isSuperAdmin) return null
  return (
    <ActivityShell
      title="🕓 Activity"
      error={error}
      isLoading={isLoading}
      entries={entries}
      profileById={profileById}
    />
  )
}

/**
 * Table-wide change log (every row's INSERT/UPDATE/DELETE), newest first —
 * used where per-row history isn't enough, e.g. so a DELETE still shows after
 * its row is gone. `labelOf` lets the caller tag each entry with a human row
 * label (model/variant, etc.). Super-admin only, same as AuditLogPanel.
 */
export function TableActivityLog({
  tableName,
  title = '🕓 Change log',
  labelOf,
  limit = 50,
}: {
  tableName: string
  title?: string
  labelOf?: (entry: AuditLogEntry) => string | null
  limit?: number
}) {
  const { isSuperAdmin } = useAuth()
  const { data: entries, error, isLoading } = useAuditForTable(
    tableName,
    isSuperAdmin,
    limit,
  )
  const profileById = useProfileMap(isSuperAdmin)
  if (!isSuperAdmin) return null
  return (
    <ActivityShell
      title={title}
      error={error}
      isLoading={isLoading}
      entries={entries}
      profileById={profileById}
      labelOf={labelOf}
    />
  )
}

function ActivityShell({
  title,
  error,
  isLoading,
  entries,
  profileById,
  labelOf,
}: {
  title: string
  error: unknown
  isLoading: boolean
  entries: AuditLogEntry[] | undefined
  profileById: Map<string, Profile>
  labelOf?: (entry: AuditLogEntry) => string | null
}) {
  return (
    <section className="mt-6 rounded-2xl border border-gray-200 bg-white p-5">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-gray-900">{title}</h2>
        <span className="text-[10px] uppercase tracking-wider text-rose-500">
          Super Admin view
        </span>
      </div>

      {error ? (
        <div
          role="alert"
          className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700"
        >
          {formatError(error)}
        </div>
      ) : null}

      {isLoading && <div className="text-xs text-gray-400">Loading…</div>}

      {entries && entries.length === 0 && !isLoading && (
        <div className="text-xs text-gray-500">No history yet.</div>
      )}

      {entries && entries.length > 0 && (
        <ol className="space-y-2">
          {entries.map((e) => (
            <AuditEntryRow
              key={e.id}
              entry={e}
              profileById={profileById}
              label={labelOf?.(e) ?? null}
            />
          ))}
        </ol>
      )}
    </section>
  )
}

function AuditEntryRow({
  entry: e,
  profileById,
  label,
}: {
  entry: AuditLogEntry
  profileById: Map<string, Profile>
  label: string | null
}) {
  const actor = e.actor_id ? profileById.get(e.actor_id) : null
  const actorName =
    actor?.full_name ||
    actor?.email ||
    (e.actor_id ? '(deleted user)' : 'system')
  const roleLabel = e.actor_role ? ROLE_LABEL[e.actor_role] : '—'
  const changedKeys = e.changed
    ? Object.keys(e.changed).filter((k) => k !== 'id' && k !== 'created_at')
    : []
  const att = attachmentInfo(e)

  return (
    <li className="rounded-lg border border-gray-100 bg-gray-50 px-3 py-2">
      <div className="flex flex-wrap items-baseline gap-2 text-xs">
        <span className="text-gray-500">{formatWhen(e.occurred_at)}</span>
        <span className="font-medium text-gray-900">{actorName}</span>
        <span className="text-[10px] text-gray-500">({roleLabel})</span>
        {label && (
          <span className="rounded bg-gray-200 px-1.5 py-0.5 text-[10px] font-medium text-gray-700">
            {label}
          </span>
        )}
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

      {att ? (
        <div className="mt-1 text-xs text-gray-700">
          {e.operation === 'DELETE' ? '🗑 Removed ' : '📎 Uploaded '}
          <span className="font-medium">{att.kind}</span>
          {att.file && (
            <>
              {' — '}
              <span className="font-mono text-gray-600">{att.file}</span>
            </>
          )}
        </div>
      ) : (
        <>
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
            <div className="mt-1 text-xs text-red-700">Hard-deleted.</div>
          )}
        </>
      )}
    </li>
  )
}

const ATTACHMENT_KIND_LABEL: Record<string, string> = {
  bank_transaction: 'Bank transaction',
  bank_statement: 'Bank statement',
  lou: 'LOU',
  cancellation_form: 'Cancellation form',
  other: 'Document',
}

/** For a booking_attachments audit row, pull a friendly kind + filename out of
 *  the snapshot jsonb (INSERT → `changed`, DELETE → `old_values`). */
function attachmentInfo(
  e: AuditLogEntry,
): { kind: string; file: string } | null {
  if (e.table_name !== 'booking_attachments') return null
  const src = (e.changed ?? e.old_values ?? {}) as Record<string, unknown>
  const kindRaw = String(src.kind ?? '')
  const path = String(src.file_path ?? '')
  const file = path.split('/').pop() ?? ''
  return { kind: ATTACHMENT_KIND_LABEL[kindRaw] ?? kindRaw ?? 'Document', file }
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
