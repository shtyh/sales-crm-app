// supabase/functions/invite-user/index.ts
//
// Admin-only Edge Function. Lets the SWL Motors admin invite a new user
// directly from the web UI — no Supabase Dashboard required.
//
// Flow:
//   1. Verify the caller's JWT and load their profile.
//   2. Reject if the caller is not is_admin = true.
//   3. Use the service_role key (server-side only) to send the invite email.
//
// Deploy:
//   supabase functions deploy invite-user
//
// The SUPABASE_URL, SUPABASE_ANON_KEY, and SUPABASE_SERVICE_ROLE_KEY env
// variables are injected automatically by the Supabase Functions runtime.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }
  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405)
  }

  const authHeader = req.headers.get('Authorization')
  if (!authHeader) return json({ error: 'Missing Authorization header' }, 401)

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
  const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!
  const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

  // Client scoped to the caller — used to identify them and check admin status
  // (RLS still applies, so this can't be spoofed).
  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  })

  const { data: userData, error: userErr } = await userClient.auth.getUser()
  if (userErr || !userData.user) {
    return json({ error: 'Unauthorized' }, 401)
  }

  const { data: profile, error: pErr } = await userClient
    .from('profiles')
    .select('is_admin')
    .eq('id', userData.user.id)
    .single()

  if (pErr) return json({ error: pErr.message }, 500)
  if (!profile?.is_admin) return json({ error: 'Admins only' }, 403)

  // Parse + validate request body.
  let body: { email?: string; redirectTo?: string } = {}
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Invalid JSON body' }, 400)
  }
  const email = (body.email ?? '').trim().toLowerCase()
  if (!email) return json({ error: 'Email is required' }, 400)
  if (!/^\S+@\S+\.\S+$/.test(email)) {
    return json({ error: 'Email is not valid' }, 400)
  }

  // Service-role client — bypasses RLS, lets us call auth.admin APIs.
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  const { data, error } = await admin.auth.admin.inviteUserByEmail(email, {
    redirectTo: body.redirectTo,
  })

  if (error) {
    return json({ error: error.message }, 400)
  }

  return json({ ok: true, user: data.user })
})

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}
