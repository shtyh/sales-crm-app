-- Stock Issued List report: every part-issue transaction (service_order_items
-- kind='part') in a date range, joined to its job (order_no + date) and the
-- part master. SECURITY DEFINER + server-side so it bypasses the PostgREST
-- 1000-row cap once the service-history import lands. Date filter uses the
-- KL-local date of the issue. Amount = line_total (selling), per spec.
create or replace function public.stock_issued_list(p_from date, p_to date)
returns table (
  issued_at  timestamptz,
  order_no   text,
  part_no    text,
  part_name  text,
  brand      text,
  category   text,
  qty        numeric,
  amount     numeric
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    coalesce(so.opened_at, so.created_at)       as issued_at,
    so.order_no,
    p.part_no,
    p.name                                      as part_name,
    p.brand,
    p.category,
    soi.quantity                                as qty,
    coalesce(soi.line_total, 0)                 as amount
  from public.service_order_items soi
  join public.service_orders so on so.id = soi.service_order_id
  join public.parts_inventory  p  on p.id = soi.part_id
  where soi.kind = 'part'
    and soi.part_id is not null
    and (coalesce(so.opened_at, so.created_at) at time zone 'Asia/Kuala_Lumpur')::date
        between p_from and p_to
  order by p.part_no, issued_at;
$$;

revoke all on function public.stock_issued_list(date, date) from public;
grant execute on function public.stock_issued_list(date, date) to authenticated;
