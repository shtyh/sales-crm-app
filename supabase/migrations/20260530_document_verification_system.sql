-- 2026-05-30 · Document Verification System — Phase A (schema foundation).
--
-- Adds the document-verification workflow + in-app notifications. Deliberately
-- SEPARATE from the existing commission_verifications / extract-allinone system
-- (which stays untouched and wired into /reconciliation) — these are parallel
-- pipelines that both read the "All In One" form but serve different flows.
--
-- This migration is purely ADDITIVE: two new tables, additive nullable columns
-- on bookings, storage policies for a new prefix, and the notification RPCs.
-- The booking-complete / commission-unlock logic + guard interaction land in a
-- later phase. Storage convention: document-verification/{user_id}/{ts}.{ext}.

-- ============================================================================
-- 1. notifications
-- ============================================================================
create table if not exists public.notifications (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles(id) on delete cascade,
  booking_id  uuid references public.bookings(id) on delete cascade,
  type        text not null check (type in (
                'no_sm_signature','all_in_one_pending','all_in_one_approved',
                'all_in_one_rejected','down_payment_complete','lou_pending',
                'lou_verified','booking_complete','commission_unlocked')),
  message     text not null,
  is_read     boolean not null default false,
  created_at  timestamptz not null default now()
);

create index if not exists notifications_user_unread_idx
  on public.notifications(user_id, is_read, created_at desc);

alter table public.notifications enable row level security;

grant select, insert, update, delete on public.notifications to authenticated;
grant select, insert on public.notifications to service_role;

-- SELECT: own rows; super_admin sees all.
drop policy if exists notifications_select on public.notifications;
create policy notifications_select on public.notifications
  for select to authenticated
  using (public.is_super_admin() or user_id = (select auth.uid()));

-- INSERT: super_admin only directly. Everything else goes through the
-- SECURITY DEFINER create_notification() RPC (so the system can notify other
-- users without tripping the own-row rule).
drop policy if exists notifications_insert on public.notifications;
create policy notifications_insert on public.notifications
  for insert to authenticated
  with check (public.is_super_admin());

-- UPDATE: own rows (toggling is_read) or super_admin.
drop policy if exists notifications_update on public.notifications;
create policy notifications_update on public.notifications
  for update to authenticated
  using (public.is_super_admin() or user_id = (select auth.uid()))
  with check (public.is_super_admin() or user_id = (select auth.uid()));

-- DELETE: own rows or super_admin.
drop policy if exists notifications_delete on public.notifications;
create policy notifications_delete on public.notifications
  for delete to authenticated
  using (public.is_super_admin() or user_id = (select auth.uid()));

