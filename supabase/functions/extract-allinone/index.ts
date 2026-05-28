// SWL Motors CRM — extract-allinone Edge Function.
//
// Reads a Proton "All In One Preparation" form image from Supabase Storage
// and asks Gemini 2.5 Flash to pull out the 12 fields we care about for
// commission verification. The image is downloaded server-side via the
// service-role client so the model call never sees the user's JWT and the
// service-role key never leaves the Edge runtime.
//
// Security posture:
//   - JWT verified on every request. 401 if missing/invalid.
//   - Role checked. Only sales_advisor / sales_manager / super_admin proceed.
//   - For sales_advisor, file_path must be under commission/{their_uid}/.
//     sales_manager and super_admin can pull any commission/* path.
//   - Per-user rate limit: 10 requests / 60s (in-memory, best-effort).
//   - All errors logged to audit_log server-side. Caller sees only a
//     generic `{ error: "..." }`. No stack traces, no provider errors leak.
//
// Secrets:
//   GEMINI_API_KEY            Google AI Studio key. Server-only.
//   SUPABASE_URL              Auto-injected by Supabase runtime.
//   SUPABASE_SERVICE_ROLE_KEY Auto-injected by Supabase runtime.
//   SUPABASE_ANON_KEY         Auto-injected; used to verify the caller's JWT.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.46.1'

const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY') ?? ''
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? ''

const BUCKET = 'booking-files'
const PROMPT = `Extract data from this Proton car sales "All In One Preparation" form. Return ONLY a JSON object with no markdown, no explanation:
{
  "customer_name": "",
  "sa_name": "",
  "model": "",
  "otr_price": 0,
  "total_otr": 0,
  "booking_fee": 0,
  "commission_amount": 0,
  "payment_type": "cash or loan",
  "date": "YYYY-MM-DD",
  "ncd_discount": 0,
  "own_discount": 0,
  "pesb_discount": 0
}`

// CORS — restricted to the Vercel app + localhost for dev. Edge Functions
// invoked via supabase-js add the right origin automatically; this is for
// preflight OPTIONS responses.
const ALLOWED_ORIGINS = new Set([
  'https://swlmotorscrm.vercel.app',
  'http://localhost:5173',
])

function corsHeaders(origin: string | null): Record<string, string> {
  const allow = origin && ALLOWED_ORIGINS.has(origin) ? origin : 'null'
  return {
    'access-control-allow-origin': allow,
    'access-control-allow-headers':
      'authorization, x-client-info, apikey, content-type',
    'access-control-allow-methods': 'POST, OPTIONS',
    'access-control-max-age': '86400',
    vary: 'origin',
  }
}

// Service-role client — bypasses RLS. Used only for the storage download and
// the audit-log insert. Never reachable from anywhere outside this function.
const adminDb = createClient(SUPABASE_URL, SERVICE_ROLE, {
  auth: { persistSession: false, autoRefreshToken: false },
})

// ---------- Rate limit (in-memory, best-effort) ---------------------------

const RATE_LIMIT_WINDOW_MS = 60_000
const RATE_LIMIT_MAX = 10

const callTimes = new Map<string, number[]>()

function rateLimit(userId: string): boolean {
  const now = Date.now()
  const arr = callTimes.get(userId) ?? []
  const recent = arr.filter((t) => now - t < RATE_LIMIT_WINDOW_MS)
  if (recent.length >= RATE_LIMIT_MAX) {
    callTimes.set(userId, recent)
    return false
  }
  recent.push(now)
  callTimes.set(userId, recent)
  return true
}

// ---------- Audit ---------------------------------------------------------

async function audit(opts: {
  actorId: string | null
  actorRole: string | null
  operation: 'CALL' | 'ERROR'
  detail: Record<string, unknown>
}) {
  try {
    await adminDb.from('audit_log').insert({
      actor_id: opts.actorId,
      actor_role: opts.actorRole,
      table_name: 'extract-allinone',
      operation: opts.operation,
      changed: opts.detail,
    })
  } catch (_err) {
    // Audit must never block the response — swallow.
  }
}

