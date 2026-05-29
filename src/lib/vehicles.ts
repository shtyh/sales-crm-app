import { supabase } from './supabase'
import type {
  ServiceOrder,
  Vehicle,
  VehicleInsert,
  VehicleWithCustomer,
} from './types'

// Joined customer fields the list/detail views need. The `service_customer`
// nested row is the preferred source (since 2026-05-29 the workshop side
// owns its own customer pool); we keep `customer` joined as a fallback for
// any vehicle whose service_customer_id hasn't been backfilled yet.
const JOIN =
  '*,' +
  'customer:customers!vehicles_customer_id_fkey(id, name, nric, phone),' +
  'service_customer:service_customers!vehicles_service_customer_id_fkey(id, name, nric, phone)'

type RawJoined = Vehicle & {
  customer: {
    id: string
    name: string
    nric: string | null
    phone: string
  } | null
  service_customer: {
    id: string
    name: string
    nric: string | null
    phone: string
  } | null
}

/** Collapse the dual customer joins into the single `customer` field the
 *  UI expects. Prefer the workshop-side service_customer; fall back to
 *  the legacy customers row. */
function normalise(row: RawJoined): VehicleWithCustomer {
  const sc = row.service_customer
  const c = row.customer
  // Strip the raw fields so the returned object matches VehicleWithCustomer.
  const { customer: _c, service_customer: _sc, ...rest } = row
  void _c; void _sc
  return {
    ...rest,
    customer: sc
      ? { id: sc.id, name: sc.name, nric: sc.nric, phone: sc.phone }
      : c
        ? { id: c.id, name: c.name, nric: c.nric, phone: c.phone }
        : null,
  } as VehicleWithCustomer
}

/**
 * All vehicles, with the linked customer joined in for the list view.
 * RLS is open SELECT to any authenticated user on this Phase-1 build.
 */
export async function listVehicles(): Promise<VehicleWithCustomer[]> {
  const { data, error } = await supabase
    .from('vehicles')
    .select(JOIN)
    .order('registration_no', { ascending: true })

  if (error) throw error
  return ((data ?? []) as unknown as RawJoined[]).map(normalise)
}

/** Single vehicle by id, with the linked customer joined in. */
export async function getVehicle(
  id: string,
): Promise<VehicleWithCustomer | null> {
  const { data, error } = await supabase
    .from('vehicles')
    .select(JOIN)
    .eq('id', id)
    .maybeSingle()

  if (error) throw error
  return data ? normalise(data as unknown as RawJoined) : null
}

export async function createVehicle(input: VehicleInsert): Promise<Vehicle> {
  // Normalise plate / chassis: trim + uppercase. The DB UNIQUE index is
  // case-sensitive, so without this two SAs typing "wkk 1234" and
  // "WKK1234" would dodge the dedupe.
  const payload: VehicleInsert = {
    ...input,
    registration_no: input.registration_no.trim().toUpperCase(),
    chassis_no: input.chassis_no?.trim().toUpperCase() || null,
    model: input.model.trim(),
    variant: input.variant?.trim() || null,
    color: input.color?.trim() || null,
    notes: input.notes?.trim() || null,
  }
  const { data, error } = await supabase
    .from('vehicles')
    .insert(payload)
    .select('*')
    .single()

  if (error) throw error
  return data as Vehicle
}

export async function updateVehicle(
  id: string,
  patch: Partial<VehicleInsert>,
): Promise<Vehicle> {
  // Same trim/upper normalisation as create, but only for the fields the
  // caller actually sent.
  const cleaned: Record<string, unknown> = { ...patch }
  if (typeof cleaned.registration_no === 'string') {
    cleaned.registration_no = (cleaned.registration_no as string)
      .trim()
      .toUpperCase()
  }
  if (typeof cleaned.chassis_no === 'string') {
    const v = (cleaned.chassis_no as string).trim().toUpperCase()
    cleaned.chassis_no = v || null
  }
  for (const k of ['model', 'variant', 'color', 'notes'] as const) {
    if (typeof cleaned[k] === 'string') {
      const v = (cleaned[k] as string).trim()
      cleaned[k] = v || (k === 'model' ? v : null)
    }
  }

  const { data, error } = await supabase
    .from('vehicles')
    .update(cleaned)
    .eq('id', id)
    .select('*')
    .single()

  if (error) throw error
  return data as Vehicle
}

/**
 * Service-order history for a given vehicle, newest first. Used by the
 * vehicle detail page. Returns [] until the service-order pages start
 * writing rows — that's fine.
 */
export async function listServiceOrdersByVehicle(
  vehicleId: string,
): Promise<ServiceOrder[]> {
  const { data, error } = await supabase
    .from('service_orders')
    .select('*')
    .eq('vehicle_id', vehicleId)
    .order('opened_at', { ascending: false })

  if (error) throw error
  return (data ?? []) as ServiceOrder[]
}
