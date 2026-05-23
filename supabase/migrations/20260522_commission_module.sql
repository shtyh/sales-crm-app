-- ============================================================================
-- Commission module
--
-- New objects:
--   commission_schedules     — super_admin maintains base commission per
--                              (vehicle_model, vehicle_variant)
--   commission_payouts       — sales_manager creates a batch per half-month
--                              payout; each batch references multiple bookings
--   bookings.base_commission       — snapshot from schedule on insert
--   bookings.commission_amount     — auto = greatest(0, base - discount)
--   bookings.commission_status     — not_eligible / pending / approved /
--                                    rejected / paid
--   bookings.commission_payout_id  — set when SM marks a payout
--
-- Workflow:
--   1. Booking inserted → trigger snapshots base_commission via schedule
--      lookup (model+variant); commission_amount = greatest(0, base - discount).
--      commission_status starts at 'not_eligible'.
--   2. discount changes → commission_amount recomputed automatically.
--   3. status=delivered AND payment_status=paid → commission_status flips
--      'not_eligible' → 'pending' automatically, UNLESS the booking owner is
--      a sales_manager — then jump straight to 'approved' (trust mode).
--   4. sales_manager (+ super_admin) flips approved/rejected manually.
--   5. SM creates a commission_payouts row and links bookings to it; those
--      bookings get commission_status='paid' and commission_payout_id set.
-- ============================================================================

do $$ begin
  create type public.commission_status as enum (
    'not_eligible', 'pending', 'approved', 'rejected', 'paid'
  );
exception when duplicate_object then null; end $$;
grant usage on type public.commission_status to authenticated;

