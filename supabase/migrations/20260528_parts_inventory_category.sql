-- 2026-05-28 · parts_inventory.category
--
-- Powers the Stock On Hand report — the legacy WMS groups parts into
-- OIL and PRT buckets and prints sub-totals per category. Defaults to
-- 'PRT' so existing rows keep working; OIL rows are tagged manually
-- (or imported from the legacy XLS).
alter table public.parts_inventory
  add column if not exists category text not null default 'PRT'
  check (category in ('OIL', 'PRT'));

create index if not exists parts_inventory_category_idx
  on public.parts_inventory (category);
