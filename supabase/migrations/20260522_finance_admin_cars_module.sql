-- ============================================================================
-- Finance Admin module
--
-- New table: public.cars (showroom inventory)
-- New column: public.bookings.car_id → cars(id) on delete set null
-- New red line: a booking cannot move to 'delivered' unless the linked car's
--   floor_stock_status = 'paid_off'.
-- Tightening: deposit_status / payment_status now accountant-only.
-- Backfill: each existing booking gets a placeholder car (chassis_no =
--   'BACKFILL-<booking_code>', arrived_at = booking_date) so the FK and the
--   delivery red line don't break on existing rows.
-- ============================================================================

do $$ begin
  create type public.car_status as enum (
    'in_stock', 'reserved', 'delivered', 'returned'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.floor_stock_status as enum (
    'locked', 'pending_settlement', 'overdue', 'paid_off'
  );
exception when duplicate_object then null; end $$;

grant usage on type public.car_status         to authenticated;
grant usage on type public.floor_stock_status to authenticated;

create table if not exists public.cars (
  id                  uuid primary key default gen_random_uuid(),
  chassis_no          text unique not null,
  model               text not null,
  variant             text,
  color               text,
  arrived_at          date not null default current_date,
  status              public.car_status not null default 'in_stock',
  floor_stock_bank    text,
  financed_amount     numeric(10,2) check (financed_amount is null or financed_amount >= 0),
  floor_stock_status  public.floor_stock_status not null default 'locked',
  floor_stock_due     date,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists cars_status_idx on public.cars(status);
create index if not exists cars_floor_stock_due_idx
  on public.cars(floor_stock_due)
  where floor_stock_status <> 'paid_off';

drop trigger if exists trg_cars_updated_at on public.cars;
create trigger trg_cars_updated_at
  before update on public.cars
  for each row execute function public.set_updated_at();

grant select, insert, update, delete on public.cars to authenticated;
alter table public.cars enable row level security;

drop policy if exists cars_select on public.cars;
create policy cars_select on public.cars
  for select to authenticated using (true);

drop policy if exists cars_insert on public.cars;
create policy cars_insert on public.cars
  for insert to authenticated
  with check (
    public.is_super_admin()
    or public.current_app_role() = 'general_admin'
  );

drop policy if exists cars_update on public.cars;
create policy cars_update on public.cars
  for update to authenticated
  using (
    public.is_super_admin()
    or public.current_app_role() in ('general_admin','finance_admin')
  )
  with check (
    public.is_super_admin()
    or public.current_app_role() in ('general_admin','finance_admin')
  );

drop policy if exists cars_delete on public.cars;
create policy cars_delete on public.cars
  for delete to authenticated
  using (public.is_super_admin());

create or replace function public.guard_car_field_writes()
returns trigger
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  caller public.app_role := public.current_app_role();
begin
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
revoke execute on function public.guard_car_field_writes() from anon, authenticated, public;

drop trigger if exists trg_cars_guard on public.cars;
create trigger trg_cars_guard
  before update on public.cars
  for each row execute function public.guard_car_field_writes();

alter table public.bookings
  add column if not exists car_id uuid references public.cars(id) on delete set null;

create index if not exists bookings_car_idx on public.bookings(car_id);

-- Backfill placeholder car per existing booking
do $$
declare
  b record;
  new_car_id uuid;
begin
  for b in select * from public.bookings where car_id is null loop
    insert into public.cars (
      chassis_no, model, variant, color, arrived_at,
      status, floor_stock_status
    )
    values (
      'BACKFILL-' || b.code,
      b.vehicle_model,
      nullif(b.vehicle_variant, ''),
      nullif(b.vehicle_color, ''),
      b.booking_date,
      case b.status
        when 'delivered' then 'delivered'::public.car_status
        when 'cancelled' then 'returned'::public.car_status
        else 'reserved'::public.car_status
      end,
      case b.status
        when 'delivered' then 'paid_off'::public.floor_stock_status
        else 'locked'::public.floor_stock_status
      end
    )
    returning id into new_car_id;
    update public.bookings set car_id = new_car_id where id = b.id;
  end loop;
end$$;

-- Rewrite bookings guard:
--   * deposit/payment now accountant-only (was finance + accountant)
--   * new red line A: cannot deliver while linked car ≠ paid_off
create or replace function public.guard_booking_field_writes()
returns trigger
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  caller public.app_role := public.current_app_role();
  client_set_approval boolean;
  car_fss public.floor_stock_status;
begin
  if TG_OP = 'INSERT' then
    if new.discount_amount is null or new.discount_amount = 0 then
      new.approval_status := 'not_required';
    elsif caller in ('super_admin','sales_manager','general_admin','finance_admin') then
      new.approval_status := 'approved';
    else
      new.approval_status := 'pending';
    end if;
    return new;
  end if;

  if caller = 'super_admin' then return new; end if;

  client_set_approval := new.approval_status is distinct from old.approval_status;

  if client_set_approval and caller is distinct from 'sales_manager' then
    raise exception 'Only sales_manager can change discount approval status'
      using errcode = '42501', hint = format('your role: %s', caller);
  end if;

  if not client_set_approval
     and new.discount_amount is distinct from old.discount_amount then
    if new.discount_amount = 0 then
      new.approval_status := 'not_required';
    elsif caller in ('sales_manager','general_admin','finance_admin') then
      new.approval_status := 'approved';
    elsif caller = 'sales_advisor' then
      new.approval_status := 'pending';
    end if;
  end if;

  if new.owner_id is distinct from old.owner_id
     and caller is distinct from 'sales_manager' then
    raise exception 'Only sales_manager can reassign a booking to another owner'
      using errcode = '42501', hint = format('your role: %s', caller);
  end if;

  if (new.loan_bank is distinct from old.loan_bank
      or new.insurance_company is distinct from old.insurance_company
      or new.loan_status is distinct from old.loan_status
      or new.loan_notes is distinct from old.loan_notes)
     and caller is distinct from 'finance_admin' then
    raise exception 'Only finance_admin can change loan or insurance fields'
      using errcode = '42501', hint = format('your role: %s', caller);
  end if;

  if (new.deposit_status is distinct from old.deposit_status
      or new.payment_status is distinct from old.payment_status)
     and caller is distinct from 'accountant' then
    raise exception 'Only accountant can change deposit/payment status'
      using errcode = '42501', hint = format('your role: %s', caller);
  end if;

  if new.status = 'cancelled' and old.status is distinct from 'cancelled'
     and caller not in ('sales_manager','accountant') then
    raise exception 'Only sales_manager or accountant can cancel a booking'
      using errcode = '42501', hint = format('your role: %s', caller);
  end if;

  if new.status = 'delivered' and old.status is distinct from 'delivered' then
    if new.car_id is null then
      raise exception 'Cannot deliver a booking without a linked car'
        using errcode = '42501';
    end if;
    select floor_stock_status into car_fss
      from public.cars where id = new.car_id;
    if car_fss is distinct from 'paid_off' then
      raise exception
        'Car is still %; finance must mark it paid_off before delivery',
        car_fss
        using errcode = '42501';
    end if;
  end if;

  return new;
end;
$$;
