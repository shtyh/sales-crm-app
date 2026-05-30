-- Backfill existing bookings' commission snapshot when a commission_schedules
-- row is added/updated. Conservative: only fills bookings whose base_commission
-- IS NULL (i.e. that were created before any matching schedule existed), so an
-- already-snapshotted booking is never retroactively changed. commission_amount
-- is recomputed by the existing bookings guard trigger that fires on the UPDATE.
create or replace function public.backfill_booking_commission(
  in_model text, in_variant text
) returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.bookings b
  set base_commission = s.base_commission,
      hq_discount     = coalesce(s.hq_discount, 0),
      dealer_support  = coalesce(s.dealer_support, 0),
      approval_status = case
        when b.approval_status in ('approved','rejected') then b.approval_status
        when coalesce(b.discount_amount, 0) > s.base_commission then 'pending'
        else 'not_required'
      end
  from public.commission_schedules s
  where s.model = in_model
    and s.variant is not distinct from in_variant
    and b.vehicle_model = in_model
    and nullif(b.vehicle_variant, '') is not distinct from in_variant
    and b.base_commission is null;
end;
$$;

-- Fire it whenever a schedule row lands or changes.
create or replace function public.commission_schedule_backfill()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.backfill_booking_commission(new.model, new.variant);
  return new;
end;
$$;

drop trigger if exists trg_commission_schedule_backfill on public.commission_schedules;
create trigger trg_commission_schedule_backfill
  after insert or update on public.commission_schedules
  for each row execute function public.commission_schedule_backfill();

-- One-time backfill for bookings created before their schedule existed.
update public.bookings b
set base_commission = sched.base_commission,
    hq_discount     = coalesce(sched.hq_discount, 0),
    dealer_support  = coalesce(sched.dealer_support, 0),
    approval_status = case
      when b.approval_status in ('approved','rejected') then b.approval_status
      when coalesce(b.discount_amount, 0) > sched.base_commission then 'pending'
      else 'not_required'
    end
from public.commission_schedules sched
where sched.model = b.vehicle_model
  and sched.variant is not distinct from nullif(b.vehicle_variant, '')
  and b.base_commission is null;
