-- 2026-05-26 — drop service_orders.department.
-- Added earlier today in 20260526_service_order_intake_fields.sql, but
-- the workshop team decided they don't need a department on the
-- intake form. No production data should exist on it yet (added and
-- removed within the same day).

alter table public.service_orders
  drop column if exists department;
