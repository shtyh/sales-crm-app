# SWL Motors CRM — context for Claude Code

> Drop-in context so a fresh Claude Code session can resume work without
> needing to re-explore the codebase. Keep this updated as architecture
> decisions land.

## What this is

A car-sale CRM for a Proton showroom (Malaysia). Sales advisors take
customer bookings; admins / finance / sales managers shepherd them through
deposit → loan approval → delivery → commission payout. Built as a Vite +
React 19 SPA on Vercel, with all data + auth + storage on Supabase.

## Stack + external services

- **Vite 8** + **React 19** + **react-router-dom 7** + **@tanstack/react-query**
- **Tailwind CSS v4** via `@tailwindcss/vite`
- **Supabase** (Postgres 17, RLS, Auth, Storage, postgrest)
- **Vercel** for static hosting + edge CDN (region `sin1`)

| Service | ID | Notes |
|---|---|---|
| Vercel project | `prj_e3GLct6FpLk2DUcgGaVyu9arbzlC` (team `swlproton`) | Connected to GitHub `shtyh/sales-crm-app`; auto-deploys main |
| Live URL | https://swlmotorscrm.vercel.app | also custom domain config in Vercel |
| Supabase project ref | `dguohpdqwyfxlpurnwjw` | region `ap-northeast-2` (Seoul) |
| Org | `kjdrwrvbfqffsdojkbch` | SWL Motors |

`.env.local` holds `VITE_SUPABASE_URL` + `VITE_SUPABASE_PUBLISHABLE_KEY`.

## RBAC — 6 roles (5 active + 1 deprecated)

Enum `public.app_role`:

| Role | Frontend label | Lands on | Notes |
|---|---|---|---|
| `super_admin` | Super Admin | `/` (AdminDashboard, red banner) | God mode — every guard trigger early-returns. Only role allowed to DELETE bookings + manage roles + edit `commission_schedules`. |
| `general_admin` | General Admin | `/` (GeneralAdminDashboard, purple) | Edits non-financial booking fields. Owns JPJ tracking (jpj_status / jpj_submitted_at / jpj_expected_completion). Inventory writes moved to finance_admin 2026-05-26. |
| `sales_manager` | Sales Manager | `/` (AdminDashboard, blue) | Cancels bookings, approves SA discount, approves SA commission, reassigns leads (owner_id), creates payout batches. Dual identity: also takes own bookings. |
| `finance_admin` | Finance Admin | `/finance` (amber) | Owns `loan_bank`, `loan_status`, `loan_notes`, `loan_amount`, `insurance_company`, `insurance_amount`, `deposit_status`, `payment_status` on bookings, and **all** `cars.*` columns (vehicle attributes transferred from general_admin 2026-05-26, plus the existing floor stock columns). Now also the only role that can `+ New car`. |
| `sales_advisor` | Sales Advisor | `/` (DashboardPage, plain) | Default role for new users. Creates own bookings. Can set discount (routes through SM for approval). Sees own commission. |
| `accountant` | — | — | **DEPRECATED.** Enum value remains but no one is assignable to it (filtered out of UI dropdown). All accountant responsibilities are folded into `finance_admin`. See migration `20260522_revert_accountant_module.sql`. |
| `service_manager` | Service Manager | `/` (AdminDashboard) | Workshop side. Currently same write surface as other non-SA roles via the Phase-1 permissive RLS on the Service tables. |
| `service_advisor` | Service Advisor | `/` (AdminDashboard) | Workshop intake. Same Phase-1 surface as above. |
| `store_keeper` | Store Keeper | `/` (AdminDashboard) | Parts inventory custodian. Same Phase-1 surface as above. |
| `mechanic` | Mechanic | `/` (AdminDashboard) | Technician. Same Phase-1 surface as above. |

Current real users (`select id, full_name, role from public.profiles`):

- Axelrod Han (`651800d5-1c86-4636-ba7d-6d98f751db26`) — super_admin
- Lia — general_admin
- Johnson — sales_manager
- Others — sales_advisor (Bhotti, Hong, Minie, Munis, Suren, Vikna, plus one anonymous swlmotors88)

## Tables

