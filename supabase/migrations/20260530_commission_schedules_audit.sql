-- Audit every add / edit / delete on commission_schedules.
-- Reuses the generic public.write_audit_log() trigger fn already attached
-- to bookings + cars (it keys off TG_TABLE_NAME + new.id/old.id). audit_log
-- SELECT stays super_admin-only via existing RLS, so this change history is
-- visible only to super_admin — the only role that can edit this table.
drop trigger if exists trg_commission_schedules_audit on public.commission_schedules;

create trigger trg_commission_schedules_audit
  after insert or update or delete on public.commission_schedules
  for each row execute function public.write_audit_log();
