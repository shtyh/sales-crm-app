-- ============================================================================
-- Performance + security hardening
--   1. Collapse the per-table "_own + _admin" RLS policy pairs into one
--      policy each. Postgres OR-combines permissive policies but evaluates
--      every one of them on every row, so two policies = ~2x per-row cost.
--   2. Revoke REST executability on trigger-only SECURITY DEFINER functions
--      that were never meant to be callable via /rest/v1/rpc/<fn>.
--   3. Pin set_updated_at's search_path so it can't be hijacked.
-- ============================================================================

-- ---------- bookings: unify _own + _admin -----------------------------------
drop policy if exists bookings_select_own   on public.bookings;
drop policy if exists bookings_select_admin on public.bookings;
create policy bookings_select on public.bookings
  for select to authenticated
  using (owner_id = (select auth.uid()) or public.is_admin());

drop policy if exists bookings_insert_own   on public.bookings;
drop policy if exists bookings_insert_admin on public.bookings;
create policy bookings_insert on public.bookings
  for insert to authenticated
  with check (owner_id = (select auth.uid()) or public.is_admin());

drop policy if exists bookings_update_own   on public.bookings;
drop policy if exists bookings_update_admin on public.bookings;
create policy bookings_update on public.bookings
  for update to authenticated
  using       (owner_id = (select auth.uid()) or public.is_admin())
  with check  (owner_id = (select auth.uid()) or public.is_admin());

-- ---------- booking_attachments: unify --------------------------------------
drop policy if exists ba_select_own   on public.booking_attachments;
drop policy if exists ba_select_admin on public.booking_attachments;
create policy ba_select on public.booking_attachments
  for select to authenticated
  using (
    public.is_admin()
    or booking_id in (
      select id from public.bookings where owner_id = (select auth.uid())
    )
  );

drop policy if exists ba_insert_own   on public.booking_attachments;
drop policy if exists ba_insert_admin on public.booking_attachments;
create policy ba_insert on public.booking_attachments
  for insert to authenticated
  with check (
    public.is_admin()
    or booking_id in (
      select id from public.bookings where owner_id = (select auth.uid())
    )
  );

drop policy if exists ba_delete_own   on public.booking_attachments;
drop policy if exists ba_delete_admin on public.booking_attachments;
create policy ba_delete on public.booking_attachments
  for delete to authenticated
  using (
    public.is_admin()
    or booking_id in (
      select id from public.bookings where owner_id = (select auth.uid())
    )
  );

-- ---------- storage.objects (booking-files bucket): unify -------------------
drop policy if exists bf_select_own   on storage.objects;
drop policy if exists bf_select_admin on storage.objects;
create policy bf_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'booking-files'
    and (
      public.is_admin()
      or exists (
        select 1 from public.bookings b
        where b.owner_id = (select auth.uid())
          and split_part(storage.objects.name, '/', 1) in (b.code, b.id::text)
      )
    )
  );

drop policy if exists bf_insert_own   on storage.objects;
drop policy if exists bf_insert_admin on storage.objects;
create policy bf_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'booking-files'
    and (
      public.is_admin()
      or exists (
        select 1 from public.bookings b
        where b.owner_id = (select auth.uid())
          and split_part(storage.objects.name, '/', 1) in (b.code, b.id::text)
      )
    )
  );

drop policy if exists bf_delete_own   on storage.objects;
drop policy if exists bf_delete_admin on storage.objects;
create policy bf_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'booking-files'
    and (
      public.is_admin()
      or exists (
        select 1 from public.bookings b
        where b.owner_id = (select auth.uid())
          and split_part(storage.objects.name, '/', 1) in (b.code, b.id::text)
      )
    )
  );

-- ============================================================================
-- Trigger functions should never be REST-callable. PostgREST exposes every
-- function in `public` as /rpc/<fn> by default — fine for is_admin (which
-- the RLS machinery needs the authenticated role to execute) but not for
-- these two, which are only meant to fire from BEFORE/AFTER triggers.
-- ============================================================================
revoke execute on function public.guard_admin_only_booking_fields() from anon, authenticated, public;
revoke execute on function public.handle_auth_user_change()         from anon, authenticated, public;

-- is_admin is INTENTIONALLY callable by authenticated (RLS uses it), but anon
-- never reaches a policy that references it, so close that door.
revoke execute on function public.is_admin() from anon, public;

-- ============================================================================
-- Pin search_path on set_updated_at so a malicious search_path entry can't
-- shadow `now()` or the row's columns. Other functions in earlier migrations
-- already pin theirs; this one was overlooked.
-- ============================================================================
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
