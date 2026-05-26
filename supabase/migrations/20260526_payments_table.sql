-- 2026-05-26 — first-class payments ledger linked to bookings.
--
-- WHY
-- ---
-- Until now, "paid" was a single status field on bookings (unpaid /
-- partial / paid) with no breakdown of who paid what, when, or how. As
-- the dealership processes more deposits + final payments, the team
-- needs an audit trail: every receipt is one row here, attributable to
-- a profile (received_by) and a booking.
--
-- DESIGN NOTES
-- ------------
-- * payment_type ('deposit' / 'full' / 'partial') describes the role
--   the payment plays in the booking lifecycle.
-- * payment_method ('cash' / 'bank_transfer' / 'card') describes how
--   the money arrived; useful for end-of-day reconciliation.
-- * received_by FK → profiles(id). On delete restrict, because losing
--   the operator who took the cash would obscure the trail.
-- * received_at is the *business* timestamp (when the money came in);
--   created_at is the *record* timestamp (when we typed it in). Both
--   are needed — admins sometimes back-fill payments after the fact.
-- * No auto-sync to bookings.payment_status; the human deciding when a
--   booking is "fully paid" needs that judgment call. We can wire a
--   trigger later if the workflow proves it deserves automation.

-- 1. Enums -----------------------------------------------------------------
do $$ begin
  create type public.payment_type as enum ('deposit', 'full', 'partial');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.payment_method as enum ('cash', 'bank_transfer', 'card');
exception when duplicate_object then null; end $$;

-- 2. Table -----------------------------------------------------------------
create table if not exists public.payments (
  id              uuid primary key default gen_random_uuid(),
  booking_id      uuid not null
                    references public.bookings(id) on delete restrict,
  amount          numeric(12,2) not null check (amount > 0),
  payment_type    public.payment_type   not null,
  payment_method  public.payment_method not null,
  received_by     uuid not null
                    references public.profiles(id) on delete restrict,
  received_at     timestamptz not null default now(),
  notes           text,
  created_at      timestamptz not null default now()
);

comment on table  public.payments              is 'Append-only ledger of money received against a booking.';
comment on column public.payments.received_at  is 'When the money was received in real life (may be back-dated).';
comment on column public.payments.created_at   is 'When the record was created in the CRM.';

create index if not exists payments_booking_id_idx
  on public.payments(booking_id);
create index if not exists payments_received_at_idx
  on public.payments(received_at desc);

-- 3. GRANTs (RLS can't run without these) ----------------------------------
-- Stock Supabase pattern: SQL-created tables don't auto-grant to the
-- `authenticated` role. Skipping this would yield 'permission denied for
-- table payments' before any RLS policy fires. (Same lesson we already
-- learned with the customers table.)
grant select, insert, update, delete on public.payments to authenticated;

-- 4. RLS -------------------------------------------------------------------
alter table public.payments enable row level security;

-- SELECT: if you can see the booking, you can see its payments. Mirrors
-- the bookings_select policy exactly via an EXISTS subquery; that keeps
-- the rule in lockstep with the bookings policy if it ever changes.
drop policy if exists payments_select on public.payments;
create policy payments_select on public.payments
  for select to authenticated
  using (
    exists (
      select 1 from public.bookings b
      where b.id = payments.booking_id
    )
  );

-- INSERT / UPDATE: finance_admin (or super_admin) only. They own
-- deposit_status / payment_status today; receipts live in the same
-- mental model.
drop policy if exists payments_insert on public.payments;
create policy payments_insert on public.payments
  for insert to authenticated
  with check (
    public.is_super_admin()
    or public.current_app_role() = 'finance_admin'
  );

drop policy if exists payments_update on public.payments;
create policy payments_update on public.payments
  for update to authenticated
  using (
    public.is_super_admin()
    or public.current_app_role() = 'finance_admin'
  )
  with check (
    public.is_super_admin()
    or public.current_app_role() = 'finance_admin'
  );

-- DELETE: super_admin only. A payment record is part of the audit
-- trail; corrections should be appended (a negative-amount reversal
-- ideally) rather than hard-deleted.
drop policy if exists payments_delete on public.payments;
create policy payments_delete on public.payments
  for delete to authenticated
  using (public.is_super_admin());
