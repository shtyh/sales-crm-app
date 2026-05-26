-- 2026-05-26 — Service module foundation.
--
-- Five tables that together represent the workshop side of a Proton 3S
-- centre. Sales is already covered (bookings / cars / customers /
-- payments / invoices); these tables cover the Service half.
--
--   vehicles            — customer-owned cars (keyed on plate, optionally
--                          linked to a SWL-sold cars row by chassis).
--   technicians         — mechanic roster (separate from profiles because
--                          not every technician needs a login).
--   parts_inventory     — spare parts master + on-hand stock count.
--   service_orders      — one work order per visit (job sheet).
--   service_order_items — line items on each order: parts used + labour.
--
-- Phase 1 design choices:
--   * Stock is NOT auto-decremented when a part is added to an order —
--     too easy to get wrong on edits/cancels. A later trigger / explicit
--     "fulfil order" step can deduct.
--   * RLS is permissive (any auth reads, non-SA writes, super deletes)
--     so the SA/SM/finance/admin teams can all participate while we
--     learn the real workflow. Service-specific roles (service_advisor,
--     mechanic, service_manager) can come later.
--   * order_no is unique-when-set so the FE can save drafts before
--     assigning a number, then format it (e.g. SO-260526-0001) on
--     check-in.

-- ─── Enums ────────────────────────────────────────────────────────────────
do $$ begin
  create type public.service_order_status as enum (
    'open',            -- created, awaiting work
    'in_progress',     -- technician working
    'awaiting_parts',  -- paused, parts on order
    'completed',       -- work done, awaiting collection
    'collected',       -- customer picked up
    'cancelled'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.service_item_kind as enum ('part', 'labour');
exception when duplicate_object then null; end $$;

-- ─── 1. technicians ───────────────────────────────────────────────────────
-- A separate table from `profiles` because a mechanic may not have (or
-- need) a CRM login. profile_id is nullable; populate it when the
-- technician is also an authenticated staff member so we can attribute
-- their work back to a user.
create table if not exists public.technicians (
  id           uuid primary key default gen_random_uuid(),
  profile_id   uuid references public.profiles(id) on delete set null,
  name         text not null,
  employee_no  text,
  phone        text,
  specialty    text,
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint technicians_employee_no_key unique (employee_no),
  constraint technicians_profile_id_key  unique (profile_id)
);

comment on table  public.technicians            is 'Workshop mechanic roster. Optionally linked to a profile for login.';
comment on column public.technicians.profile_id is 'Nullable. Set if this technician also signs in to the CRM.';

drop trigger if exists technicians_set_updated_at on public.technicians;
create trigger technicians_set_updated_at
before update on public.technicians
for each row execute function public.set_updated_at();

-- ─── 2. parts_inventory ───────────────────────────────────────────────────
create table if not exists public.parts_inventory (
  id              uuid primary key default gen_random_uuid(),
  part_no         text not null,
  name            text not null,
  description     text,
  brand           text,
  unit            text not null default 'each',
  unit_cost       numeric(12,2) not null default 0 check (unit_cost  >= 0),
  unit_price      numeric(12,2) not null default 0 check (unit_price >= 0),
  stock_qty       numeric(12,2) not null default 0,
  reorder_level   numeric(12,2) not null default 0 check (reorder_level >= 0),
  location        text,
  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint parts_inventory_part_no_key unique (part_no)
);

comment on table  public.parts_inventory               is 'Spare parts master + on-hand stock count.';
comment on column public.parts_inventory.stock_qty     is 'Current on-hand quantity. Not auto-decremented yet.';
comment on column public.parts_inventory.reorder_level is 'Trigger threshold for low-stock alerts.';

create index if not exists parts_inventory_part_no_idx on public.parts_inventory(part_no);

drop trigger if exists parts_inventory_set_updated_at on public.parts_inventory;
create trigger parts_inventory_set_updated_at
before update on public.parts_inventory
for each row execute function public.set_updated_at();

-- ─── 3. vehicles ──────────────────────────────────────────────────────────
-- A customer can own multiple vehicles. registration_no is the plate
-- (unique). car_id is an optional bridge to the SWL inventory cars row,
-- populated when the workshop is servicing a car SWL originally sold.
create table if not exists public.vehicles (
  id               uuid primary key default gen_random_uuid(),
  customer_id      uuid not null references public.customers(id) on delete restrict,
  car_id           uuid references public.cars(id) on delete set null,
  registration_no  text not null,
  chassis_no       text,
  model            text not null,
  variant          text,
  color            text,
  year             smallint,
  mileage          integer,
  notes            text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint vehicles_registration_no_key unique (registration_no),
  constraint vehicles_chassis_no_key      unique (chassis_no)
);

comment on table  public.vehicles            is 'Customer-owned cars seen by the workshop. Plate is the primary key for staff lookup.';
comment on column public.vehicles.car_id     is 'Optional: bridges to a cars (SWL inventory) row when the service vehicle was sold by SWL.';
comment on column public.vehicles.mileage    is 'Last-known mileage at any visit; updated when a service order records a new reading.';

create index if not exists vehicles_customer_id_idx on public.vehicles(customer_id);

drop trigger if exists vehicles_set_updated_at on public.vehicles;
create trigger vehicles_set_updated_at
before update on public.vehicles
for each row execute function public.set_updated_at();

-- ─── 4. service_orders ────────────────────────────────────────────────────
create table if not exists public.service_orders (
  id                  uuid primary key default gen_random_uuid(),
  order_no            text,
  customer_id         uuid not null references public.customers(id)  on delete restrict,
  vehicle_id          uuid not null references public.vehicles(id)   on delete restrict,
  technician_id       uuid references public.technicians(id)         on delete set null,
  service_advisor_id  uuid references public.profiles(id)            on delete set null,
  status              public.service_order_status not null default 'open',
  complaint           text,
  diagnosis           text,
  mileage_in          integer,
  opened_at           timestamptz not null default now(),
  completed_at        timestamptz,
  collected_at        timestamptz,
  subtotal            numeric(12,2) not null default 0 check (subtotal     >= 0),
  tax_amount          numeric(12,2) not null default 0 check (tax_amount   >= 0),
  total_amount        numeric(12,2) not null default 0 check (total_amount >= 0),
  notes               text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint service_orders_order_no_key unique (order_no)
);

comment on table  public.service_orders           is 'One row per visit / job sheet.';
comment on column public.service_orders.order_no  is 'Unique-when-set. NULL while the order is a draft.';
comment on column public.service_orders.subtotal  is 'Cached sum of line items. Refreshed by the FE on save; we can move this into a trigger later.';

create index if not exists service_orders_customer_id_idx  on public.service_orders(customer_id);
create index if not exists service_orders_vehicle_id_idx   on public.service_orders(vehicle_id);
create index if not exists service_orders_technician_idx   on public.service_orders(technician_id);
create index if not exists service_orders_status_idx       on public.service_orders(status);
create index if not exists service_orders_opened_at_idx    on public.service_orders(opened_at desc);

drop trigger if exists service_orders_set_updated_at on public.service_orders;
create trigger service_orders_set_updated_at
before update on public.service_orders
for each row execute function public.set_updated_at();

-- ─── 5. service_order_items ───────────────────────────────────────────────
-- Each order has 0..N line items: either a `part` (FK into parts_inventory)
-- or a `labour` line (free-text description, e.g. "Oil change service").
-- line_total = quantity * unit_price, stored to avoid re-summing on every
-- read; FE keeps it consistent.
create table if not exists public.service_order_items (
  id                uuid primary key default gen_random_uuid(),
  service_order_id  uuid not null references public.service_orders(id) on delete cascade,
  kind              public.service_item_kind not null,
  part_id           uuid references public.parts_inventory(id) on delete set null,
  description       text not null,
  quantity          numeric(12,2) not null default 1 check (quantity > 0),
  unit_price        numeric(12,2) not null default 0 check (unit_price >= 0),
  line_total        numeric(12,2) not null default 0 check (line_total >= 0),
  created_at        timestamptz not null default now(),
  -- A labour line must not point at a part; a part line should.
  constraint service_order_items_part_consistency
    check (
      (kind = 'labour' and part_id is null)
      or (kind = 'part')
    )
);

comment on table public.service_order_items is 'Parts + labour lines on a service order. Cascades with the order.';

create index if not exists service_order_items_order_idx on public.service_order_items(service_order_id);
create index if not exists service_order_items_part_idx  on public.service_order_items(part_id);

-- ─── GRANTs (RLS can't run without table-level privileges first) ──────────
grant select, insert, update, delete on public.technicians         to authenticated;
grant select, insert, update, delete on public.parts_inventory     to authenticated;
grant select, insert, update, delete on public.vehicles            to authenticated;
grant select, insert, update, delete on public.service_orders      to authenticated;
grant select, insert, update, delete on public.service_order_items to authenticated;

-- ─── RLS — Phase 1 permissive model ───────────────────────────────────────
-- Reads open to any authenticated user (anyone in the company may need
-- to look something up). Writes restricted to non-SA roles. Deletes
-- super-only across the board.
alter table public.technicians         enable row level security;
alter table public.parts_inventory     enable row level security;
alter table public.vehicles            enable row level security;
alter table public.service_orders      enable row level security;
alter table public.service_order_items enable row level security;

-- SELECT — open
do $$
declare t text;
begin
  foreach t in array array[
    'technicians', 'parts_inventory', 'vehicles',
    'service_orders', 'service_order_items'
  ]
  loop
    execute format('drop policy if exists %I_select on public.%I', t, t);
    execute format(
      'create policy %I_select on public.%I for select to authenticated using (true)',
      t, t
    );
  end loop;
end $$;

-- INSERT / UPDATE — any non-SA role (sales_advisor stays read-only on
-- the workshop tables for now; they can browse stock and history but
-- not edit). super_admin always allowed.
do $$
declare t text;
begin
  foreach t in array array[
    'technicians', 'parts_inventory', 'vehicles',
    'service_orders', 'service_order_items'
  ]
  loop
    execute format('drop policy if exists %I_insert on public.%I', t, t);
    execute format(
      $f$create policy %I_insert on public.%I for insert to authenticated
         with check (public.is_super_admin() or public.current_app_role() <> 'sales_advisor')$f$,
      t, t
    );
    execute format('drop policy if exists %I_update on public.%I', t, t);
    execute format(
      $f$create policy %I_update on public.%I for update to authenticated
         using       (public.is_super_admin() or public.current_app_role() <> 'sales_advisor')
         with check  (public.is_super_admin() or public.current_app_role() <> 'sales_advisor')$f$,
      t, t
    );
  end loop;
end $$;

-- DELETE — super_admin only.
do $$
declare t text;
begin
  foreach t in array array[
    'technicians', 'parts_inventory', 'vehicles',
    'service_orders', 'service_order_items'
  ]
  loop
    execute format('drop policy if exists %I_delete on public.%I', t, t);
    execute format(
      'create policy %I_delete on public.%I for delete to authenticated using (public.is_super_admin())',
      t, t
    );
  end loop;
end $$;
