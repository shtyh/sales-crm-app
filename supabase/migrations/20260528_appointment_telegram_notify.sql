-- 2026-05-28 · Telegram notification on service_appointments INSERT
--
-- Fires a Telegram sendMessage call whenever a new appointment row
-- lands — covers the public /book path, staff /service/book path, and
-- phone-block path uniformly because it's a DB trigger.
--
-- Secrets live in Supabase Vault (encrypted at rest):
--   telegram_bot_token              → bot token from @BotFather
--   telegram_service_chat_id        → chat ID of the service team group
--
-- If either secret is missing the trigger NO-OPs (so the migration is
-- safe to apply before credentials are uploaded). Failures during the
-- HTTP call are swallowed inside an EXCEPTION block so they never
-- block the underlying INSERT.
--
-- Rotate the secrets via SQL:
--   select vault.update_secret(id, 'NEW_TOKEN_HERE') from vault.secrets where name = 'telegram_bot_token';
--   select vault.update_secret(id, 'NEW_CHAT_ID_HERE') from vault.secrets where name = 'telegram_service_chat_id';

create extension if not exists pg_net with schema extensions;

do $$
begin
  if not exists (select 1 from vault.secrets where name = 'telegram_bot_token') then
    perform vault.create_secret('', 'telegram_bot_token', 'Telegram bot token for service notifications');
  end if;
  if not exists (select 1 from vault.secrets where name = 'telegram_service_chat_id') then
    perform vault.create_secret('', 'telegram_service_chat_id', 'Chat ID of the service team Telegram group');
  end if;
end $$;

create or replace function public.notify_telegram_appointment()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_token text;
  v_chat  text;
  v_url   text;
  v_text  text;
  v_date_label text;
  v_time_label text;
  v_source_emoji text;
  v_status_label text;
  v_mileage_label text;
begin
  select decrypted_secret into v_token
    from vault.decrypted_secrets where name = 'telegram_bot_token';
  select decrypted_secret into v_chat
    from vault.decrypted_secrets where name = 'telegram_service_chat_id';

  if coalesce(v_token, '') = '' or coalesce(v_chat, '') = '' then
    return new;
  end if;

  v_date_label := to_char(new.preferred_date, 'Dy, DD Mon YYYY');
  v_time_label := case
    when new.slot_time is null then upper(new.preferred_period::text)
    else to_char(new.slot_time, 'HH12:MI AM')
  end;
  v_source_emoji := case new.source
    when 'public' then '🌐 Public form'
    when 'staff'  then '🧑‍💼 Staff entry'
    when 'phone'  then '📞 Phone booking'
    else new.source
  end;
  v_status_label := case new.status
    when 'pending'   then '⏳ Pending'
    when 'confirmed' then '✅ Confirmed'
    when 'rejected'  then '❌ Rejected'
    when 'cancelled' then '🚫 Cancelled'
    else new.status::text
  end;
  v_mileage_label := case
    when new.service_mileage is null then '—'
    else to_char(new.service_mileage, 'FM999G999') || ' km'
  end;

  v_text := format(
    e'🔧 *New appointment* — %s\n'
    '*%s*\n\n'
    '👤 %s\n'
    '📞 %s\n'
    '✉️ %s\n\n'
    '🚗 %s · %s\n'
    '🔩 Service: %s\n\n'
    '📅 %s · 🕘 %s\n\n'
    '📝 %s',
    v_source_emoji,
    v_status_label,
    coalesce(new.customer_name, '—'),
    coalesce(new.customer_phone, '—'),
    coalesce(new.customer_email, '—'),
    coalesce(new.vehicle_reg, '—'),
    coalesce(new.vehicle_model, '—'),
    v_mileage_label,
    v_date_label,
    v_time_label,
    coalesce(nullif(new.complaint, ''), '_no notes_')
  );

  v_url := 'https://api.telegram.org/bot' || v_token || '/sendMessage';

  begin
    perform net.http_post(
      url     := v_url,
      headers := jsonb_build_object('Content-Type', 'application/json'),
      body    := jsonb_build_object(
        'chat_id', v_chat,
        'text', v_text,
        'parse_mode', 'Markdown',
        'disable_web_page_preview', true
      )
    );
  exception when others then
    raise warning 'Telegram notify failed for appointment %: %', new.id, sqlerrm;
  end;

  return new;
end;
$$;

revoke all on function public.notify_telegram_appointment() from public;

drop trigger if exists service_appointments_telegram_notify
  on public.service_appointments;
create trigger service_appointments_telegram_notify
after insert on public.service_appointments
for each row execute function public.notify_telegram_appointment();
