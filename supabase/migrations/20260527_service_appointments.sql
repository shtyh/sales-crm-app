-- 2026-05-27 · service_appointments
--
-- Customer-facing booking page (/book) writes here. Workshop staff
-- (service_manager / service_advisor / super_admin) review the queue
-- at /service/appointments and confirm or reject. Confirmed
-- appointments freeze — the public /book/:token page renders read-only
-- after that, "locking the slot" for the customer.
--
-- Anon access goes through two SECURITY DEFINER RPCs so we never have
-- to open SELECT on the table itself to the anon role:
--   submit_appointment(...)       → creates a row, returns the token
--   get_appointment_by_token(uid) → returns just the row matching a token

-- ─── enums ─────────────────────────────────────────────────────────────
do $$ begin
  create type public.appointment_status as enum (
    'pending', 'confirmed', 'rejected', 'cancelled'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.appointment_period as enum ('am', 'pm');
exception when duplicate_object then null; end $$;

-- ─── table ─────────────────────────────────────────────────────────────
create table if not exists public.service_appointments (
  id              uuid primary key default gen_random_uuid(),
  token           uuid not null default gen_random_uuid() unique,

  customer_name   text not null check (length(trim(customer_name))  > 0),
  customer_phone  text not null check (length(trim(customer_phone)) > 0),
  customer_nric   text,
  customer_email  text,

  vehicle_reg     text not null check (length(trim(vehicle_reg))    > 0),
  vehicle_chassis text,
  vehicle_model   text,

  preferred_date   date not null,
  preferred_period public.appointment_period not null,
  complaint        text,

  status public.appointment_status not null default 'pending',
  service_order_id uuid references public.service_orders(id) on delete set null,

  confirmed_by   uuid references public.profiles(id) on delete set null,
  confirmed_at   timestamptz,
  rejected_reason text,

  submitted_by uuid references public.profiles(id) on delete set null,
  source       text not null default 'public'
               check (source in ('public', 'staff')),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists service_appointments_status_date_idx
  on public.service_appointments (status, preferred_date desc);

drop trigger if exists service_appointments_set_updated_at
  on public.service_appointments;
create trigger service_appointments_set_updated_at
before update on public.service_appointments
for each row execute function public.set_updated_at();

-- ─── grants + RLS ──────────────────────────────────────────────────────
grant select, update, delete on public.service_appointments to authenticated;
-- anon never touches the table directly; everything goes through RPCs.

alter table public.service_appointments enable row level security;

drop policy if exists service_appointments_select on public.service_appointments;
create policy service_appointments_select
  on public.service_appointments for select to authenticated
  using (
    public.is_super_admin()
    or public.current_app_role() in (
      'service_manager', 'service_advisor', 'store_keeper', 'mechanic'
    )
  );

-- Confirm / reject is the workshop's job — service_manager / service_advisor
-- + super_admin. Mechanic / store_keeper can read but not modify.
drop policy if exists service_appointments_update on public.service_appointments;
create policy service_appointments_update
  on public.service_appointments for update to authenticated
  using       (public.is_super_admin() or public.current_app_role() in ('service_manager', 'service_advisor'))
  with check  (public.is_super_admin() or public.current_app_role() in ('service_manager', 'service_advisor'));

drop policy if exists service_appointments_delete on public.service_appointments;
create policy service_appointments_delete
  on public.service_appointments for delete to authenticated
  using (public.is_super_admin());

-- Staff-initiated inserts (e.g. the /service/book page) still go through
-- the RPC so the same validation runs for both paths.

-- ─── RPC: anonymous submit ─────────────────────────────────────────────
create or replace function public.submit_appointment(
  p_customer_name   text,
  p_customer_phone  text,
  p_customer_nric   text,
  p_customer_email  text,
  p_vehicle_reg     text,
  p_vehicle_chassis text,
  p_vehicle_model   text,
  p_preferred_date  date,
  p_preferred_period public.appointment_period,
  p_complaint       text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_token uuid;
  v_caller uuid;
  v_source text;
begin
  v_caller := auth.uid();
  v_source := case when v_caller is null then 'public' else 'staff' end;

  if coalesce(trim(p_customer_name),  '') = '' then raise exception 'name required';     end if;
  if coalesce(trim(p_customer_phone), '') = '' then raise exception 'phone required';    end if;
  if coalesce(trim(p_vehicle_reg),    '') = '' then raise exception 'vehicle reg required'; end if;
  if p_preferred_date is null  then raise exception 'preferred date required'; end if;
  if p_preferred_date < current_date then raise exception 'preferred date must not be in the past'; end if;

  insert into public.service_appointments (
    customer_name, customer_phone, customer_nric, customer_email,
    vehicle_reg, vehicle_chassis, vehicle_model,
    preferred_date, preferred_period, complaint,
    submitted_by, source
  ) values (
    trim(p_customer_name), trim(p_customer_phone),
    nullif(trim(coalesce(p_customer_nric,  '')), ''),
    nullif(trim(coalesce(p_customer_email, '')), ''),
    trim(p_vehicle_reg),
    nullif(trim(coalesce(p_vehicle_chassis, '')), ''),
    nullif(trim(coalesce(p_vehicle_model,   '')), ''),
    p_preferred_date, p_preferred_period,
    nullif(trim(coalesce(p_complaint, '')), ''),
    v_caller, v_source
  ) returning token into v_token;

  return v_token;
end;
$$;

revoke all on function public.submit_appointment(text, text, text, text, text, text, text, date, public.appointment_period, text) from public;
grant execute on function public.submit_appointment(text, text, text, text, text, text, text, date, public.appointment_period, text) to anon, authenticated;

-- ─── RPC: anonymous token lookup ───────────────────────────────────────
create or replace function public.get_appointment_by_token(p_token uuid)
returns table (
  id              uuid,
  token           uuid,
  customer_name   text,
  customer_phone  text,
  customer_email  text,
  vehicle_reg     text,
  vehicle_chassis text,
  vehicle_model   text,
  preferred_date  date,
  preferred_period public.appointment_period,
  complaint        text,
  status           public.appointment_status,
  confirmed_at     timestamptz,
  rejected_reason  text,
  created_at       timestamptz
)
language sql
security definer
set search_path = public
as $$
  select
    id, token, customer_name, customer_phone, customer_email,
    vehicle_reg, vehicle_chassis, vehicle_model,
    preferred_date, preferred_period, complaint,
    status, confirmed_at, rejected_reason, created_at
  from public.service_appointments
  where token = p_token;
$$;

revoke all on function public.get_appointment_by_token(uuid) from public;
grant execute on function public.get_appointment_by_token(uuid) to anon, authenticated;
