import { supabase } from './supabase'
import type { Payment } from './types'

/** Every payment receipt the caller can see (RLS mirrors booking visibility). */
export async function listPayments() {
  const { data, error } = await supabase
    .from('payments')
    .select('*')
    .order('received_at', { ascending: false })

  if (error) throw error
  return data as Payment[]
}