// ---------- Helpers -------------------------------------------------------

function json(status: number, body: unknown, origin: string | null): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...corsHeaders(origin) },
  })
}

function generic(
  status: number,
  origin: string | null,
  message = 'Something went wrong',
): Response {
  return json(status, { error: message }, origin)
}

/** Inline base64 encode, chunked to avoid `Maximum call stack size exceeded`
 *  on large images. Deno doesn't expose `Buffer`. */
function toBase64(bytes: Uint8Array): string {
  let bin = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(bin)
}

function mimeFromPath(path: string): string {
  const ext = path.toLowerCase().split('.').pop() ?? ''
  if (ext === 'png') return 'image/png'
  if (ext === 'heic' || ext === 'heif') return 'image/heic'
  if (ext === 'webp') return 'image/webp'
  return 'image/jpeg'
}

// Allow only the 12 expected keys through. Anything else Gemini might tack
// on gets dropped before it reaches the frontend.
const ALLOWED_KEYS = new Set([
  'customer_name',
  'sa_name',
  'model',
  'otr_price',
  'total_otr',
  'booking_fee',
  'commission_amount',
  'payment_type',
  'date',
  'ncd_discount',
  'own_discount',
  'pesb_discount',
])

function sanitiseExtracted(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== 'object') return {}
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (ALLOWED_KEYS.has(k)) out[k] = v
  }
  return out
}

// --------- Handler --------------------------------------------------------

