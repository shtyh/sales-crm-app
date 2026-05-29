// Data layer for the Vehicle Type master (vehicle_types table).

import { supabase } from './supabase'
import type { VehicleType, VehicleTypeWithCount } from './types'

export type NewVehicleType = {
  code: string
  name: string
  profit_center?: string | null
}

export async function listVehicleTypes(): Promise<VehicleTypeWithCount[]> {
  // Pull the master + every active workshop vehicle's model in one round
  // trip, then join client-side on case-insensitive substring match. The
  // legacy WMS codes (e.g. "EXORA20R") don't exist in our existing
  // `vehicles.model` text values — those are usually plain model names
  // like "Iriz" or "X70" — so we match on the descriptive `name` instead,
  // and just count overlaps as a rough usage hint.
  const [{ data: types, error: tErr }, { data: vehicles, error: vErr }] =
    await Promise.all([
      supabase
        .from('vehicle_types')
        .select('*')
        .order('code', { ascending: true }),
      supabase
        .from('vehicles')
        .select('model')
        .not('model', 'is', null),
    ])
  if (tErr) throw tErr
  if (vErr) throw vErr

  const models = ((vehicles ?? []) as Array<{ model: string | null }>)
    .map((v) => (v.model ?? '').toLowerCase())
    .filter(Boolean)

  return ((types as VehicleType[] | null) ?? []).map((t) => {
    const needle = t.name.toLowerCase()
    let count = 0
    for (const m of models) {
      // Simple bidirectional substring match — handles "EXORA 1.6 A/T"
      // typed as "EXORA AT" or just "EXORA" on the vehicle side.
      if (m.includes(needle) || needle.includes(m)) count++
    }
    return { ...t, vehicle_count: count }
  })
}

export async function createVehicleType(
  input: NewVehicleType,
): Promise<VehicleType> {
  const row = {
    code: input.code.trim(),
    name: input.name.trim(),
    profit_center:
      (input.profit_center ?? '').toString().trim() === ''
        ? null
        : input.profit_center,
  }
  const { data, error } = await supabase
    .from('vehicle_types')
    .insert(row)
    .select('*')
    .single()
  if (error) throw error
  return data as VehicleType
}
