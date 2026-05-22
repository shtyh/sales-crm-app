-- ============================================================================
-- 1. car_status auto-sync
--    bookings AFTER INSERT/UPDATE/DELETE recomputes the linked car(s)'
--    status from the set of bookings still pointing at it:
--      any 'delivered'           → car.status = 'delivered'
--      any 'pending'/'confirmed' → 'reserved'
--      otherwise                 → 'in_stock'
--    System-driven writes bypass the cars per-column guard via a
--    transaction-local config flag.
-- ============================================================================

create or replace function public.recompute_car_status(target_car uuid)
returns void
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  has_delivered boolean;
  has_active    boolean;
  new_status    public.car_status;
begin
  if target_car is null then return; end if;
  select
    bool_or(status = 'delivered'),
    bool_or(status in ('pending','confirmed'))
  into has_delivered, has_active
  from public.bookings
  where car_id = target_car;

  if has_delivered then
    new_status := 'delivered';
  elsif has_active then
    new_status := 'reserved';
  else
    new_status := 'in_stock';
  end if;

  perform set_config('app.system_op', 'on', true);
  update public.cars
     set status = new_status
   where id = target_car
     and status is distinct from new_status;
  perform set_config('app.system_op', 'off', true);
end;
$$;
revoke execute on function public.recompute_car_status(uuid) from anon, authenticated, public;

create or replace function public.sync_car_status_from_booking()
returns trigger
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  old_car uuid := case when TG_OP <> 'INSERT' then old.car_id end;
  new_car uuid := case when TG_OP <> 'DELETE' then new.car_id end;
begin
  if old_car is not null then perform public.recompute_car_status(old_car); end if;
  if new_car is not null and new_car is distinct from old_car then
    perform public.recompute_car_status(new_car);
  end if;
  if TG_OP = 'UPDATE'
     and old.car_id is not distinct from new.car_id
     and old.status is distinct from new.status
     and new.car_id is not null then
    perform public.recompute_car_status(new.car_id);
  end if;
  return coalesce(new, old);
end;
$$;
revoke execute on function public.sync_car_status_from_booking() from anon, authenticated, public;

drop trigger if exists trg_bookings_sync_car on public.bookings;
create trigger trg_bookings_sync_car
  after insert or update or delete on public.bookings
  for each row execute function public.sync_car_status_from_booking();

-- Teach the cars guard to step aside for system-driven writes
create or replace function public.guard_car_field_writes()
returns trigger
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  caller public.app_role := public.current_app_role();
begin
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
     and caller is distinct from 'general_admin' then
    raise exception 'Only general_admin can change vehicle attributes'
      using errcode = '42501', hint = format('your role: %s', caller);
  end if;

  return new;
end;
$$;

-- ============================================================================
-- 2. audit log
--    Generic event store. One trigger function on bookings + cars logs
--    every INSERT (full row), UPDATE (only changed fields), and DELETE
--    (full row). super_admin only can read; only the SECURITY DEFINER
--    trigger (running as postgres) can write.
-- ============================================================================

create table if not exists public.audit_log (
  id           uuid primary key default gen_random_uuid(),
  occurred_at  timestamptz not null default now(),
  actor_id     uuid references auth.users(id) on delete set null,
  actor_role   public.app_role,
  table_name   text not null,
  row_id       uuid not null,
  operation    text not null check (operation in ('INSERT','UPDATE','DELETE')),
  changed      jsonb,
  old_values   jsonb
);

create index if not exists audit_log_table_row_idx
  on public.audit_log(table_name, row_id, occurred_at desc);
create index if not exists audit_log_actor_idx
  on public.audit_log(actor_id, occurred_at desc);

grant select on public.audit_log to authenticated;
alter table public.audit_log enable row level security;

drop policy if exists audit_log_select on public.audit_log;
create policy audit_log_select on public.audit_log
  for select to authenticated using (public.is_super_admin());

create or replace function public.write_audit_log()
returns trigger
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  changed_cols jsonb := '{}'::jsonb;
  old_vals     jsonb := '{}'::jsonb;
  k text;
  old_j jsonb;
  new_j jsonb;
begin
  if TG_OP = 'INSERT' then
    insert into public.audit_log(actor_id, actor_role, table_name, row_id, operation, changed)
      values (auth.uid(), public.current_app_role(), TG_TABLE_NAME, new.id, 'INSERT', to_jsonb(new));
    return new;
  end if;
  if TG_OP = 'DELETE' then
    insert into public.audit_log(actor_id, actor_role, table_name, row_id, operation, old_values)
      values (auth.uid(), public.current_app_role(), TG_TABLE_NAME, old.id, 'DELETE', to_jsonb(old));
    return old;
  end if;

  old_j := to_jsonb(old);
  new_j := to_jsonb(new);
  for k in select jsonb_object_keys(new_j) loop
    if k = 'updated_at' then continue; end if;
    if old_j->k is distinct from new_j->k then
      changed_cols := changed_cols || jsonb_build_object(k, new_j->k);
      old_vals     := old_vals     || jsonb_build_object(k, old_j->k);
    end if;
  end loop;
  if changed_cols = '{}'::jsonb then return new; end if;

  insert into public.audit_log(actor_id, actor_role, table_name, row_id, operation, changed, old_values)
    values (auth.uid(), public.current_app_role(), TG_TABLE_NAME, new.id, 'UPDATE', changed_cols, old_vals);
  return new;
end;
$$;
revoke execute on function public.write_audit_log() from anon, authenticated, public;

drop trigger if exists trg_bookings_audit on public.bookings;
create trigger trg_bookings_audit
  after insert or update or delete on public.bookings
  for each row execute function public.write_audit_log();

drop trigger if exists trg_cars_audit on public.cars;
create trigger trg_cars_audit
  after insert or update or delete on public.cars
  for each row execute function public.write_audit_log();
