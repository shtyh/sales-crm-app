// SWL Motors CRM — Telegram bot webhook handler.
//
// Deployed as a Supabase Edge Function. Telegram POSTs every update to
// `https://<project>.supabase.co/functions/v1/telegram-bot`. We verify the
// shared-secret header, check the sender is on the allow-list, dispatch
// commands, and reply via the Bot API.
//
// Secrets (set in Supabase Dashboard → Edge Functions → Manage secrets):
//   TELEGRAM_BOT_TOKEN       The bot token from @BotFather.
//   TELEGRAM_WEBHOOK_SECRET  Random string we hand to Telegram in setWebhook;
//                            Telegram echoes it back on every request via the
//                            X-Telegram-Bot-Api-Secret-Token header.
//   TELEGRAM_ALLOWED_IDS     Comma-separated Telegram numeric user IDs that
//                            are allowed to talk to the bot.
//
// Supabase auto-injects SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY into the
// runtime, so we don't need to declare those secrets manually.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.46.1'

const TELEGRAM_BOT_TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN') ?? ''
const TELEGRAM_WEBHOOK_SECRET = Deno.env.get('TELEGRAM_WEBHOOK_SECRET') ?? ''
const ALLOWED_IDS = new Set(
  (Deno.env.get('TELEGRAM_ALLOWED_IDS') ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
)

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

// Service-role client. Bypasses RLS by design — we enforce access at the
// Telegram allow-list layer above.
const supabase = createClient(SUPABASE_URL, SERVICE_ROLE)

async function telegramApi(
  method: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const res = await fetch(
    `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/${method}`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    },
  )
  if (!res.ok) {
    const text = await res.text()
    console.error(`Telegram ${method} failed: ${res.status} ${text}`)
  }
}

function sendMessage(chatId: number, text: string) {
  return telegramApi('sendMessage', {
    chat_id: chatId,
    text,
    parse_mode: 'HTML',
    disable_web_page_preview: true,
  })
}

// -------- Commands ---------------------------------------------------------

async function cmdInventory(chatId: number): Promise<void> {
  const { data, error } = await supabase
    .from('cars')
    .select('model')
    .eq('status', 'in_stock')

  if (error) {
    await sendMessage(chatId, `⚠ Couldn't read inventory: ${error.message}`)
    return
  }

  const rows = data ?? []
  const total = rows.length
  if (total === 0) {
    await sendMessage(chatId, '📦 No cars currently in stock.')
    return
  }

  const counts = new Map<string, number>()
  for (const row of rows) {
    counts.set(row.model, (counts.get(row.model) ?? 0) + 1)
  }
  const breakdown = Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([model, n]) => `• <b>${model}</b>: ${n}`)
    .join('\n')

  await sendMessage(
    chatId,
    `🚗 <b>${total}</b> car${total === 1 ? '' : 's'} in stock\n\n${breakdown}`,
  )
}

const HELP_TEXT = [
  '👋 <b>SWL Motors CRM bot</b>',
  '',
  'Available commands:',
  '• /inventory — cars currently in stock',
  '• /help — show this message',
].join('\n')

async function cmdHelp(chatId: number): Promise<void> {
  await sendMessage(chatId, HELP_TEXT)
}

// -------- Dispatcher -------------------------------------------------------

interface TelegramUpdate {
  message?: {
    chat: { id: number }
    from?: { id: number }
    text?: string
  }
}

Deno.serve(async (req) => {
  // 1. Verify the shared secret. If this header is wrong, the request did
  //    not come from Telegram — reject hard so we don't process arbitrary
  //    JSON or leak Bot API calls.
  if (
    req.headers.get('x-telegram-bot-api-secret-token') !==
    TELEGRAM_WEBHOOK_SECRET
  ) {
    return new Response('forbidden', { status: 403 })
  }

  let update: TelegramUpdate
  try {
    update = (await req.json()) as TelegramUpdate
  } catch {
    return new Response('bad request', { status: 400 })
  }

  // Telegram sends many update types (edits, callbacks, channel posts…).
  // We only care about direct text messages for now.
  const msg = update.message
  if (!msg || !msg.text || !msg.from) {
    return new Response('ok')
  }

  const fromId = String(msg.from.id)
  const chatId = msg.chat.id
  const text = msg.text.trim()

  // 2. Allow-list. Strangers get a polite rejection so they know the bot
  //    works — they're just not on the list.
  if (!ALLOWED_IDS.has(fromId)) {
    await sendMessage(
      chatId,
      `🔒 This bot is private. Your Telegram ID is <code>${fromId}</code> — ask the admin to add it to the allow-list.`,
    )
    return new Response('ok')
  }

  // 3. Dispatch.
  // Strip any "@botname" suffix that group-chat usage tacks on.
  const cmd = text.split(/\s+/)[0].split('@')[0].toLowerCase()

  switch (cmd) {
    case '/start':
    case '/help':
      await cmdHelp(chatId)
      break
    case '/inventory':
      await cmdInventory(chatId)
      break
    default:
      await sendMessage(
        chatId,
        `Unknown command <code>${cmd}</code>. Try /inventory or /help.`,
      )
  }

  // Telegram only cares that we returned 200 — the actual reply went out via
  // sendMessage above.
  return new Response('ok')
})
