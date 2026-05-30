-- 2026-05-30 · Wire the manual bookings.down_payment into the doc-verification
-- down-payment check + keep it fresh on booking edits.
--
-- recompute_booking_documents now uses bookings.down_payment as the EXPECTED
-- down payment when it's set (> 0), instead of always deriving total_otr − loan
-- (which is meaningless when otr_price is 0). The received total (sum of
-- down-payment receipts) is still compared against it within RM1.
--
-- Plus trg_booking_dv_recompute (AFTER UPDATE on bookings) re-runs recompute
-- when down_payment / loan_amount / otr_price change, so setting the agreed
-- down payment after receipts were uploaded refreshes the status (and can flip
-- documents_complete / unlock commission). Gated to bookings already in the
-- doc-verification flow. Does NOT watch payment_type / the doc-status columns —
-- recompute writes those, so watching them would recurse.

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

  select coalesce(sum(extracted_payment_amount), 0) into v_received
    from public.document_verifications
   where booking_id = p_booking_id and document_type = 'down_payment';

  v_payment_type := bk.payment_type;
  if v_payment_type is null and aio.id is not null
     and aio.extracted_payment_type in ('cash','loan') then
    v_payment_type := aio.extracted_payment_type;
  end if;

  if aio.id is null then
    v_aio_status := 'pending';
  elsif aio.verification_status = 'approved' then
    v_aio_status := 'approved';
  elsif aio.verification_status = 'rejected' then
    v_aio_status := 'rejected';
  else
    v_aio_status := 'pending';
  end if;

  -- Expected down payment: the SA's agreed figure (bookings.down_payment) when
  -- set; otherwise fall back to total_otr − loan.
  if coalesce(bk.down_payment, 0) > 0 then
    v_expected_down := bk.down_payment;
  else
    v_total := coalesce(aio.extracted_total_otr, bk.otr_price, 0);
    v_loan  := coalesce(bk.loan_amount, aio.extracted_loan_amount, 0);
    if v_payment_type = 'cash' then
      v_loan := 0;
    end if;
    v_expected_down := greatest(v_total - v_loan, 0);
  end if;

  if v_received <= 0 then
    v_dp_status := 'pending';
  elsif v_expected_down <= 0 then
    v_dp_status := 'complete';
  elsif v_received >= v_expected_down - 1 then
    v_dp_status := 'complete';
  else
    v_dp_status := 'partial';
  end if;

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
    v_lou_status := 'not_required';
  end if;

  v_complete := (v_payment_type is not null)
                and (v_aio_status = 'approved')
                and (v_dp_status = 'complete');
  if v_payment_type = 'loan' then
    v_complete := v_complete and (v_lou_status = 'verified');
  end if;

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

-- Keep the doc-verification rollup fresh when the booking inputs to the
-- expected-down-payment calc change. Watches ONLY user-editable inputs, never
-- the columns recompute itself writes (would recurse).
create or replace function public.trg_booking_dv_recompute()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if exists (
    select 1 from public.document_verifications where booking_id = new.id
  ) then
    perform public.recompute_booking_documents(new.id);
  end if;
  return null;
end;
$$;

revoke execute on function public.trg_booking_dv_recompute() from anon, authenticated, public;

drop trigger if exists trg_booking_dv_recompute on public.bookings;
create trigger trg_booking_dv_recompute
  after update of down_payment, loan_amount, otr_price
  on public.bookings
  for each row
  when (
    new.down_payment   is distinct from old.down_payment
    or new.loan_amount is distinct from old.loan_amount
    or new.otr_price   is distinct from old.otr_price
  )
  execute function public.trg_booking_dv_recompute();

-- One-time: refresh every booking already in the doc-verification flow so the
-- new expected-down-payment basis applies to existing rows.
do $$
declare
  r record;
begin
  for r in select distinct booking_id from public.document_verifications loop
    perform public.recompute_booking_documents(r.booking_id);
  end loop;
end
$$;
