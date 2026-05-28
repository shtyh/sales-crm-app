-- 2026-05-29 · Commission verification feature.
--
-- Sales advisors upload a photo of the dealership's "All In One Preparation"
-- form. The extract-allinone Edge Function (Gemini 1.5 Flash, server-side
-- only) reads the form and writes the extracted fields back into this table.
-- A SECURITY-DEFINER RPC then auto-matches the extraction to an existing
-- booking and flags any commission discrepancy.
--
-- Storage convention (existing booking-files bucket): files live under
--   commission/{user_id}/{timestamp}.jpg
-- so the user-id prefix lets us scope RLS without needing a separate bucket.

-- ============================================================================
-- 1. Loosen audit_log so the Edge Function can record extraction attempts.
--    The existing schema was row-level only (row_id NOT NULL, operation IN
--    INSERT/UPDATE/DELETE). Edge-function calls are events, not row mutations,
--    so we relax both constraints. Existing trigger-driven rows keep
--    operation in (INSERT/UPDATE/DELETE) and a populated row_id — only the
--    *new* event rows have null row_id and operation='CALL'.
-- ============================================================================

alter table public.audit_log
  alter column row_id drop not null;

alter table public.audit_log
  drop constraint if exists audit_log_operation_check;

alter table public.audit_log
  add constraint audit_log_operation_check
  check (operation in ('INSERT','UPDATE','DELETE','CALL','ERROR'));

-- ============================================================================
-- 2. commission_verifications table.
-- ============================================================================

create table if not exists public.commission_verifications (
  id                        uuid primary key default gen_random_uuid(),
  booking_id                uuid references public.bookings(id) on delete set null,
  uploaded_by               uuid not null references public.profiles(id) on delete cascade,
  uploaded_at               timestamptz not null default now(),
  image_path                text not null,
  extracted_customer_name   text,
  extracted_sa_name         text,
  extracted_model           text,
  extracted_otr_price       numeric(12,2),
  extracted_commission      numeric(12,2),
  extracted_payment_type    text,
  extracted_date            date,
  matched                   boolean not null default false,
  discrepancy_notes         text
);

create index if not exists commission_verifications_uploaded_by_idx
  on public.commission_verifications(uploaded_by, uploaded_at desc);

create index if not exists commission_verifications_booking_idx
  on public.commission_verifications(booking_id)
  where booking_id is not null;

alter table public.commission_verifications enable row level security;

-- Base table grants — RLS narrows what the authenticated role can read /
-- write but only after Postgres has confirmed the role has the privilege at
-- all. Without these grants every query 500s with `permission denied for
-- table commission_verifications` before the policies even get a look in.
grant select, insert, update, delete on public.commission_verifications to authenticated;
grant select on public.commission_verifications to service_role;

-- SELECT: SA sees own; SM / FA / super see all.
drop policy if exists commission_verifications_select on public.commission_verifications;
create policy commission_verifications_select on public.commission_verifications
  for select to authenticated
  using (
    public.is_super_admin()
    or public.current_app_role() in ('sales_manager','finance_admin')
    or uploaded_by = (select auth.uid())
  );

-- INSERT: SA can insert own only; SM and super can insert any row (FA cannot
-- author since the workflow assumes the uploader is doing the matching).
drop policy if exists commission_verifications_insert on public.commission_verifications;
create policy commission_verifications_insert on public.commission_verifications
  for insert to authenticated
  with check (
    public.is_super_admin()
    or (
      public.current_app_role() in ('sales_advisor','sales_manager')
      and uploaded_by = (select auth.uid())
    )
  );

-- UPDATE: SM and super can update any row. SA cannot UPDATE — the match RPC
-- runs SECURITY DEFINER so SA-owned rows still get their match fields filled.
drop policy if exists commission_verifications_update on public.commission_verifications;
create policy commission_verifications_update on public.commission_verifications
  for update to authenticated
  using (
    public.is_super_admin()
    or public.current_app_role() = 'sales_manager'
  )
  with check (
    public.is_super_admin()
    or public.current_app_role() = 'sales_manager'
  );

-- DELETE: super only.
drop policy if exists commission_verifications_delete on public.commission_verifications;
create policy commission_verifications_delete on public.commission_verifications
  for delete to authenticated
  using (public.is_super_admin());

-- ============================================================================
-- 3. match_commission_verification(verification_id)
--    SECURITY DEFINER so SA-owned rows can be updated by their own match call.
--    The function first checks the caller owns the verification (or is privileged).
-- ============================================================================

