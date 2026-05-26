-- 2026-05-26 — workshop SA's own-orders RLS + quote workflow column.
--
-- WHY
-- ---
-- The Service Advisor (SA) role on the workshop side should see only
-- their own job orders, not other SAs'. Phase-1 RLS on service_orders
-- was "any auth SELECT" — fine while we were testing. Now we tighten:
--   * SA sees only rows where service_advisor_id = auth.uid()
--   * SM / store_keeper / mechanic / GA / SM-sales / finance / super
--     see everything (their existing access is unchanged)
-- INSERT/UPDATE for SA additionally enforces "you can only write rows
-- you own" so an SA can't grab someone else's order via PATCH.
--
-- service_order_items inherits the parent order's gate via EXISTS.
--
-- QUOTE WORKFLOW
-- --------------
-- Add a `quote_status` enum + column to service_orders. The SA bumps
-- it from 'none' → 'sent' when they hand the quote to the customer,
-- then → 'approved' or 'rejected' after speaking to them. No magic-link
-- approval yet; manual flip by the SA / SM.

-- ─── quote_status enum + column ───────────────────────────────────────────
do $$ begin
  create type public.quote_status as enum ('none','sent','approved','rejected');
exception when duplicate_object then null; end $$;

alter table public.service_orders
  add column if not exists quote_status public.quote_status
    not null default 'none';

comment on column public.service_orders.quote_status is
  'Quote-to-customer state. ''sent'' = awaiting customer approval. The SA flips this manually after speaking to the customer until a customer-facing approval link exists.';

-- ─── Predicate helpers ─────────────────────────────────────────────────────
-- One function for the read-check, one for the write-check. Keeps the
-- policies short and means a future tweak is one place to edit.
create or replace function public.can_read_service_order(advisor_id uuid)
returns boolean
language sql stable security definer set search_path = public, pg_temp
as $$
  select
    public.is_super_admin()
    or public.current_app_role() <> 'service_advisor'
    or advisor_id = (select auth.uid())
$$;

create or replace function public.can_write_service_order(advisor_id uuid)
returns boolean
language sql stable security definer set search_path = public, pg_temp
as $$
  -- Phase-1 base: only non-SA (sales-side SA still excluded). Workshop SA
  -- additionally restricted to rows they own.
  select
    public.is_super_admin()
    or (
      public.current_app_role() <> 'sales_advisor'
      and (
        public.current_app_role() <> 'service_advisor'
        or advisor_id = (select auth.uid())
      )
    )
$$;

-- ─── service_orders policies ─────────────────────────────────────────────
drop policy if exists service_orders_select on public.service_orders;
drop policy if exists service_orders_insert on public.service_orders;
drop policy if exists service_orders_update on public.service_orders;
drop policy if exists service_orders_delete on public.service_orders;

create policy service_orders_select on public.service_orders
  for select to authenticated
  using (public.can_read_service_order(service_advisor_id));

create policy service_orders_insert on public.service_orders
  for insert to authenticated
  with check (public.can_write_service_order(service_advisor_id));

create policy service_orders_update on public.service_orders
  for update to authenticated
  using       (public.can_write_service_order(service_advisor_id))
  with check  (public.can_write_service_order(service_advisor_id));

create policy service_orders_delete on public.service_orders
  for delete to authenticated
  using (public.is_super_admin());

-- ─── service_order_items policies ────────────────────────────────────────
-- Visibility + write-ability inherited from the parent service_order.
drop policy if exists service_order_items_select on public.service_order_items;
drop policy if exists service_order_items_insert on public.service_order_items;
drop policy if exists service_order_items_update on public.service_order_items;
drop policy if exists service_order_items_delete on public.service_order_items;

create policy service_order_items_select on public.service_order_items
  for select to authenticated
  using (
    exists (
      select 1 from public.service_orders so
      where so.id = service_order_items.service_order_id
        and public.can_read_service_order(so.service_advisor_id)
    )
  );

create policy service_order_items_insert on public.service_order_items
  for insert to authenticated
  with check (
    exists (
      select 1 from public.service_orders so
      where so.id = service_order_items.service_order_id
        and public.can_write_service_order(so.service_advisor_id)
    )
  );

create policy service_order_items_update on public.service_order_items
  for update to authenticated
  using (
    exists (
      select 1 from public.service_orders so
      where so.id = service_order_items.service_order_id
        and public.can_write_service_order(so.service_advisor_id)
    )
  )
  with check (
    exists (
      select 1 from public.service_orders so
      where so.id = service_order_items.service_order_id
        and public.can_write_service_order(so.service_advisor_id)
    )
  );

-- DELETE on line items: anyone who can write the parent order can also
-- delete a line. SAs need this to undo mis-adds without pinging super.
-- Hard-deleting the parent service_order itself stays super-only.
create policy service_order_items_delete on public.service_order_items
  for delete to authenticated
  using (
    exists (
      select 1 from public.service_orders so
      where so.id = service_order_items.service_order_id
        and public.can_write_service_order(so.service_advisor_id)
    )
  );
