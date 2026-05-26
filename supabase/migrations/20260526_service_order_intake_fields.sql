-- 2026-05-26 — extend service_orders with the intake fields the legacy
-- WMS job-sheet dialog has but our schema didn't.
--
-- WHY
-- ---
-- The new Job Sheet form needs Department, Service-type checkboxes,
-- Appointment type, and a Days-to-complete estimate. Previously these
-- weren't tracked at all; the dashboard had nowhere to bucket on them.
--
-- COLUMNS
-- -------
--   department          text             — workshop unit / area (free text)
--   service_types       text[] not null  — checkbox set: maintenance,
--                                          int_g_repair, warranty_service,
--                                          service_coupon, come_back_job,
--                                          body_repair, inspection
--   appointment_type    text             — 'walk_in' (default) or 'by_appointment'
--   days_to_complete    integer          — SA's estimate, in days
--
-- Phase-1 permissive RLS on service_orders already lets any
-- authenticated user write, so no policy / guard changes are needed for
-- these columns.

alter table public.service_orders
  add column if not exists department        text,
  add column if not exists service_types     text[] not null default '{}',
  add column if not exists appointment_type  text not null default 'walk_in',
  add column if not exists days_to_complete  integer;

comment on column public.service_orders.department is
  'Workshop department / area the job is routed to (free text).';
comment on column public.service_orders.service_types is
  'Set of work-type tags ticked at intake: maintenance, int_g_repair, '
  'warranty_service, service_coupon, come_back_job, body_repair, inspection.';
comment on column public.service_orders.appointment_type is
  'walk_in (default) or by_appointment. Drives reporting on appt vs walk-in mix.';
comment on column public.service_orders.days_to_complete is
  'Service advisor''s estimate at intake, in calendar days.';

-- Loose CHECKs — keep enum-like values consistent without committing to
-- a real Postgres enum (cheaper to add new categories later).
alter table public.service_orders
  drop constraint if exists service_orders_appointment_type_chk;
alter table public.service_orders
  add  constraint service_orders_appointment_type_chk
       check (appointment_type in ('walk_in', 'by_appointment'));
