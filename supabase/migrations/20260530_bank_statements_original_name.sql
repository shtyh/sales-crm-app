-- Remember the operator's original file name so the Reconciliation page can
-- show "what file was uploaded" (the stored object is just {timestamp}.pdf).
alter table public.bank_statements
  add column if not exists original_name text;