| Table | Owner of writes | Notable columns |
|---|---|---|
| `profiles` | self / super_admin (role changes by super only) | `role app_role`, `is_admin` (generated = role <> 'sales_advisor'), `full_name`, `email` |
| `customers` | any authenticated; delete super only (UI exposed on `/customers` row + mobile card; two-step NRIC-typed confirm; rejects if customer still has bookings via FK `on delete restrict`) | `nric unique`, `name`, `phone`, `email?`, `address?`. Bookings reference via `bookings.customer_id`. |
| `payments` | finance_admin + super write; visibility mirrors bookings; super-only delete | `booking_id` FK, `amount > 0`, `payment_type` enum (deposit/full/partial), `payment_method` enum (cash/bank_transfer/card), `received_by` FK→profiles, `received_at`, `notes?`. |
| `invoices` | finance_admin + super write; visibility mirrors bookings; super-only delete | `booking_id` FK, `customer_id` FK, `invoice_number` unique-when-set, `invoice_date`, `subtotal`/`tax_amount`/`total_amount` numeric, `status` enum (draft/issued/paid). |
| `vehicles` | any auth read; non-SA write; super delete | `customer_id` FK, `car_id?` (bridge to SWL inventory), `registration_no unique`, `chassis_no? unique`, model, variant, color, year, mileage, notes. |
| `technicians` | any auth read; non-SA write; super delete | `profile_id?` (one-to-one with profiles if they log in), name, employee_no? unique, phone, specialty, is_active. |
| `parts_inventory` | any auth read; non-SA write; super delete | `part_no unique`, name, brand, unit, unit_cost/price, stock_qty (not auto-decremented yet), reorder_level, location, is_active. |
| `service_orders` | any auth read; non-SA write; super delete | `order_no?` unique-when-set, `customer_id` + `vehicle_id` FK, `technician_id?`, `service_advisor_id?`, status enum (open/in_progress/awaiting_parts/completed/collected/cancelled), complaint/diagnosis, mileage_in, opened_at/completed_at/collected_at, subtotal/tax/total. |
| `service_order_items` | any auth read; non-SA write; super delete | `service_order_id` FK (cascade), `kind` enum (part/labour), `part_id?` (required when kind=part), description, quantity, unit_price, line_total. |
| `bookings` | per-column gated by trigger | see below |
| `booking_attachments` | booking owner + any admin | `kind` enum (bank_transaction / bank_statement / lou / cancellation_form / other) |
| `cars` | per-column gated by trigger; delete super only (UI exposed at `/cars/:id` ★ Delete; two-step chassis-typed confirm; bookings.car_id is `on delete set null` so deletion never blocks) | `chassis_no unique`, `floor_stock_*`, `status enum(in_stock/reserved/delivered/returned)` |
| `commission_schedules` | super_admin | `(model, variant) → base_commission` (variant nullable as catch-all) |
| `commission_payouts` | sales_manager + super_admin | batch label, paid_at, paid_by |
| `audit_log` | trigger only (postgres) | reads = super_admin only; one row per INSERT/UPDATE/DELETE on bookings + cars |
| storage bucket `booking-files` | matches `booking_attachments` ownership | private |

## bookings.* column ownership matrix

These are enforced by `public.guard_booking_field_writes` BEFORE INSERT/UPDATE.
`super_admin` early-returns and bypasses everything.

| Column | Who can write |
|---|---|
| `customer_*`, `vehicle_*`, `otr_price`, `booking_fee`, `booking_date`, `notes` | booking owner (SA) + any privileged role (general_admin / sales_manager / finance_admin) |
| `status` (non-cancel transitions) | DB-only — no UI form field as of 2026-05-26. Cancel is sales_manager via the cancel button; `delivered` requires car `paid_off`. The Status dropdown was removed from NewBookingPage + BookingDetailPage because the workflow is now driven by finance_admin actions on `deposit_status` / `payment_status`. |
| `discount_amount` | same set; no approval flow as of 2026-05-23 |
| `special_support` | sales_manager only — RM bonus that adds to commission |
| `approval_status` | legacy, sales_manager only when explicit. No longer auto-flipped. |
| `owner_id` (lead reassignment) | sales_manager only (UI hidden 2026-05-23) |
| `loan_bank`, `loan_status`, `loan_notes`, `loan_amount`, `insurance_company`, `insurance_amount` | finance_admin only |
| `deposit_status`, `payment_status` | finance_admin only |
| `jpj_status`, `jpj_submitted_at`, `jpj_expected_completion` | general_admin only |
| `status='cancelled'` transition | sales_manager only |
| `car_id` | general_admin or sales_manager (or super_admin) |
| `base_commission` | system trigger only (snapshot on INSERT from `commission_schedules`); super_admin can override |
| `commission_amount` | auto = base − discount + special_support (can go negative); sales_manager can override |
| `commission_status` | system auto-flips to `pending` when delivered+paid (or `approved` if owner is SM). sales_manager flips manually after. |
| `commission_payout_id` | sales_manager (set when bundling into a payout batch) |

## cars.* column ownership

