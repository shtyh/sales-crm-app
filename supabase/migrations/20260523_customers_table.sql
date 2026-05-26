-- 2026-05-23 — extract a proper customers table out of the bookings row.
--
-- WHY
-- ---
-- Until now, customer details lived denormalised on `bookings.customer_*`.
-- That's fine for one-off bookings but the same customer can take out
-- multiple bookings (re-purchase, family member's purchase, etc.) and we
-- end up with the same person typed in slightly differently each time.
-- A first-class customers table:
--   * deduplicates by NRIC (the closest thing to a stable national ID),
--   * gives us an address column (didn't exist before), and
--   * lets future features attach to a customer (loyalty, contact log…).
--
-- BACKWARD COMPAT
-- ---------------
-- The `bookings.customer_*` columns are KEPT for now. They double as a
-- snapshot of the customer at booking time (a customer's phone can change
-- but the booking record should still reflect the contact used on that
-- deal). The frontend will continue to read them until we update it to
-- look up the linked customer.
--
-- DATA
-- ----
-- 2 bookings, 2 distinct NRICs, no conflicting customer data — confirmed
-- before writing this. So the backfill is straightforward.

-- 1. Table -----------------------------------------------------------------
create table if not exists public.customers (
  id          uuid primary key default gen_random_uuid(),
  name        text        not null,
  nric        text        not null,
  phone       text        not null,
  email       text,
  address     text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint customers_nric_key unique (nric)
);

comment on table  public.customers      is 'One row per real-world customer, deduplicated by NRIC.';
comment on column public.customers.nric is 'Malaysian NRIC / passport. Unique.';

-- Auto-bump updated_at (reuses the existing project-wide helper).
drop trigger if exists customers_set_updated_at on public.customers;
create trigger customers_set_updated_at
before update on public.customers
for each row execute function public.set_updated_at();

-- 2. GRANTs + RLS ----------------------------------------------------------
-- Supabase's stock posture for new tables created via SQL doesn't grant
-- anything to `authenticated`, so RLS policies on their own are useless
-- (PostgREST rejects the request at the privilege layer with 'permission
-- denied for table customers' before RLS even runs). Granting CRUD here;
-- per-row rules below handle the actual gating.
grant select, insert, update, delete on public.customers to authenticated;

-- Permissive read/write to any authenticated user: every role that can see
-- a booking already sees the customer details on that booking, so the
-- customers table doesn't expose anything new. DELETE is super-only because
-- a stray delete here would cascade-block bookings (we use ON DELETE
-- RESTRICT below).
alter table public.customers enable row level security;

drop policy if exists customers_select on public.customers;
create policy customers_select on public.customers
  for select to authenticated using (true);

drop policy if exists customers_insert on public.customers;
create policy customers_insert on public.customers
  for insert to authenticated with check (true);

drop policy if exists customers_update on public.customers;
create policy customers_update on public.customers
  for update to authenticated
  using (true) with check (true);

drop policy if exists customers_delete on public.customers;
create policy customers_delete on public.customers
  for delete to authenticated
  using (public.is_super_admin());

-- 3. Backfill from bookings ------------------------------------------------
-- DISTINCT ON picks one row per NRIC; we prefer the most recently updated
-- booking, on the theory that newer data is more likely current.
insert into public.customers (name, nric, phone, email)
select distinct on (customer_nric)
       customer_name,
       customer_nric,
       customer_phone,
       nullif(customer_email, '')
  from public.bookings
 where customer_nric is not null
   and trim(customer_nric) <> ''
 order by customer_nric, updated_at desc, created_at desc
on conflict (nric) do nothing;

-- 4. FK column on bookings -------------------------------------------------
-- Nullable for now so existing rows aren't blocked while the frontend still
-- creates bookings without going through the customers table. A follow-up
-- migration can ALTER … SET NOT NULL once the UI is updated.
alter table public.bookings
  add column if not exists customer_id uuid
    references public.customers(id) on delete restrict;

create index if not exists bookings_customer_id_idx
  on public.bookings(customer_id);

-- 5. Backfill bookings.customer_id ----------------------------------------
update public.bookings b
   set customer_id = c.id
  from public.customers c
 where c.nric = b.customer_nric
   and b.customer_id is null;
