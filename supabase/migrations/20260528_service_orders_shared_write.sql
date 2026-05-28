-- 2026-05-28 · service_orders are also shared for writes
--
-- Companion to 20260528_service_orders_shared_read.sql. Workshop wants
-- every advisor to be able to add billing items / update job sheets,
-- not just their own. This loosens can_write_service_order to mirror
-- the read function — any non-sales role can write. (Sales advisors
-- stay locked out of the workshop tables.)
--
-- This fixes:
--   "new row violates row-level security policy for table
--    service_order_items"
-- when a service_advisor adds a billing line to a job whose
-- service_advisor_id is someone else (or null).

create or replace function public.can_write_service_order(advisor_id uuid)
returns boolean
language sql
stable
security definer
set search_path = 'public', 'pg_temp'
as $$
  select
    public.is_super_admin()
    or public.current_app_role() <> 'sales_advisor'
$$;
