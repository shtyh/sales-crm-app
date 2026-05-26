-- 2026-05-26 — extend vehicles + customers with the fields the legacy
-- WMS "Edit Vehicle Information / Account" dialog has, so the New Job
-- Sheet → New Registration popup can persist everything the workshop
-- used to capture.
--
-- All columns are nullable / defaulted so existing rows stay valid and
-- existing inserts (which don't mention these fields) keep working.

-- ─── vehicles ───────────────────────────────────────────────────────────
alter table public.vehicles
  add column if not exists account_no        text,
  add column if not exists membership_no     text,
  add column if not exists engine_no         text,
  add column if not exists capacity_cc       integer,
  add column if not exists year_make         integer,
  add column if not exists registration_date date,
  add column if not exists warranty_date     date;

comment on column public.vehicles.account_no        is 'Legacy WMS account/customer code if migrated from the prior system.';
comment on column public.vehicles.membership_no     is 'Workshop membership card no.';
comment on column public.vehicles.engine_no         is 'Engine serial.';
comment on column public.vehicles.capacity_cc       is 'Engine displacement in cc.';
comment on column public.vehicles.year_make         is 'Manufacture year (just the year — registration_date covers the calendar date).';
comment on column public.vehicles.registration_date is 'Date the car was first registered with JPJ.';
comment on column public.vehicles.warranty_date     is 'Warranty expiry date.';

-- ─── customers ─────────────────────────────────────────────────────────
alter table public.customers
  -- Address parts (existing `address` keeps the multi-line street/unit; new
  -- columns split out the postal admin levels for reporting).
  add column if not exists city               text,
  add column if not exists state              text,
  add column if not exists post_code          text,
  -- Extra contact channels
  add column if not exists phone2             text,
  add column if not exists fax_no             text,
  -- Tax / identity
  add column if not exists tin_no             text,
  add column if not exists tax_no             text,
  -- Demographics — single-letter codes match the legacy WMS dropdowns
  add column if not exists sex                text,   -- 'M' / 'F'
  add column if not exists race               text,   -- 'C' / 'M' / 'I' / 'O'
  add column if not exists marital_status     text,   -- 'S' / 'M' / 'D'
  add column if not exists birthday           date,
  add column if not exists sales_dealer       text,
  -- Account status — 'active' / 'inactive' (legacy WMS used 'AC' / 'IN')
  add column if not exists status             text   not null default 'active',
  add column if not exists fixed_discount_rate numeric(5,2) not null default 0
                            check (fixed_discount_rate >= 0 and fixed_discount_rate <= 100),
  add column if not exists preference_list_price text not null default 'List Price 1',
  -- Reminder dates
  add column if not exists road_tax_renewal           date,
  add column if not exists insurance_renewal          date,
  add column if not exists driving_license_renewal    date,
  -- Reminder toggles (default on, matching the legacy form's pre-checked boxes)
  add column if not exists road_tax_send_reminder         boolean not null default true,
  add column if not exists insurance_send_reminder        boolean not null default true,
  add column if not exists driving_license_send_reminder  boolean not null default true,
  add column if not exists birthday_send_reminder         boolean not null default true,
  add column if not exists send_next_service_reminder     boolean not null default true,
  add column if not exists send_greeting_card             boolean not null default true;

-- Loose CHECKs — keep the single-letter dropdowns consistent without
-- locking us into Postgres enums.
alter table public.customers
  drop constraint if exists customers_sex_chk;
alter table public.customers
  add  constraint customers_sex_chk
       check (sex is null or sex in ('M', 'F'));

alter table public.customers
  drop constraint if exists customers_race_chk;
alter table public.customers
  add  constraint customers_race_chk
       check (race is null or race in ('C', 'M', 'I', 'O'));

alter table public.customers
  drop constraint if exists customers_marital_status_chk;
alter table public.customers
  add  constraint customers_marital_status_chk
       check (marital_status is null or marital_status in ('S', 'M', 'D'));

alter table public.customers
  drop constraint if exists customers_status_chk;
alter table public.customers
  add  constraint customers_status_chk
       check (status in ('active', 'inactive'));
