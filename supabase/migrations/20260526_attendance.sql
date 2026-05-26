-- 2026-05-26 — employee clock-in / clock-out attendance.
--
-- One row per employee per work day. Check-in is required (the row is
-- INSERTed at check-in time); check-out fields are filled by a later
-- UPDATE on the same row.
--
-- Geolocation is captured both ways so we can audit "where did Aichen
-- check in from?" — distance_m is the haversine result vs the office
-- coords, computed client-side at submit time.
--
-- RLS: each employee sees their own rows; is_admin sees everyone's
-- (drives the team-attendance dashboard); super_admin can delete.

create table if not exists public.attendance (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete restrict,

  -- Local date the work day starts on (Asia/Kuala_Lumpur). Pass from
  -- the FE rather than deriving from UTC check_in_at so jobs around
  -- midnight land on the right day.
  work_date date not null,

  -- Check-in (required at insert)
  check_in_at         timestamptz not null default now(),
  check_in_lat        numeric(9,6) not null,
  check_in_lng        numeric(9,6) not null,
  check_in_distance_m numeric(8,2) not null,

  -- Check-out (set later via UPDATE)
  check_out_at         timestamptz,
  check_out_lat        numeric(9,6),
  check_out_lng        numeric(9,6),
  check_out_distance_m numeric(8,2),

  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  -- One attendance row per employee per local day
  constraint attendance_unique_day unique (profile_id, work_date)
);

comment on table  public.attendance is 'Employee clock-in / clock-out per work day.';
comment on column public.attendance.work_date is
  'Calendar day in Asia/Kuala_Lumpur. FE-supplied so it doesn''t drift around UTC midnight.';
comment on column public.attendance.check_in_distance_m is
  'Haversine distance (metres) from the office at the moment of check-in.';

create index if not exists attendance_profile_idx on public.attendance(profile_id);
create index if not exists attendance_work_date_idx on public.attendance(work_date desc);

drop trigger if exists attendance_set_updated_at on public.attendance;
create trigger attendance_set_updated_at
before update on public.attendance
for each row execute function public.set_updated_at();

grant select, insert, update, delete on public.attendance to authenticated;
alter table public.attendance enable row level security;

-- SELECT: see your own; admins (is_admin = role != 'sales_advisor') see all.
drop policy if exists attendance_select on public.attendance;
create policy attendance_select on public.attendance
  for select to authenticated
  using (
    profile_id = auth.uid()
    or exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.is_admin = true
    )
  );

-- INSERT: only your own row.
drop policy if exists attendance_insert on public.attendance;
create policy attendance_insert on public.attendance
  for insert to authenticated
  with check (profile_id = auth.uid());

-- UPDATE: only your own row (used for check-out).
drop policy if exists attendance_update on public.attendance;
create policy attendance_update on public.attendance
  for update to authenticated
  using (profile_id = auth.uid())
  with check (profile_id = auth.uid());

-- DELETE: super_admin only (audit-trail-ish).
drop policy if exists attendance_delete on public.attendance;
create policy attendance_delete on public.attendance
  for delete to authenticated
  using (public.is_super_admin());
