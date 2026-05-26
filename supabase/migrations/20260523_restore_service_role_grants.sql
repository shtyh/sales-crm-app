-- 2026-05-23 — restore the default service_role GRANTs on public tables.
--
-- The earlier perf/security hardening migration revoked CRUD from
-- service_role across the board. That's the wrong threat model:
-- service_role's whole purpose is server-side privileged access (e.g.
-- Edge Functions). It already bypasses RLS; revoking column GRANTs just
-- means anything written against the service key gets "permission denied
-- for table X" — which is exactly what the new telegram-bot edge function
-- hit when reading `cars`.
--
-- Restoring Supabase's stock posture: full CRUD on every public table for
-- service_role, plus default-privileges so future tables inherit it.

grant select, insert, update, delete on all tables in schema public
  to service_role;

grant usage, select on all sequences in schema public to service_role;

alter default privileges in schema public
  grant select, insert, update, delete on tables to service_role;

alter default privileges in schema public
  grant usage, select on sequences to service_role;
