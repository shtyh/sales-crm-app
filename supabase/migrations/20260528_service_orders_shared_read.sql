-- 2026-05-28 · service_orders are shared across the workshop floor
--
-- Previous policy gated SELECT for service_advisor callers to rows
-- where `service_advisor_id = auth.uid()` — i.e. each advisor only
-- saw their own job sheets. Workshop wants every advisor to see the
-- full queue so they can pick up handoffs and cover for each other.
--
-- Write access stays tied to ownership via can_write_service_order
-- (unchanged), so an advisor still can't edit someone else's job.

create or replace function public.can_read_service_order(advisor_id uuid)
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
