-- ============================================================================
-- Loan status — what the bank said about the customer's loan application.
-- SA updates this after following up with the bank.
-- ============================================================================

do $$ begin
  create type public.loan_status as enum (
    'not_applicable',  -- cash deal, or no loan needed
    'pending',         -- application submitted, waiting on bank
    'approved',        -- bank approved — admin can proceed to JPJ
    'rejected'         -- bank rejected — SA needs to switch bank
  );
exception when duplicate_object then null; end $$;

alter table public.bookings
  add column if not exists loan_status public.loan_status
    not null default 'not_applicable';

alter table public.bookings
  add column if not exists loan_notes text;

grant usage on type public.loan_status to authenticated;

-- No new RLS needed: existing "_own" + "_admin" policies cover this field.
-- No trigger needed: both SA and admin should be able to update loan_status.
