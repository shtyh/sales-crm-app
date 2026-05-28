-- 2026-05-28 · Refine the sales digest funnel per the ASM's actual
-- counting:
--   * Pending register no longer requires payment_status='paid'.
--   * Have LOU is mutually exclusive with Pending register (a row
--     counts in exactly one of those two lines).
-- Also reschedule pg_cron to skip Sundays.

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
  with
  open_bookings as (
    select * from public.bookings
    where status not in ('cancelled', 'delivered')
  ),
  pending_register_ids as (
    select b.id
    from open_bookings b
    where b.jpj_status in ('not_submitted', 'submitted')
      and (
        b.loan_bank = 'cash'
        or exists (
          select 1 from public.booking_attachments
          where booking_id = b.id and kind = 'lou'
        )
      )
  ),
  have_lou_ids as (
    select b.id
    from open_bookings b
    where b.jpj_status <> 'registered'
      and exists (
        select 1 from public.booking_attachments
        where booking_id = b.id and kind = 'lou'
      )
  )
  select
    (select count(*) from public.bookings
      where booking_date = p_for_date)::int                    as today_booking,
    (select count(*) from pending_register_ids)::int           as pending_register,
    (select count(*) from open_bookings
      where jpj_status = 'registered')::int                    as done_register,
    (select count(*) from (
       select id from have_lou_ids
       except
       select id from pending_register_ids
     ) hl)::int                                                as have_lou,
    (select count(*) from open_bookings
      where loan_status = 'pending')::int                      as wait_loan;
$$;

-- 7pm Asia/Kuala_Lumpur, Mon-Sat only (skip Sunday).
do $$
declare j record;
begin
  for j in select jobid from cron.job where jobname = 'sales_daily_digest' loop
    perform cron.unschedule(j.jobid);
  end loop;
end $$;

select cron.schedule(
  'sales_daily_digest',
  '0 11 * * 1-6',
  'select public.send_sales_digest_now();'
);
