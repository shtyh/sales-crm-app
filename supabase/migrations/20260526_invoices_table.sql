-- 2026-05-26 — invoices table linked to bookings + customers.
--
-- WHY
-- ---
-- Each delivered booking generates one (or sometimes more) invoices to
-- the customer: a tax invoice for the OTR, sometimes a separate one for
-- accessories. The CRM has had nowhere to track them.
--
-- DESIGN NOTES
-- ------------
-- * booking_id + customer_id are both required FKs. customer_id is
--   technically derivable via the booking, but invoicing sometimes
--   redirects to a different payer (e.g. company name instead of the
--   individual buyer), so we capture the chosen payer per invoice.
-- * invoice_number is unique-when-present (NULL allowed for in-flight
--   drafts). Postgres treats NULLs as distinct in unique indexes, so
--   multiple drafts can coexist before a number is allocated.
-- * subtotal + tax_amount + total_amount are stored independently
--   rather than computed, because real-world tax rounding sometimes
--   forces a manual adjustment in the final total. The frontend can
--   show a warning if total != subtotal + tax.
-- * invoice_date is a `date`, not a timestamp — invoices are dated to a
--   calendar day for tax purposes, not a millisecond instant.

-- 1. Enum -----------------------------------------------------------------
do $$ begin
  create type public.invoice_status as enum ('draft', 'issued', 'paid');
exception when duplicate_object then null; end $$;

-- 2. Table ----------------------------------------------------------------
create table if not exists public.invoices (
  id              uuid primary key default gen_random_uuid(),
  booking_id      uuid not null
                    references public.bookings(id)  on delete restrict,
  customer_id     uuid not null
                    references public.customers(id) on delete restrict,
  invoice_number  text,
  invoice_date    date not null default current_date,
  subtotal        numeric(12,2) not null default 0 check (subtotal     >= 0),
  tax_amount      numeric(12,2) not null default 0 check (tax_amount   >= 0),
  total_amount    numeric(12,2) not null default 0 check (total_amount >= 0),
  status          public.invoice_status not null default 'draft',
  created_at      timestamptz not null default now(),
  constraint invoices_invoice_number_key unique (invoice_number)
);

comment on table  public.invoices                is 'Tax invoices issued against bookings.';
comment on column public.invoices.invoice_number is 'Unique when set. NULL while the invoice is in draft.';
comment on column public.invoices.invoice_date   is 'The legal invoice date (calendar day), not the timestamp of entry.';

create index if not exists invoices_booking_id_idx   on public.invoices(booking_id);
create index if not exists invoices_customer_id_idx  on public.invoices(customer_id);
create index if not exists invoices_invoice_date_idx on public.invoices(invoice_date desc);

-- 3. GRANTs (RLS can't run without these) ---------------------------------
grant select, insert, update, delete on public.invoices to authenticated;

-- 4. RLS ------------------------------------------------------------------
alter table public.invoices enable row level security;

-- SELECT: anyone who can see the booking can see its invoices (matches
-- the payments_select pattern — mirror booking visibility via EXISTS).
drop policy if exists invoices_select on public.invoices;
create policy invoices_select on public.invoices
  for select to authenticated
  using (
    exists (select 1 from public.bookings b where b.id = invoices.booking_id)
  );

-- INSERT / UPDATE: finance_admin (and super_admin via god mode) own the
-- invoicing flow. Same role gate as deposit_status / payment_status /
-- payments.
drop policy if exists invoices_insert on public.invoices;
create policy invoices_insert on public.invoices
  for insert to authenticated
  with check (
    public.is_super_admin()
    or public.current_app_role() = 'finance_admin'
  );

drop policy if exists invoices_update on public.invoices;
create policy invoices_update on public.invoices
  for update to authenticated
  using (
    public.is_super_admin()
    or public.current_app_role() = 'finance_admin'
  )
  with check (
    public.is_super_admin()
    or public.current_app_role() = 'finance_admin'
  );

-- DELETE: super_admin only. Once an invoice has been issued to a
-- customer, the trail shouldn't be removable by anyone else; corrections
-- should be a credit note rather than a hard delete.
drop policy if exists invoices_delete on public.invoices;
create policy invoices_delete on public.invoices
  for delete to authenticated
  using (public.is_super_admin());