-- ============================================================================
-- 2. document_verifications
-- ============================================================================
create table if not exists public.document_verifications (
  id              uuid primary key default gen_random_uuid(),
  booking_id      uuid not null references public.bookings(id) on delete cascade,
  document_type   text not null check (document_type in ('all_in_one','down_payment','lou')),
  attachment_id   uuid references public.booking_attachments(id) on delete set null,
  image_path      text not null,

  -- Gemini extracted — All In One
  extracted_otr                   numeric(12,2),
  extracted_pesb_discount         numeric(12,2),
  extracted_own_discount          numeric(12,2),
  extracted_insurance             numeric(12,2),
  extracted_total_otr             numeric(12,2),
  extracted_loan_amount           numeric(12,2),
  extracted_down_payment          numeric(12,2),
  extracted_balance               numeric(12,2),
  extracted_commission            numeric(12,2),
  extracted_sa_name               text,
  extracted_customer_name         text,
  extracted_model                 text,
  extracted_plate_no              text,
  extracted_sm_signature_detected boolean,
  extracted_payment_type          text,

  -- Gemini extracted — Down Payment
  extracted_payment_amount        numeric(12,2),
  extracted_payment_date          date,
  extracted_payer_name            text,

  -- Gemini extracted — LOU
  extracted_hirer_name            text,
  extracted_loan_amount_lou       numeric(12,2),
  extracted_handling_fee          numeric(12,2),
  extracted_plate_no_lou          text,

  -- Finance Admin
  finance_admin_loan_amount       numeric(12,2),
  finance_admin_confirmed         boolean not null default false,
  finance_admin_confirmed_by      uuid references public.profiles(id) on delete set null,
  finance_admin_confirmed_at      timestamptz,
  finance_admin_notes             text,

  -- Verification result
  gemini_match                    boolean,
  verification_status             text not null default 'pending'
                                    check (verification_status in
                                      ('pending','approved','rejected','needs_review')),
  rejection_reason                text,

  uploaded_by     uuid not null references public.profiles(id) on delete cascade,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists document_verifications_booking_idx
  on public.document_verifications(booking_id, document_type);
create index if not exists document_verifications_uploaded_by_idx
  on public.document_verifications(uploaded_by, created_at desc);
create index if not exists document_verifications_status_idx
  on public.document_verifications(verification_status);

-- updated_at touch (dedicated fn so we never clobber a shared one).
create or replace function public.dv_set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_document_verifications_updated_at on public.document_verifications;
create trigger trg_document_verifications_updated_at
  before update on public.document_verifications
  for each row execute function public.dv_set_updated_at();

alter table public.document_verifications enable row level security;

grant select, insert, update, delete on public.document_verifications to authenticated;
grant select, insert, update on public.document_verifications to service_role;

-- SELECT: uploader sees own; finance_admin / sales_manager / super see all.
drop policy if exists document_verifications_select on public.document_verifications;
create policy document_verifications_select on public.document_verifications
  for select to authenticated
  using (
    public.is_super_admin()
    or public.current_app_role() in ('finance_admin','sales_manager')
    or uploaded_by = (select auth.uid())
  );

-- INSERT: SA / SM author own rows; super any.
drop policy if exists document_verifications_insert on public.document_verifications;
create policy document_verifications_insert on public.document_verifications
  for insert to authenticated
  with check (
    public.is_super_admin()
    or (
      public.current_app_role() in ('sales_advisor','sales_manager')
      and uploaded_by = (select auth.uid())
    )
  );

-- UPDATE: finance_admin / sales_manager / super (the review step). SA cannot.
drop policy if exists document_verifications_update on public.document_verifications;
create policy document_verifications_update on public.document_verifications
  for update to authenticated
  using (
    public.is_super_admin()
    or public.current_app_role() in ('finance_admin','sales_manager')
  )
  with check (
    public.is_super_admin()
    or public.current_app_role() in ('finance_admin','sales_manager')
  );

-- DELETE: super only.
drop policy if exists document_verifications_delete on public.document_verifications;
create policy document_verifications_delete on public.document_verifications
  for delete to authenticated
  using (public.is_super_admin());

-- ============================================================================
-- 3. bookings — additive document-status columns.
--    payment_type = deal financing type (cash/loan/floor_stock). DISTINCT from
--    payments.payment_type (deposit/full/partial = payment method). Nullable +
--    no backfill here so this migration never fires the bookings guard trigger;
--    a careful backfill + write-gating lands in the booking-complete phase.
-- ============================================================================
alter table public.bookings
  add column if not exists all_in_one_status text default 'pending'
    check (all_in_one_status in ('pending','approved','rejected')),
  add column if not exists down_payment_status text default 'pending'
    check (down_payment_status in ('pending','partial','complete')),
  add column if not exists lou_status text default 'not_required'
    check (lou_status in ('not_required','pending','verified')),
  add column if not exists documents_complete boolean not null default false,
  add column if not exists total_received_down_payment numeric(12,2) not null default 0,
  add column if not exists payment_type text
    check (payment_type in ('cash','loan','floor_stock'));

-- ============================================================================
-- 4. Storage policies — `document-verification/{user_id}/...` on booking-files.
--    Mirrors the existing bf_commission_* policies.
-- ============================================================================
drop policy if exists bf_docverif_select on storage.objects;
create policy bf_docverif_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'booking-files'
    and split_part(storage.objects.name, '/', 1) = 'document-verification'
    and (
      public.is_super_admin()
      or public.current_app_role() in ('finance_admin','sales_manager')
      or split_part(storage.objects.name, '/', 2) = (select auth.uid())::text
    )
  );

drop policy if exists bf_docverif_insert on storage.objects;
create policy bf_docverif_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'booking-files'
    and split_part(storage.objects.name, '/', 1) = 'document-verification'
    and split_part(storage.objects.name, '/', 2) = (select auth.uid())::text
    and public.current_app_role() in ('sales_advisor','sales_manager','super_admin')
  );

drop policy if exists bf_docverif_delete on storage.objects;
create policy bf_docverif_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'booking-files'
    and split_part(storage.objects.name, '/', 1) = 'document-verification'
    and public.is_super_admin()
  );

-- ============================================================================
-- 5. Notification RPCs (Part 7).
-- ============================================================================
create or replace function public.get_unread_notification_count()
returns integer
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select count(*)::int
  from public.notifications
  where user_id = (select auth.uid()) and not is_read;
$$;

create or replace function public.mark_notification_read(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.notifications
     set is_read = true
   where id = p_id and user_id = (select auth.uid());
end;
$$;

create or replace function public.mark_all_notifications_read()
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.notifications
     set is_read = true
   where user_id = (select auth.uid()) and not is_read;
end;
$$;

-- Internal use (edge functions via service_role, and other SECURITY DEFINER
-- RPCs in their definer context). Not callable by ordinary authenticated users
-- so nobody can spam notifications to other people.
create or replace function public.create_notification(
  p_user_id uuid, p_booking_id uuid, p_type text, p_message text
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
begin
  insert into public.notifications(user_id, booking_id, type, message)
  values (p_user_id, p_booking_id, p_type, p_message)
  returning id into v_id;
  return v_id;
end;
$$;

revoke execute on function public.get_unread_notification_count() from anon, public;
grant  execute on function public.get_unread_notification_count() to authenticated;

revoke execute on function public.mark_notification_read(uuid) from anon, public;
grant  execute on function public.mark_notification_read(uuid) to authenticated;

revoke execute on function public.mark_all_notifications_read() from anon, public;
grant  execute on function public.mark_all_notifications_read() to authenticated;

revoke execute on function public.create_notification(uuid, uuid, text, text)
  from anon, public, authenticated;
grant  execute on function public.create_notification(uuid, uuid, text, text)
  to service_role;
