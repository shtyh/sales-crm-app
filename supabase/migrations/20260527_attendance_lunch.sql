-- 2026-05-27 — split the work day with lunch out / lunch in.
--
-- Same row per (profile_id, work_date); we just gain four optional
-- timestamps + lat/lng/distance for the lunch break.
--
-- All nullable so staff can skip lunch tracking and still check out
-- normally (some days the SA grabs lunch at the desk and never punches
-- out for it).

alter table public.attendance
  add column if not exists lunch_out_at         timestamptz,
  add column if not exists lunch_out_lat        numeric(9,6),
  add column if not exists lunch_out_lng        numeric(9,6),
  add column if not exists lunch_out_distance_m numeric(8,2),
  add column if not exists lunch_in_at          timestamptz,
  add column if not exists lunch_in_lat         numeric(9,6),
  add column if not exists lunch_in_lng         numeric(9,6),
  add column if not exists lunch_in_distance_m  numeric(8,2);

comment on column public.attendance.lunch_out_at is
  'When the employee left for lunch. Null = no lunch tracked today.';
comment on column public.attendance.lunch_in_at is
  'When the employee returned from lunch. Pairs with lunch_out_at.';
