// Data layer for the Stock Received / Control module.
//
// Three operations:
//   * listSuppliers / listStockReceipts — read.
//   * findPartByCodeExact — quick lookup used by the line-item entry row.
//   * createStockReceipt — insert header + items inside a single round trip.
//     The DB trigger `apply_stock_receipt_item` bumps parts_inventory.

import { supabase } from './supabase'
import type {
  NewStockReceipt,
  Part,
  StockReceipt,
  StockReceiptItem,
  StockReceiptRow,
  Supplier,
} from './types'

export type NewSupplier = {
  code: string
  name: string
  person?: string | null
  phone?: string | null
  phone2?: string | null
  fax?: string | null
  email?: string | null
  address_line1?: string | null
  address_line2?: string | null
  address_line3?: string | null
  postcode?: string | null
  sst_no?: string | null
  tin_no?: string | null
  biz_activity?: string | null
  msic_code?: string | null
}

export async function createSupplier(input: NewSupplier): Promise<Supplier> {
  // Trim everything; convert empty strings to null so the optional columns
  // store NULL rather than '' (cleaner for downstream queries + dedup).
  const row = Object.fromEntries(
    Object.entries(input).map(([k, v]) => {
      if (typeof v === 'string') {
        const t = v.trim()
        return [k, t === '' ? null : t]
      }
      return [k, v]
    }),
  )
  const { data, error } = await supabase
    .from('suppliers')
    .insert(row)
    .select('*')
    .single()
  if (error) throw error
  return data as Supplier
}

export async function listSuppliers(): Promise<Supplier[]> {
  const { data, error } = await supabase
    .from('suppliers')
    .select('*')
    .eq('is_active', true)
    .order('code', { ascending: true })
  if (error) throw error
  return (data ?? []) as Supplier[]
}

export async function listStockReceipts(limit = 20): Promise<StockReceiptRow[]> {
  const { data, error } = await supabase
    .from('stock_receipts')
    .select(
      `
        id, receipt_no, receipt_date, supplier_id, invoice_no, invoice_date,
        do_no, po_no, remarks, total_qty, total_cost, created_by, created_at,
        supplier:suppliers(code, name),
        items:stock_receipt_items(id)
      `,
    )
    .order('receipt_date', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw error
  type Joined = StockReceipt & {
    supplier: { code: string; name: string } | Array<{ code: string; name: string }> | null
    items: Array<{ id: string }>
  }
  function pickFirst<T>(v: T | T[] | null): T | null {
    if (v == null) return null
    return Array.isArray(v) ? (v[0] ?? null) : v
  }
  return ((data as unknown as Joined[] | null) ?? []).map((row) => {
    const s = pickFirst(row.supplier)
    return {
      ...row,
      supplier_name: s?.name ?? null,
      supplier_code: s?.code ?? null,
      item_count: row.items?.length ?? 0,
    }
  })
}

/** Quick exact-match lookup by part_no — used in the line-item add row. */
export async function findPartByCodeExact(code: string): Promise<Part | null> {
  const trimmed = code.trim()
  if (!trimmed) return null
  const { data, error } = await supabase
    .from('parts_inventory')
    .select('*')
    .eq('part_no', trimmed)
    .maybeSingle()
  if (error) throw error
  return (data as Part | null) ?? null
}

/** Typeahead — top-10 prefix matches on part_no. */
export async function searchPartsForCode(prefix: string): Promise<Part[]> {
  const t = prefix.trim()
  if (!t) return []
  const escaped = t.replace(/[%,]/g, '')
  const { data, error } = await supabase
    .from('parts_inventory')
    .select('*')
    .ilike('part_no', `${escaped}%`)
    .order('part_no', { ascending: true })
    .limit(10)
  if (error) throw error
  return (data ?? []) as Part[]
}

/**
 * Insert the receipt header then bulk-insert items, returning the header
 * row. Items hit the DB trigger which atomically bumps stock_qty +
 * qty_received on each affected part.
 *
 * Not wrapped in a SQL transaction because supabase-js doesn't expose
 * BEGIN/COMMIT — if items fail mid-flight we delete the orphan header so
 * the inventory bumps that did succeed get rolled back via CASCADE.
 */
export async function createStockReceipt(
  input: NewStockReceipt,
  createdBy: string,
): Promise<StockReceipt> {
  const { data: header, error: headErr } = await supabase
    .from('stock_receipts')
    .insert({
      receipt_date: input.receipt_date,
      supplier_id: input.supplier_id,
      invoice_no: input.invoice_no || null,
      invoice_date: input.invoice_date || null,
      do_no: input.do_no || null,
      po_no: input.po_no || null,
      remarks: input.remarks || null,
      created_by: createdBy,
    })
    .select('*')
    .single()
  if (headErr) throw headErr

  const items = input.items.map((i) => ({
    receipt_id: (header as StockReceipt).id,
    part_id: i.part_id,
    qty: i.qty,
    unit_cost: i.unit_cost,
  }))
  if (items.length > 0) {
    const { error: itemsErr } = await supabase
      .from('stock_receipt_items')
      .insert(items)
    if (itemsErr) {
      // Compensating action: nuke the orphan header (CASCADE will sweep
      // any partial item inserts; their stock_qty bumps roll back via
      // the AFTER trigger only firing on successful INSERT).
      await supabase
        .from('stock_receipts')
        .delete()
        .eq('id', (header as StockReceipt).id)
      throw itemsErr
    }
  }
  return header as StockReceipt
}

/** Items for one receipt with the part joined in. */
export async function listReceiptItems(receiptId: string): Promise<
  Array<StockReceiptItem & { part_no: string; part_name: string }>
> {
  const { data, error } = await supabase
    .from('stock_receipt_items')
    .select(
      `
        id, receipt_id, part_id, qty, unit_cost, line_total, created_at,
        part:parts_inventory(part_no, name)
      `,
    )
    .eq('receipt_id', receiptId)
    .order('created_at', { ascending: true })
  if (error) throw error
  type Joined = StockReceiptItem & {
    part: { part_no: string; name: string } | Array<{ part_no: string; name: string }> | null
  }
  function pickFirst<T>(v: T | T[] | null): T | null {
    if (v == null) return null
    return Array.isArray(v) ? (v[0] ?? null) : v
  }
  return ((data as unknown as Joined[] | null) ?? []).map((row) => {
    const p = pickFirst(row.part)
    return {
      ...row,
      part_no: p?.part_no ?? '—',
      part_name: p?.name ?? '—',
    }
  })
}
