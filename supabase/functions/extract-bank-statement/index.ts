// SWL Motors CRM — extract-bank-statement Edge Function.
//
// Reads a bank statement PDF from Supabase Storage, sends it to Gemini 2.5
// Flash, and writes one row per credit (incoming) line into
// `bank_statement_lines`. We only care about credits — that's where the
// customer's bank-in receipts land.
//
// Auth model mirrors extract-allinone:
//   - JWT verified server-side.
//   - Only super_admin allowed (FA can read statements but not upload).
//   - file_path must be under statements/{their_uid}/.
//   - Per-user rate limit: 5 requests / 60s.
//   - All errors → audit_log; caller sees only `{ error: '...' }`.
//
// Required secrets:
//   GEMINI_API_KEY            Google AI Studio key (already set).
//   SUPABASE_URL              Auto-injected.
//   SUPABASE_SERVICE_ROLE_KEY Auto-injected.
//   SUPABASE_ANON_KEY         Auto-injected.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.46.1'

const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY') ?? ''
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? ''

const BUCKET = 'booking-files'
const MAX_PDF_BYTES = 20 * 1024 * 1024 // Gemini inline-data cap.

const PROMPT = `You are reading a Malaysian bank statement PDF.
Return ONLY a JSON object — no markdown, no commentary — with this shape:

{
  "period_start": "YYYY-MM-DD or null",
  "period_end":   "YYYY-MM-DD or null",
  "lines": [
    { "date": "YYYY-MM-DD", "amount": 0, "description": "..." }
  ]
}

Rules:
- Include ONLY credit / incoming lines (money received).
- Skip debits, fees, interest credits, and opening/closing balances.
- "amount" must be a positive number, no currency symbol, no thousands separators.
- "date" is the transaction date in YYYY-MM-DD.
- "description" is the raw narration text from the statement.
- If you can't read a value, omit that line.`

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

const adminDb = createClient(SUPABASE_URL, SERVICE_ROLE, {
  auth: { persistSession: false, autoRefreshToken: false },
})

const RATE_LIMIT_WINDOW_MS = 60_000
const RATE_LIMIT_MAX = 5
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
      table_name: 'extract-bank-statement',
      operation: opts.operation,
      changed: opts.detail,
    })
  } catch (_err) {
    // Best-effort.
  }
}

function json(status: number, body: unknown, origin: string | null): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...corsHeaders(origin) },
  })
}

function generic(status: number, origin: string | null, message = 'Something went wrong'): Response {
  return json(status, { error: message }, origin)
}

function toBase64(bytes: Uint8Array): string {
  let bin = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(bin)
}

type ExtractedLine = { date?: string; amount?: number; description?: string }
type ExtractedStatement = {
  period_start?: string | null
  period_end?: string | null
  lines?: ExtractedLine[]
}

function asDate(v: unknown): string | null {
  return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null
}

function asAmount(v: unknown): number | null {
  if (v == null) return null
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null
}

