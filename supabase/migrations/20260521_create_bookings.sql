-- ============================================================================
-- Bookings table — one row per car sale a salesperson is working on.
-- Run this whole file in Supabase Dashboard → SQL Editor → New query → Run.
-- ============================================================================

create extension if not exists "pgcrypto";

do $$ begin
  create type public.booking_status as enum (
    'pending',     -- newly created, awaiting confirmation
    'confirmed',   -- deposit paid, sale agreed
    'delivered',   -- car handed over to customer
    'cancelled'    -- customer cancelled (deposit may be forfeited)
  );
exception when duplicate_object then null; end $$;

create table if not exists public.bookings (
  id                uuid primary key default gen_random_uuid(),
  code              text unique not null
                      default (
                        'BK-' || to_char(now(), 'YYMMDD') || '-' ||
                        substr(replace(gen_random_uuid()::text, '-', ''), 1, 6)
                      ),
  owner_id          uuid not null references auth.users(id) on delete restrict
                      default auth.uid(),

  -- Customer (snapshot at booking time). NRIC is required because every
  -- booking is a legal commitment under MY law.
  customer_name     text not null,
  customer_nric     text not null,
  customer_phone    text not null,
  customer_email    text,

  -- Vehicle
  vehicle_model     text not null,
  vehicle_variant   text not null,
  vehicle_color     text not null,

  -- Money (MYR)
  otr_price         numeric(10, 2) not null default 0 check (otr_price   >= 0),
  booking_fee       numeric(10, 2) not null default 0 check (booking_fee >= 0),

  -- Dates
  booking_date      date not null default current_date,

  -- Status + free-form
  status            public.booking_status not null default 'pending',
  notes             text,

  -- Audit
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists bookings_owner_idx  on public.bookings(owner_id);
create index if not exists bookings_status_idx on public.bookings(status);
create index if not exists bookings_date_idx   on public.bookings(booking_date desc);

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_bookings_updated_at on public.bookings;
create trigger trg_bookings_updated_at
  before update on public.bookings
  for each row execute function public.set_updated_at();

-- ============================================================================
-- Grants — table is read/written by signed-in users (RLS narrows by row).
-- Without these, you get "permission denied for table bookings" even if
-- RLS would otherwise allow the row.
-- ============================================================================
grant usage on schema public to authenticated;
grant usage on type public.booking_status to authenticated;
grant select, insert, update, delete on public.bookings to authenticated;

-- ============================================================================
-- RLS — each salesperson sees / writes only their own bookings.
-- ============================================================================
alter table public.bookings enable row level security;

drop policy if exists bookings_select_own on public.bookings;
create policy bookings_select_own
  on public.bookings for select to authenticated
  using (owner_id = (select auth.uid()));

drop policy if exists bookings_insert_own on public.bookings;
create policy bookings_insert_own
  on public.bookings for insert to authenticated
  with check (owner_id = (select auth.uid()));

drop policy if exists bookings_update_own on public.bookings;
create policy bookings_update_own
  on public.bookings for update to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

drop policy if exists bookings_delete_own on public.bookings;
create policy bookings_delete_own
  on public.bookings for delete to authenticated
  using (owner_id = (select auth.uid()));