Enforced by `public.guard_car_field_writes`. Bypasses guard when transaction-local `app.system_op = 'on'` (used by `recompute_car_status`).

| Column | Who |
|---|---|
| `chassis_no`, `model`, `variant`, `color`, `arrived_at`, `status` | finance_admin only (was general_admin until 2026-05-26 — `20260526_transfer_car_attrs_to_finance_admin.sql`) |
| `floor_stock_bank`, `financed_amount`, `floor_stock_status`, `floor_stock_due` | finance_admin only |

RLS `cars_insert` / `cars_update` policies were also restricted to finance_admin in the same migration.

## Red lines (enforced in DB triggers)

1. **Delivery requires paid_off car.** `bookings.status` cannot transition to `'delivered'` unless the linked car has `floor_stock_status = 'paid_off'`. (Plus car_id must be non-null.)
2. **SM discount approval.** Only `sales_manager` can flip `approval_status` to/from `approved` / `rejected`.
3. **Cancellation gate.** Only `sales_manager` can set `status='cancelled'`.
4. **Reassignment gate.** Only `sales_manager` can change `owner_id`.
5. **Commission approve/pay gate.** Only `sales_manager` can flip `commission_status` or set `commission_payout_id`.

Red line B (delivery requires `payment_status='paid'`) was added with the accountant module and **removed** during Phase 5 revert. If you need it back, it lived in the same trigger; check `20260522_accountant_module.sql` for the snippet.

## car_status auto-sync

Trigger `sync_car_status_from_booking` fires AFTER INSERT/UPDATE/DELETE on bookings. Recomputes the linked car (and any old car when reassigning) via `recompute_car_status`:

- Any linked booking with `status='delivered'` → car `delivered`
- Else any linked booking with `status in ('pending','confirmed')` → car `reserved`
- Else → car `in_stock`

