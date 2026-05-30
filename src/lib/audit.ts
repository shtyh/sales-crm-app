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
