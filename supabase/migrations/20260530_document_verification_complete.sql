-- 2026-05-30 · Document Verification System — Phase F (completion engine).
--
-- The brain of the doc-verification flow. document_verifications is the source
-- of truth; this migration rolls its rows up onto the booking and unlocks the
-- commission when everything checks out.
--
--   recompute_booking_documents(booking_id)  — SECURITY DEFINER. Reads the
--     latest All-In-One / LOU rows + sums the down-payment receipts, derives
--     all_in_one_status / down_payment_status / lou_status /
--     total_received_down_payment / payment_type, writes them onto the booking,
--     and (idempotently, once on the false→true transition) sets
--     documents_complete + unlocks the commission + fans out notifications.
--
--   trg_document_verifications_recompute  — AFTER INSERT/UPDATE on
--     document_verifications → recompute. So the edge functions and the
--     Finance-Admin review mutations just write DV rows; the booking updates
--     itself. Nobody UPDATEs the booking doc-status columns directly.
--
--   check_booking_complete(booking_id)  — thin authenticated wrapper around
--     recompute, for a manual "re-check" button.
--
-- Guard interaction: recompute writes bookings.commission_status, which the
-- guard normally lets only sales_manager touch AND auto-demotes when a booking
-- isn't delivered+paid. So we re-create guard_booking_field_writes with a
-- transaction-local app.system_op='on' early-return (mirroring
-- guard_car_field_writes) and flip that flag around recompute's UPDATE. The
-- guard body is otherwise byte-for-byte the 2026-05-28 version.

-- ============================================================================
-- 1. guard_booking_field_writes — add the system_op bypass at the very top.
-- ============================================================================
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
  -- System path (recompute_booking_documents): write the row as-is, skipping
  -- every role gate + the commission auto-(de)flip. Transaction-local flag.
  if coalesce(current_setting('app.system_op', true), 'off') = 'on' then
    return new;
  end if;

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

