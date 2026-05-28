-- 2026-05-27 — clear the high-signal Supabase security linter warnings.
--
-- Three classes of fix:
--   1. Pin `search_path` on `generate_service_order_no` so a malicious
--      `search_path` can't shadow `public` when the function is called
--      from another SECURITY DEFINER trigger.
--   2. Revoke EXECUTE from `anon` (and the default `public` grant) on
--      internal RLS helpers — they were unintentionally exposed at
--      `/rest/v1/rpc/*` because their ACL was null (Postgres defaults to
--      PUBLIC). They stay callable by `authenticated` so the RLS
--      policies that invoke them still work.
--   3. Drop EXECUTE entirely on `rls_auto_enable` — one-off scaffolding
--      helper, no runtime caller.
--
-- Intentionally-public RPCs (submit_appointment / get_appointment_by_token
-- / get_available_slots) are NOT touched — those drive the customer
-- booking flow at /book and must remain anon-callable.

-- 1. search_path pin
alter function public.generate_service_order_no()
  set search_path = public, pg_temp;

-- 2. Lock internal helpers to `authenticated`-only
revoke execute on function public.can_read_service_order(uuid)
  from anon, public;
grant  execute on function public.can_read_service_order(uuid)
  to   authenticated;

revoke execute on function public.can_write_service_order(uuid)
  from anon, public;
grant  execute on function public.can_write_service_order(uuid)
  to   authenticated;

-- 3. Strip every caller from the scaffolding helper
revoke execute on function public.rls_auto_enable()
  from anon, public, authenticated;
