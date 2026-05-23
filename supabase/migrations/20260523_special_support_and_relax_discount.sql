-- 2026-05-23 — Special support column + relaxed discount approval flow.
--
-- WHY
-- ---
-- The user wants two shifts in policy:
--   1. Discount no longer requires Sales Manager approval. The SA can set it
--      freely. We stop auto-flipping `approval_status` to 'pending'; the
--      column is left in place for historical data but is effectively dead.
--   2. New column `special_support` (RM) — only the Sales Manager can write
--      it. It bumps SA earnings UP, instead of discount which pulls them down.
--
-- New commission math:
--   commission_amount = greatest(0, base_commission - discount + special_support)
--
-- BACKWARD COMPAT
-- ---------------
-- Existing rows with approval_status='pending' or 'rejected' are NOT
-- back-filled — those are real historical records. The frontend just
-- stops surfacing the approval banners.

-- 1. New column. Default 0 so existing rows pick a value automatically.
alter table public.bookings
  add column if not exists special_support numeric(12,2) not null default 0;

comment on column public.bookings.special_support is
  'Manager-granted RM bonus added on top of SA commission. Only sales_manager '
  'or super_admin can write. Pumps commission_amount up by this much.';

-- 2. Rebuild the guard trigger.
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
  -- ─── INSERT ────────────────────────────────────────────────────────────
  if TG_OP = 'INSERT' then
    -- Discount approval is gone — every new booking defaults to not_required.
    new.approval_status := 'not_required';

    -- Special support cannot be set on INSERT by anyone except SM / super.
    -- Default 0 covers the SA happy path.
    if coalesce(new.special_support, 0) <> 0
       and caller not in ('sales_manager','super_admin') then
      raise exception
        'Only sales_manager can set special_support on a booking'
        using errcode = '42501', hint = format('your role: %s', caller);
    end if;

    new.base_commission := public.lookup_base_commission(
      new.vehicle_model, nullif(new.vehicle_variant, '')
    );
    if new.base_commission is not null then
      new.commission_amount := greatest(
        0,
        new.base_commission
          - coalesce(new.discount_amount, 0)
          + coalesce(new.special_support, 0)
      );
    else
      new.commission_amount := null;
    end if;
    return new;
  end if;

  -- ─── UPDATE path ───────────────────────────────────────────────────────
  client_set_approval          := new.approval_status   is distinct from old.approval_status;
  client_set_commission_status := new.commission_status is distinct from old.commission_status;
  client_set_commission_amount := new.commission_amount is distinct from old.commission_amount;
  client_set_base_commission   := new.base_commission   is distinct from old.base_commission;
  client_set_payout            := new.commission_payout_id is distinct from old.commission_payout_id;
  client_set_special_support   := new.special_support   is distinct from old.special_support;

  if caller <> 'super_admin' then
    -- approval_status writes still SM-only (kept for backward compat with the
    -- handful of pre-existing pending rows the SM might want to clear).
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

    -- NEW: special_support is sales_manager only.
    if client_set_special_support and caller is distinct from 'sales_manager' then
      raise exception 'Only sales_manager can set special_support'
        using errcode = '42501', hint = format('your role: %s', caller);
    end if;

    -- Discount approval no longer auto-flips. Discount is a free SA field.

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
  end if;

  -- Auto recompute commission_amount when discount OR special_support OR base
  -- changes. SM can override by setting commission_amount explicitly in the
  -- same patch (client_set_commission_amount short-circuits this).
  if not client_set_commission_amount
     and (new.discount_amount is distinct from old.discount_amount
          or client_set_special_support
          or client_set_base_commission)
     and new.base_commission is not null then
    new.commission_amount := greatest(
      0,
      new.base_commission
        - coalesce(new.discount_amount, 0)
        + coalesce(new.special_support, 0)
    );
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

  -- Red line A: deliver only if linked car is paid_off
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
