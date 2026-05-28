-- 2026-05-29 · 3-way reconciliation: bank statement + LOU + bank-in receipt
-- ↔ All-In-One Preparation form.
--
-- Workflow:
--   1. Super admin uploads the dealership's monthly bank statement (PDF).
--      `extract-bank-statement` Edge Fn reads it → one row per credit line
--      into `bank_statement_lines` (date + amount + description).
--   2. Finance Admin uploads LOU + bank-in receipts via the existing
--      `booking_attachments` table. The FE auto-fires `extract-document`
--      which writes the extracted amount / date / customer name into
--      `attachment_extractions` (one row per attachment).
--   3. Sales Advisor uploads the "All In One Preparation" form on
--      `/commission-verify`. That writes a row into
--      `commission_verifications`, which is matched to a booking.
--   4. Triggers on all three sources call `reconcile_booking(booking_id)`,
--      which upserts a single row per booking into
--      `booking_reconciliations` with status ∈
--      (complete · missing_… · discrepancy) plus a jsonb of per-field
--      diffs the dashboard can render.
--
-- Matching policy: strict. Statement-line ↔ bank-in must have the same
-- amount AND the same date. Discrepancies > 0 cent or > 0 days are
-- flagged.

-- ============================================================================
-- 1. bank_statements — one row per uploaded statement file.
-- ============================================================================

create table if not exists public.bank_statements (
  id            uuid primary key default gen_random_uuid(),
  uploaded_by   uuid not null references public.profiles(id) on delete cascade,
  uploaded_at   timestamptz not null default now(),
  file_path     text not null,
  period_start  date,
  period_end    date,
  notes         text
);

create index if not exists bank_statements_uploaded_at_idx
  on public.bank_statements(uploaded_at desc);

alter table public.bank_statements enable row level security;

drop policy if exists bank_statements_select on public.bank_statements;
create policy bank_statements_select on public.bank_statements
  for select to authenticated
  using (
    public.is_super_admin()
    or public.current_app_role() in ('finance_admin','sales_manager')
  );

drop policy if exists bank_statements_insert on public.bank_statements;
create policy bank_statements_insert on public.bank_statements
  for insert to authenticated
  with check (
    (public.is_super_admin() or public.current_app_role() = 'finance_admin')
    and uploaded_by = (select auth.uid())
  );

drop policy if exists bank_statements_delete on public.bank_statements;
create policy bank_statements_delete on public.bank_statements
  for delete to authenticated
  using (public.is_super_admin());

grant select, insert, delete on public.bank_statements to authenticated;
grant select on public.bank_statements to service_role;

-- ============================================================================
-- 2. bank_statement_lines — one row per credit line in a statement.
-- ============================================================================

create table if not exists public.bank_statement_lines (
  id            uuid primary key default gen_random_uuid(),
  statement_id  uuid not null references public.bank_statements(id) on delete cascade,
  line_date     date not null,
  amount        numeric(12,2) not null,
  description   text,
  raw           jsonb,
  created_at    timestamptz not null default now()
);

create index if not exists bank_statement_lines_statement_idx
  on public.bank_statement_lines(statement_id);
create index if not exists bank_statement_lines_match_idx
  on public.bank_statement_lines(amount, line_date);

alter table public.bank_statement_lines enable row level security;

drop policy if exists bank_statement_lines_select on public.bank_statement_lines;
create policy bank_statement_lines_select on public.bank_statement_lines
  for select to authenticated
  using (
    public.is_super_admin()
    or public.current_app_role() in ('finance_admin','sales_manager')
  );

-- Inserts come from the extract-bank-statement edge fn (service role).
-- No INSERT policy for authenticated.
grant select on public.bank_statement_lines to authenticated;
grant select, insert, delete on public.bank_statement_lines to service_role;

-- ============================================================================
-- 3. attachment_extractions — one row per booking_attachment (LOU / bank-in).
--    UNIQUE on attachment_id so re-extracting just upserts.
-- ============================================================================

create table if not exists public.attachment_extractions (
  id                       uuid primary key default gen_random_uuid(),
  attachment_id            uuid not null unique references public.booking_attachments(id) on delete cascade,
  doc_type                 text not null check (doc_type in ('lou','bank_transaction','cancellation_form','other')),
  extracted_amount         numeric(12,2),
  extracted_date           date,
  extracted_customer_name  text,
  raw                      jsonb,
  created_at               timestamptz not null default now()
);

create index if not exists attachment_extractions_attachment_idx
  on public.attachment_extractions(attachment_id);
create index if not exists attachment_extractions_match_idx
  on public.attachment_extractions(extracted_amount, extracted_date)
  where doc_type = 'bank_transaction';

alter table public.attachment_extractions enable row level security;

-- Visibility mirrors booking_attachments: any admin or the booking owner.
drop policy if exists attachment_extractions_select on public.attachment_extractions;
create policy attachment_extractions_select on public.attachment_extractions
  for select to authenticated
  using (
    public.is_super_admin()
    or public.current_app_role() in ('general_admin','sales_manager','finance_admin')
    or attachment_id in (
      select ba.id from public.booking_attachments ba
      join public.bookings b on b.id = ba.booking_id
      where b.owner_id = (select auth.uid())
    )
  );

-- Writes come from the extract-document edge fn (service role).
grant select on public.attachment_extractions to authenticated;
grant select, insert, update, delete on public.attachment_extractions to service_role;

-- ============================================================================
-- 4. booking_reconciliations — current state per booking. UNIQUE on booking_id
--    so the reconcile RPC just upserts.
-- ============================================================================

