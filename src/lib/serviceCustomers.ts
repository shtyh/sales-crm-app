// Data layer for the Service-side customer master (service_customers).

import { supabase } from './supabase'
import type {
  ServiceCustomer,
  ServiceCustomerWithCounts,
} from './types'

export type NewServiceCustomer = {
  name: string
  nric?: string | null
  phone: string
  email?: string | null
  address?: string | null
  city?: string | null
  state?: string | null
  post_code?: string | null
  phone2?: string | null
}

export async function listServiceCustomers(): Promise<
  ServiceCustomerWithCounts[]
> {
  // Pull the master + every vehicle / service_order that points back, then
  // count client-side. With a workshop-scale customer base (hundreds, not
  // millions) this avoids a Postgres view + keeps the FE one file.
  const [customers, vehicles, orders] = await Promise.all([
    supabase
      .from('service_customers')
      .select('*')
      .order('name', { ascending: true }),
    supabase
      .from('vehicles')
      .select('service_customer_id')
      .not('service_customer_id', 'is', null),
    supabase
      .from('service_orders')
      .select('service_customer_id')
      .not('service_customer_id', 'is', null),
  ])

  if (customers.error) throw customers.error
  if (vehicles.error) throw vehicles.error
  if (orders.error) throw orders.error

  const vcByCust = new Map<string, number>()
  for (const v of (vehicles.data ?? []) as Array<{
    service_customer_id: string | null
  }>) {
    if (!v.service_customer_id) continue
    vcByCust.set(v.service_customer_id, (vcByCust.get(v.service_customer_id) ?? 0) + 1)
  }
  const jobsByCust = new Map<string, number>()
  for (const o of (orders.data ?? []) as Array<{
    service_customer_id: string | null
  }>) {
    if (!o.service_customer_id) continue
    jobsByCust.set(
      o.service_customer_id,
      (jobsByCust.get(o.service_customer_id) ?? 0) + 1,
    )
  }

  return (customers.data as ServiceCustomer[]).map((c) => ({
    ...c,
    vehicle_count: vcByCust.get(c.id) ?? 0,
    job_count: jobsByCust.get(c.id) ?? 0,
  }))
}

export async function createServiceCustomer(
  input: NewServiceCustomer,
): Promise<ServiceCustomer> {
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
    .from('service_customers')
    .insert(row)
    .select('*')
    .single()
  if (error) throw error
  return data as ServiceCustomer
}