-- ============================================================================
-- 2. Notification helpers (internal — definer chain only).
-- ============================================================================
create or replace function public._dv_notify(
  p_user uuid, p_booking uuid, p_type text, p_msg text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if p_user is null then return; end if;
  insert into public.notifications(user_id, booking_id, type, message)
  values (p_user, p_booking, p_type, p_msg);
end;
$$;

create or replace function public._dv_notify_finance(
  p_booking uuid, p_type text, p_msg text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r record;
begin
  for r in select id from public.profiles where role = 'finance_admin' loop
    insert into public.notifications(user_id, booking_id, type, message)
    values (r.id, p_booking, p_type, p_msg);
  end loop;
end;
$$;

revoke execute on function public._dv_notify(uuid, uuid, text, text)
  from anon, authenticated, public;
revoke execute on function public._dv_notify_finance(uuid, text, text)
  from anon, authenticated, public;

-- ============================================================================
-- 3. recompute_booking_documents — derive + roll up + unlock.
-- ============================================================================
create or replace function public.recompute_booking_documents(p_booking_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  bk   record;
  aio  record;
  lou  record;
  v_received numeric := 0;
  v_total numeric;
  v_loan numeric;
  v_expected_down numeric;
  v_aio_status text;
  v_dp_status text;
  v_lou_status text;
  v_payment_type text;
  v_complete boolean;
  v_owner uuid;
begin
  select * into bk from public.bookings where id = p_booking_id;
  if not found then return; end if;
  v_owner := bk.owner_id;

  -- Latest document of each single-instance kind.
  select * into aio
    from public.document_verifications
   where booking_id = p_booking_id and document_type = 'all_in_one'
   order by created_at desc
   limit 1;

  select * into lou
    from public.document_verifications
   where booking_id = p_booking_id and document_type = 'lou'
   order by created_at desc
   limit 1;

  -- Down payment can be many receipts — sum them.
  select coalesce(sum(extracted_payment_amount), 0) into v_received
    from public.document_verifications
   where booking_id = p_booking_id and document_type = 'down_payment';

  -- payment_type: keep what's on the booking; else infer from the All-In-One.
  v_payment_type := bk.payment_type;
  if v_payment_type is null and aio.id is not null
     and aio.extracted_payment_type in ('cash','loan') then
    v_payment_type := aio.extracted_payment_type;
  end if;

  -- All-In-One status mirrors the latest DV's verification_status.
  if aio.id is null then
    v_aio_status := 'pending';
  elsif aio.verification_status = 'approved' then
    v_aio_status := 'approved';
  elsif aio.verification_status = 'rejected' then
    v_aio_status := 'rejected';
  else
    v_aio_status := 'pending';
  end if;

  -- Down payment: expected = total OTR − loan; complete within RM1.
  v_total := coalesce(aio.extracted_total_otr, bk.otr_price, 0);
  v_loan  := coalesce(bk.loan_amount, aio.extracted_loan_amount, 0);
  if v_payment_type = 'cash' then
    v_loan := 0;
  end if;
  v_expected_down := greatest(v_total - v_loan, 0);
  if v_received <= 0 then
    v_dp_status := 'pending';
  elsif v_expected_down <= 0 then
    v_dp_status := 'complete';
  elsif v_received >= v_expected_down - 1 then
    v_dp_status := 'complete';
  else
    v_dp_status := 'partial';
  end if;

  -- LOU: only loan deals need it; verified once finance confirms.
  if v_payment_type is not null and v_payment_type <> 'loan' then
    v_lou_status := 'not_required';
  elsif v_payment_type = 'loan' then
    if lou.id is null then
      v_lou_status := 'pending';
    elsif lou.finance_admin_confirmed then
      v_lou_status := 'verified';
    else
      v_lou_status := 'pending';
    end if;
  else
    -- payment_type still unknown — don't demand a LOU yet.
    v_lou_status := 'not_required';
  end if;

  -- documents_complete — never while payment_type is still unknown.
  v_complete := (v_payment_type is not null)
                and (v_aio_status = 'approved')
                and (v_dp_status = 'complete');
  if v_payment_type = 'loan' then
    v_complete := v_complete and (v_lou_status = 'verified');
  end if;

  -- Write the booking with the guard bypassed (transaction-local).
  perform set_config('app.system_op', 'on', true);
  update public.bookings
     set all_in_one_status           = v_aio_status,
         down_payment_status         = v_dp_status,
         lou_status                  = v_lou_status,
         total_received_down_payment = v_received,
         payment_type                = v_payment_type,
         documents_complete          = v_complete,
         commission_status = case
           when v_complete
                and not bk.documents_complete
                and bk.commission_status = 'not_eligible'
           then case
             when public.role_of(bk.owner_id) = 'sales_manager'
               then 'approved'::public.commission_status
             else 'pending'::public.commission_status
           end
           else bk.commission_status
         end
   where id = p_booking_id;
  perform set_config('app.system_op', 'off', true);

  -- ── Notifications, only on real transitions ──
  if v_aio_status is distinct from bk.all_in_one_status then
    if v_aio_status = 'approved' then
      perform public._dv_notify(v_owner, p_booking_id, 'all_in_one_approved',
        'Your All-In-One form was approved.');
    elsif v_aio_status = 'rejected' then
      perform public._dv_notify(v_owner, p_booking_id, 'all_in_one_rejected',
        coalesce('All-In-One rejected: ' || aio.rejection_reason,
                 'Your All-In-One form was rejected.'));
      perform public._dv_notify_finance(p_booking_id, 'no_sm_signature',
        'An All-In-One form was rejected — check the SM signature.');
    elsif v_aio_status = 'pending' then
      perform public._dv_notify_finance(p_booking_id, 'all_in_one_pending',
        'An All-In-One form is awaiting your review.');
    end if;
  end if;

  if v_dp_status is distinct from bk.down_payment_status
     and v_dp_status = 'complete' then
    perform public._dv_notify(v_owner, p_booking_id, 'down_payment_complete',
      'Down payment is complete for your booking.');
    perform public._dv_notify_finance(p_booking_id, 'down_payment_complete',
      'A booking''s down payment is now complete.');
  end if;

  if v_lou_status is distinct from bk.lou_status then
    if v_lou_status = 'pending' then
      perform public._dv_notify_finance(p_booking_id, 'lou_pending',
        'A Letter of Undertaking is awaiting your review.');
    elsif v_lou_status = 'verified' then
      perform public._dv_notify(v_owner, p_booking_id, 'lou_verified',
        'The Letter of Undertaking was verified.');
    end if;
  end if;

  if v_complete and not bk.documents_complete then
    perform public._dv_notify(v_owner, p_booking_id, 'booking_complete',
      'All documents verified — your booking is complete.');
    if bk.commission_status = 'not_eligible' then
      perform public._dv_notify(v_owner, p_booking_id, 'commission_unlocked',
        'Your commission is now unlocked for review.');
    end if;
  end if;
end;
$$;

revoke execute on function public.recompute_booking_documents(uuid)
  from anon, authenticated, public;
grant execute on function public.recompute_booking_documents(uuid) to service_role;

-- ============================================================================
-- 4. Auto-recompute trigger on document_verifications.
-- ============================================================================
create or replace function public.trg_dv_recompute()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.recompute_booking_documents(coalesce(new.booking_id, old.booking_id));
  return null;
end;
$$;

-- Trigger functions get a default PUBLIC execute grant; revoke it so a
-- SECURITY DEFINER trigger fn can't be invoked directly via PostgREST.
revoke execute on function public.trg_dv_recompute() from anon, authenticated, public;

drop trigger if exists trg_document_verifications_recompute on public.document_verifications;
create trigger trg_document_verifications_recompute
  after insert or update on public.document_verifications
  for each row execute function public.trg_dv_recompute();

-- ============================================================================
-- 5. check_booking_complete — authenticated "re-check" wrapper.
-- ============================================================================
create or replace function public.check_booking_complete(p_booking_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.recompute_booking_documents(p_booking_id);
end;
$$;

revoke execute on function public.check_booking_complete(uuid) from anon, public;
grant execute on function public.check_booking_complete(uuid) to authenticated;

-- ============================================================================
-- 6. Lint cleanup — pin the search_path on the Phase A updated_at trigger fn.
-- ============================================================================
alter function public.dv_set_updated_at() set search_path = public, pg_temp;
