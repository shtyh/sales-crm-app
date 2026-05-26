import { supabase } from './supabase'
import type {
  ServiceOrder,
  ServiceOrderInsert,
  ServiceOrderWithJoins,
} from './types'

const JOINED_SELECT = [
  '*',
  'vehicle:vehicles(id, registration_no, model, variant, color)',
  'customer:customers(id, name, phone)',
  'technician:technicians(id, name)',
].join(', ')

/**
 * Every service order the caller can see (RLS filters). Joins vehicle,
 * customer, and technician for the dashboard table.
 *
 * service_advisor callers see only their own rows (post-RLS).
 */
export async function listServiceOrders(): Promise<ServiceOrderWithJoins[]> {
  const { data, error } = await supabase
    .from('service_orders')
    .select(JOINED_SELECT)
    .order('opened_at', { ascending: false })

  if (error) throw error
  return (data ?? []) as unknown as ServiceOrderWithJoins[]
}

/** Single service order by id (RLS filters — null if not visible). */
export async function getServiceOrder(
  id: string,
): Promise<ServiceOrderWithJoins | null> {
  const { data, error } = await supabase
    .from('service_orders')
    .select(JOINED_SELECT)
    .eq('id', id)
    .maybeSingle()

  if (error) throw error
  return (data as unknown as ServiceOrderWithJoins | null) ?? null
}

/**
 * Insert a new service order. order_no is left null; the DB trigger
 * `generate_service_order_no` fills it with SO-YYMMDD-NNNN on insert.
 */
export async function createServiceOrder(
  input: ServiceOrderInsert,
): Promise<ServiceOrder> {
  const payload: ServiceOrderInsert = {
    ...input,
    complaint: input.complaint?.trim() || null,
    diagnosis: input.diagnosis?.trim() || null,
    notes: input.notes?.trim() || null,
  }
  const { data, error } = await supabase
    .from('service_orders')
    .insert(payload)
    .select('*')
    .single()

  if (error) throw error
  return data as ServiceOrder
}

/** Patch named fields on a service order. */
export async function updateServiceOrder(
  id: string,
  patch: Partial<ServiceOrderInsert>,
): Promise<ServiceOrder> {
  const cleaned: Record<string, unknown> = { ...patch }
  for (const k of ['complaint', 'diagnosis', 'notes'] as const) {
    if (typeof cleaned[k] === 'string') {
      const v = (cleaned[k] as string).trim()
      cleaned[k] = v || null
    }
  }

  const { data, error } = await supabase
    .from('service_orders')
    .update(cleaned)
    .eq('id', id)
    .select('*')
    .single()

  if (error) throw error
  return data as ServiceOrder
}

