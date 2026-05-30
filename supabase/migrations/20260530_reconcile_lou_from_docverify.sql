-- 2026-05-30 · Reconciliation reads the LOU from the single Document submission.
--
-- The booking page's old 📃 LOU AttachmentSection (booking_attachments kind='lou'
-- → attachment_extractions) was removed; the LOU now lives only in the Document
-- submission card (document_verifications, via extract-lou). So reconcile_booking
-- now falls back to the document_verifications LOU when there's no attachment LOU
-- — one upload, both systems. Plus a trigger so uploading the LOU there refreshes
-- the reconciliation (gated to bookings already in the reconciliation flow so it
-- never spawns new rows). Everything else in reconcile_booking is unchanged from
-- the 2026-05-30 handling-fee version.

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
  v_handling_fee constant numeric := 600;
  v_lou_amount   numeric;
  v_lou_present  boolean := false;
begin
  if p_booking_id is null then
    return null;
  end if;

  select * into bk from public.bookings where id = p_booking_id;
  if not found then
    return null;
  end if;

  select * into cv
  from public.commission_verifications
  where booking_id = p_booking_id
  order by uploaded_at desc
  limit 1;

  if cv.id is null then
    missing := array_append(missing, 'all_in_one');
  end if;

  -- LOU is auto-satisfied for cash deals. Otherwise prefer the reconciliation
  -- attachment LOU, then fall back to the Document submission LOU.
  if bk.loan_bank is distinct from 'cash' then
    select ae.* into lou_ext
    from public.attachment_extractions ae
    join public.booking_attachments ba on ba.id = ae.attachment_id
    where ba.booking_id = p_booking_id and ae.doc_type = 'lou'
    order by ae.created_at desc
    limit 1;

    if lou_ext.id is not null then
      v_lou_present := true;
      v_lou_amount  := lou_ext.extracted_amount;
    else
      select dv.extracted_loan_amount_lou into v_lou_amount
      from public.document_verifications dv
      where dv.booking_id = p_booking_id and dv.document_type = 'lou'
      order by dv.created_at desc
      limit 1;
      if found then
        v_lou_present := true;
      end if;
    end if;

    if not v_lou_present then
      missing := array_append(missing, 'lou');
    end if;
  end if;

  select ae.* into bankin_ext
  from public.attachment_extractions ae
  join public.booking_attachments ba on ba.id = ae.attachment_id
  where ba.booking_id = p_booking_id and ae.doc_type = 'bank_transaction'
  order by ae.created_at desc
  limit 1;

  if bankin_ext.id is null then
    missing := array_append(missing, 'bank_in');
  end if;

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

  if cv.id is not null
     and cv.extracted_commission is not null
     and bk.commission_amount is not null
     and cv.extracted_commission <> bk.commission_amount then
    diffs := diffs || jsonb_build_array(jsonb_build_object(
      'field', 'commission', 'doc', 'all_in_one',
      'expected', bk.commission_amount, 'got', cv.extracted_commission));
  end if;

  if cv.id is not null
     and cv.extracted_otr_price is not null
     and bk.otr_price is not null
     and cv.extracted_otr_price <> bk.otr_price then
    diffs := diffs || jsonb_build_array(jsonb_build_object(
      'field', 'otr_price', 'doc', 'all_in_one',
      'expected', bk.otr_price, 'got', cv.extracted_otr_price));
  end if;

  -- LOU loan amount diff: accept loan_amount OR loan_amount + RM600 handling
  -- fee as a match (within RM1). Source is whichever LOU was found above.
  if v_lou_present
     and v_lou_amount is not null
     and bk.loan_amount is not null
     and abs(v_lou_amount - bk.loan_amount) > 1
     and abs(v_lou_amount - (bk.loan_amount + v_handling_fee)) > 1 then
    diffs := diffs || jsonb_build_array(jsonb_build_object(
      'field', 'loan_amount', 'doc', 'lou',
      'expected', bk.loan_amount, 'got', v_lou_amount));
  end if;

  if bankin_ext.id is not null
     and bankin_ext.extracted_amount is not null
     and bk.booking_fee is not null
     and bankin_ext.extracted_amount <> bk.booking_fee then
    diffs := diffs || jsonb_build_array(jsonb_build_object(
      'field', 'booking_fee', 'doc', 'bank_in',
      'expected', bk.booking_fee, 'got', bankin_ext.extracted_amount));
  end if;

  if bankin_ext.id is not null
     and bankin_ext.extracted_customer_name is not null
     and bk.customer_name is not null
     and not (trim(bankin_ext.extracted_customer_name) ilike trim(bk.customer_name)) then
    diffs := diffs || jsonb_build_array(jsonb_build_object(
      'field', 'customer_name', 'doc', 'bank_in',
      'expected', bk.customer_name, 'got', bankin_ext.extracted_customer_name));
  end if;

  if array_length(missing, 1) is not null then
    v_status := 'missing';
  elsif jsonb_array_length(diffs) > 0 then
    v_status := 'discrepancy';
  else
    v_status := 'complete';
  end if;

  insert into public.booking_reconciliations(
    booking_id, status, all_in_one_id, lou_extraction_id,
    bankin_extraction_id, statement_line_id, details, updated_at
  ) values (
    p_booking_id, v_status, cv.id, lou_ext.id, bankin_ext.id, stmt_line.id,
    jsonb_build_object('missing', to_jsonb(missing), 'diffs', diffs), now()
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

-- Refresh reconciliation when a Document submission doc lands (the LOU now feeds
-- it). Gated to bookings already in the reconciliation flow so it never spawns
-- new rows. reconcile_booking touches only booking_reconciliations → no recursion.
create or replace function public.trg_dv_reconcile()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if exists (
    select 1 from public.booking_reconciliations
    where booking_id = coalesce(new.booking_id, old.booking_id)
  ) then
    perform public.reconcile_booking(coalesce(new.booking_id, old.booking_id));
  end if;
  return null;
end;
$$;

revoke execute on function public.trg_dv_reconcile() from anon, authenticated, public;

drop trigger if exists trg_document_verifications_reconcile on public.document_verifications;
create trigger trg_document_verifications_reconcile
  after insert or update on public.document_verifications
  for each row execute function public.trg_dv_reconcile();

-- One-time: re-run every existing reconciliation so any already-uploaded
-- Document submission LOU is picked up now.
do $$
declare
  r record;
begin
  for r in select booking_id from public.booking_reconciliations loop
    perform public.reconcile_booking(r.booking_id);
  end loop;
end
$$;
