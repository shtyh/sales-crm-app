-- 2026-05-26 — JPJ (Jabatan Pengangkutan Jalan) registration tracking
-- per booking.
--
-- WHY
-- ---
-- Between "all documents in hand" and "ready to deliver" there's a
-- physical JPJ step: registration paperwork goes to the department,
-- waits for processing, comes back with plates issued. The GA dashboard
-- needs to surface this as its own queue ("Submitted to JPJ", "Ready to
-- deliver") with a manual update path — the timeline isn't driven by
-- any other system event.
--
-- COLUMNS
-- -------
-- jpj_status enum:
--   * not_submitted (default) — paperwork hasn't been sent yet
--   * submitted              — at JPJ, awaiting registration
--   * registered             — JPJ done; plates issued; ready to deliver
-- jpj_submitted_at date — when GA dropped the paperwork at JPJ
-- jpj_expected_completion date — GA's estimate of when it'll come back
--
-- OWNERSHIP
-- ---------
-- General Admin (and super_admin via god mode) own all jpj_* writes.
-- Gate added to guard_booking_field_writes alongside the existing
-- per-role blocks. Sales advisor / finance admin / sales manager cannot
-- touch these fields.

-- 1. Enum -----------------------------------------------------------------
do $$ begin
  create type public.jpj_status as enum (
    'not_submitted', 'submitted', 'registered'
  );
exception when duplicate_object then null; end $$;

grant usage on type public.jpj_status to authenticated;

-- 2. Columns --------------------------------------------------------------
alter table public.bookings
  add column if not exists jpj_status public.jpj_status
    not null default 'not_submitted',
  add column if not exists jpj_submitted_at        date,
  add column if not exists jpj_expected_completion date;

comment on column public.bookings.jpj_status is
  'JPJ registration state. Owned by general_admin.';
comment on column public.bookings.jpj_submitted_at is
  'Date the registration paperwork was handed over to JPJ.';
comment on column public.bookings.jpj_expected_completion is
  'GA-estimated date the registration should be complete.';

-- 3. Extend guard to gate jpj_* writes to general_admin --------------------
create or replace function public.guard_booking_field_writes()
returns trigger
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  caller public.app_role := public.current_app_role();
  client_set_approval boolean;
  client_set_commission_status boolean;
  client_set_commission_amount boolean;
  client_set_base_commission boolean;
  client_set_payout boolean;
  client_set_special_support boolean;
  car_fss public.floor_stock_status;
  owner_role public.app_role;
begin
  if TG_OP = 'INSERT' then
    new.approval_status := 'not_required';

    if coalesce(new.special_support, 0) <> 0
       and caller not in ('sales_manager','super_admin') then
      raise exception
        'Only sales_manager can set special_support on a booking'
        using errcode = '42501', hint = format('your role: %s', caller);
    end if;

    if new.loan_amount is not null
       and caller not in ('finance_admin','super_admin') then
      raise exception
        'Only finance_admin can set loan_amount on a booking'
        using errcode = '42501', hint = format('your role: %s', caller);
    end if;

    -- JPJ fields on INSERT should be defaults only; non-GA can't ship
    -- a non-default state in. Treat absence as the safe default.
    if (new.jpj_status <> 'not_submitted'
        or new.jpj_submitted_at is not null
        or new.jpj_expected_completion is not null)
       and caller not in ('general_admin','super_admin') then
      raise exception
        'Only general_admin can set JPJ tracking fields on a booking'
        using errcode = '42501', hint = format('your role: %s', caller);
    end if;

    new.base_commission := public.lookup_base_commission(
      new.vehicle_model, nullif(new.vehicle_variant, '')
    );
    if new.base_commission is not null then
      new.commission_amount :=
        new.base_commission
          - coalesce(new.discount_amount, 0)
          + coalesce(new.special_support, 0);
    else
      new.commission_amount := null;
    end if;
    return new;
  end if;

  client_set_approval          := new.approval_status   is distinct from old.approval_status;
  client_set_commission_status := new.commission_status is distinct from old.commission_status;
  client_set_commission_amount := new.commission_amount is distinct from old.commission_amount;
  client_set_base_commission   := new.base_commission   is distinct from old.base_commission;
  client_set_payout            := new.commission_payout_id is distinct from old.commission_payout_id;
  client_set_special_support   := new.special_support   is distinct from old.special_support;

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
      raise exception
        'Car is still %; finance must mark it paid_off before delivery',
        car_fss
        using errcode = '42501';
    end if;
  end if;

  return new;
end;
$$;
revoke execute on function public.guard_booking_field_writes() from anon, authenticated, public;