create or replace function public.match_commission_verification(p_verification_id uuid)
returns public.commission_verifications
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v               public.commission_verifications;
  b               public.bookings;
  diff            numeric(12,2);
  match_count     int;
  caller          uuid := (select auth.uid());
  caller_role     public.app_role := public.current_app_role();
begin
  if caller is null then
    raise exception 'not authenticated';
  end if;

  select * into v from public.commission_verifications where id = p_verification_id;
  if not found then
    raise exception 'verification not found';
  end if;

  -- Authorisation: SA can only match own rows; SM / FA / super can match any.
  if v.uploaded_by <> caller
     and caller_role not in ('sales_manager','finance_admin','super_admin') then
    raise exception 'forbidden';
  end if;

  -- Look up a single matching booking by customer name + model (case-insensitive).
  -- Bail to "ambiguous" if more than one row matches — we don't want to silently
  -- pick the wrong booking and report a spurious discrepancy.
  select count(*) into match_count
  from public.bookings bk
  where v.extracted_customer_name is not null
    and v.extracted_model is not null
    and bk.customer_name ilike v.extracted_customer_name
    and bk.vehicle_model ilike v.extracted_model;

  if match_count = 0 then
    update public.commission_verifications
       set booking_id = null,
           matched = false,
           discrepancy_notes = 'No matching booking found'
     where id = p_verification_id
     returning * into v;
    return v;
  end if;

  if match_count > 1 then
    update public.commission_verifications
       set booking_id = null,
           matched = false,
           discrepancy_notes = format(
             'Ambiguous: %s bookings match this customer + model. Match manually.',
             match_count
           )
     where id = p_verification_id
     returning * into v;
    return v;
  end if;

  -- Exactly one match.
  select * into b
  from public.bookings bk
  where bk.customer_name ilike v.extracted_customer_name
    and bk.vehicle_model ilike v.extracted_model
  limit 1;

  if v.extracted_commission is null or b.commission_amount is null then
    update public.commission_verifications
       set booking_id = b.id,
           matched = true,
           discrepancy_notes = case
             when v.extracted_commission is null and b.commission_amount is null then null
             when v.extracted_commission is null then 'Form commission missing; booking commission is RM ' || b.commission_amount
             else 'Booking commission not yet set; form shows RM ' || v.extracted_commission
           end
     where id = p_verification_id
     returning * into v;
    return v;
  end if;

  diff := v.extracted_commission - b.commission_amount;

  update public.commission_verifications
     set booking_id = b.id,
         matched = true,
         discrepancy_notes = case
           when diff = 0 then null
           else format(
             'Expected RM %s, extracted RM %s, difference RM %s',
             trim(to_char(b.commission_amount,    'FM999999990.00')),
             trim(to_char(v.extracted_commission, 'FM999999990.00')),
             trim(to_char(diff,                   'FM999999990.00'))
           )
         end
   where id = p_verification_id
   returning * into v;

  return v;
end;
$$;

revoke execute on function public.match_commission_verification(uuid) from anon, public;
grant  execute on function public.match_commission_verification(uuid) to authenticated;

-- ============================================================================
-- 4. Storage policies for the `commission/...` prefix on booking-files.
--    The existing bf_select / bf_insert / bf_delete policies on storage.objects
--    only allowed files whose first path segment is a booking code/id, so the
--    new `commission/{user_id}/...` prefix would currently be rejected. Add
--    sibling policies scoped to that prefix.
-- ============================================================================

drop policy if exists bf_commission_select on storage.objects;
create policy bf_commission_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'booking-files'
    and split_part(storage.objects.name, '/', 1) = 'commission'
    and (
      public.is_super_admin()
      or public.current_app_role() in ('sales_manager','finance_admin')
      or split_part(storage.objects.name, '/', 2) = (select auth.uid())::text
    )
  );

drop policy if exists bf_commission_insert on storage.objects;
create policy bf_commission_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'booking-files'
    and split_part(storage.objects.name, '/', 1) = 'commission'
    and split_part(storage.objects.name, '/', 2) = (select auth.uid())::text
    and public.current_app_role() in ('sales_advisor','sales_manager','super_admin')
  );

-- No UPDATE policy — uploads are immutable from the FE.
-- DELETE limited to super_admin to keep the audit trail intact.
drop policy if exists bf_commission_delete on storage.objects;
create policy bf_commission_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'booking-files'
    and split_part(storage.objects.name, '/', 1) = 'commission'
    and public.is_super_admin()
  );
