-- 2026-05-27 · Drop chassis from the booking flow.
--
-- User clarified that "chassis no need" meant "remove the chassis
-- field". The column stays on the table for legacy rows, but the
-- public / staff booking form no longer collects it. RPC signature
-- drops the p_vehicle_chassis parameter; new rows always insert NULL.

drop function if exists public.submit_appointment(
  text, text, text, text, text, text,
  date, time, int, text, boolean
);

create or replace function public.submit_appointment(
  p_customer_name   text,
  p_customer_phone  text,
  p_customer_email  text,
  p_vehicle_reg     text,
  p_vehicle_model   text,
  p_preferred_date  date,
  p_slot_time       time,
  p_service_mileage int,
  p_complaint       text,
  p_phone_block     boolean default false
)
returns uuid
language plpgsql security definer
set search_path = public
as $$
declare
  v_token uuid;
  v_caller uuid;
  v_source text;
  v_status public.appointment_status;
  v_caller_role public.app_role;
  v_taken int;
  v_capacity int := 2;
  v_valid_slots time[] := array[
    '09:00','10:00','11:00','12:00','13:00','14:00','15:00','16:00'
  ]::time[];
begin
  v_caller := auth.uid();

  if coalesce(trim(p_customer_name),  '') = '' then raise exception 'name required'; end if;
  if coalesce(trim(p_customer_phone), '') = '' then raise exception 'phone required'; end if;
  if coalesce(trim(p_customer_email), '') = '' then raise exception 'email required'; end if;
  if coalesce(trim(p_vehicle_reg),    '') = '' then raise exception 'vehicle reg required'; end if;
  if coalesce(trim(p_vehicle_model),  '') = '' then raise exception 'vehicle model required'; end if;
  if p_service_mileage is null or p_service_mileage <= 0 then raise exception 'service mileage required'; end if;
  if p_preferred_date is null then raise exception 'preferred date required'; end if;
  if p_preferred_date < current_date then raise exception 'preferred date must not be in the past'; end if;
  if p_slot_time is null then raise exception 'slot time required'; end if;
  if not (p_slot_time = any(v_valid_slots)) then raise exception 'invalid slot time'; end if;
  if extract(dow from p_preferred_date) = 0 then raise exception 'workshop is closed on Sunday'; end if;

  if v_caller is null then
    if p_phone_block then raise exception 'authentication required for phone block'; end if;
    v_source := 'public';
    v_status := 'pending';
  else
    select role into v_caller_role from public.profiles where id = v_caller;
    if p_phone_block then
      if v_caller_role not in ('service_manager', 'service_advisor', 'super_admin') then
        raise exception 'only service advisor / manager / super admin can phone-block';
      end if;
      v_source := 'phone';
      v_status := 'confirmed';
    else
      v_source := 'staff';
      v_status := 'pending';
    end if;
  end if;

  select count(*) into v_taken
  from public.service_appointments
  where preferred_date = p_preferred_date
    and slot_time = p_slot_time
    and status in ('pending', 'confirmed');

  if v_taken >= v_capacity then
    raise exception 'this slot is full — please pick another';
  end if;

  insert into public.service_appointments (
    customer_name, customer_phone, customer_email,
    vehicle_reg, vehicle_model,
    preferred_date, slot_time, preferred_period,
    service_mileage, complaint,
    status, source, submitted_by, confirmed_at, confirmed_by
  ) values (
    trim(p_customer_name), trim(p_customer_phone),
    trim(p_customer_email),
    trim(p_vehicle_reg),
    trim(p_vehicle_model),
    p_preferred_date, p_slot_time,
    case when p_slot_time < '12:00'::time then 'am' else 'pm' end::public.appointment_period,
    p_service_mileage,
    nullif(trim(coalesce(p_complaint, '')), ''),
    v_status, v_source, v_caller,
    case when p_phone_block then now() else null end,
    case when p_phone_block then v_caller else null end
  ) returning token into v_token;

  return v_token;
end;
$$;
revoke all on function public.submit_appointment(text, text, text, text, text, date, time, int, text, boolean) from public;
grant execute on function public.submit_appointment(text, text, text, text, text, date, time, int, text, boolean) to anon, authenticated;
