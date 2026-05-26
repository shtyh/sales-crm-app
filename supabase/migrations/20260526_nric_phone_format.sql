-- 2026-05-26 — enforce NRIC = 12 digits and phone = 10–11 digits.
--
-- WHY
-- ---
-- The user wants the booking + customer forms to reject malformed
-- contact data instead of letting "0124117726-x" or "97062407" through.
-- Frontend HTML5 validation handles the friendly error; these CHECK
-- constraints are the belt-and-braces backstop so direct SQL / API
-- writes (e.g. the Telegram bot, future imports) can't bypass it.
--
-- EXISTING DATA
-- -------------
-- One customer (Eric demo, NRIC '567839926' = 9 digits) is non-conforming.
-- Both phones in the table already match the new rule.
--
-- We therefore add NRIC checks as NOT VALID — they apply to every
-- INSERT/UPDATE from this migration onwards but skip a one-time scan over
-- existing rows. The legacy customer can be fixed via the normal UI; once
-- it's clean, a follow-up `ALTER … VALIDATE CONSTRAINT` would promote the
-- check to fully enforced.

-- Customers ----------------------------------------------------------------
alter table public.customers
  add constraint customers_nric_format
  check (nric ~ '^[0-9]{12}$') not valid;

alter table public.customers
  add constraint customers_phone_format
  check (phone ~ '^[0-9]{10,11}$');

-- Bookings snapshot --------------------------------------------------------
-- The bookings.customer_* columns are still written (snapshot at booking
-- time). Same shape rules apply.
alter table public.bookings
  add constraint bookings_customer_nric_format
  check (customer_nric ~ '^[0-9]{12}$') not valid;

alter table public.bookings
  add constraint bookings_customer_phone_format
  check (customer_phone ~ '^[0-9]{10,11}$');