Deno.serve(async (req) => {
  const origin = req.headers.get('origin')

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders(origin) })
  }

  if (req.method !== 'POST') {
    return generic(405, origin, 'Method not allowed')
  }

  // ---- 1. Authn — verify JWT via Supabase Auth ----
  const authHeader = req.headers.get('authorization') ?? ''
  const jwt = authHeader.toLowerCase().startsWith('bearer ')
    ? authHeader.slice(7).trim()
    : ''
  if (!jwt) {
    await audit({
      actorId: null,
      actorRole: null,
      operation: 'ERROR',
      detail: { stage: 'authn', reason: 'missing_bearer_token' },
    })
    return generic(401, origin, 'Unauthorized')
  }

  // Use the anon client to verify the JWT — it calls /auth/v1/user with the
  // bearer token and returns the user record or an error.
  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${jwt}` } },
  })
  const { data: userResp, error: userErr } = await userClient.auth.getUser(jwt)
  if (userErr || !userResp?.user) {
    await audit({
      actorId: null,
      actorRole: null,
      operation: 'ERROR',
      detail: { stage: 'authn', reason: userErr?.message ?? 'invalid_jwt' },
    })
    return generic(401, origin, 'Unauthorized')
  }
  const user = userResp.user

  // ---- 2. Authz — role check via profiles ----
  const { data: profile, error: profileErr } = await adminDb
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .maybeSingle()

  if (profileErr || !profile) {
    await audit({
      actorId: user.id,
      actorRole: null,
      operation: 'ERROR',
      detail: { stage: 'authz', reason: 'profile_lookup_failed' },
    })
    return generic(403, origin, 'Forbidden')
  }

  const role = profile.role as string
  const allowed = ['sales_advisor', 'sales_manager', 'super_admin']
  if (!allowed.includes(role)) {
    await audit({
      actorId: user.id,
      actorRole: role,
      operation: 'ERROR',
      detail: { stage: 'authz', reason: 'role_not_permitted', role },
    })
    return generic(403, origin, 'Forbidden')
  }

  // ---- 3. Rate limit ----
  if (!rateLimit(user.id)) {
    await audit({
      actorId: user.id,
      actorRole: role,
      operation: 'ERROR',
      detail: { stage: 'rate_limit' },
    })
    return generic(429, origin, 'Too many requests')
  }

  // ---- 4. Body ----
  let body: { file_path?: unknown }
  try {
    body = (await req.json()) as { file_path?: unknown }
  } catch {
    return generic(400, origin, 'Bad request')
  }

  const filePath = typeof body.file_path === 'string' ? body.file_path : ''
  // Must look like commission/{uuid}/{filename}, no traversal characters.
  if (
    !filePath ||
    !/^commission\/[0-9a-f-]{36}\/[A-Za-z0-9._-]+$/i.test(filePath)
  ) {
    await audit({
      actorId: user.id,
      actorRole: role,
      operation: 'ERROR',
      detail: { stage: 'path_validate', reason: 'bad_path', filePath },
    })
    return generic(400, origin, 'Bad request')
  }

  const ownerSegment = filePath.split('/')[1]
  if (role === 'sales_advisor' && ownerSegment !== user.id) {
    await audit({
      actorId: user.id,
      actorRole: role,
      operation: 'ERROR',
      detail: { stage: 'path_ownership', filePath },
    })
    return generic(403, origin, 'Forbidden')
  }

  // ---- 5. Download image via service role ----
  const { data: blob, error: dlErr } = await adminDb.storage
    .from(BUCKET)
    .download(filePath)
  if (dlErr || !blob) {
    await audit({
      actorId: user.id,
      actorRole: role,
      operation: 'ERROR',
      detail: { stage: 'download', reason: dlErr?.message ?? 'missing' },
    })
    return generic(404, origin, 'File not found')
  }

  const bytes = new Uint8Array(await blob.arrayBuffer())
  // 10MB ceiling — also enforced client-side, defense-in-depth here.
  if (bytes.length > 10 * 1024 * 1024) {
    await audit({
      actorId: user.id,
      actorRole: role,
      operation: 'ERROR',
      detail: { stage: 'size_limit', size: bytes.length },
    })
    return generic(413, origin, 'File too large')
  }

  const base64Image = toBase64(bytes)
  const mimeType = mimeFromPath(filePath)

  // ---- 6. Call Gemini ----
  if (!GEMINI_API_KEY) {
    await audit({
      actorId: user.id,
      actorRole: role,
      operation: 'ERROR',
      detail: { stage: 'config', reason: 'missing_GEMINI_API_KEY' },
    })
    return generic(500, origin)
  }

  let geminiRes: Response
  try {
    geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                {
                  inline_data: {
                    mime_type: mimeType,
                    data: base64Image,
                  },
                },
                { text: PROMPT },
              ],
            },
          ],
          generationConfig: {
            temperature: 0,
            responseMimeType: 'application/json',
          },
        }),
      },
    )
  } catch (err) {
    await audit({
      actorId: user.id,
      actorRole: role,
      operation: 'ERROR',
      detail: {
        stage: 'gemini_fetch',
        message: err instanceof Error ? err.message : String(err),
      },
    })
    return generic(502, origin)
  }

  if (!geminiRes.ok) {
    const text = await geminiRes.text().catch(() => '')
    await audit({
      actorId: user.id,
      actorRole: role,
      operation: 'ERROR',
      detail: {
        stage: 'gemini_status',
        status: geminiRes.status,
        body: text.slice(0, 2000),
      },
    })
    return generic(502, origin)
  }

  let geminiJson: {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>
  }
  try {
    geminiJson = await geminiRes.json()
  } catch (err) {
    await audit({
      actorId: user.id,
      actorRole: role,
      operation: 'ERROR',
      detail: {
        stage: 'gemini_parse',
        message: err instanceof Error ? err.message : String(err),
      },
    })
    return generic(502, origin)
  }

  const rawText = geminiJson.candidates?.[0]?.content?.parts?.[0]?.text ?? ''
  let extracted: Record<string, unknown> = {}
  try {
    extracted = sanitiseExtracted(JSON.parse(rawText))
  } catch (err) {
    await audit({
      actorId: user.id,
      actorRole: role,
      operation: 'ERROR',
      detail: {
        stage: 'extract_parse',
        message: err instanceof Error ? err.message : String(err),
        raw: rawText.slice(0, 2000),
      },
    })
    return generic(502, origin)
  }

  await audit({
    actorId: user.id,
    actorRole: role,
    operation: 'CALL',
    detail: { stage: 'ok', file_path: filePath, fields: Object.keys(extracted) },
  })

  return json(200, { extracted, file_path: filePath }, origin)
})
