import { supabase } from './supabase'
import type { Part } from './types'

/**
 * Every part in the inventory master, sorted by part_no. Workshop
 * dashboard filters this client-side for the low-stock alert
 * (`stock_qty <= reorder_level AND is_active`) because PostgREST
 * doesn't expose column-to-column comparisons in its filter syntax.
 *
 * NB: parts_inventory is ~80k rows after the AUTFTP02 import. Don't
 * call this from a hot path — use `searchParts` instead. Kept around
 * for the existing low-stock alert which fetches everything once on
 * dashboard mount and caches.
 */
export async function listParts(): Promise<Part[]> {
  const { data, error } = await supabase
    .from('parts_inventory')
    .select('*')
    .order('part_no', { ascending: true })

  if (error) throw error
  return (data ?? []) as Part[]
}

export const PARTS_PAGE_SIZE = 50

/**
 * Server-side paginated parts search. `q` matches part_no OR name
 * (case-insensitive). Returns the page slice plus the total count so
 * the FE can render "page X of Y".
 *
 * Sort order: part_no ASC, the legacy WMS convention.
 */
export async function searchParts({
  q,
  page,
  category,
  activeOnly,
}: {
  q: string
  page: number
  category?: 'OIL' | 'PRT' | ''
  activeOnly?: boolean
}): Promise<{ rows: Part[]; total: number }> {
  const from = page * PARTS_PAGE_SIZE
  const to = from + PARTS_PAGE_SIZE - 1

  let query = supabase
    .from('parts_inventory')
    .select('*', { count: 'exact' })
    .order('part_no', { ascending: true })
    .range(from, to)

  const needle = q.trim()
  if (needle) {
    // OR across two text columns. PostgREST treats this as
    // (part_no ilike '%X%' OR name ilike '%X%').
    const escaped = needle.replace(/[%,]/g, '')
    query = query.or(`part_no.ilike.%${escaped}%,name.ilike.%${escaped}%`)
  }
  if (category) {
    query = query.eq('category', category)
  }
  if (activeOnly) {
    query = query.eq('is_active', true)
  }

  const { data, error, count } = await query
  if (error) throw error
  return { rows: (data ?? []) as Part[], total: count ?? 0 }
}

export type PartPatch = Partial<
  Pick<
    Part,
    | 'name'
    | 'description'
    | 'brand'
    | 'unit'
    | 'unit_cost'
    | 'unit_price'
    | 'stock_qty'
    | 'reorder_level'
    | 'location'
    | 'category'
    | 'is_active'
  >
>

export type PartsStats = {
  total: number
  active: number
  value_rm: number
  low_stock: number
}

/** Aggregate stats for the Stock Menu headline counters. Server-side SQL
 *  so we don't drag the full 80k catalogue over the wire just to count it
 *  (and to stop the PostgREST 1000-row default cap from understating
 *  totals). */
export async function getPartsStats(): Promise<PartsStats> {
  const { data, error } = await supabase
    .rpc('parts_inventory_stats')
    .single()
  if (error) throw error
  const row = data as {
    total: number
    active: number
    value_rm: number | string
    low_stock: number
  }
  return {
    total: Number(row.total),
    active: Number(row.active),
    value_rm: Number(row.value_rm),
    low_stock: Number(row.low_stock),
  }
}

export async function updatePart(id: string, patch: PartPatch): Promise<Part> {
  const { data, error } = await supabase
    .from('parts_inventory')
    .update(patch)
    .eq('id', id)
    .select('*')
    .single()
  if (error) throw error
  return data as Part
}
