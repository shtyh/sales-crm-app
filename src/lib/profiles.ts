import { supabase } from './supabase'
import type { Profile } from './types'

/** Fetch a single profile by id (returns null if not visible / not found). */
export async function getProfile(id: string) {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', id)
    .maybeSingle()
  if (error) throw error
  return data as Profile | null
}

/** List every profile (RLS lets all authenticated users read). */
export async function listProfiles() {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .order('full_name', { ascending: true, nullsFirst: false })
  if (error) throw error
  return data as Profile[]
}

/** Update a profile. Only admins are allowed by RLS to mutate other people. */
export async function updateProfile(
  id: string,
  patch: Partial<Pick<Profile, 'full_name' | 'is_admin'>>,
) {
  const { data, error } = await supabase
    .from('profiles')
    .update(patch)
    .eq('id', id)
    .select('*')
    .single()
  if (error) throw error
  return data as Profile
}
