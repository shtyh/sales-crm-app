-- 2026-05-28 · Daily sales digest to Telegram (sales bot)
--
-- Runs every day at 7pm Asia/Kuala_Lumpur (11:00 UTC) via pg_cron.
-- Counts five funnel stages from `bookings` and posts them to the
-- @PROTON_SWL_MOTORS_SALES_bot. Tweak the SQL inside
-- `compute_sales_digest` if the counts don't match what the ASM sends.
--
-- Funnel definitions ("open" = status not in cancelled/delivered):
--   today_booking      bookings created today
--   pending_register   open + payment_status='paid' + (cash OR LOU on file)
--                      + jpj_status in (not_submitted, submitted)
--   done_register      open + jpj_status='registered'
--   have_lou           open + LOU attachment on file + jpj_status<>registered
--   wait_loan          open + loan_status='pending'

create extension if not exists pg_cron with schema extensions;

do $$
begin
  if not exists (select 1 from vault.secrets where name = 'telegram_sales_bot_token') then
    perform vault.create_secret('', 'telegram_sales_bot_token', 'Telegram bot token for daily sales digest');
  end if;
  if not exists (select 1 from vault.secrets where name = 'telegram_sales_chat_id') then
    perform vault.create_secret('', 'telegram_sales_chat_id', 'Chat ID of the sales team Telegram');
  end if;
end $$;

create or replace function public.compute_sales_digest(p_for_date date)
returns table (
  today_booking      int,
  pending_register   int,
  done_register      int,
  have_lou           int,
  wait_loan          int
)
language sql
stable
security definer
set search_path = public
as $$
  with funnel as (
    select
      (select count(*) from public.bookings
        where booking_date = p_for_date) as today_booking,

      (select count(*) from public.bookings b
        where b.status not in ('cancelled', 'delivered')
          and b.payment_status = 'paid'
          and b.jpj_status in ('not_submitted', 'submitted')
          and (
            b.loan_bank = 'cash'
            or exists (
              select 1 from public.booking_attachments
              where booking_id = b.id and kind = 'lou'
            )
          )) as pending_register,

      (select count(*) from public.bookings
        where status not in ('cancelled', 'delivered')
          and jpj_status = 'registered') as done_register,

      (select count(*) from public.bookings b
        where b.status not in ('cancelled', 'delivered')
          and b.jpj_status <> 'registered'
          and exists (
            select 1 from public.booking_attachments
            where booking_id = b.id and kind = 'lou'
          )) as have_lou,

      (select count(*) from public.bookings
        where status not in ('cancelled', 'delivered')
          and loan_status = 'pending') as wait_loan
  )
  select
    today_booking::int,
    pending_register::int,
    done_register::int,
    have_lou::int,
    wait_loan::int
  from funnel;
$$;
revoke all on function public.compute_sales_digest(date) from public;
grant execute on function public.compute_sales_digest(date) to authenticated;

create or replace function public.send_sales_digest_now()
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_token text;
  v_chat  text;
  v_url   text;
  v_text  text;
  v_today date := (now() at time zone 'Asia/Kuala_Lumpur')::date;
  m       record;
begin
  select decrypted_secret into v_token
    from vault.decrypted_secrets where name = 'telegram_sales_bot_token';
  select decrypted_secret into v_chat
    from vault.decrypted_secrets where name = 'telegram_sales_chat_id';

  if coalesce(v_token, '') = '' or coalesce(v_chat, '') = '' then
    raise notice 'sales digest: secrets missing, skipping';
    return;
  end if;

  select * into m from public.compute_sales_digest(v_today);

  v_text := format(
    E'📅 *%s*\n\n🆕 Today booking  *%s* units\n📝 Pending register  *%s* units\n✅ Up-to-date Done Register  *%s* units\n📄 Have LOU  *%s* units\n⏳ Wait loan  *%s* units',
    to_char(v_today, 'DD/MM/YYYY'),
    m.today_booking, m.pending_register, m.done_register,
    m.have_lou, m.wait_loan
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
    raise warning 'sales digest send failed: %', sqlerrm;
  end;
end;
$$;
revoke all on function public.send_sales_digest_now() from public;
grant execute on function public.send_sales_digest_now() to authenticated;

-- Schedule 7pm Asia/Kuala_Lumpur = 11:00 UTC daily.
do $$
declare j record;
begin
  for j in select jobid from cron.job where jobname = 'sales_daily_digest' loop
    perform cron.unschedule(j.jobid);
  end loop;
end $$;

select cron.schedule(
  'sales_daily_digest',
  '0 11 * * *',
  'select public.send_sales_digest_now();'
);
