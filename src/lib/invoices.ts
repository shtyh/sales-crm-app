import { supabase } from './supabase'
import type { Invoice } from './types'

/** Every invoice the caller can see (RLS mirrors booking visibility). */
export async function listInvoices() {
  const { data, error } = await supabase
    .from('invoices')
    .select('*')
    .order('invoice_date', { ascending: false })

  if (error) throw error
  return data as Invoice[]
}
