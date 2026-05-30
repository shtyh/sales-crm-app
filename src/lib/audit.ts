import { supabase } from './supabase'
import type { AuditLogEntry } from './types'

/**
 * Recent audit entries for a single row. RLS restricts SELECT to super_admin,
 * so callers who aren't super_admin will simply get an empty list (no error).
 */
export async function listAuditForRow(
  tableName: string,
  rowId: string,
  limit = 20,
) {
  const { data, error } = await supabase
    .from('audit_log')
    .select('*')
    .eq('table_name', tableName)
    .eq('row_id', rowId)
    .order('occurred_at', { ascending: false })
    .limit(limit)
  if (error) throw error
  return data as AuditLogEntry[]
}

/**
 * Audit timeline for a booking: the booking row's own changes PLUS its
 * document upload/removal events (which live on `booking_attachments`, keyed
 * by `booking_id` inside the audit row's jsonb). Merged + newest first.
 * RLS limits SELECT to super_admin, so non-super callers get an empty list.
 */
export async function listAuditForBooking(
  bookingId: string,
  limit = 40,
): Promise<AuditLogEntry[]> {
  const [own, attach] = await Promise.all([
    supabase
      .from('audit_log')
      .select('*')
      .eq('table_name', 'bookings')
      .eq('row_id', bookingId)
      .order('occurred_at', { ascending: false })
      .limit(limit),
    supabase
      .from('audit_log')
      .select('*')
      .eq('table_name', 'booking_attachments')
      .or(
        `changed->>booking_id.eq.${bookingId},old_values->>booking_id.eq.${bookingId}`,
      )
      .order('occurred_at', { ascending: false })
      .limit(limit),
  ])
  if (own.error) throw own.error
  if (attach.error) throw attach.error
  const merged = [
    ...((own.data as AuditLogEntry[]) ?? []),
    ...((attach.data as AuditLogEntry[]) ?? []),
  ]
  merged.sort((a, b) => b.occurred_at.localeCompare(a.occurred_at))
  return merged.slice(0, limit)
}

/**
 * Recent audit entries for a whole table (any row), newest first. Used for
 * table-level change logs where per-row history isn't enough — e.g. so a
 * DELETE still shows up after its row is gone. RLS restricts SELECT to
 * super_admin, so non-super callers get an empty list (no error).
 */
export async function listAuditForTable(tableName: string, limit = 50) {
  const { data, error } = await supabase
    .from('audit_log')
    .select('*')
    .eq('table_name', tableName)
    .order('occurred_at', { ascending: false })
    .limit(limit)
  if (error) throw error
  return data as AuditLogEntry[]
}
