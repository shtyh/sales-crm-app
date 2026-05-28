-- 2026-05-28 · Lock super_admin out of creating new bookings.
--
-- Super admin keeps god-mode for reads / updates / deletes, but
-- shouldn't be authoring customer bookings — sales_advisor and
-- sales_manager own that workflow. The frontend already redirects
-- super_admin off /bookings/new, but the DB policy was still allowing
-- the INSERT, which left a back door (open browser tab on an old
-- bundle, direct API calls, etc).

drop policy if exists bookings_insert on public.bookings;

create policy bookings_insert
  on public.bookings
  for insert
  to authenticated
  with check (
    public.current_app_role() = any (array[
      'sales_advisor'::public.app_role,
      'sales_manager'::public.app_role
    ])
    and owner_id = (select auth.uid())
  );
