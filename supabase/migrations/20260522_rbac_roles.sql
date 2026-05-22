-- ============================================================================
-- RBAC: 6 application roles
--   super_admin    — god mode (Axelrod); bypasses every policy
--   sales_advisor  — default; only own bookings, no cancel, no loan/insurance
--   sales_manager  — sees all, can cancel
--   general_admin  — sees all, can create bookings on others' behalf
--   finance_admin  — the only role that can write loan_bank/insurance/loan_status
--   accountant     — can cancel (deposit refund flow)
-- ============================================================================

-- 1. Enum
do $$ begin
  create type public.app_role as enum (
    'super_admin',
    'sales_advisor',
    'sales_manager',
    'general_admin',
    'finance_admin',
    'accountant'
  );
exception when duplicate_object then null; end $$;

grant usage on type public.app_role to authenticated;

-- 2. role column on profiles (default least-privileged)
alter table public.profiles
  add column if not exists role public.app_role not null default 'sales_advisor';

-- 3. Backfill known users
update public.profiles set role = 'super_admin'
  where id = '651800d5-1c86-4636-ba7d-6d98f751db26';  -- Axelrod Han
update public.profiles set role = 'general_admin'
  where id = '33542ff9-434d-4250-8814-58f7aa1291e0';  -- Lia
update public.profiles set role = 'sales_manager'
  where id = '0c9a2cbd-84c4-4b03-80a3-4d0a61204c04';  -- Johnson

-- 4. is_admin becomes a generated column so existing frontend code that
-- reads profile.is_admin keeps working: "admin" = "any non-SA role".
alter table public.profiles drop column if exists is_admin;
alter table public.profiles add column is_admin boolean
  generated always as (role <> 'sales_advisor') stored;

drop index if exists public.profiles_is_admin_idx;
create index if not exists profiles_role_idx
  on public.profiles(role)
  where role <> 'sales_advisor';

-- ============================================================================
-- Helper functions
-- ============================================================================

create or replace function public.current_app_role()
returns public.app_role
language sql stable security definer set search_path = public, pg_temp
as $$
  select role from public.profiles where id = (select auth.uid())
$$;

create or replace function public.is_super_admin()
returns boolean
language sql stable security definer set search_path = public, pg_temp
as $$
  select coalesce(public.current_app_role() = 'super_admin', false);
$$;

create or replace function public.has_role(check_role public.app_role)
returns boolean
language sql stable security definer set search_path = public, pg_temp
as $$
  select coalesce(public.current_app_role() = check_role, false);
$$;

-- Back-compat: old is_admin() now means "any non-SA role"
create or replace function public.is_admin()
returns boolean
language sql stable security definer set search_path = public, pg_temp
as $$
  select coalesce(public.current_app_role() <> 'sales_advisor', false);
$$;

grant execute on function public.current_app_role()         to authenticated;
grant execute on function public.is_super_admin()           to authenticated;
grant execute on function public.has_role(public.app_role)  to authenticated;
revoke execute on function public.current_app_role()        from anon, public;
revoke execute on function public.is_super_admin()          from anon, public;
revoke execute on function public.has_role(public.app_role) from anon, public;

-- ============================================================================
-- bookings policies
-- ============================================================================

drop policy if exists bookings_select on public.bookings;
create policy bookings_select on public.bookings
  for select to authenticated
  using (
    public.is_super_admin()
    or owner_id = (select auth.uid())
    or public.current_app_role() in ('general_admin','sales_manager','finance_admin','accountant')
  );

drop policy if exists bookings_insert on public.bookings;
create policy bookings_insert on public.bookings
  for insert to authenticated
  with check (
    public.is_super_admin()
    or (public.current_app_role() = 'sales_advisor' and owner_id = (select auth.uid()))
    or public.current_app_role() = 'general_admin'
  );

drop policy if exists bookings_update on public.bookings;
create policy bookings_update on public.bookings
  for update to authenticated
  using (
    public.is_super_admin()
    or owner_id = (select auth.uid())
    or public.current_app_role() in ('general_admin','sales_manager','finance_admin','accountant')
  )
  with check (
    public.is_super_admin()
    or owner_id = (select auth.uid())
    or public.current_app_role() in ('general_admin','sales_manager','finance_admin','accountant')
  );

drop policy if exists bookings_delete_own on public.bookings;
drop policy if exists bookings_delete     on public.bookings;
create policy bookings_delete on public.bookings
  for delete to authenticated
  using (public.is_super_admin());

-- ============================================================================
-- Field- and transition-level guard trigger
-- ============================================================================

