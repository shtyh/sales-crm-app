-- 2026-05-28 · Discount approval system
--
-- Adds HQ discount + dealer support to the commission schedule (per
-- model/variant) and per-booking snapshot. Re-introduces the auto
-- approval flow on bookings.approval_status (was dropped 2026-05-23).
--
-- Rules baked into guard_booking_field_writes:
--   SA discount <= base_commission → approval_status = 'not_required'
--   SA discount >  base_commission → approval_status = 'pending'
-- Manager's explicit approved/rejected decision sticks even if the
-- discount changes after the fact.
--
-- HQ + dealer values are snapshotted from commission_schedules at
-- INSERT time and are not editable per-booking — only super_admin can
-- adjust them via the schedule.

alter table public.commission_schedules
  add column if not exists hq_discount numeric(10,2) not null default 0
    check (hq_discount >= 0),
  add column if not exists dealer_support numeric(10,2) not null default 0
    check (dealer_support >= 0);

alter table public.bookings
  add column if not exists hq_discount numeric(10,2) not null default 0
    check (hq_discount >= 0),
  add column if not exists dealer_support numeric(10,2) not null default 0
    check (dealer_support >= 0),
  add column if not exists approval_notes text;

create or replace function public.lookup_schedule_for(
  in_model text, in_variant text
)
returns table (
  base_commission numeric,
  hq_discount     numeric,
  dealer_support  numeric
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select base_commission, hq_discount, dealer_support
  from public.commission_schedules
  where model = in_model and variant is not distinct from in_variant
  limit 1
$$;

-- guard_booking_field_writes — new INSERT logic snapshots HQ + dealer
-- and auto-flips approval_status; UPDATE re-evaluates approval_status
-- when the discount changes (unless the manager has already decided).
create or replace function public.guard_booking_field_writes()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  caller public.app_role := public.current_app_role();
  client_set_approval boolean;
  client_set_commission_status boolean;
  client_set_commission_amount boolean;
  client_set_base_commission boolean;
  client_set_payout boolean;
  client_set_special_support boolean;
  client_set_hq_discount boolean;
  client_set_dealer_support boolean;
  car_fss public.floor_stock_status;
  owner_role public.app_role;
  schedule record;
begin
  if TG_OP = 'INSERT' then
    if coalesce(new.special_support, 0) <> 0
       and caller not in ('sales_manager','super_admin') then
      raise exception 'Only sales_manager can set special_support on a booking'
        using errcode = '42501', hint = format('your role: %s', caller);
    end if;

    if new.loan_amount is not null
       and caller not in ('finance_admin','super_admin') then
      raise exception 'Only finance_admin can set loan_amount on a booking'
        using errcode = '42501', hint = format('your role: %s', caller);
    end if;

    if new.insurance_amount is not null
       and caller not in ('finance_admin','super_admin') then
      raise exception 'Only finance_admin can set insurance_amount on a booking'
        using errcode = '42501', hint = format('your role: %s', caller);
    end if;

    if (new.jpj_status <> 'not_submitted'
        or new.jpj_submitted_at is not null
        or new.jpj_expected_completion is not null)
       and caller not in ('general_admin','super_admin') then
      raise exception 'Only general_admin can set JPJ tracking fields on a booking'
        using errcode = '42501', hint = format('your role: %s', caller);
    end if;

    select * into schedule from public.lookup_schedule_for(
      new.vehicle_model, nullif(new.vehicle_variant, '')
    );
    new.base_commission := schedule.base_commission;
    new.hq_discount     := coalesce(schedule.hq_discount, 0);
    new.dealer_support  := coalesce(schedule.dealer_support, 0);

    if new.base_commission is not null then
      new.commission_amount :=
        new.base_commission
          - coalesce(new.discount_amount, 0)
          + coalesce(new.special_support, 0);
    else
      new.commission_amount := null;
    end if;

    if coalesce(new.discount_amount, 0) > coalesce(new.base_commission, 0) then
      new.approval_status := 'pending';
    else
      new.approval_status := 'not_required';
    end if;
    return new;
  end if;

  client_set_approval          := new.approval_status   is distinct from old.approval_status;
  client_set_commission_status := new.commission_status is distinct from old.commission_status;
  client_set_commission_amount := new.commission_amount is distinct from old.commission_amount;
  client_set_base_commission   := new.base_commission   is distinct from old.base_commission;
  client_set_payout            := new.commission_payout_id is distinct from old.commission_payout_id;
  client_set_special_support   := new.special_support   is distinct from old.special_support;
  client_set_hq_discount       := new.hq_discount       is distinct from old.hq_discount;
  client_set_dealer_support    := new.dealer_support    is distinct from old.dealer_support;

  if caller <> 'super_admin' then
    if client_set_approval and caller is distinct from 'sales_manager' then
      raise exception 'Only sales_manager can change discount approval status'
        using errcode = '42501', hint = format('your role: %s', caller);
    end if;

    if (client_set_commission_status or client_set_payout)
       and caller is distinct from 'sales_manager' then
      raise exception 'Only sales_manager can change commission status or payout'
        using errcode = '42501', hint = format('your role: %s', caller);
    end if;

    if client_set_base_commission then
      raise exception 'base_commission is system-managed; only super_admin can override'
        using errcode = '42501';
    end if;

    if (client_set_hq_discount or client_set_dealer_support) then
      raise exception 'HQ discount and dealer support are system-managed; only super_admin can override'
        using errcode = '42501';
    end if;

    if client_set_commission_amount and caller is distinct from 'sales_manager' then
      raise exception 'Only sales_manager can adjust commission_amount'
        using errcode = '42501';
    end if;

    if client_set_special_support and caller is distinct from 'sales_manager' then
      raise exception 'Only sales_manager can set special_support'
        using errcode = '42501', hint = format('your role: %s', caller);
    end if;

    if new.owner_id is distinct from old.owner_id
       and caller is distinct from 'sales_manager' then
      raise exception 'Only sales_manager can reassign a booking to another owner'
        using errcode = '42501', hint = format('your role: %s', caller);
    end if;

    if new.car_id is distinct from old.car_id
       and caller not in ('general_admin','sales_manager') then
      raise exception 'Only general_admin or sales_manager can assign the linked car'
        using errcode = '42501', hint = format('your role: %s', caller);
    end if;

    if (new.loan_bank is distinct from old.loan_bank
        or new.insurance_company is distinct from old.insurance_company
        or new.insurance_amount is distinct from old.insurance_amount
        or new.loan_status is distinct from old.loan_status
        or new.loan_notes is distinct from old.loan_notes
        or new.loan_amount is distinct from old.loan_amount)
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

    if (new.jpj_status is distinct from old.jpj_status
        or new.jpj_submitted_at is distinct from old.jpj_submitted_at
        or new.jpj_expected_completion is distinct from old.jpj_expected_completion)
       and caller is distinct from 'general_admin' then
      raise exception 'Only general_admin can change JPJ tracking fields'
        using errcode = '42501', hint = format('your role: %s', caller);
    end if;

    if new.status = 'cancelled' and old.status is distinct from 'cancelled'
       and caller is distinct from 'sales_manager' then
      raise exception 'Only sales_manager can cancel a booking'
        using errcode = '42501', hint = format('your role: %s', caller);
    end if;
  end if;

  if not client_set_commission_amount
     and (new.discount_amount is distinct from old.discount_amount
          or client_set_special_support
          or client_set_base_commission)
     and new.base_commission is not null then
    new.commission_amount :=
      new.base_commission
        - coalesce(new.discount_amount, 0)
        + coalesce(new.special_support, 0);
  end if;

  -- Auto-flip approval_status when the SA bumps the discount, unless
  -- the manager has already locked in approved/rejected.
  if not client_set_approval
     and new.discount_amount is distinct from old.discount_amount
     and old.approval_status not in ('approved', 'rejected') then
    if coalesce(new.discount_amount, 0) > coalesce(new.base_commission, 0) then
      new.approval_status := 'pending';
    else
      new.approval_status := 'not_required';
    end if;
  end if;

  if not client_set_commission_status then
    if new.status = 'delivered' and new.payment_status = 'paid' then
      if old.commission_status = 'not_eligible' then
        owner_role := public.role_of(new.owner_id);
        if owner_role = 'sales_manager' then
          new.commission_status := 'approved';
        else
          new.commission_status := 'pending';
        end if;
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
      raise exception 'Car is still %; finance must mark it paid_off before delivery', car_fss
        using errcode = '42501';
    end if;
  end if;

  return new;
end;
$$;