(This is the **booking-driven** version — Phase 5 had a stricter "deposit-driven" version that's been reverted.)

## Routes

| Path | Component | Who sees it |
|---|---|---|
| `/login` | LoginPage | anon |
| `/` | RoleHome → role-specific dashboard. finance_admin → redirect to `/finance`; general_admin → `GeneralAdminDashboardPage`; workshop roles → service dashboards; everyone else → AdminDashboardPage or DashboardPage. | any auth |
| `/bookings` | BookingsPage (list) | any auth |
| `/bookings/new` | NewBookingPage | sales_advisor / sales_manager / super_admin (nav link hidden from others; RLS still gates insert) |
| `/bookings/:id` | BookingDetailPage | any auth (RLS still gates select) |
| `/cars` | CarsPage (list) | any auth |
| `/cars/new` | NewCarPage | finance_admin + super_admin (was general_admin until 2026-05-26) |
| `/cars/:id` | CarDetailPage | any auth; column gates within the page |
| `/finance` | FinancePage (overview cards + insurance / payment / invoice / commission tables, plus floor-stock + LOU below) | finance_admin + super_admin only |
| `/commissions` | CommissionsPage (SM payout flow) | sales_manager + super_admin |
| `/admin/commissions` | CommissionSchedulesPage (base rates) | super_admin only |
| `/admin/users` | AdminUsersPage | super_admin only |
| `/account` | AccountPage (personal display name) | any auth |

Top nav layout (2026-05-26 cleanup):

```
[brand]  [primary nav links...]                    [+New] [toggle] [avatar▾]
```

* **+ New** is rendered as a primary pill on the right (not inside the nav list). Shown only when `canCreateBooking` (sales_advisor / sales_manager / super_admin).
* **Avatar dropdown** consolidates: name / email / online dot, `/account`, super_admin shortcuts (Manage users → `/admin/users`, Commission rates → `/admin/commissions`), and Logout. Initials are derived from full_name or email; the avatar is rose-tinted for super_admin and gray for everyone else. **The email line is hidden for super_admin** (their email is intentionally not surfaced in the UI).
* **Workspace toggle** (super_admin only) sits between + New and the avatar.

Primary nav links by role:

| Role | Sees in primary nav |
|---|---|
| sales_advisor | Home · Bookings |
| sales_manager | Home · Bookings · Customers · Inventory · Commissions |
| general_admin | Home · Bookings · Customers · Inventory |
| finance_admin | Bookings · Inventory · Finance (Home link hidden — Finance is the landing) |
| super_admin (Sales workspace) | Home · Bookings · Customers · Inventory · Commissions (no + New — super admin doesn't author bookings) |
| super_admin (Service workspace) | Home · Vehicles · + Job order |
| workshop roles | Home · Vehicles · + Job order |

(super_admin's `Rates` link moved into the avatar dropdown; the old "★ Super Admin" pill is gone — its destination lives in the dropdown's Manage users entry.)

## Dashboards (role-specific landings)

- **GeneralAdminDashboardPage** (`/` for general_admin) — sales-ops queue:
  3 cards (Waiting for documents · Submitted to JPJ · Ready to deliver),
  filter chips, and 3 tables. "Missing documents" is **derived** (no
  checklist columns): IC / Phone / Address from `customers` (with
  snapshot fallback from `bookings.customer_*`); Bank transaction + LOU
  from `booking_attachments` by `kind`. LOU is auto-satisfied when
  `bookings.loan_bank='cash'`. JPJ status / submitted / expected dates
  edit inline via `useUpdateBooking` and save on change. "Ready to
  deliver" rule: docs complete + insurance_company set + payment_status
  = 'paid' + jpj_status = 'registered' + car_id assigned.

- **FinancePage** (`/` for finance_admin → redirected to `/finance`) —
  overview-first repurpose 2026-05-26. Top: 4 cards (Pending insurance ·
  Pending payment · Invoices issued RM · Total commission RM). Then 4
  tables (insurance / payment / invoices / commission-by-SA). Then the
  existing Inventory financing (floor stock) + Pending LOU sections.
  Pending insurance = `insurance_company is null OR insurance_amount is
  null/zero`. Pending payment = `OTR - (Σ payments + loan_amount) > 0`
  (only rows with a positive shortfall are listed).

- **AdminDashboardPage** still serves super_admin and sales_manager.
  `RoleHome` dispatches:
  ```
  workshop role         → ServiceDashboardPage / ServiceAdvisorDashboardPage
  super_admin + service → ServiceDashboardPage
  finance_admin         → <Navigate to="/finance">
  general_admin         → GeneralAdminDashboardPage
  else if isAdmin       → AdminDashboardPage
  else                  → DashboardPage  (sales_advisor)
  ```

## Performance work already done

- Vite `manualChunks` splits react / supabase vendor into stable chunks (cached forever).
- All routes lazy-loaded via `React.lazy` + Suspense; per-page chunk size ~1–5 KB gzip.
- `vercel.json` sets `cache-control: public, max-age=31536000, immutable` on `/assets/*` (was `max-age=0` from Vercel defaults). SPA rewrite excludes `/assets/` so missing-chunk 404s don't return HTML.
- React Query with 30s staleTime, 5min gcTime, retry 1. All pages use `useQuery` / `useMutation` via `src/lib/queries.ts`.
- supabase-js auth-lock deadlock fixed in `src/lib/auth.tsx` — `onAuthStateChange` callback stays synchronous, profile fetch deferred via `setTimeout(0)`. See <https://github.com/supabase/auth-js/issues/762> for context.

## Migrations (apply order)

Files in `supabase/migrations/` (chronological):

```
20260521_create_bookings.sql                      original bookings + RLS
20260521_booking_attachments.sql                  attachments table + storage policies
20260521_profiles_and_admin.sql                   profiles + is_admin + auth sync trigger
20260522_admin_handoff.sql                        loan_bank/insurance_company + guard
20260522_loan_status.sql                          loan_status enum + columns
20260522_perf_security_hardening.sql              consolidate RLS, fn search_path
20260522_rbac_roles.sql                           6-role enum + helpers + per-table policies
20260522_sales_manager_workflow.sql               discount/quota/deposit/payment/approval
20260522_finance_admin_cars_module.sql            cars table + delivery red line A
20260522_car_autosync_and_audit_log.sql           recompute_car_status + write_audit_log
20260522_accountant_module.sql                    Phase 5 (DROPPED — see next)
20260522_revert_accountant_module.sql             rolls back Phase 5
20260522_commission_module.sql                    schedules + payouts + commission cols
20260523_allow_sm_assign_car.sql                  guard car_id → general_admin OR sales_manager
20260523_special_support_and_relax_discount.sql   new special_support col; discount no longer needs approval
20260523_negative_commission.sql                  drop 0-clamp + CHECK so commission_amount can go negative
20260523_restore_service_role_grants.sql          restore CRUD grants to service_role on all public tables
20260523_customers_table.sql                      first-class customers table + bookings.customer_id FK
20260526_nric_phone_format.sql                    CHECK: NRIC = 12 digits, phone = 10-11 digits
20260526_loan_amount.sql                          bookings.loan_amount + finance-admin gate (for HP letter)
20260526_payments_table.sql                       first-class payments ledger linked to bookings + profiles
20260526_invoices_table.sql                       invoices table linked to bookings + customers
20260526_service_module.sql                       Service: vehicles, technicians, parts_inventory, service_orders, service_order_items
20260526_service_roles_and_order_no.sql           +4 workshop roles (service_manager / service_advisor / store_keeper / mechanic); auto SO-YYMMDD-NNNN order_no
20260526_transfer_car_attrs_to_finance_admin.sql  cars insert/update RLS + guard now finance_admin (was general_admin)
20260526_jpj_tracking.sql                         bookings: jpj_status enum + jpj_submitted_at + jpj_expected_completion; guard gates writes to general_admin
20260526_insurance_amount.sql                     bookings.insurance_amount numeric(12,2); guard gates writes to finance_admin (alongside insurance_company)
```

Some early ones were **applied by hand** in Supabase SQL editor and so don't show up in `supabase_migrations.schema_migrations`. The files are still source of truth for what should exist.

Schema drift noted earlier: `delivered_at` (in migrations) vs `expected_delivery` (in DB). Frontend uses `delivered_at` (typed in `types.ts`); reading it returns undefined. Low priority but worth fixing if anything actually depends on delivery timestamp.

## Open TODOs (the user has asked for these — not yet started)

- **6.5 Excel/CSV upload** for commission_schedules (user wanted this in original spec but we built manual-row UI first to validate the flow).
- **Half-monthly payout batch detail page** — past batches list exists, but no drill-in view of which bookings were included in a given batch.
- **Re-snapshot existing bookings' `base_commission`** when a schedule row is added/updated (currently only INSERT snapshots; existing bookings stay null until manually re-saved).
- **Drop `accountant` enum value** properly (requires PG type recreation; deferred because zero users are on it and the value is filtered from UI).
- **car_status returned flow** — when a delivered car physically comes back, currently general_admin sets it manually. No auto-trigger.

## Deploy + verify pattern

The project is wired to GitHub via Vercel. Push to main → Vercel builds + deploys automatically (~30 s). After pushing, poll the live URL for a new entry-bundle hash to confirm:

```bash
git push
OLD=<previous main entry hash>
for i in $(seq 1 36); do
  sleep 5
  F=$(curl -s "https://swlmotorscrm.vercel.app/?cb=$(date +%s)" \
        | grep -oE '/assets/index-[A-Za-z0-9_-]+\.js' | head -1)
  if [[ "$F" != *"$OLD"* ]]; then echo "DEPLOYED. main=$F"; break; fi
done
```

Local checks before pushing:

```bash
cd /Users/khorheeshin/sales-crm-app
npm run build         # tsc + vite build; should be green
```

## MCP servers available

- `mcp__cf7ad5d4-…` — Supabase (apply_migration, execute_sql, get_advisors, get_logs, list_migrations, etc.). Already authorized for the project.
- `mcp__94ec6bc2-…` — Vercel. Read-only via `web_fetch_vercel_url` works; `get_project` / `list_deployments` need the team token re-authorized to scope `swlproton`. If you need build logs / runtime logs, ask the user to reconnect Vercel MCP in `/mcp`.
- Audit log is super_admin-only readable; if you need to debug behaviour as another role, use `set local request.jwt.claims to '{"sub":"<uuid>","role":"authenticated"}';` inside `execute_sql` to simulate.

## Common gotchas

- **Don't await another supabase call inside `onAuthStateChange`** — deadlocks every subsequent REST request. Use `setTimeout(0)` to defer.
- **Don't `cd` between Bash calls** without using absolute paths; the shell session resets working directory after every call. Use `cd /Users/khorheeshin/sales-crm-app && …` in one line.
- **`supabase.from('bookings').update({...})` where the patch includes a column the caller can't write** trips the guard trigger and rejects the whole PATCH. The frontend pattern is to build the patch with role-gated spread:
  ```ts
  await updateMut.mutateAsync({ id, patch: {
    ...alwaysOK,
    ...(canEditFinance ? financeFields : {}),
    ...(canApprove ? approvalFields : {}),
  }})
  ```
- **`audit_log` reads only super_admin.** Trying to fetch for any other role returns `[]` silently (no error). `useAuditForRow(table, id, isSuperAdmin)` skips the call when false.
- **`commission_schedules.variant` is nullable** as a catch-all; lookup uses `IS NOT DISTINCT FROM` so a booking with empty variant matches a NULL-variant schedule row.

## How to resume / hand off

When you start a fresh Claude Code session in this repo, this file should appear automatically in context (Claude Code reads `CLAUDE.md` at session start). Re-read it before doing anything destructive. If a section above is out of date, fix it as you make the change — the file is the single source of truth for "what state is the system in right now."
