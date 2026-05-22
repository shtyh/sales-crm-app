-- ============================================================================
-- Accountant module
--
-- New columns on bookings:
--   deposit_confirmed_at  timestamptz  — auto-stamped when deposit_status
--                                        flips to 'received'; cleared on
--                                        flip back to 'unpaid'
--   receipt_number        text unique  — accountant logs after verification
--   invoice_number        text unique  — accountant assigns
--   commission_status     enum         — see below
--   commission_amount     numeric      — actual payout, manual entry
--
-- commission_status state machine:
--   not_eligible  — default
--   pending       — system flips when status=delivered AND payment=paid
--   approved      — accountant signs off
--   paid          — accountant marks payout done
--
-- Semantic changes:
--   1. Red line B added: delivery now also requires payment_status='paid'.
--   2. car_status auto-sync is now DEPOSIT-DRIVEN — only reserves when at
--      least one linked booking has deposit_status='received'.
-- ============================================================================

do $$ begin
  create type public.commission_status as enum (
    'not_eligible', 'pending', 'approved', 'paid'
  );
exception when duplicate_object then null; end $$;
grant usage on type public.commission_status to authenticated;

alter table public.bookings
  add column if not exists deposit_confirmed_at timestamptz;

alter table public.bookings
  add column if not exists receipt_number text;

alter table public.bookings
  add column if not exists invoice_number text;

alter table public.bookings
  add column if not exists commission_status public.commission_status
    not null default 'not_eligible';

alter table public.bookings
  add column if not exists commission_amount numeric(10,2)
    check (commission_amount is null or commission_amount >= 0);

do $$ begin
  alter table public.bookings
    add constraint bookings_receipt_number_uniq unique (receipt_number);
exception when duplicate_table then null; end $$;

do $$ begin
  alter table public.bookings
    add constraint bookings_invoice_number_uniq unique (invoice_number);
exception when duplicate_table then null; end $$;

create index if not exists bookings_deposit_status_idx
  on public.bookings(deposit_status)
  where deposit_status <> 'received';
create index if not exists bookings_payment_status_idx
  on public.bookings(payment_status)
  where payment_status <> 'paid';
create index if not exists bookings_commission_pending_idx
  on public.bookings(commission_status)
  where commission_status = 'pending';

-- ===== Updated guard trigger ===============================================
create or replace function public.guard_booking_field_writes()
returns trigger
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  caller public.app_role := public.current_app_role();
  client_set_approval boolean;
  client_set_commission boolean;
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

  client_set_approval   := new.approval_status   is distinct from old.approval_status;
  client_set_commission := new.commission_status is distinct from old.commission_status;

  if caller <> 'super_admin' then
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

    if (new.deposit_status     is distinct from old.deposit_status
        or new.payment_status     is distinct from old.payment_status
        or new.receipt_number     is distinct from old.receipt_number
        or new.invoice_number     is distinct from old.invoice_number
        or new.commission_amount  is distinct from old.commission_amount
        or client_set_commission)
       and caller is distinct from 'accountant' then
      raise exception 'Only accountant can change deposit / payment / receipt / invoice / commission fields'
        using errcode = '42501', hint = format('your role: %s', caller);
    end if;

    if new.status = 'cancelled' and old.status is distinct from 'cancelled'
       and caller not in ('sales_manager','accountant') then
      raise exception 'Only sales_manager or accountant can cancel a booking'
        using errcode = '42501', hint = format('your role: %s', caller);
    end if;
  end if;

  if new.deposit_status is distinct from old.deposit_status then
    if new.deposit_status = 'received' then
      new.deposit_confirmed_at := now();
    elsif new.deposit_status = 'unpaid' then
      new.deposit_confirmed_at := null;
    end if;
  end if;

  if not client_set_commission then
    if new.status = 'delivered' and new.payment_status = 'paid' then
      if old.commission_status = 'not_eligible' then
        new.commission_status := 'pending';
      end if;
    else
      if old.commission_status = 'pending' then
        new.commission_status := 'not_eligible';
      end if;
    end if;
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
    if new.payment_status is distinct from 'paid' then
      raise exception
        'Cannot deliver until accountant marks payment_status = paid'
        using errcode = '42501';
    end if;
  end if;

  return new;
end;
$$;

-- ===== car_status auto-sync — now deposit-driven ==========================
create or replace function public.recompute_car_status(target_car uuid)
returns void
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  has_delivered boolean;
  has_reserved  boolean;
  new_status    public.car_status;
begin
  if target_car is null then return; end if;
  select
    bool_or(status = 'delivered'),
    bool_or(status in ('pending','confirmed') and deposit_status = 'received')
  into has_delivered, has_reserved
  from public.bookings
  where car_id = target_car;

  if has_delivered then
    new_status := 'delivered';
  elsif has_reserved then
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
      or old.status is distinct from new.status
      or old.deposit_status is distinct from new.deposit_status;
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