create or replace function public.guard_booking_field_writes()
returns trigger
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  caller public.app_role := public.current_app_role();
begin
  if caller = 'super_admin' then
    return new;
  end if;

  if (new.loan_bank        is distinct from old.loan_bank
      or new.insurance_company is distinct from old.insurance_company
      or new.loan_status   is distinct from old.loan_status
      or new.loan_notes    is distinct from old.loan_notes)
     and caller is distinct from 'finance_admin' then
    raise exception
      'Only finance_admin can change loan or insurance fields'
      using errcode = '42501', hint = format('your role: %s', caller);
  end if;

  if new.status = 'cancelled' and old.status is distinct from 'cancelled'
     and caller is distinct from 'sales_manager'
     and caller is distinct from 'accountant' then
    raise exception
      'Only sales_manager or accountant can cancel a booking'
      using errcode = '42501', hint = format('your role: %s', caller);
  end if;

  return new;
end;
$$;

revoke execute on function public.guard_booking_field_writes() from anon, authenticated, public;

drop trigger if exists trg_bookings_guard_admin_fields on public.bookings;
drop trigger if exists trg_bookings_guard              on public.bookings;
create trigger trg_bookings_guard
  before update on public.bookings
  for each row execute function public.guard_booking_field_writes();

drop function if exists public.guard_admin_only_booking_fields();

-- ============================================================================
-- booking_attachments + storage.objects: same access pattern
-- ============================================================================

drop policy if exists ba_select on public.booking_attachments;
create policy ba_select on public.booking_attachments
  for select to authenticated
  using (
    public.is_super_admin()
    or public.current_app_role() in ('general_admin','sales_manager','finance_admin','accountant')
    or booking_id in (select id from public.bookings where owner_id = (select auth.uid()))
  );

drop policy if exists ba_insert on public.booking_attachments;
create policy ba_insert on public.booking_attachments
  for insert to authenticated
  with check (
    public.is_super_admin()
    or public.current_app_role() in ('general_admin','sales_manager','finance_admin','accountant')
    or booking_id in (select id from public.bookings where owner_id = (select auth.uid()))
  );

drop policy if exists ba_delete on public.booking_attachments;
create policy ba_delete on public.booking_attachments
  for delete to authenticated
  using (
    public.is_super_admin()
    or public.current_app_role() in ('general_admin','sales_manager','finance_admin','accountant')
    or booking_id in (select id from public.bookings where owner_id = (select auth.uid()))
  );

drop policy if exists bf_select on storage.objects;
create policy bf_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'booking-files'
    and (
      public.is_super_admin()
      or public.current_app_role() in ('general_admin','sales_manager','finance_admin','accountant')
      or exists (
        select 1 from public.bookings b
        where b.owner_id = (select auth.uid())
          and split_part(storage.objects.name, '/', 1) in (b.code, b.id::text)
      )
    )
  );

drop policy if exists bf_insert on storage.objects;
create policy bf_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'booking-files'
    and (
      public.is_super_admin()
      or public.current_app_role() in ('general_admin','sales_manager','finance_admin','accountant')
      or exists (
        select 1 from public.bookings b
        where b.owner_id = (select auth.uid())
          and split_part(storage.objects.name, '/', 1) in (b.code, b.id::text)
      )
    )
  );

drop policy if exists bf_delete on storage.objects;
create policy bf_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'booking-files'
    and (
      public.is_super_admin()
      or public.current_app_role() in ('general_admin','sales_manager','finance_admin','accountant')
      or exists (
        select 1 from public.bookings b
        where b.owner_id = (select auth.uid())
          and split_part(storage.objects.name, '/', 1) in (b.code, b.id::text)
      )
    )
  );

-- ============================================================================
-- profiles: read by all; update by self OR super_admin; role change blocked
-- to non-super-admin via trigger.
-- ============================================================================

drop policy if exists profiles_select_any on public.profiles;
drop policy if exists profiles_select     on public.profiles;
create policy profiles_select on public.profiles
  for select to authenticated using (true);

drop policy if exists profiles_update_admin on public.profiles;
drop policy if exists profiles_update_self  on public.profiles;
drop policy if exists profiles_update_super on public.profiles;
drop policy if exists profiles_update       on public.profiles;
create policy profiles_update on public.profiles
  for update to authenticated
  using      (id = (select auth.uid()) or public.is_super_admin())
  with check (id = (select auth.uid()) or public.is_super_admin());

create or replace function public.guard_profile_role()
returns trigger
language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  if new.role is distinct from old.role and not public.is_super_admin() then
    raise exception 'Only super_admin can change a user role'
      using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke execute on function public.guard_profile_role() from anon, authenticated, public;

drop trigger if exists trg_profiles_guard_role on public.profiles;
create trigger trg_profiles_guard_role
  before update on public.profiles
  for each row execute function public.guard_profile_role();