Deno.serve(async (req) => {
  const origin = req.headers.get('origin')

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders(origin) })
  }
  if (req.method !== 'POST') {
    return generic(405, origin, 'Method not allowed')
  }

  // 1. Authn
  const authHeader = req.headers.get('authorization') ?? ''
  const jwt = authHeader.toLowerCase().startsWith('bearer ')
    ? authHeader.slice(7).trim()
    : ''
  if (!jwt) {
    await audit({ actorId: null, actorRole: null, operation: 'ERROR', detail: { stage: 'authn', reason: 'missing_bearer' } })
    return generic(401, origin, 'Unauthorized')
  }

  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${jwt}` } },
  })
  const { data: userResp, error: userErr } = await userClient.auth.getUser(jwt)
  if (userErr || !userResp?.user) {
    await audit({ actorId: null, actorRole: null, operation: 'ERROR', detail: { stage: 'authn', reason: userErr?.message ?? 'invalid_jwt' } })
    return generic(401, origin, 'Unauthorized')
  }
  const user = userResp.user

  // 2. Authz
  const { data: profile } = await adminDb
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .maybeSingle()
  const role = (profile?.role as string | undefined) ?? null
  if (role !== 'super_admin') {
    await audit({ actorId: user.id, actorRole: role, operation: 'ERROR', detail: { stage: 'authz', role } })
    return generic(403, origin, 'Forbidden')
  }

  // 3. Rate limit
  if (!rateLimit(user.id)) {
    await audit({ actorId: user.id, actorRole: role, operation: 'ERROR', detail: { stage: 'rate_limit' } })
    return generic(429, origin, 'Too many requests')
  }

  // 4. Body
  let body: { file_path?: unknown; statement_id?: unknown }
  try {
    body = (await req.json()) as { file_path?: unknown; statement_id?: unknown }
  } catch {
    return generic(400, origin, 'Bad request')
  }
  const filePath = typeof body.file_path === 'string' ? body.file_path : ''
  const statementId = typeof body.statement_id === 'string' ? body.statement_id : ''

  if (!filePath || !/^statements\/[0-9a-f-]{36}\/[A-Za-z0-9._-]+$/i.test(filePath)) {
    await audit({ actorId: user.id, actorRole: role, operation: 'ERROR', detail: { stage: 'path_validate', filePath } })
    return generic(400, origin, 'Bad request')
  }
  if (filePath.split('/')[1] !== user.id) {
    await audit({ actorId: user.id, actorRole: role, operation: 'ERROR', detail: { stage: 'path_ownership', filePath } })
    return generic(403, origin, 'Forbidden')
  }
  if (!statementId || !/^[0-9a-f-]{36}$/i.test(statementId)) {
    return generic(400, origin, 'Bad request')
  }

  // 5. Confirm the statement row belongs to the caller
  const { data: stmtRow, error: stmtErr } = await adminDb
    .from('bank_statements')
    .select('id, uploaded_by, file_path')
    .eq('id', statementId)
    .maybeSingle()
  if (stmtErr || !stmtRow) {
    return generic(404, origin, 'Statement not found')
  }
  // Role check above already guarantees super_admin; just verify the
  // statement they're operating on belongs to them.
  if (stmtRow.uploaded_by !== user.id) {
    await audit({ actorId: user.id, actorRole: role, operation: 'ERROR', detail: { stage: 'statement_ownership', statementId } })
    return generic(403, origin, 'Forbidden')
  }
  if (stmtRow.file_path !== filePath) {
    return generic(400, origin, 'Bad request')
  }

  // 6. Download PDF
  const { data: blob, error: dlErr } = await adminDb.storage.from(BUCKET).download(filePath)
  if (dlErr || !blob) {
    await audit({ actorId: user.id, actorRole: role, operation: 'ERROR', detail: { stage: 'download', reason: dlErr?.message ?? 'missing' } })
    return generic(404, origin, 'File not found')
  }
  const bytes = new Uint8Array(await blob.arrayBuffer())
  if (bytes.length > MAX_PDF_BYTES) {
    await audit({ actorId: user.id, actorRole: role, operation: 'ERROR', detail: { stage: 'size_limit', size: bytes.length } })
    return generic(413, origin, 'File too large')
  }

  if (!GEMINI_API_KEY) {
    await audit({ actorId: user.id, actorRole: role, operation: 'ERROR', detail: { stage: 'config' } })
    return generic(500, origin)
  }

  // 7. Gemini call
  const base64Data = toBase64(bytes)
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
                { inline_data: { mime_type: 'application/pdf', data: base64Data } },
                { text: PROMPT },
              ],
            },
          ],
          generationConfig: { temperature: 0, responseMimeType: 'application/json' },
        }),
      },
    )
  } catch (err) {
    await audit({
      actorId: user.id, actorRole: role, operation: 'ERROR',
      detail: { stage: 'gemini_fetch', message: err instanceof Error ? err.message : String(err) },
    })
    return generic(502, origin)
  }
  if (!geminiRes.ok) {
    const text = await geminiRes.text().catch(() => '')
    await audit({
      actorId: user.id, actorRole: role, operation: 'ERROR',
      detail: { stage: 'gemini_status', status: geminiRes.status, body: text.slice(0, 2000) },
    })
    return generic(502, origin)
  }

  let geminiJson: { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> }
  try {
    geminiJson = await geminiRes.json()
  } catch (err) {
    await audit({
      actorId: user.id, actorRole: role, operation: 'ERROR',
      detail: { stage: 'gemini_parse', message: err instanceof Error ? err.message : String(err) },
    })
    return generic(502, origin)
  }

  const rawText = geminiJson.candidates?.[0]?.content?.parts?.[0]?.text ?? ''
  let parsed: ExtractedStatement
  try {
    parsed = JSON.parse(rawText) as ExtractedStatement
  } catch (err) {
    await audit({
      actorId: user.id, actorRole: role, operation: 'ERROR',
      detail: { stage: 'extract_parse', message: err instanceof Error ? err.message : String(err), raw: rawText.slice(0, 2000) },
    })
    return generic(502, origin)
  }

  // 8. Normalise + insert
  const rawLines = Array.isArray(parsed.lines) ? parsed.lines : []
  const cleanLines = rawLines
    .map((l) => ({
      statement_id: statementId,
      line_date: asDate(l?.date),
      amount: asAmount(l?.amount),
      description: typeof l?.description === 'string' ? l.description : null,
      raw: l ?? null,
    }))
    .filter((l) => l.line_date && l.amount)

  // Period fields go on the parent statement row.
  await adminDb
    .from('bank_statements')
    .update({
      period_start: asDate(parsed.period_start),
      period_end: asDate(parsed.period_end),
    })
    .eq('id', statementId)

  // Wipe any prior lines for this statement (in case of re-extract) then
  // insert fresh.
  await adminDb.from('bank_statement_lines').delete().eq('statement_id', statementId)
  if (cleanLines.length > 0) {
    const { error: insErr } = await adminDb.from('bank_statement_lines').insert(cleanLines)
    if (insErr) {
      await audit({
        actorId: user.id, actorRole: role, operation: 'ERROR',
        detail: { stage: 'insert_lines', message: insErr.message },
      })
      return generic(500, origin)
    }
  }

  await audit({
    actorId: user.id, actorRole: role, operation: 'CALL',
    detail: { stage: 'ok', statement_id: statementId, lines: cleanLines.length },
  })

  return json(200, { statement_id: statementId, lines_inserted: cleanLines.length }, origin)
})
