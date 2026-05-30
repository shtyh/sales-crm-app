// SWL Motors CRM — shared boilerplate for the document-verification edge
// functions (extract-all-in-one / extract-down-payment / extract-lou).
//
// Each function is a thin wrapper around `makeExtractor`, supplying only its
// Gemini prompt + the field-mapping that turns the extracted JSON into a
// document_verifications row. Everything security-sensitive lives here:
//
//   - JWT verified on every request (401 if missing/invalid).
//   - Role gate: only sales_advisor / sales_manager / super_admin.
//   - Path must be document-verification/{uid}/{file}; a sales_advisor may
//     only reference their own uid.
//   - The target booking must exist; a sales_advisor may only attach docs to
//     a booking they own.
//   - Per-user rate limit: 10 req / 60s (in-memory, best-effort).
//   - The image is downloaded server-side via the service role — the model
//     call never sees the user's JWT and the service-role key never leaves
//     the Edge runtime.
//   - Every call + error logged to audit_log; the caller sees only a generic
//     message.
//
// After a successful extraction the row is inserted into
// document_verifications via the service role; the AFTER trigger
// (recompute_booking_documents) rolls it up onto the booking + fans out
// notifications.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.46.1'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
export const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY') ?? ''

const BUCKET = 'booking-files'
const GEMINI_MODEL = 'gemini-2.5-flash'

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

// Service-role client — bypasses RLS. Used for the storage download, the
// booking lookup, the DV insert, and the audit-log insert.
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

/** Chunked base64 — Deno has no Buffer; naive spread overflows the stack. */
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
  if (ext === 'pdf') return 'application/pdf'
  return 'image/jpeg'
}

// Field coercers — Gemini may return numbers as strings or omit cells.
export function asNum(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = typeof v === 'number' ? v : Number(String(v).replace(/[^0-9.-]/g, ''))
  return Number.isFinite(n) ? n : null
}
export function asStr(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const t = v.trim()
  return t === '' ? null : t
}
export function asDate(v: unknown): string | null {
  if (typeof v !== 'string') return null
  return /^\d{4}-\d{2}-\d{2}$/.test(v.trim()) ? v.trim() : null
}
export function asBool(v: unknown): boolean | null {
  if (typeof v === 'boolean') return v
  if (typeof v === 'string') {
    const t = v.trim().toLowerCase()
    if (['true', 'yes', 'y', '1'].includes(t)) return true
    if (['false', 'no', 'n', '0'].includes(t)) return false
  }
  return null
}

// ---------- Audit ---------------------------------------------------------

async function audit(
  fnName: string,
  opts: {
    actorId: string | null
    actorRole: string | null
    operation: 'CALL' | 'ERROR'
    detail: Record<string, unknown>
  },
) {
  try {
    await adminDb.from('audit_log').insert({
      actor_id: opts.actorId,
      actor_role: opts.actorRole,
      table_name: fnName,
      operation: opts.operation,
      changed: opts.detail,
    })
  } catch (_err) {
    // Audit must never block the response.
  }
}

// ---------- Gemini --------------------------------------------------------

async function callGemini(
  prompt: string,
  base64Image: string,
  mimeType: string,
): Promise<{ ok: true; raw: string } | { ok: false; stage: string; info: string }> {
  let res: Response
  try {
    res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                { inline_data: { mime_type: mimeType, data: base64Image } },
                { text: prompt },
              ],
            },
          ],
          generationConfig: { temperature: 0, responseMimeType: 'application/json' },
        }),
      },
    )
  } catch (err) {
    return {
      ok: false,
      stage: 'gemini_fetch',
      info: err instanceof Error ? err.message : String(err),
    }
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    return { ok: false, stage: 'gemini_status', info: `${res.status} ${text.slice(0, 1500)}` }
  }
  let body: {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>
  }
  try {
    body = await res.json()
  } catch (err) {
    return {
      ok: false,
      stage: 'gemini_parse',
      info: err instanceof Error ? err.message : String(err),
    }
  }
  return { ok: true, raw: body.candidates?.[0]?.content?.parts?.[0]?.text ?? '' }
}

// ---------- Extractor factory ---------------------------------------------

