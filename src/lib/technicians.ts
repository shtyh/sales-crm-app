import { supabase } from './supabase'
import type { Technician } from './types'

/** Workshop mechanic roster (active only). */
export async function listTechnicians() {
  const { data, error } = await supabase
    .from('technicians')
    .select('*')
    .eq('is_active', true)
    .order('name', { ascending: true })

  if (error) throw error
  return data as Technician[]
}
