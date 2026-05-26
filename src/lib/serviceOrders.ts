import { supabase } from './supabase'
import type { ServiceOrderWithJoins } from './types'

/**
 * Every service order with its linked vehicle / customer / technician
 * joined in. Used by the workshop dashboard table. Returns rows sorted by
 * opened_at desc — newest visit first.
 *
 * RLS is open SELECT on service_orders to any authenticated user
 * (Phase-1 permissive policy).
 */
export async function listServiceOrders(): Promise<ServiceOrderWithJoins[]> {
  const { data, error } = await supabase
    .from('service_orders')
    .select(
      [
        '*',
        'vehicle:vehicles(id, registration_no, model, variant, color)',
        'customer:customers(id, name, phone)',
        'technician:technicians(id, name)',
      ].join(', '),
    )
    .order('opened_at', { ascending: false })

  if (error) throw error
  return (data ?? []) as unknown as ServiceOrderWithJoins[]
}
