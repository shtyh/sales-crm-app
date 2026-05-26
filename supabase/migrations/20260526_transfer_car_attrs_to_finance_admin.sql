-- Transfer car-attribute write ownership from general_admin to finance_admin.
--
-- Showroom restructure: finance_admin now manages vehicle intake (the
-- "+ New car" flow + edits to chassis_no / model / variant / color /
-- arrived_at / status). general_admin keeps booking-side rights but no
-- longer touches the cars table directly.
--
-- Floor-stock columns stay finance_admin (unchanged).
-- super_admin still bypasses everything via early-return in the guard.

drop policy if exists cars_insert on public.cars;
create policy cars_insert on public.cars
  for insert to authenticated
  with check (
    public.is_super_admin()
    or public.current_app_role() = 'finance_admin'
  );

drop policy if exists cars_update on public.cars;
create policy cars_update on public.cars
  for update to authenticated
  using (
    public.is_super_admin()
    or public.current_app_role() = 'finance_admin'
  )
  with check (
    public.is_super_admin()
    or public.current_app_role() = 'finance_admin'
  );

create or replace function public.guard_car_field_writes()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  caller public.app_role := public.current_app_role();
begin
  -- System-driven writes (recompute_car_status) bypass the guard.
  if coalesce(current_setting('app.system_op', true), 'off') = 'on' then
    return new;
  end if;
  if caller = 'super_admin' then return new; end if;

  if (new.floor_stock_bank   is distinct from old.floor_stock_bank
      or new.financed_amount    is distinct from old.financed_amount
      or new.floor_stock_status is distinct from old.floor_stock_status
      or new.floor_stock_due    is distinct from old.floor_stock_due)
     and caller is distinct from 'finance_admin' then
    raise exception 'Only finance_admin can change floor stock fields'
      using errcode = '42501', hint = format('your role: %s', caller);
  end if;

  if (new.chassis_no is distinct from old.chassis_no
      or new.model      is distinct from old.model
      or new.variant    is distinct from old.variant
      or new.color      is distinct from old.color
      or new.arrived_at is distinct from old.arrived_at
      or new.status     is distinct from old.status)
     and caller is distinct from 'finance_admin' then
    raise exception 'Only finance_admin can change vehicle attributes'
      using errcode = '42501', hint = format('your role: %s', caller);
  end if;

  return new;
end;
$$;
revoke execute on function public.guard_car_field_writes() from anon, authenticated, public;