create table if not exists public.booking_reconciliations (
  id                       uuid primary key default gen_random_uuid(),
  booking_id               uuid not null unique references public.bookings(id) on delete cascade,
  status                   text not null,
  -- All four pointers; null = the doc isn't there yet.
  all_in_one_id            uuid references public.commission_verifications(id) on delete set null,
  lou_extraction_id        uuid references public.attachment_extractions(id) on delete set null,
  bankin_extraction_id     uuid references public.attachment_extractions(id) on delete set null,
  statement_line_id        uuid references public.bank_statement_lines(id) on delete set null,
  -- Per-field diffs + missing-doc list. Shape:
  --   {
  --     "missing": ["all_in_one","lou","bank_in","statement"],
  --     "diffs": [{"field":"commission","expected":1234,"got":1100}, ...]
  --   }
  details                  jsonb not null default '{}'::jsonb,
  updated_at               timestamptz not null default now()
);

create index if not exists booking_reconciliations_status_idx
  on public.booking_reconciliations(status, updated_at desc);

alter table public.booking_reconciliations enable row level security;

drop policy if exists booking_reconciliations_select on public.booking_reconciliations;
create policy booking_reconciliations_select on public.booking_reconciliations
  for select to authenticated
  using (
    public.is_super_admin()
    or public.current_app_role() in ('finance_admin','sales_manager','general_admin')
    or booking_id in (
      select id from public.bookings where owner_id = (select auth.uid())
    )
  );

-- Writes come from reconcile_booking() (security definer).
grant select on public.booking_reconciliations to authenticated;
grant select, insert, update, delete on public.booking_reconciliations to service_role;

-- ============================================================================
-- 5. reconcile_booking(uuid) RPC.
--    SECURITY DEFINER so triggers can call it without per-row RLS pain.
-- ============================================================================

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

  -- LOU loan amount diff
  if lou_ext.id is not null
     and lou_ext.extracted_amount is not null
     and bk.loan_amount is not null
     and lou_ext.extracted_amount <> bk.loan_amount then
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

revoke execute on function public.reconcile_booking(uuid) from anon, public;
grant  execute on function public.reconcile_booking(uuid) to authenticated;

-- ============================================================================
-- 6. Triggers: auto-fire reconcile when any of the four source docs change.
-- ============================================================================

-- 6a. commission_verifications: re-run when booking_id is set / changed.
create or replace function public.trg_cv_reconcile()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
begin
  if NEW.booking_id is not null then
    perform public.reconcile_booking(NEW.booking_id);
  end if;
  -- If a CV was previously linked to a different booking, reconcile that too.
  if TG_OP = 'UPDATE'
     and OLD.booking_id is not null
     and OLD.booking_id is distinct from NEW.booking_id then
    perform public.reconcile_booking(OLD.booking_id);
  end if;
  return NEW;
end;
$fn$;

drop trigger if exists trg_cv_reconcile on public.commission_verifications;
create trigger trg_cv_reconcile
  after insert or update of booking_id, extracted_commission, extracted_otr_price
  on public.commission_verifications
  for each row execute function public.trg_cv_reconcile();

-- 6b. attachment_extractions: reconcile the booking the attachment belongs to.
create or replace function public.trg_attext_reconcile()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  bid uuid;
begin
  select booking_id into bid from public.booking_attachments where id = NEW.attachment_id;
  if bid is not null then
    perform public.reconcile_booking(bid);
  end if;
  return NEW;
end;
$fn$;

drop trigger if exists trg_attext_reconcile on public.attachment_extractions;
create trigger trg_attext_reconcile
  after insert or update on public.attachment_extractions
  for each row execute function public.trg_attext_reconcile();

-- 6c. bank_statement_lines: find any bank-in extraction matching the line,
--     and re-reconcile each affected booking.
create or replace function public.trg_stmt_reconcile()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  r record;
begin
  for r in
    select distinct ba.booking_id as bid
    from public.attachment_extractions ae
    join public.booking_attachments ba on ba.id = ae.attachment_id
    where ae.doc_type = 'bank_transaction'
      and ae.extracted_amount = NEW.amount
      and ae.extracted_date   = NEW.line_date
  loop
    perform public.reconcile_booking(r.bid);
  end loop;
  return NEW;
end;
$fn$;

drop trigger if exists trg_stmt_reconcile on public.bank_statement_lines;
create trigger trg_stmt_reconcile
  after insert on public.bank_statement_lines
  for each row execute function public.trg_stmt_reconcile();

-- ============================================================================
-- 7. Storage policies — let FA upload bank statements under statements/{uid}/
-- ============================================================================

drop policy if exists bf_statements_select on storage.objects;
create policy bf_statements_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'booking-files'
    and split_part(storage.objects.name, '/', 1) = 'statements'
    and (
      public.is_super_admin()
      or public.current_app_role() = 'finance_admin'
    )
  );

drop policy if exists bf_statements_insert on storage.objects;
create policy bf_statements_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'booking-files'
    and split_part(storage.objects.name, '/', 1) = 'statements'
    and split_part(storage.objects.name, '/', 2) = (select auth.uid())::text
    and (
      public.is_super_admin()
      or public.current_app_role() = 'finance_admin'
    )
  );

drop policy if exists bf_statements_delete on storage.objects;
create policy bf_statements_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'booking-files'
    and split_part(storage.objects.name, '/', 1) = 'statements'
    and public.is_super_admin()
  );
