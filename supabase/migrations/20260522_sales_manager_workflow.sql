-- ============================================================================
-- Sales Manager workflow + financial state tracking
--
-- bookings now carries:
--   discount_amount  numeric — MYR off OTR
--   approval_status  enum    — gates the discount; SA-set non-zero → pending;
--                              manager/admin-set → auto-approved (mode A);
--                              sales_manager flips it via Approve/Reject
--   deposit_status   enum    — finance_admin + accountant + super_admin only
--   payment_status   enum    — same gating as deposit
--
-- sales_manager also gains owner_id reassignment ("重新分配客户线索").
--
-- Per-SA discount_quota is intentionally deferred. For now the trigger
-- treats ANY non-zero SA-set discount as needing approval. When quotas
-- are added, the only change is to compare new.discount_amount to a
-- profile.discount_quota lookup inside the trigger.
-- ============================================================================

do $$ begin
  create type public.approval_status as enum (
    'not_required', 'pending', 'approved', 'rejected'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.deposit_status as enum (
    'unpaid', 'received', 'refunded'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.payment_status as enum (
    'unpaid', 'partial', 'paid'
  );
exception when duplicate_object then null; end $$;

grant usage on type public.approval_status to authenticated;
grant usage on type public.deposit_status  to authenticated;
grant usage on type public.payment_status  to authenticated;

alter table public.bookings
  add column if not exists discount_amount numeric(10,2) not null default 0
    check (discount_amount >= 0);

alter table public.bookings
  add column if not exists approval_status public.approval_status
    not null default 'not_required';

alter table public.bookings
  add column if not exists deposit_status public.deposit_status
    not null default 'unpaid';

alter table public.bookings
  add column if not exists payment_status public.payment_status
    not null default 'unpaid';

create index if not exists bookings_approval_pending_idx
  on public.bookings(approval_status)
  where approval_status = 'pending';

-- ============================================================================
-- Guard trigger: fires on INSERT (to compute initial approval_status) and on
-- UPDATE (every per-field guard including discount, owner reassignment,
-- finance fields, deposit/payment, and cancel).
-- ============================================================================

create or replace function public.guard_booking_field_writes()
returns trigger
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  caller public.app_role := public.current_app_role();
  client_set_approval boolean;
begin
  if TG_OP = 'INSERT' then
    if new.discount_amount is null or new.discount_amount = 0 then
      new.approval_status := 'not_required';
    elsif caller in ('super_admin','sales_manager','general_admin','finance_admin') then
      new.approval_status := 'approved';
    else
      new.approval_status := 'pending';
    end if;
    return new;
  end if;

  if caller = 'super_admin' then return new; end if;

  client_set_approval := new.approval_status is distinct from old.approval_status;

  if client_set_approval and caller is distinct from 'sales_manager' then
    raise exception 'Only sales_manager can change discount approval status'
      using errcode = '42501', hint = format('your role: %s', caller);
  end if;

  if not client_set_approval
     and new.discount_amount is distinct from old.discount_amount then
    if new.discount_amount = 0 then
      new.approval_status := 'not_required';
    elsif caller in ('sales_manager','general_admin','finance_admin') then
      new.approval_status := 'approved';
    elsif caller = 'sales_advisor' then
      new.approval_status := 'pending';
    end if;
  end if;

  if new.owner_id is distinct from old.owner_id
     and caller is distinct from 'sales_manager' then
    raise exception 'Only sales_manager can reassign a booking to another owner'
      using errcode = '42501', hint = format('your role: %s', caller);
  end if;

  if (new.loan_bank is distinct from old.loan_bank
      or new.insurance_company is distinct from old.insurance_company
      or new.loan_status is distinct from old.loan_status
      or new.loan_notes is distinct from old.loan_notes)
     and caller is distinct from 'finance_admin' then
    raise exception 'Only finance_admin can change loan or insurance fields'
      using errcode = '42501', hint = format('your role: %s', caller);
  end if;

  if (new.deposit_status is distinct from old.deposit_status
      or new.payment_status is distinct from old.payment_status)
     and caller not in ('finance_admin','accountant') then
    raise exception 'Only finance_admin or accountant can change deposit/payment status'
      using errcode = '42501', hint = format('your role: %s', caller);
  end if;

  if new.status = 'cancelled' and old.status is distinct from 'cancelled'
     and caller not in ('sales_manager','accountant') then
    raise exception 'Only sales_manager or accountant can cancel a booking'
      using errcode = '42501', hint = format('your role: %s', caller);
  end if;

  return new;
end;
$$;

revoke execute on function public.guard_booking_field_writes() from anon, authenticated, public;

drop trigger if exists trg_bookings_guard on public.bookings;
create trigger trg_bookings_guard
  before insert or update on public.bookings
  for each row execute function public.guard_booking_field_writes();
