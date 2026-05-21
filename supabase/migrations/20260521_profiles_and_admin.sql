-- ============================================================================
-- Profiles + admin role
--   - Mirrors selected auth.users fields into a public table so other
--     authenticated users can resolve owner names (e.g. for booking lists).
--   - Adds an `is_admin` flag, set/unset only by other admins.
--   - Auto-syncs whenever auth.users is inserted or updated.
-- ============================================================================

create table if not exists public.profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  full_name  text,
  email      text,
  is_admin   boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists profiles_email_idx    on public.profiles(email);
create index if not exists profiles_is_admin_idx on public.profiles(is_admin) where is_admin;

grant usage on schema public to authenticated;
grant select, update on public.profiles to authenticated;

-- ============================================================================
-- is_admin() helper — SECURITY DEFINER bypasses RLS so it doesn't recurse.
-- Used by other RLS policies that need to know "is the caller an admin?".
-- ============================================================================
create or replace function public.is_admin()
returns boolean
language sql stable security definer set search_path = public, pg_temp
as $$
  select coalesce(
    (select is_admin from public.profiles where id = (select auth.uid())),
    false
  );
$$;

grant execute on function public.is_admin() to authenticated;

-- ============================================================================
-- RLS — anyone signed in can read profiles; only admins can update.
-- ============================================================================
alter table public.profiles enable row level security;

drop policy if exists profiles_select_any on public.profiles;
create policy profiles_select_any on public.profiles
  for select to authenticated using (true);

drop policy if exists profiles_update_admin on public.profiles;
create policy profiles_update_admin on public.profiles
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- ============================================================================
-- Auto-sync trigger: copy display name + email from auth.users into profiles
-- on every insert/update. This is what makes the Account page's
-- `auth.updateUser({ data: { full_name } })` flow trickle into profiles.
-- ============================================================================
create or replace function public.handle_auth_user_change()
returns trigger
language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  insert into public.profiles (id, full_name, email)
  values (
    new.id,
    new.raw_user_meta_data->>'full_name',
    new.email
  )
  on conflict (id) do update
    set full_name  = excluded.full_name,
        email      = excluded.email,
        updated_at = now();
  return new;
end;
$$;

drop trigger if exists on_auth_user_change on auth.users;
create trigger on_auth_user_change
  after insert or update of email, raw_user_meta_data on auth.users
  for each row execute function public.handle_auth_user_change();

-- ============================================================================
-- Backfill: make sure every existing auth user has a profile row.
-- ============================================================================
insert into public.profiles (id, full_name, email)
select id, raw_user_meta_data->>'full_name', email from auth.users
on conflict (id) do update
  set full_name = excluded.full_name,
      email     = excluded.email;

-- ============================================================================
-- updated_at trigger (reuse set_updated_at from earlier migration).
-- ============================================================================
drop trigger if exists trg_profiles_updated_at on public.profiles;
create trigger trg_profiles_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();
