import { supabase } from './supabase'
import type {
  ServiceOrderItem,
  ServiceOrderItemInsert,
} from './types'

/**
 * Every line item on a service order, newest last (so the user sees the
 * lines in the order they added them).
 */
export async function listServiceOrderItems(
  serviceOrderId: string,
): Promise<ServiceOrderItem[]> {
  const { data, error } = await supabase
    .from('service_order_items')
    .select('*')
    .eq('service_order_id', serviceOrderId)
    .order('created_at', { ascending: true })

  if (error) throw error
  return (data ?? []) as ServiceOrderItem[]
}

/** Insert a part or labour line. line_total must be computed by the caller. */
export async function createServiceOrderItem(
  input: ServiceOrderItemInsert,
): Promise<ServiceOrderItem> {
  // Sanity: a labour line must not point at a part. DB CHECK constraint
  // would catch this anyway, but failing fast in JS gives a friendlier
  // error message.
  if (input.kind === 'labour' && input.part_id) {
    throw new Error('Labour lines cannot reference a part.')
  }
  const payload: ServiceOrderItemInsert = {
    ...input,
    description: input.description.trim(),
    part_id: input.kind === 'part' ? (input.part_id ?? null) : null,
  }
  const { data, error } = await supabase
    .from('service_order_items')
    .insert(payload)
    .select('*')
    .single()

  if (error) throw error
  return data as ServiceOrderItem
}

export async function updateServiceOrderItem(
  id: string,
  patch: Partial<ServiceOrderItemInsert>,
): Promise<ServiceOrderItem> {
  const cleaned: Record<string, unknown> = { ...patch }
  if (typeof cleaned.description === 'string') {
    cleaned.description = (cleaned.description as string).trim()
  }
  const { data, error } = await supabase
    .from('service_order_items')
    .update(cleaned)
    .eq('id', id)
    .select('*')
    .single()

  if (error) throw error
  return data as ServiceOrderItem
}

export async function deleteServiceOrderItem(id: string): Promise<void> {
  const { error } = await supabase
    .from('service_order_items')
    .delete()
    .eq('id', id)
  if (error) throw error
}
