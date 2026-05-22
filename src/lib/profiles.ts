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

/**
 * Update a profile. RLS rules:
 *   - Users can update their OWN row (used for the Account page name change)
 *   - super_admin can update anyone
 *   - Role changes are blocked by trigger for non-super-admin
 *   - is_admin is a generated column; never include it in `patch`
 */
export async function updateProfile(
  id: string,
  patch: Partial<Pick<Profile, 'full_name' | 'role'>>,
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
