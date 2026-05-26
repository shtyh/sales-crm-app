import { supabase } from './supabase'
import type { Part } from './types'

/**
 * Every part in the inventory master, sorted by part_no. Workshop
 * dashboard filters this client-side for the low-stock alert
 * (`stock_qty <= reorder_level AND is_active`) because PostgREST
 * doesn't expose column-to-column comparisons in its filter syntax.
 */
export async function listParts(): Promise<Part[]> {
  const { data, error } = await supabase
    .from('parts_inventory')
    .select('*')
    .order('part_no', { ascending: true })

  if (error) throw error
  return (data ?? []) as Part[]
}
