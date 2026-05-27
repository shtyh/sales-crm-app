-- 2026-05-27 — Individual vs Company customers + booking-fee payment
-- channel + official receipt number.
--
-- WHY
-- ---
-- Many bookings come in under a company name (workshops, fleet operators,
-- corporates) where the 12-digit "NRIC" field is actually the SSM /
-- business registration number. We need a flag to know which it is so
-- the booking form can re-label the field appropriately. We also need
-- to record how the booking deposit was paid (cash / QR / transfer)
-- and the OR number for the customer's receipt.

alter table public.customers
  add column if not exists customer_type text not null default 'individual';

alter table public.customers
  drop constraint if exists customers_customer_type_chk;
alter table public.customers
  add  constraint customers_customer_type_chk
       check (customer_type in ('individual', 'company'));

comment on column public.customers.customer_type is
  'individual (default) or company. When company, customers.nric stores '
  'the SSM / business registration number instead of an IC.';

alter table public.bookings
  add column if not exists booking_fee_method  text,
  add column if not exists official_receipt_no text;

alter table public.bookings
  drop constraint if exists bookings_booking_fee_method_chk;
alter table public.bookings
  add  constraint bookings_booking_fee_method_chk
       check (booking_fee_method is null
              or booking_fee_method in ('cash', 'qr', 'transfer'));

comment on column public.bookings.booking_fee_method is
  'How the booking deposit was received: cash / qr / transfer. Null until '
  'finance confirms receipt.';
comment on column public.bookings.official_receipt_no is
  'Official receipt number issued for the booking fee. Free text.';
