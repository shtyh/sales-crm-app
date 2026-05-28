-- 2026-05-28 · Re-allow super_admin to author bookings.
--
-- Reverts 20260528_block_super_admin_booking_insert.sql at user request.
-- Super admin now gets the same INSERT surface as sales_advisor and
-- sales_manager (still subject to the per-row owner_id = auth.uid()
-- check so the booking is attributed to whoever is logged in).

drop policy if exists bookings_insert on public.bookings;

create policy bookings_insert
  on public.bookings
  for insert
  to authenticated
  with check (
    public.is_super_admin()
    or (
      public.current_app_role() = any (array[
        'sales_advisor'::public.app_role,
        'sales_manager'::public.app_role
      ])
      and owner_id = (select auth.uid())
    )
  );
