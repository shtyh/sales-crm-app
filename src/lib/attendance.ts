import { supabase } from './supabase'
import type {
  Attendance,
  AttendanceCheckOut,
  AttendanceInsert,
} from './types'

/** Every attendance row the caller can see (own + admins see all). */
export async function listAllAttendance() {
  const { data, error } = await supabase
    .from('attendance')
    .select('*')
    .order('work_date', { ascending: false })
    .order('check_in_at', { ascending: false })
  if (error) throw error
  return data as Attendance[]
}

/** This profile's own attendance, optionally bounded by date range. */
export async function listMyAttendance(profileId: string, fromIso?: string) {
  let q = supabase
    .from('attendance')
    .select('*')
    .eq('profile_id', profileId)
    .order('work_date', { ascending: false })
  if (fromIso) q = q.gte('work_date', fromIso)
  const { data, error } = await q
  if (error) throw error
  return data as Attendance[]
}

/** Today's row (Malaysia local date) for this profile, if any. */
export async function getMyToday(profileId: string, workDate: string) {
  const { data, error } = await supabase
    .from('attendance')
    .select('*')
    .eq('profile_id', profileId)
    .eq('work_date', workDate)
    .maybeSingle()
  if (error) throw error
  return (data ?? null) as Attendance | null
}

/** Insert a new check-in. RLS enforces profile_id = auth.uid(). */
export async function checkIn(input: AttendanceInsert) {
  const { data, error } = await supabase
    .from('attendance')
    .insert(input)
    .select('*')
    .single()
  if (error) throw error
  return data as Attendance
}

/** Patch an existing row with check-out fields. */
export async function checkOut(id: string, patch: AttendanceCheckOut) {
  const { data, error } = await supabase
    .from('attendance')
    .update(patch)
    .eq('id', id)
    .select('*')
    .single()
  if (error) throw error
  return data as Attendance
}
