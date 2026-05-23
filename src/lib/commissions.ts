import { supabase } from './supabase'
import type {
  CommissionPayout,
  CommissionPayoutInsert,
  CommissionSchedule,
  CommissionScheduleInsert,
} from './types'

// ---------- commission_schedules -------------------------------------------

export async function listSchedules() {
  const { data, error } = await supabase
    .from('commission_schedules')
    .select('*')
    .order('model', { ascending: true })
    .order('variant', { ascending: true, nullsFirst: false })
  if (error) throw error
  return data as CommissionSchedule[]
}

export async function createSchedule(input: CommissionScheduleInsert) {
  const { data, error } = await supabase
    .from('commission_schedules')
    .insert(input)
    .select('*')
    .single()
  if (error) throw error
  return data as CommissionSchedule
}

export async function updateSchedule(
  id: string,
  patch: Partial<CommissionScheduleInsert>,
) {
  const { data, error } = await supabase
    .from('commission_schedules')
    .update(patch)
    .eq('id', id)
    .select('*')
    .single()
  if (error) throw error
  return data as CommissionSchedule
}

export async function deleteSchedule(id: string) {
  const { error } = await supabase
    .from('commission_schedules')
    .delete()
    .eq('id', id)
  if (error) throw error
}

// ---------- commission_payouts ---------------------------------------------

export async function listPayouts() {
  const { data, error } = await supabase
    .from('commission_payouts')
    .select('*')
    .order('paid_at', { ascending: false })
  if (error) throw error
  return data as CommissionPayout[]
}

/**
 * Create a new payout batch AND atomically attach a list of bookings to it.
 * Each booking is flipped to commission_status='paid' with commission_payout_id
 * set to the new batch.
 *
 * Done in two REST calls — Supabase has no client-side multi-statement
 * transaction, but the second call won't run if the first fails, and the
 * booking update is itself atomic per row. If the second call partially
 * fails we surface the error; super_admin can clean up via SQL editor.
 */
export async function createPayoutAndAssign(
  input: CommissionPayoutInsert,
  bookingIds: string[],
): Promise<CommissionPayout> {
  const { data: payout, error: payoutErr } = await supabase
    .from('commission_payouts')
    .insert({ ...input })
    .select('*')
    .single()
  if (payoutErr) throw payoutErr

  if (bookingIds.length > 0) {
    const { error: updateErr } = await supabase
      .from('bookings')
      .update({
        commission_status: 'paid',
        commission_payout_id: (payout as CommissionPayout).id,
      })
      .in('id', bookingIds)
    if (updateErr) throw updateErr
  }
  return payout as CommissionPayout
}