create table if not exists public.commission_schedules (
  id              uuid primary key default gen_random_uuid(),
  model           text not null,
  variant         text,
  base_commission numeric(10,2) not null check (base_commission >= 0),
  notes           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create unique index if not exists commission_schedules_model_variant_idx
  on public.commission_schedules(model, variant)
  where variant is not null;
create unique index if not exists commission_schedules_model_null_variant_idx
  on public.commission_schedules(model)
  where variant is null;

drop trigger if exists trg_commission_schedules_updated_at on public.commission_schedules;
create trigger trg_commission_schedules_updated_at
  before update on public.commission_schedules
  for each row execute function public.set_updated_at();

grant select, insert, update, delete on public.commission_schedules to authenticated;
alter table public.commission_schedules enable row level security;

drop policy if exists commission_schedules_select on public.commission_schedules;
create policy commission_schedules_select on public.commission_schedules
  for select to authenticated using (true);

drop policy if exists commission_schedules_write on public.commission_schedules;
create policy commission_schedules_write on public.commission_schedules
  for all to authenticated
  using (public.is_super_admin())
  with check (public.is_super_admin());

create table if not exists public.commission_payouts (
  id              uuid primary key default gen_random_uuid(),
  label           text not null,
  paid_at         date not null,
  paid_by         uuid references auth.users(id) on delete set null,
  notes           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists commission_payouts_paid_at_idx
  on public.commission_payouts(paid_at desc);

drop trigger if exists trg_commission_payouts_updated_at on public.commission_payouts;
create trigger trg_commission_payouts_updated_at
  before update on public.commission_payouts
  for each row execute function public.set_updated_at();

grant select, insert, update, delete on public.commission_payouts to authenticated;
alter table public.commission_payouts enable row level security;

drop policy if exists commission_payouts_select on public.commission_payouts;
create policy commission_payouts_select on public.commission_payouts
  for select to authenticated
  using (
    public.is_super_admin()
    or public.current_app_role() in ('sales_manager','general_admin','finance_admin')
  );

drop policy if exists commission_payouts_write on public.commission_payouts;
create policy commission_payouts_write on public.commission_payouts
  for all to authenticated
  using (
    public.is_super_admin()
    or public.current_app_role() = 'sales_manager'
  )
  with check (
    public.is_super_admin()
    or public.current_app_role() = 'sales_manager'
  );

alter table public.bookings
  add column if not exists base_commission numeric(10,2);
alter table public.bookings
  add column if not exists commission_amount numeric(10,2)
    check (commission_amount is null or commission_amount >= 0);
alter table public.bookings
  add column if not exists commission_status public.commission_status
    not null default 'not_eligible';
alter table public.bookings
  add column if not exists commission_payout_id uuid
    references public.commission_payouts(id) on delete set null;

create index if not exists bookings_commission_status_idx
  on public.bookings(commission_status)
  where commission_status in ('pending', 'approved');
create index if not exists bookings_commission_payout_idx
  on public.bookings(commission_payout_id)
  where commission_payout_id is not null;

create or replace function public.lookup_base_commission(
  in_model text,
  in_variant text
)
returns numeric
language sql stable security definer set search_path = public, pg_temp
as $$
  select base_commission from public.commission_schedules
   where model = in_model and variant is not distinct from in_variant
   limit 1
$$;
revoke execute on function public.lookup_base_commission(text, text) from anon, authenticated, public;

create or replace function public.role_of(target uuid)
returns public.app_role
language sql stable security definer set search_path = public, pg_temp
as $$
  select role from public.profiles where id = target
$$;
revoke execute on function public.role_of(uuid) from anon, authenticated, public;

create or replace function public.guard_booking_field_writes()
returns trigger
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  caller public.app_role := public.current_app_role();
  client_set_approval boolean;
  client_set_commission_status boolean;
  client_set_commission_amount boolean;
  client_set_base_commission boolean;
  client_set_payout boolean;
  car_fss public.floor_stock_status;
  owner_role public.app_role;
begin
  if TG_OP = 'INSERT' then
    if new.discount_amount is null or new.discount_amount = 0 then
      new.approval_status := 'not_required';
    elsif caller in ('super_admin','sales_manager','general_admin','finance_admin') then
      new.approval_status := 'approved';
    else
      new.approval_status := 'pending';
    end if;

    new.base_commission := public.lookup_base_commission(
      new.vehicle_model, nullif(new.vehicle_variant, '')
    );
    if new.base_commission is not null then
      new.commission_amount := greatest(
        0, new.base_commission - coalesce(new.discount_amount, 0)
      );
    else
      new.commission_amount := null;
    end if;
    return new;
  end if;

  client_set_approval          := new.approval_status   is distinct from old.approval_status;
  client_set_commission_status := new.commission_status is distinct from old.commission_status;
  client_set_commission_amount := new.commission_amount is distinct from old.commission_amount;
  client_set_base_commission   := new.base_commission   is distinct from old.base_commission;
  client_set_payout            := new.commission_payout_id is distinct from old.commission_payout_id;

  if caller <> 'super_admin' then
    if client_set_approval and caller is distinct from 'sales_manager' then
      raise exception 'Only sales_manager can change discount approval status'
        using errcode = '42501', hint = format('your role: %s', caller);
    end if;

    if (client_set_commission_status or client_set_payout)
       and caller is distinct from 'sales_manager' then
      raise exception 'Only sales_manager can change commission status or payout'
        using errcode = '42501', hint = format('your role: %s', caller);
    end if;

    if client_set_base_commission then
      raise exception 'base_commission is system-managed; only super_admin can override'
        using errcode = '42501';
    end if;

    if client_set_commission_amount and caller is distinct from 'sales_manager' then
      raise exception 'Only sales_manager can adjust commission_amount'
        using errcode = '42501';
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
       and caller is distinct from 'finance_admin' then
      raise exception 'Only finance_admin can change deposit/payment status'
        using errcode = '42501', hint = format('your role: %s', caller);
    end if;

    if new.status = 'cancelled' and old.status is distinct from 'cancelled'
       and caller is distinct from 'sales_manager' then
      raise exception 'Only sales_manager can cancel a booking'
        using errcode = '42501', hint = format('your role: %s', caller);
    end if;
  end if;

  if not client_set_commission_amount
     and new.discount_amount is distinct from old.discount_amount
     and new.base_commission is not null then
    new.commission_amount := greatest(
      0, new.base_commission - coalesce(new.discount_amount, 0)
    );
  end if;

  if not client_set_commission_status then
    if new.status = 'delivered' and new.payment_status = 'paid' then
      if old.commission_status = 'not_eligible' then
        owner_role := public.role_of(new.owner_id);
        if owner_role = 'sales_manager' then
          new.commission_status := 'approved';
        else
          new.commission_status := 'pending';
        end if;
      end if;
    else
      if old.commission_status = 'pending' then
        new.commission_status := 'not_eligible';
      end if;
    end if;
  end if;

  if new.status = 'delivered' and old.status is distinct from 'delivered' then
    if new.car_id is null then
      raise exception 'Cannot deliver a booking without a linked car'
        using errcode = '42501';
    end if;
    select floor_stock_status into car_fss
      from public.cars where id = new.car_id;
    if car_fss is distinct from 'paid_off' then
      raise exception
        'Car is still %; finance must mark it paid_off before delivery',
        car_fss
        using errcode = '42501';
    end if;
  end if;

  return new;
end;
$$;
