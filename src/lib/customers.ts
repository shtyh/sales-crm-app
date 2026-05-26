import { supabase } from './supabase'
import type { Customer, CustomerInsert } from './types'

/** Every customer (RLS lets all auth users read). */
export async function listCustomers() {
  const { data, error } = await supabase
    .from('customers')
    .select('*')
    .order('name', { ascending: true })

  if (error) throw error
  return data as Customer[]
}

/** Single customer by id. Returns null if not found. */
export async function getCustomer(id: string) {
  const { data, error } = await supabase
    .from('customers')
    .select('*')
    .eq('id', id)
    .maybeSingle()

  if (error) throw error
  return data as Customer | null
}

/** Look up a customer by NRIC (the canonical dedupe key). */
export async function getCustomerByNric(nric: string) {
  const trimmed = nric.trim()
  if (!trimmed) return null
  const { data, error } = await supabase
    .from('customers')
    .select('*')
    .eq('nric', trimmed)
    .maybeSingle()

  if (error) throw error
  return data as Customer | null
}

/**
 * Insert-or-update a customer keyed on NRIC. Used by NewBookingPage so SAs
 * never have to think about whether the customer already exists — the
 * trimmed NRIC drives the decision, and the latest form values are saved.
 */
export async function upsertCustomerByNric(input: CustomerInsert) {
  const payload: CustomerInsert = {
    ...input,
    name: input.name.trim(),
    nric: input.nric.trim(),
    phone: input.phone.trim(),
    email: input.email?.trim() || null,
    address: input.address?.trim() || null,
  }
  const { data, error } = await supabase
    .from('customers')
    .upsert(payload, { onConflict: 'nric' })
    .select('*')
    .single()

  if (error) throw error
  return data as Customer
}

/** Patch named fields on a customer. */
export async function updateCustomer(
  id: string,
  patch: Partial<CustomerInsert>,
) {
  // Trim only the fields actually present in the patch — leaving the rest
  // untouched. This lets callers update a single field (e.g. phone) without
  // having to resend name/nric.
  const cleaned: Record<string, unknown> = { ...patch }
  for (const k of ['name', 'nric', 'phone', 'email', 'address'] as const) {
    const v = cleaned[k]
    if (typeof v === 'string') {
      const trimmed = v.trim()
      cleaned[k] = trimmed === '' && k !== 'name' && k !== 'nric' && k !== 'phone'
        ? null
        : trimmed
    }
  }
  const { data, error } = await supabase
    .from('customers')
    .update(cleaned)
    .eq('id', id)
    .select('*')
    .single()

  if (error) throw error
  return data as Customer
}