export type DocType = 'all_in_one' | 'down_payment' | 'lou'

export type BuildRowCtx = {
  bookingId: string
  uploaderId: string
  filePath: string
}

/** Maps the sanitised extracted JSON to the document_verifications insert
 *  payload. Must include document_type, image_path, booking_id, uploaded_by
 *  (the factory fills those if omitted) and any extracted_* columns + the
 *  verification_status / rejection_reason for this doc kind. */
export type BuildRow = (
  extracted: Record<string, unknown>,
  ctx: BuildRowCtx,
) => Record<string, unknown>

export function makeExtractor(opts: {
  fnName: string
  docType: DocType
  prompt: string
  allowedKeys: string[]
  buildRow: BuildRow
}) {
  const allowed = new Set(opts.allowedKeys)

  function sanitise(raw: unknown): Record<string, unknown> {
    if (!raw || typeof raw !== 'object') return {}
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      if (allowed.has(k)) out[k] = v
    }
    return out
  }

  return async (req: Request): Promise<Response> => {
    const origin = req.headers.get('origin')

    if (req.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(origin) })
    }
    if (req.method !== 'POST') return generic(405, origin, 'Method not allowed')

    // ---- 1. Authn ----
    const authHeader = req.headers.get('authorization') ?? ''
    const jwt = authHeader.toLowerCase().startsWith('bearer ')
      ? authHeader.slice(7).trim()
      : ''
    if (!jwt) {
      await audit(opts.fnName, {
        actorId: null, actorRole: null, operation: 'ERROR',
        detail: { stage: 'authn', reason: 'missing_bearer_token' },
      })
      return generic(401, origin, 'Unauthorized')
    }

    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${jwt}` } },
    })
    const { data: userResp, error: userErr } = await userClient.auth.getUser(jwt)
    if (userErr || !userResp?.user) {
      await audit(opts.fnName, {
        actorId: null, actorRole: null, operation: 'ERROR',
        detail: { stage: 'authn', reason: userErr?.message ?? 'invalid_jwt' },
      })
      return generic(401, origin, 'Unauthorized')
    }
    const user = userResp.user

    // ---- 2. Authz — role ----
    const { data: profile, error: profileErr } = await adminDb
      .from('profiles').select('role').eq('id', user.id).maybeSingle()
    if (profileErr || !profile) {
      await audit(opts.fnName, {
        actorId: user.id, actorRole: null, operation: 'ERROR',
        detail: { stage: 'authz', reason: 'profile_lookup_failed' },
      })
      return generic(403, origin, 'Forbidden')
    }
    const role = profile.role as string
    if (!['sales_advisor', 'sales_manager', 'super_admin'].includes(role)) {
      await audit(opts.fnName, {
        actorId: user.id, actorRole: role, operation: 'ERROR',
        detail: { stage: 'authz', reason: 'role_not_permitted', role },
      })
      return generic(403, origin, 'Forbidden')
    }

    // ---- 3. Rate limit ----
    if (!rateLimit(user.id)) {
      await audit(opts.fnName, {
        actorId: user.id, actorRole: role, operation: 'ERROR',
        detail: { stage: 'rate_limit' },
      })
      return generic(429, origin, 'Too many requests')
    }

    // ---- 4. Body ----
    let body: { file_path?: unknown; booking_id?: unknown }
    try {
      body = (await req.json()) as { file_path?: unknown; booking_id?: unknown }
    } catch {
      return generic(400, origin, 'Bad request')
    }
    const filePath = typeof body.file_path === 'string' ? body.file_path : ''
    const bookingId = typeof body.booking_id === 'string' ? body.booking_id : ''

    if (
      !filePath ||
      !/^document-verification\/[0-9a-f-]{36}\/[A-Za-z0-9._-]+$/i.test(filePath)
    ) {
      await audit(opts.fnName, {
        actorId: user.id, actorRole: role, operation: 'ERROR',
        detail: { stage: 'path_validate', reason: 'bad_path', filePath },
      })
      return generic(400, origin, 'Bad request')
    }
    if (!/^[0-9a-f-]{36}$/i.test(bookingId)) {
      await audit(opts.fnName, {
        actorId: user.id, actorRole: role, operation: 'ERROR',
        detail: { stage: 'booking_validate', reason: 'bad_booking_id' },
      })
      return generic(400, origin, 'Bad request')
    }

    const ownerSegment = filePath.split('/')[1]
    if (role === 'sales_advisor' && ownerSegment !== user.id) {
      await audit(opts.fnName, {
        actorId: user.id, actorRole: role, operation: 'ERROR',
        detail: { stage: 'path_ownership', filePath },
      })
      return generic(403, origin, 'Forbidden')
    }

    // ---- 5. Booking ownership ----
    const { data: booking, error: bkErr } = await adminDb
      .from('bookings').select('id, owner_id').eq('id', bookingId).maybeSingle()
    if (bkErr || !booking) {
      await audit(opts.fnName, {
        actorId: user.id, actorRole: role, operation: 'ERROR',
        detail: { stage: 'booking_lookup', reason: 'not_found', bookingId },
      })
      return generic(404, origin, 'Booking not found')
    }
    if (role === 'sales_advisor' && booking.owner_id !== user.id) {
      await audit(opts.fnName, {
        actorId: user.id, actorRole: role, operation: 'ERROR',
        detail: { stage: 'booking_ownership', bookingId },
      })
      return generic(403, origin, 'Forbidden')
    }

    // ---- 6. Download image ----
    const { data: blob, error: dlErr } = await adminDb.storage
      .from(BUCKET).download(filePath)
    if (dlErr || !blob) {
      await audit(opts.fnName, {
        actorId: user.id, actorRole: role, operation: 'ERROR',
        detail: { stage: 'download', reason: dlErr?.message ?? 'missing' },
      })
      return generic(404, origin, 'File not found')
    }
    const bytes = new Uint8Array(await blob.arrayBuffer())
    if (bytes.length > 10 * 1024 * 1024) {
      await audit(opts.fnName, {
        actorId: user.id, actorRole: role, operation: 'ERROR',
        detail: { stage: 'size_limit', size: bytes.length },
      })
      return generic(413, origin, 'File too large')
    }

    // ---- 7. Gemini ----
    if (!GEMINI_API_KEY) {
      await audit(opts.fnName, {
        actorId: user.id, actorRole: role, operation: 'ERROR',
        detail: { stage: 'config', reason: 'missing_GEMINI_API_KEY' },
      })
      return generic(500, origin)
    }
    const g = await callGemini(opts.prompt, toBase64(bytes), mimeFromPath(filePath))
    if (!g.ok) {
      await audit(opts.fnName, {
        actorId: user.id, actorRole: role, operation: 'ERROR',
        detail: { stage: g.stage, info: g.info },
      })
      return generic(502, origin)
    }

    let extracted: Record<string, unknown>
    try {
      extracted = sanitise(JSON.parse(g.raw))
    } catch (err) {
      await audit(opts.fnName, {
        actorId: user.id, actorRole: role, operation: 'ERROR',
        detail: {
          stage: 'extract_parse',
          message: err instanceof Error ? err.message : String(err),
          raw: g.raw.slice(0, 1500),
        },
      })
      return generic(502, origin)
    }

    // ---- 8. Insert document_verifications (trigger recomputes) ----
    const row = {
      booking_id: bookingId,
      document_type: opts.docType,
      image_path: filePath,
      uploaded_by: user.id,
      ...opts.buildRow(extracted, {
        bookingId, uploaderId: user.id, filePath,
      }),
    }
    const { data: inserted, error: insErr } = await adminDb
      .from('document_verifications').insert(row).select('id').single()
    if (insErr) {
      await audit(opts.fnName, {
        actorId: user.id, actorRole: role, operation: 'ERROR',
        detail: { stage: 'dv_insert', reason: insErr.message },
      })
      return generic(500, origin)
    }

    await audit(opts.fnName, {
      actorId: user.id, actorRole: role, operation: 'CALL',
      detail: {
        stage: 'ok', booking_id: bookingId, doc_type: opts.docType,
        dv_id: (inserted as { id: string }).id, fields: Object.keys(extracted),
      },
    })

    return json(
      200,
      {
        document_verification_id: (inserted as { id: string }).id,
        extracted,
        file_path: filePath,
      },
      origin,
    )
  }
}
