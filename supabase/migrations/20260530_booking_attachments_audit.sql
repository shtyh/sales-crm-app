-- Audit document uploads/removals so they appear in the booking Activity log.
-- Reuses the generic write_audit_log() trigger fn; the audit row's `changed`
-- (INSERT) / `old_values` (DELETE) jsonb carries booking_id + kind + file_path,
-- which the Activity panel filters on to show attachments under their booking.
drop trigger if exists trg_booking_attachments_audit on public.booking_attachments;
create trigger trg_booking_attachments_audit
  after insert or update or delete on public.booking_attachments
  for each row execute function public.write_audit_log();
