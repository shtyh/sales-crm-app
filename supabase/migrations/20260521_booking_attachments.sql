-- ============================================================================
-- Booking attachments — per-booking file uploads (bank slips, LOU, etc.)
-- Run this whole file in Supabase Dashboard → SQL Editor → New query → Run.
-- ============================================================================

-- ---------- Attachment kind enum ------------------------------------------
do $$ begin
  create type public.attachment_kind as enum (
    'bank_transaction',
    'bank_statement',
    'lou',
    'cancellation_form',
    'other'
  );
exception when duplicate_object then null; end $$;

-- If the type already existed with fewer values (earlier migration), top up.
alter type public.attachment_kind add value if not exists 'bank_statement';
alter type public.attachment_kind add value if not exists 'cancellation_form';

-- ---------- booking_attachments table -------------------------------------
create table if not exists public.booking_attachments (
  id           uuid primary key default gen_random_uuid(),
  booking_id   uuid not null references public.bookings(id) on delete cascade,
  kind         public.attachment_kind not null,
  file_path    text not null,                     -- path inside the storage bucket
  file_name    text not null,                     -- original filename for display
  mime_type    text,
  size_bytes   bigint,
  uploaded_by  uuid references auth.users(id) on delete set null
                 default auth.uid(),
  uploaded_at  timestamptz not null default now()
);

create index if not exists booking_attachments_booking_idx
  on public.booking_attachments(booking_id);
create index if not exists booking_attachments_kind_idx
  on public.booking_attachments(booking_id, kind);

grant usage on schema public to authenticated;
grant usage on type public.attachment_kind to authenticated;
grant select, insert, delete on public.booking_attachments to authenticated;

alter table public.booking_attachments enable row level security;

-- A user can read/write attachment rows whose parent booking they own.
drop policy if exists ba_select_own on public.booking_attachments;
create policy ba_select_own on public.booking_attachments
  for select to authenticated
  using (
    booking_id in (
      select id from public.bookings where owner_id = (select auth.uid())
    )
  );

drop policy if exists ba_insert_own on public.booking_attachments;
create policy ba_insert_own on public.booking_attachments
  for insert to authenticated
  with check (
    booking_id in (
      select id from public.bookings where owner_id = (select auth.uid())
    )
  );

drop policy if exists ba_delete_own on public.booking_attachments;
create policy ba_delete_own on public.booking_attachments
  for delete to authenticated
  using (
    booking_id in (
      select id from public.bookings where owner_id = (select auth.uid())
    )
  );

-- ============================================================================
-- Storage bucket: private, 10 MB max, images + PDF only.
-- ============================================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'booking-files',
  'booking-files',
  false,
  10485760,  -- 10 MB
  array['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
)
on conflict (id) do update
  set file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types,
      public = excluded.public;

-- Storage policies: object name has shape `<booking_id>/<kind>/<filename>`.
-- We check that the first path segment matches a booking owned by the user.

drop policy if exists bf_select_own on storage.objects;
create policy bf_select_own on storage.objects
  for select to authenticated
  using (
    bucket_id = 'booking-files'
    and split_part(name, '/', 1) in (
      select id::text from public.bookings where owner_id = (select auth.uid())
    )
  );

drop policy if exists bf_insert_own on storage.objects;
create policy bf_insert_own on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'booking-files'
    and split_part(name, '/', 1) in (
      select id::text from public.bookings where owner_id = (select auth.uid())
    )
  );

drop policy if exists bf_delete_own on storage.objects;
create policy bf_delete_own on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'booking-files'
    and split_part(name, '/', 1) in (
      select id::text from public.bookings where owner_id = (select auth.uid())
    )
  );
