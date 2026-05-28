-- 2026-05-28 · bookings.vehicle_color → text[]
--
-- Customers often pick one of two/three colour preferences ("red or
-- white, whichever you have in stock"). Switch bookings.vehicle_color
-- from text to text[]; existing rows become 1-element arrays so the
-- display layer keeps working.

alter table public.bookings
  alter column vehicle_color type text[]
  using case
    when vehicle_color is null then null
    when length(trim(vehicle_color)) = 0 then null
    else array[vehicle_color]
  end;
