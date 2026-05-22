import { supabase } from './supabase'
import type { Car, CarInsert } from './types'

/** All cars, newest arrivals first. RLS lets every signed-in user read. */
export async function listCars() {
  const { data, error } = await supabase
    .from('cars')
    .select('*')
    .order('arrived_at', { ascending: false })
    .order('created_at', { ascending: false })
  if (error) throw error
  return data as Car[]
}

export async function getCar(id: string) {
  const { data, error } = await supabase
    .from('cars')
    .select('*')
    .eq('id', id)
    .maybeSingle()
  if (error) throw error
  return data as Car | null
}

/** Create a new car. RLS allows general_admin + super_admin. */
export async function createCar(input: CarInsert) {
  const { data, error } = await supabase
    .from('cars')
    .insert(input)
    .select('*')
    .single()
  if (error) throw error
  return data as Car
}

/**
 * Partial update. The DB guard trigger enforces which columns each role can
 * touch — finance_admin for floor_stock_* fields, general_admin for vehicle
 * attributes. super_admin bypasses both.
 */
export async function updateCar(id: string, patch: Partial<CarInsert>) {
  const { data, error } = await supabase
    .from('cars')
    .update(patch)
    .eq('id', id)
    .select('*')
    .single()
  if (error) throw error
  return data as Car
}
