-- 2026-05-30 · LOU reconciliation tolerates the RM600 bank handling fee.
--
-- A bank LOU states the financed amount that INCLUDES the bank's RM600 handling
-- fee, while bookings.loan_amount is the principal. So an LOU of (loan_amount +
-- 600) is correct, not a discrepancy. reconcile_booking() was comparing them
-- straight and flagging the RM600 fee as a loan_amount diff.
--
-- Fix: accept loan_amount OR loan_amount + handling fee (RM600, the locked
-- handling-fee constant) as a match, within RM1. Only a value that is neither
-- is a real discrepancy. Full function re-stated with that one block changed;
-- everything else is byte-for-byte the 2026-05-29 version.

create or replace function public.reconcile_booking(p_booking_id uuid)
returns public.booking_reconciliations
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  bk             public.bookings;
  cv             public.commission_verifications;
  lou_ext        public.attachment_extractions;
  bankin_ext     public.attachment_extractions;
  stmt_line      public.bank_statement_lines;
  missing        text[] := '{}';
  diffs          jsonb  := '[]'::jsonb;
  v_status       text;
  result         public.booking_reconciliations;
  v_handling_fee constant numeric := 600;  -- D3: bank LOU handling fee
begin
  if p_booking_id is null then
    return null;
  end if;

  select * into bk from public.bookings where id = p_booking_id;
  if not found then
    return null;
  end if;

  -- 1) Most recent All-In-One verification linked to this booking.
  select * into cv
  from public.commission_verifications
  where booking_id = p_booking_id
  order by uploaded_at desc
  limit 1;

  if cv.id is null then
    missing := array_append(missing, 'all_in_one');
  end if;

  -- 2) Most recent LOU extraction.
  --    LOU is auto-satisfied when loan_bank = 'cash'.
  if bk.loan_bank is distinct from 'cash' then
    select ae.* into lou_ext
    from public.attachment_extractions ae
    join public.booking_attachments ba on ba.id = ae.attachment_id
    where ba.booking_id = p_booking_id and ae.doc_type = 'lou'
    order by ae.created_at desc
    limit 1;

    if lou_ext.id is null then
      missing := array_append(missing, 'lou');
    end if;
  end if;

  -- 3) Most recent bank-in extraction.
  select ae.* into bankin_ext
  from public.attachment_extractions ae
  join public.booking_attachments ba on ba.id = ae.attachment_id
  where ba.booking_id = p_booking_id and ae.doc_type = 'bank_transaction'
  order by ae.created_at desc
  limit 1;

  if bankin_ext.id is null then
    missing := array_append(missing, 'bank_in');
  end if;

  -- 4) Statement line that matches bank-in amount + date exactly.
  if bankin_ext.id is not null
     and bankin_ext.extracted_amount is not null
     and bankin_ext.extracted_date is not null then
    select * into stmt_line
    from public.bank_statement_lines
    where amount = bankin_ext.extracted_amount
      and line_date = bankin_ext.extracted_date
    order by created_at desc
    limit 1;

    if stmt_line.id is null then
      missing := array_append(missing, 'statement');
    end if;
  else
    missing := array_append(missing, 'statement');
  end if;

  -- ─── Per-field diff checks ─────────────────────────────────────────────

  -- Commission diff (AllInOne vs booking)
  if cv.id is not null
     and cv.extracted_commission is not null
     and bk.commission_amount is not null
     and cv.extracted_commission <> bk.commission_amount then
    diffs := diffs || jsonb_build_array(jsonb_build_object(
      'field',    'commission',
      'doc',      'all_in_one',
      'expected', bk.commission_amount,
      'got',      cv.extracted_commission
    ));
  end if;

  -- OTR diff (AllInOne vs booking)
  if cv.id is not null
     and cv.extracted_otr_price is not null
     and bk.otr_price is not null
     and cv.extracted_otr_price <> bk.otr_price then
    diffs := diffs || jsonb_build_array(jsonb_build_object(
      'field',    'otr_price',
      'doc',      'all_in_one',
      'expected', bk.otr_price,
      'got',      cv.extracted_otr_price
    ));
  end if;

  -- LOU loan amount diff.
  -- The LOU states the financed amount INCLUDING the bank's RM600 handling
  -- fee, while booking.loan_amount is the principal — so accept loan_amount OR
  -- loan_amount + handling fee as a match (within RM1). Only a value that is
  -- neither is a real discrepancy.
  if lou_ext.id is not null
     and lou_ext.extracted_amount is not null
     and bk.loan_amount is not null
     and abs(lou_ext.extracted_amount - bk.loan_amount) > 1
     and abs(lou_ext.extracted_amount - (bk.loan_amount + v_handling_fee)) > 1 then
    diffs := diffs || jsonb_build_array(jsonb_build_object(
      'field',    'loan_amount',
      'doc',      'lou',
      'expected', bk.loan_amount,
      'got',      lou_ext.extracted_amount
    ));
  end if;

  -- Bank-in vs booking_fee
  if bankin_ext.id is not null
     and bankin_ext.extracted_amount is not null
     and bk.booking_fee is not null
     and bankin_ext.extracted_amount <> bk.booking_fee then
    diffs := diffs || jsonb_build_array(jsonb_build_object(
      'field',    'booking_fee',
      'doc',      'bank_in',
      'expected', bk.booking_fee,
      'got',      bankin_ext.extracted_amount
    ));
  end if;

  -- Bank-in customer-name match (ilike, ignoring case + edge whitespace)
  if bankin_ext.id is not null
     and bankin_ext.extracted_customer_name is not null
     and bk.customer_name is not null
     and not (trim(bankin_ext.extracted_customer_name) ilike trim(bk.customer_name)) then
    diffs := diffs || jsonb_build_array(jsonb_build_object(
      'field',    'customer_name',
      'doc',      'bank_in',
      'expected', bk.customer_name,
      'got',      bankin_ext.extracted_customer_name
    ));
  end if;

  -- ─── Decide status ─────────────────────────────────────────────────────
  if array_length(missing, 1) is not null then
    v_status := 'missing';
  elsif jsonb_array_length(diffs) > 0 then
    v_status := 'discrepancy';
  else
    v_status := 'complete';
  end if;

  -- Upsert
  insert into public.booking_reconciliations(
    booking_id, status, all_in_one_id, lou_extraction_id,
    bankin_extraction_id, statement_line_id, details, updated_at
  ) values (
    p_booking_id,
    v_status,
    cv.id,
    lou_ext.id,
    bankin_ext.id,
    stmt_line.id,
    jsonb_build_object('missing', to_jsonb(missing), 'diffs', diffs),
    now()
  )
  on conflict (booking_id) do update
    set status               = excluded.status,
        all_in_one_id        = excluded.all_in_one_id,
        lou_extraction_id    = excluded.lou_extraction_id,
        bankin_extraction_id = excluded.bankin_extraction_id,
        statement_line_id    = excluded.statement_line_id,
        details              = excluded.details,
        updated_at           = excluded.updated_at
  returning * into result;

  return result;
end;
$fn$;

-- Refresh existing reconciliations so the RM600 handling-fee false-positives
-- clear immediately.
do $$
declare
  r record;
begin
  for r in select booking_id from public.booking_reconciliations loop
    perform public.reconcile_booking(r.booking_id);
  end loop;
end
$$;
