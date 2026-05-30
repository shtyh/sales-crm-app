-- 2026-05-30 · Reconciliation freshness on booking edits.
--
-- reconcile_booking() already re-runs when a SOURCE DOC changes (triggers on
-- commission_verifications / attachment_extractions / bank_statement_lines).
-- But it did NOT re-run when the BOOKING's own reconciled fields change — so
-- the realistic flow "finance uploads the LOU, then types loan_amount later"
-- left the stored booking_reconciliations row stale: the LOU loan_amount diff
-- (expected = booking.loan_amount vs got = extracted LOU amount) never showed
-- until someone hit "Re-run" by hand.
--
-- Fix: an AFTER UPDATE trigger on bookings that re-reconciles when any field
-- reconcile_booking() compares against changes — gated to bookings ALREADY in
-- the reconciliation flow so a plain booking edit never spawns new rows.

create or replace function public.trg_booking_reconcile()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if exists (
    select 1 from public.booking_reconciliations where booking_id = new.id
  ) then
    perform public.reconcile_booking(new.id);
  end if;
  return null;
end;
$$;

revoke execute on function public.trg_booking_reconcile() from anon, authenticated, public;

drop trigger if exists trg_booking_reconcile on public.bookings;
create trigger trg_booking_reconcile
  after update of loan_amount, booking_fee, otr_price, commission_amount, loan_bank
  on public.bookings
  for each row
  when (
    new.loan_amount       is distinct from old.loan_amount
    or new.booking_fee    is distinct from old.booking_fee
    or new.otr_price      is distinct from old.otr_price
    or new.commission_amount is distinct from old.commission_amount
    or new.loan_bank      is distinct from old.loan_bank
  )
  execute function public.trg_booking_reconcile();

-- One-time: refresh every existing reconciliation so nothing currently shown is
-- stale (idempotent — reconcile_booking just recomputes from current data).
do $$
declare
  r record;
begin
  for r in select booking_id from public.booking_reconciliations loop
    perform public.reconcile_booking(r.booking_id);
  end loop;
end
$$;
