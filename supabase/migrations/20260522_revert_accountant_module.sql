-- ============================================================================
-- Revert Phase 5 (Accountant module).
--
-- Drops every column / type / index / unique constraint added in
-- 20260522_accountant_module.sql. The `accountant` value remains in the
-- app_role enum because dropping an enum value would require recreating
-- the type; the frontend filters it out of the assignable-roles UI so
-- nobody can be set to it.
--
-- Ownership / red lines after revert:
--   deposit_status / payment_status → finance_admin + super_admin
--     (was accountant + super_admin in Phase 5)
--   cancel → sales_manager + super_admin (was sales_manager + accountant)
--   Red line A (car must be paid_off to deliver) KEEPS
--   Red line B (payment must be 'paid' to deliver) DROPPED
--
-- car_status auto-sync reverts to BOOKING-DRIVEN: any pending/confirmed
-- booking reserves the linked car (deposit_status no longer matters).
-- ============================================================================

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
     and caller is distinct from 'finance_admin' then
    raise exception 'Only finance_admin can change deposit/payment status'
      using errcode = '42501', hint = format('your role: %s', caller);
  end if;

  if new.status = 'cancelled' and old.status is distinct from 'cancelled'
     and caller is distinct from 'sales_manager' then
    raise exception 'Only sales_manager can cancel a booking'
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
  must_recompute boolean := false;
begin
  if TG_OP <> 'UPDATE' then
    must_recompute := true;
  else
    must_recompute :=
      old.car_id is distinct from new.car_id
      or old.status is distinct from new.status;
  end if;
  if not must_recompute then return new; end if;

  if old_car is not null then perform public.recompute_car_status(old_car); end if;
  if new_car is not null and new_car is distinct from old_car then
    perform public.recompute_car_status(new_car);
  end if;
  if TG_OP = 'UPDATE'
     and old.car_id is not distinct from new.car_id
     and new.car_id is not null then
    perform public.recompute_car_status(new.car_id);
  end if;
  return coalesce(new, old);
end;
$$;

drop index if exists public.bookings_deposit_status_idx;
drop index if exists public.bookings_payment_status_idx;
drop index if exists public.bookings_commission_pending_idx;

alter table public.bookings
  drop constraint if exists bookings_receipt_number_uniq,
  drop constraint if exists bookings_invoice_number_uniq;

alter table public.bookings
  drop column if exists commission_amount,
  drop column if exists commission_status,
  drop column if exists invoice_number,
  drop column if exists receipt_number,
  drop column if exists deposit_confirmed_at;

drop type if exists public.commission_status;

select public.recompute_car_status(id) from public.cars;
