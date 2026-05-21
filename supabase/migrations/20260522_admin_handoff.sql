-- ============================================================================
-- Workflow handoff between SA and Admin:
--   - SA fills the customer/vehicle/price half of a booking.
--   - Admin fills loan_bank + insurance_company, uploads the deposit receipt,
--     and moves status pending → confirmed.
-- This migration adds the two new fields, plus the RLS rules that let an
-- admin see / edit every booking (not just their own).
-- ============================================================================

alter table public.bookings add column if not exists loan_bank         text;
alter table public.bookings add column if not exists insurance_company text;

-- ----------------------------------------------------------------------------
-- Bookings — admin can SELECT and UPDATE every booking.
-- The existing "_own" policies stay; PostgreSQL OR-combines policies, so SAs
-- still see only their own.
-- ----------------------------------------------------------------------------
drop policy if exists bookings_select_admin on public.bookings;
create policy bookings_select_admin on public.bookings
  for select to authenticated
  using (public.is_admin());

drop policy if exists bookings_insert_admin on public.bookings;
create policy bookings_insert_admin on public.bookings
  for insert to authenticated
  with check (public.is_admin());

drop policy if exists bookings_update_admin on public.bookings;
create policy bookings_update_admin on public.bookings
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- (No admin DELETE — bookings are uncancellable, only cancellable by status.)

-- ----------------------------------------------------------------------------
-- Booking attachments — admin can read/write attachments on any booking.
-- ----------------------------------------------------------------------------
drop policy if exists ba_select_admin on public.booking_attachments;
create policy ba_select_admin on public.booking_attachments
  for select to authenticated
  using (public.is_admin());

drop policy if exists ba_insert_admin on public.booking_attachments;
create policy ba_insert_admin on public.booking_attachments
  for insert to authenticated
  with check (public.is_admin());

drop policy if exists ba_delete_admin on public.booking_attachments;
create policy ba_delete_admin on public.booking_attachments
  for delete to authenticated
  using (public.is_admin());

-- ----------------------------------------------------------------------------
-- Storage objects in the booking-files bucket — admin can read/write all.
-- ----------------------------------------------------------------------------
drop policy if exists bf_select_admin on storage.objects;
create policy bf_select_admin on storage.objects
  for select to authenticated
  using (bucket_id = 'booking-files' and public.is_admin());

drop policy if exists bf_insert_admin on storage.objects;
create policy bf_insert_admin on storage.objects
  for insert to authenticated
  with check (bucket_id = 'booking-files' and public.is_admin());

drop policy if exists bf_delete_admin on storage.objects;
create policy bf_delete_admin on storage.objects
  for delete to authenticated
  using (bucket_id = 'booking-files' and public.is_admin());
