-- 2026-05-26 — workshop-side roles + auto order_no on service_orders.
--
-- ROLES
-- -----
-- Extend the app_role enum with four workshop roles. Phase-1 RLS on the
-- service tables already says "any non-SA role can write", so adding
-- these values immediately grants them write access to the workshop
-- tables (and only those). Sales tables continue to be gated by their
-- existing per-column trigger, which still names the sales-side roles
-- explicitly — so a `mechanic` can't accidentally touch a booking.
--
-- ORDER NUMBERING (trial)
-- -----------------------
-- service_orders.order_no is unique-when-set; until now the FE had to
-- pick a number. New BEFORE INSERT trigger fills it with
-- `SO-YYMMDD-NNNN` (daily 4-digit counter) when the row arrives with
-- order_no=NULL. If the FE explicitly passes a value the trigger leaves
-- it alone.
--
-- Race-condition note: the counter is read with a fresh query, so two
-- concurrent inserts on the same day could pick the same NNNN. The
-- unique index on order_no will reject the loser; the FE can retry.
-- For a workshop with <100 orders/day that's effectively never an issue.

-- ─── Roles ────────────────────────────────────────────────────────────────
alter type public.app_role add value if not exists 'service_advisor';
alter type public.app_role add value if not exists 'service_manager';
alter type public.app_role add value if not exists 'store_keeper';
alter type public.app_role add value if not exists 'mechanic';

-- ─── order_no generator ───────────────────────────────────────────────────
create or replace function public.generate_service_order_no()
returns trigger
language plpgsql
as $$
declare
  prefix   text := 'SO-' || to_char(now(), 'YYMMDD') || '-';
  next_seq integer;
begin
  -- Caller already provided a number — respect it.
  if new.order_no is not null then
    return new;
  end if;

  -- Find today's highest counter (length('SO-YYMMDD-') = 10, so the
  -- numeric portion starts at character 11).
  select coalesce(max(substring(order_no from 11)::int), 0) + 1
    into next_seq
    from public.service_orders
   where order_no like prefix || '%';

  new.order_no := prefix || lpad(next_seq::text, 4, '0');
  return new;
end;
$$;

drop trigger if exists trg_service_orders_order_no on public.service_orders;
create trigger trg_service_orders_order_no
before insert on public.service_orders
for each row execute function public.generate_service_order_no();
