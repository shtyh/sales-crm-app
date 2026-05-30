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
| `customers` | any authenticated; delete super only (UI exposed on `/customers` row + mobile card; two-step NRIC-typed confirm; rejects if customer still has bookings via FK `on delete restrict`) | `nric unique`, `name`, `phone`, `email?`, `address?`. **WMS account fields (2026-05-26)**: `city`, `state`, `post_code`, `phone2`, `fax_no`, `tin_no`, `tax_no`, `sex` (M/F), `race` (C/M/I/O), `marital_status` (S/M/D), `birthday`, `sales_dealer`, `status` (active/inactive, default active), `fixed_discount_rate` (0–100), `preference_list_price` (text, default 'List Price 1'), `road_tax_renewal` / `insurance_renewal` / `driving_license_renewal` (dates), plus 5 reminder booleans (`road_tax_send_reminder`, `insurance_send_reminder`, `driving_license_send_reminder`, `birthday_send_reminder`, `send_next_service_reminder`) + `send_greeting_card`. Bookings reference via `bookings.customer_id`. |
| `payments` | finance_admin + super write; visibility mirrors bookings; super-only delete | `booking_id` FK, `amount > 0`, `payment_type` enum (deposit/full/partial), `payment_method` enum (cash/bank_transfer/card), `received_by` FK→profiles, `received_at`, `notes?`. |
| `invoices` | finance_admin + super write; visibility mirrors bookings; super-only delete | `booking_id` FK, `customer_id` FK, `invoice_number` unique-when-set, `invoice_date`, `subtotal`/`tax_amount`/`total_amount` numeric, `status` enum (draft/issued/paid). |
| `vehicles` | any auth read; non-SA write; super delete | `customer_id` FK, `car_id?` (bridge to SWL inventory), `registration_no unique`, `chassis_no? unique`, model, variant, color, year, mileage, notes. **WMS account fields (2026-05-26)**: `account_no`, `membership_no`, `engine_no`, `capacity_cc`, `year_make`, `registration_date`, `warranty_date`. |
| `technicians` | any auth read; non-SA write; super delete | `profile_id?` (one-to-one with profiles if they log in), name, employee_no? unique, phone, specialty, is_active. |
| `parts_inventory` | any auth read; non-SA write; super delete | `part_no unique`, name, brand, unit, unit_cost/price, stock_qty (not auto-decremented yet), reorder_level, location, is_active. |
| `service_orders` | any auth read; non-SA write; super delete (UI exposed on `/service-orders/:id` "★ Delete order"; two-step confirm with typed `order_no`; service_order_items cascade) | `order_no?` unique-when-set, `customer_id` + `vehicle_id` FK, `technician_id?`, `service_advisor_id?`, status enum (open/in_progress/awaiting_parts/completed/collected/cancelled), complaint/diagnosis, mileage_in **(NOT NULL on the FE; column itself is nullable)**, opened_at/completed_at/collected_at, subtotal/tax/total. **Intake (2026-05-26)**: `service_types text[]` (maintenance / int_g_repair / warranty_service / service_coupon / come_back_job / body_repair / inspection), `appointment_type` ('walk_in' default / 'by_appointment'), `days_to_complete`. The earlier `department` column was added and removed the same day (see migrations). |
| `service_order_items` | any auth read; non-SA write; super delete | `service_order_id` FK (cascade), `kind` enum (part/labour), `part_id?` (required when kind=part), description, quantity, unit_price, line_total. **Stock movement (2026-05-29):** `trg_service_order_item_stock` AFTER INSERT/UPDATE/DELETE decrements `parts_inventory.stock_qty` + increments `qty_issued` when `kind='part'` AND `part_id` IS NOT NULL; UPDATE handles part-swap / qty-diff / kind-flip so edits stay consistent; DELETE reverts. |
| `bookings` | per-column gated by trigger. INSERT allowed for `sales_advisor` / `sales_manager` (with `owner_id = auth.uid()`) and `super_admin` (no owner constraint). | see below. `hq_discount`, `dealer_support`, `approval_notes`, `vehicle_color text[]` added 2026-05-28. |
| `booking_attachments` | booking owner + any admin | `kind` enum (bank_transaction / bank_statement / lou / cancellation_form / other). **Audited 2026-05-30** (`trg_booking_attachments_audit` → `write_audit_log()`) so uploads/removals show in the booking's 🕓 Activity (super_admin only). |
| `cars` | per-column gated by trigger; delete super only (UI exposed at `/cars/:id` ★ Delete; two-step chassis-typed confirm; bookings.car_id is `on delete set null` so deletion never blocks) | `chassis_no unique`, `floor_stock_*`, `status enum(in_stock/reserved/delivered/returned)`. **Floor-stock UI (2026-05-30):** the `/cars/:id` section is **🏦 Floor stock financing** with fields **Bank**, **Floor stock amount (MYR)**, **Floor stock status**, **Settlement due**. Bank dropdown is tight — **Public Bank or Cash** only (not the 13-bank customer-loan list); picking **Cash** auto-sets Floor stock status to **Paid off** (cash = no financing). `floor_stock_bank` stores the literal `'Cash'` for cash-funded cars (was NULL); NewCarPage's cash funding writes `'Cash'` + `paid_off`. Legacy/other bank values still render via a fallback `<option>`. (FinancePage's matching section is still titled "Inventory financing (floor stock)".) |
| `commission_schedules` | super_admin | `(model, variant) → base_commission` (variant nullable as catch-all) |
| `commission_payouts` | sales_manager + super_admin | batch label, paid_at, paid_by |
| `audit_log` | trigger only (postgres) | reads = super_admin only; one row per INSERT/UPDATE/DELETE on bookings + cars + **commission_schedules** + **booking_attachments** (2026-05-30). All use the generic `write_audit_log()` trigger fn (keys off `TG_TABLE_NAME` + row `id`). Surfaced via `AuditLogPanel` (per-row), `TableActivityLog` (table-wide), and `BookingActivityLog` (a booking's own changes + its attachment events, merged by `booking_id` in the audit jsonb — `listAuditForBooking`). |
| storage bucket `booking-files` | matches `booking_attachments` ownership | private |
| `attendance` | own row write/read; is_admin reads all; super_admin delete | one row per `(profile_id, work_date)`. check_in_* required at insert (lat/lng/distance_m + timestamp); check_out_* set later via UPDATE. **Lunch (2026-05-27)**: lunch_out_* and lunch_in_* (timestamptz + lat/lng/distance_m, all nullable). work_date is Asia/KL local YYYY-MM-DD, FE-supplied. |
| `commission_verifications` | SA writes own; SM + super UPDATE any; super DELETE. SELECT visible to SA on own, SM/FA/super on all. | `booking_id` FK (set null on delete), `uploaded_by` FK→profiles, `image_path` (Storage path), `extracted_*` fields from the Gemini extraction, `matched` boolean, `discrepancy_notes`. Populated by the `/commission-verify` upload flow + `match_commission_verification(id)` RPC. |
| `bank_statements` | **super_admin only** can insert. **Upload UI moved to `/reconciliation` (2026-05-30)** and is now shown to **super_admin only** — FA/SM no longer see the section at all (RLS still lets them SELECT, they just have no UI for it). super_admin delete; FA + SM + super_admin select. The upload card is at the **bottom** of `/reconciliation` and lists recent statements by **`original_name`** (the operator's filename, 2026-05-30) — each is a button that opens the stored PDF via a short-lived `createSignedUrl`. | `uploaded_by` FK→profiles, `file_path` (Storage, stored as `statements/{uid}/{ts}.pdf`), `original_name` (display filename), `period_start` / `period_end` filled by extractor. One row per uploaded statement PDF. |
| `bank_statement_lines` | service-role insert only (extract-bank-statement); FA + SM + super_admin select. | `statement_id` FK (cascade), `line_date`, `amount`, `description`, `raw` jsonb. One row per **credit** line on the statement. Indexed on `(amount, line_date)` for the reconciliation join. |
| `attachment_extractions` | service-role write (extract-document); admins + booking owner select. | One row per `booking_attachments` row (`UNIQUE attachment_id`), `doc_type` (lou / bank_transaction / cancellation_form / other), `extracted_amount` / `extracted_date` / `extracted_customer_name`. |
| `booking_reconciliations` | service-role write via `reconcile_booking()`; admins + booking owner select. | One row per booking (`UNIQUE booking_id`), `status` (complete / discrepancy / missing), pointers to the four source docs, `details` jsonb (`{missing:[], diffs:[{field,doc,expected,got}]}`). |
| `notifications` (2026-05-30) | RLS: own rows + super_admin all (select/update/delete own); INSERT super only directly — system creates via `create_notification()` SECURITY DEFINER RPC (service_role grant). | `user_id` FK→profiles, `booking_id?`, `type` (9-value CHECK: no_sm_signature / all_in_one_pending|approved|rejected / down_payment_complete / lou_pending / lou_verified / booking_complete / commission_unlocked), `message`, `is_read`, `created_at`. RPCs: `get_unread_notification_count()`, `mark_notification_read(id)`, `mark_all_notifications_read()`. |
| `document_verifications` (2026-05-30) | SA/SM insert+select own; finance_admin/sales_manager/super select+update all; super delete. | Per-booking, per-`document_type` (all_in_one / down_payment / lou) AI-extraction + FA review workflow. `image_path` (Storage `document-verification/{uid}/...`), the three `extracted_*` field groups (incl. `extracted_sm_signature_detected`), `finance_admin_loan_amount/confirmed/by/at/notes`, `gemini_match`, `verification_status` (pending/approved/rejected/needs_review), `rejection_reason`, `uploaded_by`. **Deliberately SEPARATE from `commission_verifications`/`extract-allinone`** — parallel pipelines that both read the All-In-One form. |

## bookings.* column ownership matrix

These are enforced by `public.guard_booking_field_writes` BEFORE INSERT/UPDATE.
`super_admin` early-returns and bypasses everything. A transaction-local
`app.system_op='on'` also early-returns the guard (added 2026-05-30, mirroring
the cars guard) — used by `recompute_booking_documents()` so the
document-verification system can write system-managed columns without tripping
role gates or the commission auto-(de)flip.

| Column | Who can write |
|---|---|
| `customer_*`, `vehicle_*`, `otr_price`, `booking_fee`, `booking_date`, `notes` | booking owner (SA) + any privileged role (general_admin / sales_manager / finance_admin) |
| `status` (non-cancel transitions) | DB-only — no UI form field as of 2026-05-26. Cancel is sales_manager via the cancel button; `delivered` requires car `paid_off`. The Status dropdown was removed from NewBookingPage + BookingDetailPage because the workflow is now driven by finance_admin actions on `deposit_status` / `payment_status`. |
| `discount_amount` | same set. Approval flow restored 2026-05-28: trigger auto-flips `approval_status` to `pending` whenever discount > base_commission. |
| `special_support` | sales_manager only — RM bonus that adds to commission |
| `approval_status` | sales_manager when explicit (manager's decision sticks once set); otherwise auto-flipped by the guard on INSERT + on discount UPDATE — `discount ≤ base_commission` → `not_required`, `discount > base_commission` → `pending`. |
| `approval_notes` | sales_manager — short reason captured when approving/rejecting from the queue on `/`. |
| `hq_discount`, `dealer_support` | system-managed snapshot from `commission_schedules` on INSERT; super_admin only after that. |
| `vehicle_color` | now `text[]` (2026-05-28) — multi-select on the booking form. Legacy rows are 1-element arrays. |
| `owner_id` (lead reassignment) | sales_manager only (UI hidden 2026-05-23) |
| `loan_bank`, `loan_status`, `loan_notes`, `loan_amount`, `insurance_company`, `insurance_amount` | finance_admin only |
| `deposit_status`, `payment_status` | finance_admin only. **UI note (2026-05-30):** the booking page's 💰 Finance status is now a **compact single row** — a read-only **Deposit** badge (`depositSummary()`; shows "✅ no booking fee" when `booking_fee = 0`) + the **Payment** dropdown. The editable Deposit field was removed (nothing reads `deposit_status` outside this page; the column stays). The deposit line was lifted out of the Loan & Insurance card into this row to tidy both. |
| `jpj_status`, `jpj_submitted_at`, `jpj_expected_completion` | general_admin only |
| `status='cancelled'` transition | sales_manager only |
| `car_id` | general_admin or sales_manager (or super_admin) |
| `base_commission` | system trigger: snapshot on INSERT from `commission_schedules`; super_admin can override. **Retro-fill (2026-05-30):** a schedule INSERT/UPDATE now also backfills existing bookings whose `base_commission` IS NULL via `trg_commission_schedule_backfill` → `backfill_booking_commission()` — so adding a schedule after the booking makes it pick up the value automatically (the guard recomputes `commission_amount` on that UPDATE). Already-snapshotted bookings are never rewritten. |
| `commission_amount` | auto = base − discount + special_support (can go negative); sales_manager can override |
| `commission_status` | system auto-flips to `pending` when delivered+paid (or `approved` if owner is SM). sales_manager flips manually after. |
| `commission_payout_id` | sales_manager (set when bundling into a payout batch) |
| `payment_type`, `all_in_one_status`, `down_payment_status`, `lou_status`, `documents_complete`, `total_received_down_payment` | **system-managed** — written ONLY by `recompute_booking_documents()` (the `document_verifications` AFTER trigger), which bypasses this guard via transaction-local `app.system_op='on'`. No UI writes them. See the Document Verification System section. |

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
| `/bookings/new` | NewBookingPage | sales_advisor / sales_manager / super_admin (nav link hidden from others; RLS gates insert to the same three roles) |
| `/bookings/:id` | BookingDetailPage (+ **📄 Document submission cards** for SA/SM/super: All-In-One / down payment / LOU upload → AI extract, 2026-05-30) | any auth (RLS still gates select) |
| `/cars` | CarsPage (list) | any auth |
| `/cars/new` | NewCarPage | finance_admin + super_admin (was general_admin until 2026-05-26) |
| `/cars/:id` | CarDetailPage | any auth; column gates within the page |
| `/finance` | FinancePage (overview cards + **📋 Document verification queue** (All-In-One approve/reject + LOU confirm, 2026-05-30) + insurance / payment / invoice / commission tables, plus floor-stock + LOU below) | finance_admin + super_admin only |
| `/commissions` | CommissionsPage (SM payout flow) | sales_manager + super_admin |
| `/admin/commissions` | CommissionSchedulesPage (base rates + a 🕓 Change log of every add/edit/delete, from `audit_log`) | super_admin only |
| `/admin/users` | AdminUsersPage | super_admin only |
| `/account` | AccountPage (personal display name) | any auth |
| `/clock-in` | ClockInPage (GPS-gated check in / out) | any auth |
| `/attendance` | MyAttendancePage (own calendar + monthly summary) | any auth |
| `/admin/attendance` | TeamAttendancePage (today + month-by-employee, **org-chart scoped**) | super_admin / sales_manager / service_manager only (others redirected to `/attendance`) |
| `/commission-verify` | CommissionVerifyPage (upload All-In-One photo → Gemini extracts → auto-match to booking → discrepancy table) | sales_advisor / sales_manager / super_admin (nav link shown to SA+SM only) |
| `/reconciliation` | ReconciliationPage (3-way reconciliation queue: bank statement + LOU + bank-in + All-In-One; **Bank statements upload section at the top — super_admin only**, moved here from `/finance` 2026-05-30) | finance_admin / sales_manager / super_admin (upload section super_admin only) |
| `/notifications` | NotificationsPage (full in-app notification list + read/type filters + mark-all-read). Bell 🔔 in the top nav (`NotificationBell`, all roles) shows the unread badge (polled 60s) + latest 10. Doc-verification system Phase B (2026-05-30). | any auth (RLS scopes to own rows; super sees all) |
| `/service/stock/parts` | PartsListPage (browse + inline-edit the ~80k-row parts catalogue) | any workshop role + super_admin |
| `/service/stock/receive` | StockReceivePage (book in a delivery — header + line items, QR-friendly DO No input) | any workshop role + super_admin |
| `/service/stock/issued` | StockIssuedListPage (port of legacy "Stock Issued List" — every part-issue transaction in a date range; see below) | any workshop role + super_admin |
| `/service/inquiry` | InquiryHubPage (WMS-style tile menu for lookups) | any workshop role + super_admin |
| `/service/inquiry/suppliers` | SuppliersInquiryPage (vendor directory + SST/TIN detail, "+ New supplier" form) | any workshop role + super_admin |
| `/service/inquiry/receipts` | StockPurchaseHistoryPage (past stock receipts + items drilldown) | any workshop role + super_admin |
| `/service/inquiry/vehicle-types` | VehicleTypesInquiryPage (Proton model master from AUTFDV02 · 86 variants) | any workshop role + super_admin |
| `/service/customers` | ServiceCustomersPage (workshop-side customer master, separate from `/customers`) | any workshop role + super_admin |

Top nav layout (2026-05-26 cleanup):

```
[brand]  [primary nav links...]                    [+New] [toggle] [avatar▾]
```

* **+ New** is rendered as a primary pill on the right (not inside the nav list). Shown only when `canCreateBooking` (sales_advisor / sales_manager / super_admin).
* **Avatar dropdown** consolidates: name / email / online dot, `/account`, super_admin shortcuts (Manage users → `/admin/users`, Commission rates → `/admin/commissions`), and Logout. Initials are derived from full_name or email; the avatar is rose-tinted for super_admin and gray for everyone else. **The email line is hidden for super_admin** (their email is intentionally not surfaced in the UI).
* **Nav is URL-driven** (2026-05-29). The visible nav links flip between Sales and Service based on the current `useLocation().pathname`. Service prefixes: `/service*`, `/service-orders*`, `/vehicles*`. Everything else is Sales. So a super_admin standing on `/service/appointments` only sees Service links; one click to `/bookings` puts them back on the Sales nav. Workshop-only roles are always pinned to Service via the existing route guards.
* **SideSwitcher pill** (super_admin only) — re-introduced near the avatar after the union-nav experiment. Two pills "Sales / Service"; clicking each navigates to that side's landing (`/` for Sales, `/service/appointments` for Service). It's purely a navigation action — the active state is derived from the URL, not from stored workspace state. **On phones it moves into the hamburger drawer (below) under a "Workspace" label; only `sm:` and up render it inline.**
* **Mobile hamburger drawer** (2026-05-30) — below the `sm` breakpoint the inline primary-nav links overflowed (super_admin's Sales nav alone is 7 links + switcher), truncating links and clipping the avatar off the right edge. Fix: the primary nav links now live in a single `navItems` array that feeds **both** the desktop inline `<nav>` (`hidden sm:flex`) **and** a phone-only `MobileNav` hamburger (`sm:hidden`, rendered just after the brand). The drawer is a left-anchored dropdown (same outside-click/Escape pattern as the avatar `UserMenu`) holding the stacked links + the super_admin SideSwitcher; it auto-closes on link tap or any `location.pathname` change. The mobile top bar is now just `🚗 ☰ … +New AH` — `+ New` and the avatar stay in the bar at every width; only the nav links + switcher collapse. Edit links in one place (`navItems`) and both navs stay in sync.

Primary nav links by role:

| Role | Sees in primary nav |
|---|---|
| sales_advisor | Home · Bookings · Verify Commission |
| sales_manager | Home · Bookings · Customers · Inventory · Commissions · Verify Commission |
| general_admin | Home · Bookings · Customers · Inventory |
| finance_admin | Bookings · Inventory · Finance (Home link hidden — Finance is the landing) |
| super_admin (Sales URL) | Home · Bookings · Customers · Inventory · Finance · Reconcile · Commissions · + New |
| super_admin (Service URL) | Home · + Job order · Appointments |
| workshop roles | Home · + Job order (Vehicles reached via Housekeeping tile) |

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

- **ServiceDashboardPage** (`/` for workshop roles + super_admin in
  Service workspace) — rebuilt 2026-05-26 as a 6-tile main menu
  mirroring the legacy WMS system (Job Sheet / Billing, Payment /
  Receipt, Housekeeping, Stock Control, Inquiry, Reporting). Tiles
  without a built screen render with a "Coming soon" pill and are
  click-disabled. "Job Sheet / Billing" → `/service/ops`, "Housekeeping"
  → `/vehicles`.

- **NewServiceOrderPage** (`/service-orders/new`) — Job Sheet intake.
  Vehicle No is a free-text field with autocomplete from existing
  plates; on blur/Enter it resolves to a matching vehicle (auto-fills
  chassis / model / owner / phone) or pops a "This is a New
  Registration Car No" alert and opens an inline modal to file the
  vehicle + owner before the job sheet is saved. **The modal is a 1:1
  port of the legacy WMS "Edit Vehicle Information" dialog** — vehicle
  attrs across the top (Account No, Vehicle No, Chassis No, Membership
  No, Engine No, Vehicle Colour | Car Model, Capacity, Year Make,
  Registration Date, Warranty Date, Variant), then a Detail Information
  section below with Owner / Address / City / State / Post Code /
  Reg./ID/Passport No / Tel / Tel (2) / Fax / Email / Remark on the
  left and TIN / Tax / Sex / Race / Sales Dealer / Marital Status /
  Birthday + reminder / Status / Fixed Discount Rate / 3× renewal
  dates each with their own Send-Reminder checkbox / Preference List
  Price / Send Next Service Reminder / Send Greeting Card / Last
  Updated Date on the right. The Reg./ID/Passport No field is
  NRIC-driven: type a 12-digit NRIC that matches an existing customer
  and every Detail field prefills from their saved record (Save then
  patches that customer via upsert-by-NRIC). New NRIC → fields stay
  empty for a fresh customer entry.

- **BillingPage** (`/service-orders/:id/billing`) — port of the legacy
  WMS Billing Screen. Top header strip with Account / Job No / Bill No
  / Department / Vehicle-Chassis / Mechanic / Mileage / Invoice Date /
  Job Sheet Date. Category quick-pick buttons (Plt / Oil / Tyr / Rim /
  Srv / Nsk / Wtk / Pck / Grp / Dcl, plus F2-F7 keyboard shortcuts).
  Entry form (Service Code / Extra Desc / Remarks / Quantity / Unit /
  Unit Price / Discount %|$) with a live "Gross / Nett / Tax / Bonus"
  calc strip. Latest Selling Price side panel (cosmetic — stock isn't
  wired to parts_inventory). Billing Item Listing table backed by
  `service_order_items` (click a row to load into the entry form;
  Modify saves back). Totals (Gross / Tax / Discount / Invoice / Trade
  In / Sales). Action bar (New / Save / Modify / Delete / Clear /
  Memo / Greeting / Close). Reachable from `/service/ops` via the
  "Bill" link next to each Job No.

- **ServiceOpsPage** (`/service/ops`) — Job Sheet / Billing screen
  modelled on the legacy WMS table. Columns: Job No · Car/Account ·
  Chassis · Job Date · Inv Date · Status (OPEN/CLOSED/VOID bucket) · Amt
  Billed · Estimated · Paid · O/S Amount · Bill No · S.A · Mech. Columns
  with no backing data yet (Inv Date, Estimated, Bill No) render `—`.
  Counters across the top, filter chips (All / Open / Closed / Void for
  super_admin) + search by job no / reg / chassis / customer. Rows are
  click-to-select (highlight + ring) so row-scoped actions can target a
  specific job — selection state lives in the page. Action bar at the
  bottom — wired: "+ New Job Sheet", "Vehicle info", and "Billing
  history" (modal, see below). The rest are placeholders waiting on
  quoting, invoicing, payment-ledger, and warranty flows. The previous
  active-jobs dashboard is gone (replaced by this view).

- **Billing History dialog** (in `ServiceOpsPage.tsx`) — 1:1 port of the
  legacy WMS popup. Opens from the action bar with a job row selected;
  shows every service order for the same vehicle (registration_no) or
  chassis (chassis_no), toggled by the radio group at the bottom. Columns:
  Job Date · Job No · Invoice Date · Invoice No · Account No · Vehicle No
  · Chassis Number · Total. Invoice Date / Invoice No render `—` (no
  service-side invoicing yet). Account No comes from
  `vehicles.account_no` (added to the `ServiceOrderWithJoins.vehicle`
  pick + the `serviceOrders.JOINED_SELECT` in 2026-05-27). Row click
  selects, double-click jumps to the job sheet. Footer buttons mirror
  the legacy: View JobSheet → `/service-orders/:id`, View Billing Item
  → `/service-orders/:id/billing`, Remark expands inline showing the
  selected row's complaint / diagnosis / notes, Close dismisses. The
  modal filters the already-loaded `useServiceOrders()` client-side, so
  no extra DB round trip.

- **Print Billing dialog** (in `ServiceOpsPage.tsx`) — 1:1 port of the
  legacy WMS "Print Billing" popup. Opens from the **Print** action
  button with a job selected. Fields mirror the legacy: Billing
  Number (read-only, taken from `order_no`), Billing Type dropdown
  (Cash / Invoice / Cash-Distribution / Invoice-Distribution /
  Delivery Order / Service Coupon Bill), Standard vs Pre-printed
  format radio, Quotation No / Delivery Order No / Days Completed /
  Time Completed / Remark, plus the Next Service block (Service
  Day / Service KM / Next Service Date / Next Service KM, with the
  next-KM seeded from `mileage_in + 5000`). Preview / Print opens a
  new tab at `/service-orders/:id/bill?type=...&remark=...&nextDate=…
  &nextKm=…` which renders `BillPrintPage` and auto-fires
  `window.print()` once layout settles.

- **StockMenuPage** (`/service/stock`) — Stock Control landing,
  ported from the legacy WMS "Stock Menu" screen. Six tiles: Closing
  Stock Report, Parts List (both wired to the closing-stock report),
  Purchase Order, Stock Received, **Stock Issued (wired 2026-05-30 →
  `/service/stock/issued`)**, FIFO / WIP Re-Calculate (the last two are
  placeholders until a stock-movements ledger lands).
  Quick-stats strip at the top sums `parts_inventory` for
  catalogued / active counts, total value (Σ stock_qty × unit_cost),
  and at-or-below reorder count.

- **StockOnHandPage** (`/service/stock/closing`) — port of the
  legacy WMS `restk-closingstk.xls` Closing Stock report. Reachable
  from the Stock Menu (Closing Stock Report and Parts List tiles).
  Was previously mounted at `/service/stock` directly; moved to make
  room for the menu landing. Groups
  parts by `parts_inventory.category` (OIL / PRT, see migration
  `20260528_parts_inventory_category.sql` — defaults to 'PRT', backfill
  OIL rows manually). Columns mirror the legacy: No · Group (brand) ·
  S/Grp · Code · Description · LOC · BIN · Qty Recv / Issued / Bal ·
  Amt Rec / Issued / on Hand. Sub-totals per category + grand total.
  Qty Bal = `stock_qty`; Amt on Hand = `stock_qty × unit_cost`. The
  Received / Issued columns render `—` until a stock-movements ledger
  lands. Print mode toggle hides the AppShell so the page can be sent
  straight to a printer.

- **StockIssuedListPage** (`/service/stock/issued`, 2026-05-30) — port of
  the legacy WMS "Stock Issued List" report. Lists every part-issue
  transaction (a `service_order_items` row with `kind='part'`) in a date
  range, via the **`stock_issued_list(p_from, p_to)`** SECURITY DEFINER RPC
  (migration `20260530_stock_issued_list_rpc.sql`) — server-side join to
  `service_orders` (date = `coalesce(opened_at, created_at)`, KL-local; bill
  no = `order_no`) and `parts_inventory` (code / group / name). **Flat list,
  no grouping** (we don't store the legacy SubGroup — only `category` +
  `brand`); **Amount = `line_total` (selling)**, per the user's pick.
  Columns: No · Date · Type (ISU) · Job/Bill · Group (brand) · Code ·
  Description · Qty · Amt Issued (RM), with a grand total, date-range +
  sort (Product / Job) + search, Excel CSV export, and print mode (mirrors
  StockOnHandPage). **Driven by `service_order_items` — near-empty until the
  AUTFDB02 service-history import runs**, so it shows little until then.

- **Job Sheet Selection dialog** (in `ServiceOpsPage.tsx`) — 1:1 port
  of the legacy WMS popup. Opens from the **Print Job Sheet** action
  button (which replaced the disabled "Edit Job Sheet" slot). Two
  tiles: **Stock Requisition** → `/service-orders/:id/stock-requisition`
  (`StockRequisitionPrintPage`, port of `jobsheetstd.xls` — Material
  Requisition Form for the parts counter, parts-only items list,
  Stock Code / Material / Qty / Remark / Mechanic columns); **Job
  Sheet / Repair Order** → `/service-orders/:id/repair-order`
  (`RepairOrderPrintPage`, port of `jobsheet.xls` — full RO including
  the Estimated Charges box, complaint/additional-job blocks, vehicle
  inventory checklist, customer signature + service-advisor lines,
  and the long workshop disclaimer). Both reuse the shared
  `Letterhead` component, auto-fire `window.print()` on load, and
  share the `useServiceOrder / useServiceOrderItems / useCustomers /
  useVehicles` data path.

- **BillPrintPage** (`/service-orders/:id/bill`) — printable cash bill
  / invoice / delivery order, 1:1 layout port of the legacy
  `cashbill.xls` template. Shared `Letterhead` component
  (`src/components/Letterhead.tsx`) at the top — Proton logo from
  `/proton-logo.png` (graceful onError hide), company name + tagline
  + address + regulatory numbers from `src/lib/company.ts`, legacy column set (Item / Description / Qty
  / Unit / U/Price / Dis (%) / Amount / Tax / Total RM), Next Service
  Date + KM in the bottom-left, SubTotal / Service Tax / Total
  Payable on the bottom-right, then the acknowledgement block with
  signature + date line. The `?type=` query param flips the title
  strip (Cash Bill / Invoice / Delivery Order / Service Coupon Bill).
  Print CSS hides the toolbar so the paper output is just the form.
  Driven by the existing `useServiceOrder` / `useServiceOrderItems` /
  `useCustomers` / `useVehicles` hooks — no separate billing ledger
  yet, so totals come straight from `service_order_items` and SST is
  applied to labour lines via `src/lib/tax.ts`.

- **Direct Payment dialog** (in `ServiceOpsPage.tsx`) — port of the
  legacy WMS "Direct Payment Section" popup, trimmed for SWL's actual
  cash mix (Cheque Details + Other Payment Type Details fieldsets
  removed, Payment Type dropdown is just Cash / Credit Card / Debit
  Card / eWallet / Bank Transfer). Opens from the action bar
  ("Payment") against the selected job. Pre-fills Account No from
  `vehicle.account_no || customer.name || 'CASH'`, Bill No from
  `order_no`, Billing Amount from `service_orders.total_amount`.
  There's **no service-side payments ledger yet**, so Total Payment
  is 0 and Outstanding == Billing for any not-yet-collected job. OK
  is only enabled when `This Payment >= Outstanding` and flips
  `service_orders.status` to `'collected'` (the workshop's "fully
  paid"); partial payments show an inline amber notice. Already-
  collected jobs show a green notice and OK simply closes.

- **Daily sales digest to Telegram** (2026-05-28) — `pg_cron` job
  `sales_daily_digest` fires `0 11 * * 1-6` UTC (= 7pm Mon–Sat
  Asia/Kuala_Lumpur, Sundays skipped) and calls
  `public.send_sales_digest_now()`, which posts the ASM's five-line
  funnel snapshot to `@PROTON_SWL_MOTORS_SALES_bot`: Today booking ·
  Pending register · Up-to-date Done Register · Have LOU · Wait loan.
  Metric SQL lives in `compute_sales_digest(date)` so the definitions
  are easy to tweak. Pending register and Have LOU are mutually
  exclusive — a row counts in exactly one line. Secrets in Vault:
  `telegram_sales_bot_token` + `telegram_sales_chat_id`. Migrations:
  `20260528_sales_daily_telegram_digest.sql` +
  `20260528_sales_digest_refine.sql`. Manual "Send now" button on
  `AdminDashboardPage` (sales_manager + super_admin) fires the digest
  ad-hoc via the same RPC.

- **Discount approval system** (2026-05-28) — full breakdown rendered
  on the booking form and gated by an auto-flip in the bookings guard
  trigger. Migration:
  `20260528_hq_discount_dealer_support_approval.sql`.
  - `commission_schedules` gains `hq_discount numeric` + `dealer_support numeric` (default 0, ≥ 0). Super admin tunes both on `/admin/commissions` alongside `base_commission`. Reads are open; writes are super_admin only.
  - `bookings` gains `hq_discount` + `dealer_support` (snapshotted from the schedule on INSERT, can't be overridden by anyone except super_admin) and `approval_notes` (manager's reason on approve/reject).
  - `lookup_schedule_for(model, variant)` returns the full schedule row; the BEFORE-INSERT path inside `guard_booking_field_writes` snapshots all three values.
  - `approval_status` auto-flip restored: `discount_amount ≤ base_commission` → `not_required`; `discount_amount > base_commission` → `pending`. Fires on INSERT and on UPDATE-when-discount-changes — but a manager's explicit `approved`/`rejected` decision is sticky once set.
  - NewBookingPage: SA discount input shows a "Cap: RM X" hint and a "Discount breakdown (auto-applied)" section (HQ discount + dealer support + your commission before/after). Amber warning when the SA exceeds their commission.
  - BookingDetailPage: HQ + Dealer strip surfaces above the existing commission breakdown when either value is non-zero.
  - AdminDashboardPage: the discount-approval queue rows show how far the discount exceeds commission, plus an inline notes input. Note is **required when rejecting**. Persists to `bookings.approval_notes`.

- **bookings.vehicle_color is now `text[]`** (2026-05-28, migration
  `20260528_booking_vehicle_color_multi.sql`). Customers can express
  multiple colour preferences ("X or Y, whichever is in stock"). UI:
  pill picker in NewBookingPage + BookingDetailPage; free-text
  fallback for models without a preset palette accepts comma-separated
  values. BookingsPage colour filter flattens across rows; the row
  display joins multi-colour bookings with " / ".

- **3-way reconciliation** (2026-05-29, migration
  `20260529_reconciliation.sql` + edge functions
  `extract-bank-statement` + `extract-document`). Cross-checks four
  sources for every booking:
  1. **Bank statement** — **super_admin only** uploads the
     monthly PDF on `/finance` (RLS + edge fn + FE all enforce this;
     FA + SM can read the resulting lines for context).
     `extract-bank-statement` calls Gemini
     2.5 Flash, parses the credit lines into `bank_statement_lines`
     (date + amount + narration).
  2. **LOU** — FA uploads via the existing `booking_attachments` flow
     (`kind='lou'`). The FE auto-fires `extract-document` after upload
     → `attachment_extractions` row.
  3. **Bank-in receipt** — same path with `kind='bank_transaction'`.
  4. **All-In-One** — SA uploads via `/commission-verify`, populates
     `commission_verifications`.

  AFTER-INSERT triggers on each of those three sources call
  `reconcile_booking(booking_id)`. **Plus (2026-05-30) `trg_booking_reconcile`
  AFTER UPDATE on `bookings`** re-runs it when a reconciled field
  (`loan_amount` / `booking_fee` / `otr_price` / `commission_amount` /
  `loan_bank`) changes — gated to bookings already in the flow so a plain edit
  never spawns rows. This fixes the staleness where finance uploads the LOU
  first and types `loan_amount` later: without it the LOU `loan_amount` diff
  (expected = booking vs got = extracted LOU) never appeared until a manual
  Re-run. Migration `20260530_reconcile_on_booking_change.sql`.
  `reconcile_booking(booking_id)` (SECURITY DEFINER) gathers
  the most recent docs, runs the per-field comparisons, and upserts a
  single row into `booking_reconciliations` with status ∈
  `complete` / `discrepancy` / `missing`. Diff jsonb captures
  per-field expected vs got.

  Matching policy is **strict**: statement line ↔ bank-in receipt
  must have the same amount AND the same `line_date`. Any drift is
  flagged. (Tunable later by relaxing the join in `reconcile_booking`.)
  LOU is auto-satisfied when `bookings.loan_bank = 'cash'`. **LOU loan
  amount (2026-05-30):** the bank LOU states principal + the RM600
  handling fee, so the diff accepts `loan_amount` OR `loan_amount + 600`
  (within RM1) as a match — the RM600 is not flagged.

  `/reconciliation` (FA + SM + super_admin) renders the queue with a
  status pill per booking + a click-in detail panel showing the
  missing docs and per-field diffs. Re-run button fires
  `reconcile_booking` on demand. Storage policies for the new
  `statements/{uid}/...` prefix on `booking-files` scope reads to
  FA + super_admin and writes to the uid that owns the row.

- **Commission verification — Gemini extraction** (2026-05-29, migration
  `20260529_commission_verifications.sql` + edge function
  `supabase/functions/extract-allinone/index.ts`). Sales advisors snap a
  photo of the dealership's "All In One Preparation" form on `/commission-verify`;
  the image lands in Storage at `commission/{uid}/{ts}.jpg` (new
  `bf_commission_*` policies on `storage.objects` scope the prefix —
  uploads only allowed when the second path segment is the caller's uid;
  reads are SA-own / SM+FA+super=all). Frontend then calls the
  `extract-allinone` Edge Function, which:
  - verifies the JWT with `auth.getUser(jwt)` (401 if missing/invalid),
  - looks up the caller's role from `profiles` (403 if not SA/SM/super),
  - enforces an in-memory rate limit (10 req / 60 s / user → 429),
  - path-validates `commission/{uuid}/{filename}` and confirms SAs only
    pull their own uid,
  - downloads the image via the **service-role** client (the FE never
    sees raw bytes, never sees the API key),
  - calls Gemini 1.5 Flash with the 12-field JSON prompt
    (`temperature: 0`, `responseMimeType: 'application/json'`),
  - sanitises the response to only the 12 expected keys, returns
    `{ extracted, file_path }`,
  - logs every call (CALL / ERROR) to `audit_log` with the actor,
    role, stage, and (on failure) the upstream provider's body — the
    user only ever sees `{ error: 'Something went wrong' }`.
  After the user confirms / edits the extracted fields, the FE inserts
  into `commission_verifications` and calls the SECURITY DEFINER RPC
  `match_commission_verification(id)`, which finds the unique booking
  where `customer_name ILIKE extracted_customer_name AND vehicle_model
  ILIKE extracted_model`, sets `booking_id` + `matched=true`, and
  writes `discrepancy_notes` if `extracted_commission ≠
  bookings.commission_amount` (or "Ambiguous: N bookings match…" if
  multiple, or "No matching booking found" if zero). The history table
  shows each row with status pill (green ✓ matched · red ✗ discrepancy
  · amber ⚠ unmatched), a clickable RM diff, and a Re-match button so
  the user can re-run the matcher after editing the booking. **Secret
  setup**: set `GEMINI_API_KEY` via `supabase secrets set
  GEMINI_API_KEY=… --project-ref dguohpdqwyfxlpurnwjw` (free key from
  aistudio.google.com). `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` /
  `SUPABASE_ANON_KEY` are auto-injected by the Supabase runtime.
  `audit_log` also relaxed in the same migration — `row_id` is now
  nullable and the operation check accepts `CALL` / `ERROR` so edge
  function events fit.

- **bookings_insert policy** (reverted 2026-05-28, migration
  `20260528_allow_super_admin_booking_insert.sql`). Briefly locked
  super_admin out of authoring earlier the same day, then reverted at
  user request. Policy is back to `is_super_admin() OR
  (current_app_role() in (sales_advisor, sales_manager) AND owner_id
  = auth.uid())`. NewBookingPage and the AppShell "+ New" pill both
  let super_admin through again. SA / SM rows are still tied to
  `owner_id = auth.uid()`; super_admin has no owner constraint, so
  they can pick any owner (or default to themselves).

- **service_orders RLS — shared workshop reads** (2026-05-28,
  migration `20260528_service_orders_shared_read.sql`). The previous
  `can_read_service_order` scoped a service_advisor caller to rows
  where `service_advisor_id = auth.uid()` (their own jobs). Workshop
  wanted every advisor to see the full floor for handoffs and
  cover. Now anyone except `sales_advisor` can read every row. Write
  access is still tied to ownership via `can_write_service_order`.

- **parts_inventory.category** (2026-05-28, migration
  `20260528_parts_inventory_category.sql`) — `text` column with CHECK
  `in ('OIL', 'PRT')`, default 'PRT'. Powers the OIL/PRT grouping on
  the Closing Stock report. The legacy stock XLS (`restk-closingstk
  .xls`, 1,615 rows) was imported via batched upserts into
  `parts_inventory` so the Inventory Search modal on the Billing
  screen has a working catalogue. **Superseded on 2026-05-29 by the
  full AUTFTP02 catalogue import — now ~80k rows.**

- **Full WMS parts catalogue + editable Parts List** (2026-05-29) —
  imported `AUTFTP02.csv` (80,680 rows) into `parts_inventory` via
  41 batched upserts (`supabase db query --linked -f batch_NNNN.sql`,
  build script at `/tmp/parts_import/build.py`). Mapping:
  `P02_SPART → part_no`, `P02_NAME → name`, `P02_PGROUP → brand`,
  `P02_UOM → unit` (default 'PC'), `P02_CPRICE → unit_cost`,
  `P02_LPRICE1 → unit_price`, `StockOnHand → stock_qty`,
  `P02_ReOrder → reorder_level`, `P02_Location + P02_Bin → location`.
  Category defaults to 'PRT'; names matching OIL / LUBE / GREASE /
  COOLANT / ATF / DEXRON auto-flip to 'OIL' (2,122 rows).
  - New page `/service/stock/parts` (`PartsListPage`) with
    server-side search (part_no OR name, debounced 250ms),
    category + active-only filters, 50/page pagination, and
    **inline cell editing**: click any field, blur to save. Hooks:
    `searchParts` + `updatePart` + `usePartsStats` in
    `src/lib/parts.ts`. Non-SA roles can edit (matches
    `parts_inventory` RLS).
  - `parts_inventory_stats()` SECURITY DEFINER RPC backs the Stock
    Menu's headline counters — server-side aggregate so we don't
    blow the PostgREST 1000-row default cap. Authenticated execute.
  - StockMenu "Parts List" tile now points at the new page (was
    aliased to the Closing Stock report).

- **Telegram service-team notifications** (2026-05-28) — every new
  `service_appointments` row fires a Telegram `sendMessage` via
  `pg_net`. Trigger lives in
  `20260528_appointment_telegram_notify.sql`; SECURITY DEFINER
  function `public.notify_telegram_appointment()` reads the bot
  token + service team chat ID from Supabase Vault (`vault.secrets`
  named `telegram_bot_token` and `telegram_service_chat_id`), so the
  values are encrypted at rest. The function NO-OPs if either secret
  is empty (safe to apply before credentials are provisioned) and
  swallows HTTP failures so a Telegram outage never blocks an
  INSERT. Rotate creds via
  `select vault.update_secret(id, 'NEW') from vault.secrets where name = ...`.

- **Service appointments** (2026-05-27) — customer-facing booking flow
  with hour-long time slots. Tables: `service_appointments` (token-keyed
  for public read-back). Required fields on the public form: name,
  phone, **email**, vehicle reg, **model**, slot, and
  **service interval (km)** — NRIC + chassis no are no longer
  collected (columns kept on the table for legacy rows; the RPC
  signature drops both parameters). The 11 service-mileage tiers (1k / 5k /
  10k / 15k / 20k / 30k / 40k / 50k / 60k / 80k / 100k) live in
  `SERVICE_MILEAGE_OPTIONS` in `src/lib/types.ts`. RPCs (all SECURITY
  DEFINER, anon-callable except where noted):
  - `submit_appointment(... p_slot_time time, p_phone_block boolean)` —
    anon path creates `source='public'` status='pending'; signed-in
    staff get `source='staff'`; staff + `p_phone_block=true` (gated to
    `service_manager` / `service_advisor` / `super_admin`) creates
    `source='phone'` status='confirmed' with `confirmed_at`/`confirmed_by`
    populated, so the slot locks immediately.
  - `get_available_slots(p_date date)` — returns the 8 hour slots
    (09:00–16:00) for the date with `taken` / `capacity`. Sundays and
    past dates return empty. Capacity is 2 cars in parallel.
  - `get_appointment_by_token(uuid)` — public read-back for `/book/:token`.

  Routes (split into public + staff):
  - `/book` (public, **no login**) — standalone form using
    `useAvailableSlots(date)` to render the slot grid; customer picks
    one of the 8 hour slots (full ones disabled) and submits. When the
    picked date is today (Asia/Kuala_Lumpur), any slot whose start
    hour has already passed renders as "Past" and is disabled — see
    `klNow()` helper in BookPage.tsx (uses `Intl.DateTimeFormat` with
    `timeZone='Asia/Kuala_Lumpur'` so the comparison is correct
    regardless of the visitor's browser tz).
  - `/book/:token` (public) — confirmation read-back. Pending shows
    amber, confirmed shows green with "Confirmed for <date> at <time>"
    and the booking summary in read-only mode (the "slot lock").
  - `/service/book` (staff) — same form inside AppShell, plus a
    "Phone booking" checkbox that flips `p_phone_block`.
  - `/service/appointments` (workshop SM/SA/super_admin write,
    store_keeper + mechanic read-only) — queue with Pending /
    Confirmed / Rejected / All tabs, search, per-row Confirm / Reject
    (with reason) / Cancel (on confirmed). Source column tags
    `public` / `staff` / `phone` so phone-blocks are obvious.

  Workshop dashboard tile: the "Payment / Receipt" placeholder slot in
  `ServiceDashboardPage.tsx` now hosts the wired 📅 Appointments tile.

- **Clock-in system** (2026-05-26, sales-advisor exempt) — `/clock-in` runs the browser
  Geolocation API on mount, computes haversine distance to the office
  (anchor 5.3073479, 100.4691911 — Bukit Mertajam, **100 m radius**, from
  `src/lib/geo.ts`), and gates Check In behind being inside the
  geofence. Phone-only — desktop browsers see a "open this on your
  phone" panel instead. Once checked in the page follows a 4-state
  flow: **Out for lunch** (amber) → **Back from lunch** (green) → **Check
  Out (end day)** (rose). Lunch out / in are optional; staff who skip
  lunch tracking can go straight to Check Out. One row per
  `(profile_id, work_date)` with lunch_out_* + lunch_in_*
  (timestamp + lat/lng/distance, all nullable). `/attendance` is the
  employee's own calendar + monthly summary (late = check-in hour ≥ 9
  local). `/admin/attendance` is the manager view (Today tab: who's
  in / late / on lunch / not yet / done with lunch columns; Month tab:
  employees × days dot grid + per-row late count). **Export CSV**
  button on the manager view downloads the current tab as a UTF-8 CSV
  (BOM-prefixed for Excel-on-Windows); gated to super_admin and
  service_manager. Sales advisors are filtered out of the team list
  entirely (they don't clock in) and the three avatar-dropdown entries
  are hidden from them. **Org-chart scoping (2026-05-27)** — the team
  list is filtered by viewer role via `teamRolesFor` in
  `TeamAttendancePage.tsx`: super_admin sees everyone, sales_manager
  sees finance_admin + general_admin, service_manager sees
  service_advisor + store_keeper + mechanic. Only those three manager
  roles can reach `/admin/attendance` at all — every other is_admin
  user (FA / GA / workshop staff) is redirected to `/attendance` and
  the Team-attendance link is hidden from their avatar menu.

- **Cross-side URL gates** (2026-05-27) — auth context exports two
  mirrored flags. `canAccessSales` is true for everyone except the four
  workshop-only roles; `canAccessService` is true only for super_admin
  and the four workshop roles. Every page on the opposite side starts
  with `if (canAccessX === false) return <Navigate to="/" replace />`
  so a sales advisor who types `/vehicles` or a workshop role who
  types `/bookings` lands back on their own home. While the role is
  still hydrating (`role == null`) both flags default to true so the
  page mounts and then re-renders with the right decision.

- **AdminDashboardPage** still serves super_admin and sales_manager.
  `RoleHome` dispatches:
  ```
  workshop role         → ServiceDashboardPage (all 4 — advisor, manager, store_keeper, mechanic)
  super_admin + service → ServiceDashboardPage
  finance_admin         → <Navigate to="/finance">
  general_admin         → GeneralAdminDashboardPage
  else if isAdmin       → AdminDashboardPage
  else                  → DashboardPage  (sales_advisor)
  ```

## Malaysian SST on labour

`src/lib/tax.ts` exports `SST_LABOUR_RATE` (default `0.08`, the post-2024
service tax rate) + `SST_LABOUR_LABEL` + `labourSST(nett)`. The Billing
screen applies it to `kind='labour'` line items only; parts are
zero-rated. Change the constant and every screen (entry-form Calc strip,
per-row Tax Amount (S), Totals "Tax Amount (+)") picks up the new rate.

## Performance work already done

- Vite `manualChunks` splits react / supabase vendor into stable chunks (cached forever).
- All routes lazy-loaded via `React.lazy` + Suspense; per-page chunk size ~1–5 KB gzip.
- `vercel.json` sets `cache-control: public, max-age=31536000, immutable` on `/assets/*` (was `max-age=0` from Vercel defaults). SPA rewrite excludes `/assets/` so missing-chunk 404s don't return HTML.
- React Query with 30s staleTime, 5min gcTime, retry 1. All pages use `useQuery` / `useMutation` via `src/lib/queries.ts`.
- supabase-js auth-lock deadlock fixed in `src/lib/auth.tsx` — `onAuthStateChange` callback stays synchronous, profile fetch deferred via `setTimeout(0)`. See <https://github.com/supabase/auth-js/issues/762> for context.

## Security posture (last audited 2026-05-27)

- **RLS:** all 17 public tables have RLS enabled with ≥1 policy. Verified
  via `pg_class.relrowsecurity` + `pg_policies` join. No table is wide
  open.
- **API keys:** FE reads `import.meta.env.VITE_SUPABASE_URL` +
  `VITE_SUPABASE_PUBLISHABLE_KEY` only (`src/lib/supabase.ts`); no JWT
  strings or supabase.co URLs are hardcoded in `src/` or `supabase/`.
  `.env.local` is gitignored via `*.local` and not tracked. The
  Telegram edge function reads `SUPABASE_SERVICE_ROLE_KEY` from
  `Deno.env.get(…)` — that key must stay in the edge function's env
  scope on Vercel and never leak into the browser bundle.
- **Linter sweep** — migration `20260527_security_lints.sql` cleared the
  five fixable warnings (search_path on `generate_service_order_no`;
  revoked anon EXECUTE on `can_read_service_order` /
  `can_write_service_order` while keeping authenticated EXECUTE;
  revoked everyone from `rls_auto_enable`). Warning count is now
  20 → 15.
- **Intentional residual warnings** — kept as-is because removing them
  would break the app:
  - `customers_insert` / `customers_update` policies are `(true)` —
    the SA booking flow upserts customers by NRIC, so any signed-in
    user needs INSERT + UPDATE. To tighten this we'd need a
    `created_by` column on customers and a per-row owner gate.
  - `submit_appointment`, `get_appointment_by_token`,
    `get_available_slots` are anon-callable — the public `/book`
    customer flow depends on them.
  - `is_admin`, `is_super_admin`, `has_role`, `current_app_role`,
    `can_read_service_order`, `can_write_service_order` are
    authenticated-callable via `/rest/v1/rpc/*` because every RLS
    policy in the app invokes them. The only way to hide them from
    PostgREST is to move them into a non-public schema, which is an
    invasive refactor with no real security gain.
- **Dashboard TODOs (cannot be done via SQL):**
  - Auth → Policies → enable **Leaked-password protection** (HIBP).
  - Project Settings → Database → Backups → verify daily backups are
    on (Free = 1-day retention, Pro = 7-day; toggle PITR if you need
    point-in-time recovery).
  - Vercel → Project Settings → Environment Variables — confirm
    `VITE_SUPABASE_URL` + `VITE_SUPABASE_PUBLISHABLE_KEY` exist for
    Production / Preview / Development, and that
    `SUPABASE_SERVICE_ROLE_KEY` is only scoped to the edge function.

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
20260526_service_order_intake_fields.sql          service_orders +department, +service_types text[], +appointment_type, +days_to_complete
20260526_drop_service_order_department.sql        drops service_orders.department (added + reverted same day; workshop doesn't use it)
20260526_wms_account_fields.sql                   vehicles +account/membership/engine/capacity/year_make/registration_date/warranty_date; customers +city/state/post_code/phone2/fax_no/tin_no/tax_no/sex/race/marital_status/birthday/sales_dealer/status/fixed_discount_rate/preference_list_price + 3 renewal dates + 5 reminder flags + send_greeting_card
20260526_attendance.sql                            attendance table (one row per profile per work_date), check-in/out lat-lng-distance, RLS: own + is_admin select-all, super delete
20260527_attendance_lunch.sql                      attendance +lunch_out_* (4) +lunch_in_* (4); all nullable so staff can skip lunch tracking
20260527_customer_type_and_booking_payment.sql    customers.customer_type ('individual'|'company') + bookings.booking_fee_method ('cash'|'qr'|'transfer') + bookings.official_receipt_no
20260527_security_lints.sql                        search_path pin on generate_service_order_no + revoke anon EXECUTE on can_read/can_write_service_order + drop all EXECUTE on rls_auto_enable (5 of 20 advisor warnings cleared)
20260527_service_appointments.sql                  service_appointments table + submit_appointment RPC + get_appointment_by_token RPC (customer-facing booking flow)
20260527_service_appointment_slots.sql             service_appointments.slot_time (HH:MM:SS) + 'phone' source + capacity check inside submit_appointment + get_available_slots RPC (8 hour slots Mon–Sat 9–5, capacity 2)
20260527_service_appointment_form_v2.sql           submit_appointment v2: drop NRIC param, require email/chassis/model/mileage, add service_mileage int (1k/5k/10k/.../100k)
20260527_service_appointment_drop_chassis.sql      submit_appointment v3: drop chassis param (per user feedback)
20260528_parts_inventory_category.sql              parts_inventory +category text default 'PRT' check in ('OIL','PRT') + index; powers the Closing Stock report grouping
20260528_appointment_telegram_notify.sql           pg_net trigger on service_appointments INSERT → Telegram via @protonswlservicebot. Bot token + chat ID in Supabase Vault (telegram_bot_token / telegram_service_chat_id)
20260528_sales_daily_telegram_digest.sql           pg_cron job sales_daily_digest + compute_sales_digest(date) + send_sales_digest_now() → @PROTON_SWL_MOTORS_SALES_bot
20260528_sales_digest_refine.sql                   Refine funnel (no payment requirement on Pending register; Have LOU mutually exclusive with Pending register) + reschedule Mon–Sat only (0 11 * * 1-6)
20260528_service_orders_shared_read.sql            can_read_service_order: every workshop role sees the full job-sheet queue (was scoped to service_advisor = caller)
20260528_block_super_admin_booking_insert.sql      bookings_insert RLS: super_admin removed; only sales_advisor / sales_manager (with own owner_id) can author bookings (REVERTED later same day, see next)
20260528_allow_super_admin_booking_insert.sql      Revert: bookings_insert RLS restored to is_super_admin() OR (sales_advisor / sales_manager AND owner_id = auth.uid())
20260529_commission_verifications.sql              commission_verifications table + RLS + match_commission_verification RPC + storage policies for commission/{uid}/* prefix on booking-files. audit_log loosened (row_id nullable, ops now include 'CALL'/'ERROR') so the extract-allinone edge function can log events. Includes the table GRANT to authenticated (was applied separately in prod via commission_verifications_grants migration and folded back into this file — without the GRANT every query 500s before RLS runs).
20260529_reconciliation.sql                        4 tables: bank_statements + bank_statement_lines + attachment_extractions + booking_reconciliations. reconcile_booking(uuid) SECURITY DEFINER RPC. Triggers on commission_verifications + attachment_extractions + bank_statement_lines auto-fire reconciliation when any source doc changes. Storage policies for statements/{uid}/* prefix on booking-files.
20260528_booking_vehicle_color_multi.sql           bookings.vehicle_color text → text[] (legacy single-colour rows become 1-element arrays). Multi-select pill picker in NewBookingPage + BookingDetailPage.
20260528_hq_discount_dealer_support_approval.sql   commission_schedules + bookings get hq_discount + dealer_support; bookings +approval_notes; lookup_schedule_for() helper; guard rewrite to snapshot HQ+dealer + auto-flip approval_status on the discount-vs-commission rule (manager's decision sticks once set)
20260530_commission_schedules_audit.sql           trg_commission_schedules_audit AFTER INSERT/UPDATE/DELETE → reuses generic write_audit_log(); powers the 🕓 Change log on /admin/commissions (super_admin only, via audit_log RLS)
20260530_bank_statements_original_name.sql        bank_statements +original_name text — operator's uploaded filename, shown (clickable → signed URL) in the Bank statements card on /reconciliation
20260530_stock_issued_list_rpc.sql                stock_issued_list(p_from,p_to) SECURITY DEFINER RPC — every part-issue txn in a date range; powers StockIssuedListPage at /service/stock/issued
20260530_commission_schedule_backfill_bookings.sql  trg_commission_schedule_backfill + backfill_booking_commission() — schedule add/update fills NULL-base bookings (one-time backfill included); guard recomputes commission_amount
20260530_booking_attachments_audit.sql            trg_booking_attachments_audit → write_audit_log(); document uploads/removals now show in the booking 🕓 Activity (BookingActivityLog merges them in)
20260530_document_verification_system.sql         DOC-VERIFICATION SYSTEM Phase A (schema). notifications + document_verifications tables (+RLS/grants/policies), bookings +all_in_one_status/down_payment_status/lou_status/documents_complete/total_received_down_payment/payment_type(cash/loan/floor_stock — distinct from payments.payment_type), document-verification/{uid}/ storage policies, notification RPCs.
20260530_reconcile_on_booking_change.sql          trg_booking_reconcile AFTER UPDATE on bookings → re-run reconcile_booking when loan_amount/booking_fee/otr_price/commission_amount/loan_bank changes (gated to bookings already reconciled). Fixes stale LOU/bank-in diffs when finance fills fields after docs were uploaded. Includes one-time refresh of all existing reconciliations.
20260530_lou_handling_fee_tolerance.sql           reconcile_booking: LOU loan-amount diff now accepts loan_amount OR loan_amount + RM600 handling fee (within RM1) as a match — the bank LOU states principal + handling fee, so the RM600 is no longer a false discrepancy. Handling fee = `v_handling_fee constant numeric := 600` (D3). Re-runs all existing reconciliations.
20260530_document_verification_complete.sql       DOC-VERIFICATION SYSTEM Phase F (completion engine). guard_booking_field_writes rewrite + app.system_op bypass; recompute_booking_documents() (source of truth: derives the 3 doc statuses + payment_type + total_received, writes onto booking guard-bypassed, unlocks commission not_eligible→pending on documents_complete false→true, fans out notifications); trg_document_verifications_recompute (AFTER INSERT/UPDATE); check_booking_complete() authenticated re-check wrapper; _dv_notify/_dv_notify_finance. Edge fns extract-all-in-one/extract-down-payment/extract-lou (+_shared/docverify.ts) deployed separately via MCP.
```

Some early ones were **applied by hand** in Supabase SQL editor and so don't show up in `supabase_migrations.schema_migrations`. The files are still source of truth for what should exist.

Schema drift noted earlier: `delivered_at` (in migrations) vs `expected_delivery` (in DB). Frontend uses `delivered_at` (typed in `types.ts`); reading it returns undefined. Low priority but worth fixing if anything actually depends on delivery timestamp.

## Open TODOs (the user has asked for these — not yet started)

- **6.5 Excel/CSV upload** for commission_schedules (user wanted this in original spec but we built manual-row UI first to validate the flow).
- **Half-monthly payout batch detail page** — past batches list exists, but no drill-in view of which bookings were included in a given batch.
- ~~Re-snapshot existing bookings' `base_commission` when a schedule row is added/updated~~ **DONE 2026-05-30** (`20260530_commission_schedule_backfill_bookings.sql`) — schedule INSERT/UPDATE backfills bookings with NULL `base_commission`; never rewrites already-snapshotted ones.
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

## Session log — 2026-05-29 (big one)

A long session that built ~10 net-new features and ran several large data
imports. Recovery shortlist of every decision + table + route landed,
so a fresh session doesn't have to re-derive context.

### Sales-side micro-fixes early in the session
- **Booking creation reverted for super_admin** — the 2026-05-28 lockdown
  was rolled back the same day. `bookings_insert` policy back to
  `is_super_admin() OR (sales_advisor/sales_manager AND owner_id =
  auth.uid())`. NewBookingPage + AppShell "+ New" both let super_admin
  through again. Migrations: `20260528_block_super_admin_booking_insert`
  → `20260528_allow_super_admin_booking_insert` (revert).
- **Hide past time slots on `/book`** when today is selected — see
  `klNow()` helper using `Intl.DateTimeFormat` with `timeZone='Asia/
  Kuala_Lumpur'`.

### Commission verification (`/commission-verify`)
- New table `commission_verifications` + 12-field extraction via Gemini
  2.5 Flash. Edge function `extract-allinone` (security: JWT verify, role
  gate, path ownership, rate-limit 10/min, audit_log, generic-error
  surface). RPC `match_commission_verification` auto-matches by
  `customer_name ILIKE` + `model ILIKE`. Storage prefix
  `commission/{uid}/` on `booking-files`. Required GRANTs landed via
  `commission_verifications_grants` follow-up (table-level privileges
  were missed the first pass and every query 500'd until added).
- Gemini model: `gemini-2.5-flash` (was `gemini-1.5-flash` for one
  ship; Google retired it the same day → 404 on v1beta).

### 3-way reconciliation (`/reconciliation`)
- 4 new tables: `bank_statements`, `bank_statement_lines`,
  `attachment_extractions`, `booking_reconciliations`. RPC
  `reconcile_booking(uuid)` SECURITY DEFINER aggregates the four source
  docs (All-In-One verification + LOU + bank-in + statement line) into a
  single per-booking row with status ∈ complete / discrepancy / missing
  and a `details jsonb` of per-field diffs.
- Edge functions: `extract-bank-statement` (PDF → line items),
  `extract-document` (generic LOU / bank-in extractor, called from FE
  after attachment upload).
- AFTER-INSERT triggers on `commission_verifications`,
  `attachment_extractions`, `bank_statement_lines` all call
  `reconcile_booking()` so the queue updates as docs land. Matching is
  **strict** (amount + date exact) — tunable later in the
  `reconcile_booking()` SQL.
- `/finance` gained an "Upload statement PDF" section, **super_admin
  only** (DB + edge fn + FE all gated; FA can read existing statements
  for context).

### Workspace nav — multiple iterations to URL-driven
- Tried merging Sales + Service nav for super_admin (one-row);
  user pushed back ("the navi service only show service, sales only show
  sales"). Landed on **URL-driven nav**: AppShell derives `onServicePath`
  from `useLocation().pathname` and renders one side or the other.
- SideSwitcher pill (super_admin only) navigates between sides; its
  highlight is read from the URL, not from any persisted state.
- `useWorkspace()` retired entirely; `RoleHome` no longer consults it
  (stale state was sending super_admin to the workshop dashboard on
  every `/` hit).
- Brand 🚗 logo + Home link target either `/` or `/service` depending
  on which side you're currently on, so Home doesn't yank super_admin
  across sides.

### Parts inventory — major rebuild
- **Imported AUTFTP02.csv** (80,680 rows) → upserted into
  `parts_inventory` (later trimmed back to 1,580 — see below).
- **`parts_inventory_stats()` RPC** — server-aggregated stats for Stock
  Menu (avoids the PostgREST 1000-row default cap).
- **Editable Parts List** at `/service/stock/parts` (`PartsListPage`):
  server-side search + 50-page pagination. Successive user requests
  stripped down what was editable until the **final shape was
  read-only with only 6 columns**: Part no · Name · Cat · Unit ·
  Price · Qty. Brand, Cost, Reorder, Location, Active all removed
  from the table. "Active only" filter also removed.
- **Closing Stock XLSX sync** (`Closing_Stock_2026-05-28 claude.xlsx`):
  - 1st pass: refreshed name + category + stock_qty for 1,615 rows.
  - 2nd pass (deletion): user said "only follow the latest excel" —
    deleted 79,107 rows not in the XLSX. parts_inventory dropped from
    80,722 → 1,615.
  - 3rd pass: synced `brand` (from XLSX `Group`) and `unit_cost`
    (from `Amt On Hand / Qty Balance`) for the Closing Stock Report
    Amt column to match the XLSX RM totals.
  - 4th pass: dropped the 35 `*** DO NOT USE ***` rows → **1,580 rows
    final**.
- **`qty_received` + `qty_issued` numeric columns** added to
  `parts_inventory` (NOT NULL DEFAULT 0, CHECK ≥ 0) — synced from the
  Closing Stock XLSX. Surfaced as Recv / Issued columns on the
  Closing Stock Report.
- **Closing Stock Report polish** (`StockOnHandPage`):
  - Trimmed 13 legacy columns down to 7: No · Group · Code ·
    Description · Recv · Issued · Bal · Cost/Qty · Amt on Hand.
  - 3 summary cards (OIL · PRT · Total) at the top, also visible in
    print mode.
  - **Excel export** button — UTF-8 CSV with BOM, subtotal + grand
    total rows, opens cleanly in Excel-on-Windows.
  - `listParts()` now `.range(0, 4999)` to bypass the 1000-row
    PostgREST cap (silently missing ~580 rows before).

### Stock Received module (`/service/stock/receive`)
- New tables `suppliers` (23 rows from AUTFDV01.csv), `stock_receipts`
  (bigserial `receipt_no`), `stock_receipt_items` (generated
  `line_total`).
- Two SECURITY DEFINER triggers:
  - `trg_stock_receipt_item_apply` — bumps `parts_inventory.stock_qty`
    + `qty_received` on each item INSERT.
  - `trg_stock_receipt_rollup` — keeps `stock_receipts.total_qty +
    total_cost` in sync.
- **Two issue triggers** on `service_order_items`:
  - `trg_service_order_item_stock` — symmetric subtract from
    `stock_qty` + add to `qty_issued` on kind='part' line inserts
    (handles UPDATE diff + DELETE revert + part_id swap + kind flip).
- **QR / barcode scanner** (`QrScannerModal` lazy-loaded
  ~370 KB chunk). Two modes:
  - `mode='qr'` for DO codes: QR + Data Matrix + Aztec + PDF 417,
    fps=10, flip-detect on.
  - `mode='barcode'` for part labels: CODE_128/93/39, CODABAR, ITF,
    EAN, UPC, fps=12, flip-detect off. Uses native `BarcodeDetector`
    API when available (Chrome Android, Safari iOS 17+).
  - **Viewfinder (fixed 2026-05-30):** html5-qrcode's built-in `qrbox`
    shaded region was dropped — it mis-rendered when the camera stream
    aspect didn't match the square preview, squashing the QR box into a
    wide strip and collapsing the barcode band into a thin, unscannable
    line. Now: scan the **whole frame** (no `qrbox`), force the injected
    `<video>` to `object-fit:cover` the square preview via a global rule
    in `src/index.css` (`#qr-scanner-region video`), and draw our **own**
    centred guide box over the feed — a real square (`72%`) for QR, a
    wide band (`70% × 26%`) for barcode. So the guide always matches what
    actually decodes.
  - **Focus / blur fix (2026-05-30):** filling the box made operators hold
    the phone closer than the lens can focus → blurry bars that won't
    decode. Fix: request a high-res rear stream via
    `videoConstraints: { facingMode:'environment', width:{ideal:1280},
    height:{ideal:720} }` (passed in the *config* arg — html5-qrcode's
    validator only bans audio keys, so width/height/advanced are fine),
    so a barcode that fills only part of the frame still has enough pixels
    to decode and can be held at a sharp distance. Plus a best-effort
    `track.applyConstraints({ advanced:[{ focusMode:'continuous' }] })`
    after `start()` (no-ops on iOS Safari, never fatal) and copy that
    tells the operator to hold ~15–20 cm away and **not** fill the box.
  - **WASM decoder polyfill (2026-05-30):** the real blocker for dense
    Code 128 / Code 39 Proton part labels was the *decoder*. html5-qrcode
    uses `window.BarcodeDetector` as its primary decoder when present (we
    enable `useBarCodeDetectorIfSupported`); iOS Safari has no native one,
    so it fell back to pure-JS ZXing, which is weak on 1-D codes — "few
    OK, most fail". Fix: `src/lib/barcodeDetectorPolyfill.ts` (side-effect
    import in `QrScannerModal`) installs a **WASM-backed** `BarcodeDetector`
    (`barcode-detector` → `zxing-wasm`) **only when there's no native one**
    (Android Chrome keeps its native detector). html5-qrcode then uses the
    WASM engine automatically. The ~1 MB `zxing_reader.wasm` is bundled
    locally (Vite `?url` + `setZXingModuleOverrides({ locateFile })`, no
    CDN dependency), lives in the lazy `QrScannerModal` chunk, loads on
    first scan, and is **not** in the SW precache.
  - **Full-resolution decode pass (2026-05-30):** the polyfill helped but
    some dense labels still failed — because html5-qrcode hands its decoder
    a canvas scaled to the *preview* size (~300px on a phone), blurring thin
    bars. Fix: in **barcode mode only**, we run an **additive** decode loop
    (`src/lib/zxingReader.ts`, `decodeBarcodeFromImageData` via
    `zxing-wasm/reader` with `tryHarder/tryRotate/tryInvert`) over the
    camera's **native-resolution** frame — grab html5-qrcode's own `<video>`,
    `drawImage` it to a full-res offscreen canvas, decode the `ImageData`
    every ~200 ms. html5-qrcode still runs the camera/preview + its own
    decode unchanged, so this can only *add* catches (whichever path reads
    first wins; `handleHit` de-dupes). Same locally-bundled
    `zxing_reader.wasm` (one shared asset). If a label still won't read,
    the operator can type the `part_no` (the Stock Receive field accepts it).
- **Uniqueness rails on Stock Receive**:
  - DB: partial UNIQUE INDEX on `stock_receipts.do_no WHERE do_no IS
    NOT NULL` (`stock_receipts_do_no_unique`).
  - FE: addLine blocks duplicate part within the same draft; save
    handler intercepts the Postgres unique-violation and surfaces a
    friendly DO-already-exists message.
- Auto-fill unit cost: leaving the cost input blank uses the part
  master's current `unit_cost`.

### Inquiry hub (`/service/inquiry`)
- New tile menu mirroring the legacy WMS Inquiry Form. Wired tiles:
  Job Sheet/Billing History → `/service/ops`, Outstanding Payment
  (same), Stock On Hand → closing report, Stock Purchase History (NEW
  page), Client Account Master → **/service/customers** (workshop side),
  Client Vehicle → `/vehicles`, **Vendor/Supplier** (NEW page),
  **Vehicle Type** (NEW page), Parts → editable list, Lubricants →
  same with `category=OIL`.
- New sub-pages:
  - **`/service/inquiry/suppliers`** (`SuppliersInquiryPage`) — list +
    detail panel (address, contact, SST, TIN, MSIC, biz activity) +
    inline **"+ New supplier"** form (SST format, NRIC-unique
    handled). The legacy "GST No" was renamed to **SST No** everywhere
    (DB column rename `suppliers.gst_no → sst_no` plus all FE labels).
  - **`/service/inquiry/receipts`** (`StockPurchaseHistoryPage`) —
    last 200 stock_receipts, search, expandable line items.
  - **`/service/inquiry/vehicle-types`** (`VehicleTypesInquiryPage`)
    — 86-row Proton model master imported from AUTFDV02.csv.
    Includes "In shop" column counting workshop vehicles whose
    `.model` matches (case-insensitive bidirectional substring).
  - **`/service/customers`** (`ServiceCustomersPage`) — see service
    customer split below.

### Service customer split (Pass 2 — option B picked)
- New `public.service_customers` table — 33-column mirror of
  `customers` + `sales_customer_id` back-reference.
- New nullable `service_customer_id` FK on **`vehicles`** and
  **`service_orders`** (legacy `customer_id` kept for dual-write
  during the transition).
- **Backfill**: every customer referenced by an existing
  vehicle/service_order cloned into `service_customers` and the new FK
  populated. 0 orphans after.
- **Auto-import trigger**: `trg_auto_import_service_on_delivery` AFTER
  UPDATE OF status on `bookings`. When transitioning to `'delivered'`,
  the function `auto_import_to_service_on_delivery()` clones the
  customer (idempotent by `sales_customer_id` → `nric`), and creates
  a `vehicles` row from the linked car's chassis + model (idempotent
  by `chassis_no` UNIQUE). Errors swallowed via `RAISE WARNING` so a
  malformed booking can never block its own status change.
- `/vehicles` and `/vehicles/:id` queries prefer the
  `service_customer` join, falling back to legacy `customer` only when
  `service_customer_id` is null. Normalisation done in
  `lib/vehicles.ts::normalise()` so `VehicleWithCustomer.customer`
  stays a single field for the UI.

### Vehicle type ↔ vehicle linkage
- `vehicles.vehicle_type_id` FK added, ON DELETE SET NULL.
- Backfill: case-insensitive bidirectional substring match between
  `vehicles.model` and `vehicle_types.name`, shortest match wins.
- Slate badge with `vehicle_types.code` shown next to the model on
  the Vehicles list, full name on hover.
- **Bulk-seeded 86 placeholder vehicles** from `vehicle_types` per
  user request ("move all in. i will filter after that"):
  `customer_id NOT NULL` constraint dropped, then one
  `vehicles` row per type with `registration_no='TYPE-<code>'`,
  `model=<full name>`, `variant=<profit_center>`, `vehicle_type_id`
  back-linked. Easy filter: `WHERE registration_no LIKE 'TYPE-%'` or
  `WHERE customer_id IS NULL`.

### Telegram
- **Appointment notifications already work** for `/book` submissions —
  same trigger as 2026-05-28, fires on every `service_appointments`
  INSERT regardless of source (public / staff / phone).
- Group chat ID switched: vault.`telegram_service_chat_id` updated to
  `-1003740722189` (14-char negative = group/supergroup). Bot must be
  a member of the group.
- `telegram_bot_token` (vault) + `TELEGRAM_BOT_TOKEN` (edge fn env)
  both rotated to `8827323520:AAH…` and kept in sync. Note: the new
  bot needs the same webhook re-set via `setWebhook` if you want the
  `/inventory` `/help` command flow back.

### Smaller fixes / decisions worth noting
- `/finance` upload UI: bank statement upload is **super_admin only**
  across all three layers (DB RLS, edge fn role check, FE conditional
  render). FA still sees the historical list for context.
- `+ New booking` was unwired for super_admin once during the session
  (per a 2026-05-28 lockdown). The whole-session arc reverted that
  decision back to permissive.
- Several timing / lifecycle bugs in the QR scanner: facingMode wants
  bare string (not `{ ideal: ... }`); useEffect deps were thrashing
  on parent re-renders; surfaced as "Element with id qr-scanner-region
  not found" → fixed by stashing onScan/onClose in refs + pinning the
  start-effect to `[open, mode]`.

### Data import in flight at session end — AUTFDJ02 / AUTFDB02

User started a major service-history import (legacy WMS): owners +
vehicles + service_orders + service_order_items. **Dry-run completed,
user approved with "lets go with details"** but execution was
interrupted before any writes landed.

Plan when resuming:
1. **Schema prep** (not yet applied):
   - `ALTER TABLE public.service_orders ALTER COLUMN customer_id DROP NOT NULL`
   - `ALTER TABLE public.service_order_items DISABLE TRIGGER trg_service_order_item_stock`
     (otherwise the ~167k matched part lines will tank `parts_inventory.stock_qty`)
2. **Layer 1 — owners**: 10,350 unique (name, phone) from `AUTFDJ02.csv`
   → `public.service_customers`. Blank phones → `'0000000000'`. Idempotent
   on (name, phone).
3. **Layer 2 — vehicles**: 9,537 unique plates (latest jobdte wins for
   mileage/owner). Chassis nulled when `chassis == plate` (~1,200 rows).
   `vehicle_type_id` matched by name (~7.2% hit rate; 91/9537). Upsert
   on `registration_no`. Existing 87 placeholders untouched (TYPE-*
   prefix can't collide with real plates).
4. **Layer 3 — service_orders**: 40,055 rows, no dedup. Status map
   `CLOSED→collected, OPEN→open, DELETE→cancelled`. `customer_id=NULL`
   (allowed after the ALTER above). `service_customer_id` looked up by
   (name, phone). `vehicle_id` looked up by plate. Upsert on `order_no`.
5. **Layer 4 — service_order_items**: 268,465 rows (32 orphans skipped).
   TXNCAT map: `SRV` + `WRK` → labour; everything else (`PRT`, `OIL`,
   `DCT`, `NSK`, `PCK`) → part. `part_id` matched by stkcde (~55.3% hit
   rate; 1,382/2,500 distinct codes). For re-runs:
   `DELETE FROM stock_receipt_items WHERE service_order_id IN (...)`
   before re-insert.
6. **Cleanup**: re-enable the stock trigger,
   `ALTER TABLE service_order_items ENABLE TRIGGER trg_service_order_item_stock`.
   Report row counts + match rates.

Generated dry-run helpers in `/tmp/parts_import/dry/` —
`order_nos.txt`, `makes.txt`, `codes.txt`, `q_makes.sql`, `q_codes.sql`.
Source CSVs at `/Users/khorheeshin/Claude Fun/wms_data/AUTFDJ02.csv`
and `AUTFDB02.csv` (latin-1 encoded).

## ✅ Document Verification System — COMPLETE (2026-05-30)

Big multi-part feature (AI doc extraction + Finance-Admin review + in-app
notifications) from a detailed user spec. **All phases A–F shipped.** Key
decisions were locked (below) and held.

### How it flows end-to-end
1. **SA uploads** on `/bookings/:id` (📄 Document submission cards, gated
   SA+SM+super) → `document-verification/{uid}/{docType}-{ts}.{ext}` on
   `booking-files` → invokes the matching extractor edge fn.
2. **Edge fn** (`extract-all-in-one` / `extract-down-payment` / `extract-lou`,
   all on `gemini-2.5-flash`) verifies JWT + role + path/booking ownership +
   rate limit, downloads the image via service-role, calls Gemini, and
   **inserts a `document_verifications` row** (no-SM-signature All-In-One →
   `rejected`; otherwise `pending`; down-payment → `approved` auto; LOU →
   `needs_review`).
3. **`trg_document_verifications_recompute`** (AFTER INSERT/UPDATE) →
   `recompute_booking_documents(booking_id)` is the **single source of truth**:
   it re-derives `all_in_one_status` / `down_payment_status` / `lou_status` /
   `total_received_down_payment` / `payment_type` from the DV rows, writes them
   onto the booking (guard bypassed), and on the `documents_complete` false→true
   transition sets `documents_complete` + **unlocks commission**
   (`not_eligible`→`pending`, or `approved` if owner is SM) + fans out
   notifications.
4. **Finance reviews** on `/finance` (📋 Document verification queue): approve /
   reject the All-In-One; type the loan amount + confirm the LOU
   (match-within-RM1 flagged). Each review is a plain UPDATE on
   `document_verifications` → the same trigger re-derives + notifies.

Completion rule by `payment_type`: **cash/floor_stock** = All-In-One approved +
down payment complete; **loan** also requires LOU verified. `documents_complete`
never flips while `payment_type` is still unknown. Down-payment "complete" =
Σ receipts ≥ (total_otr − loan) within RM1. The all-in-one extraction is what
auto-sets `payment_type` when it was null.

**Guard interaction solved:** `guard_booking_field_writes` got a
transaction-local `app.system_op='on'` early-return (mirroring the cars guard);
`recompute_booking_documents` flips that flag around its UPDATE, so writing
system-managed columns (incl. `commission_status`) never trips the role gate or
the pending→not_eligible auto-demotion. recompute is the ONLY thing that writes
the booking doc-status columns — never the FE directly.

### Locked decisions (do NOT relitigate)
- **D1 — Separate `document_verifications` table + new edge fns. Do NOT extend
  the existing `commission_verifications`/`extract-allinone` system.** They are
  deliberately PARALLEL pipelines that both read the "All In One" form. The
  commission/`/commission-verify`/reconciliation flow stays untouched.
- **D2 — `bookings.payment_type`** = deal financing type `cash`/`loan`/`floor_stock`
  (added, nullable, no backfill yet). DISTINCT from `payments.payment_type`
  (deposit/full/partial = payment method).
- **D3 — RM600 handling fee = a constant in the edge fn** (`HANDLING_FEE = 600`),
  not a DB column.
- **D4 — Gemini model = `gemini-2.5-flash`** (the spec said 1.5; prod runs 2.5 —
  use 2.5, matching `extract-allinone/index.ts`).
- **D5 — HEIC** passed inline to Gemini; 10 MB cap enforced client + server.
- **D6 — Notification fan-out via the `create_notification()` RPC** (single
  audited, RLS-bypassing path); edge fns call it with the service-role client.

### ✅ Phase A — schema (DONE, applied to prod, committed `66b0eb4`)
Migration `supabase/migrations/20260530_document_verification_system.sql`:
- Tables `notifications` + `document_verifications` (+RLS/grants/policies — see
  the Tables section above for columns). updated_at trigger `dv_set_updated_at`.
- `bookings` += `all_in_one_status`, `down_payment_status`, `lou_status`,
  `documents_complete`, `total_received_down_payment`, `payment_type`.
- Storage policies `bf_docverif_*` for the `document-verification/{uid}/...`
  prefix on `booking-files`.
- RPCs `get_unread_notification_count`, `mark_notification_read`,
  `mark_all_notifications_read`, `create_notification` (Part 7). Verified:
  notification RPC round-trip works.

### ✅ Phase B — notification bell + page (DONE, builds green; committed + pushed
alongside this status note at the pause point)
Files (created/edited):
- CREATE `src/lib/notifications.ts` — list/getUnreadCount/markRead/markAllRead.
- CREATE `src/components/NotificationBell.tsx` — top-nav 🔔 + badge + dropdown
  (exports `NOTIFICATION_ICON`, `notifTimeAgo`).
- CREATE `src/pages/NotificationsPage.tsx` — `/notifications` full list + filters.
- EDIT `src/lib/types.ts` — `AppNotification` + `NotificationType`.
- EDIT `src/lib/queries.ts` — imports, `qk.notifications`/`qk.unreadCount`,
  hooks `useNotifications`/`useUnreadCount` (60s poll)/`useMarkNotificationRead`/
  `useMarkAllNotificationsRead`.
- EDIT `src/components/AppShell.tsx` — `<NotificationBell />` before `<UserMenu>`.
- EDIT `src/App.tsx` — lazy import + `/notifications` route.
- EDIT `CLAUDE.md` — routes table row + this section.
- (The Phase-B test notification row has since been deleted; notifications
  table is empty until a real document flow fires one.)

### ✅ Phase C — 3 edge functions + FE data layer (DONE, deployed to prod)
- `supabase/functions/_shared/docverify.ts` — `makeExtractor()` factory holding
  ALL the security boilerplate (JWT verify, SA/SM/super role gate, path +
  booking-ownership checks, 10/60s rate limit, service-role download, Gemini
  `gemini-2.5-flash` call, audit_log CALL/ERROR, generic errors, the
  `document_verifications` insert) + coercers `asNum/asStr/asDate/asBool`.
- `extract-all-in-one` / `extract-down-payment` / `extract-lou` — thin wrappers
  (prompt + field-mapping + initial `verification_status`). Request body is
  `{ file_path, booking_id }`; returns `{ document_verification_id, extracted }`.
  Deployed via the Supabase MCP (`verify_jwt: true`). `GEMINI_API_KEY` reused
  from the commission-verify secret.
- `src/lib/documentVerifications.ts` — `uploadAndExtractDocument`,
  `listDocumentVerifications(ForBooking)`, FA mutations `approveAllInOne` /
  `rejectAllInOne` / `confirmLou`, and `recheckBooking` (calls
  `check_booking_complete`). Hooks in `queries.ts`: `useDocumentVerifications`,
  `useDocumentVerificationsForBooking`, `useUploadDocument`,
  `useApproveAllInOne`, `useRejectAllInOne`, `useConfirmLou`, `useRecheckBooking`.
- Notifications are NOT sent from the edge fns (decision evolved past D6): they
  fan out from `recompute_booking_documents` on real status transitions, so the
  recipient + dedup logic lives in one place. `_dv_notify` (owner) +
  `_dv_notify_finance` (every finance_admin) insert directly (SECURITY DEFINER,
  RLS-bypassing) rather than via `create_notification`.

### ✅ Phase D — Finance review queue (DONE)
`src/components/FinanceDocVerifyQueue.tsx`, rendered on `/finance` above Pending
insurance. Lists All-In-One rows still `pending` (Approve / Reject-with-reason)
and LOU rows still `needs_review` (type loan amount → Confirm, off-by->RM1
warning). Down-payment receipts auto-sum, so they never queue.

### ✅ Phase E — SA submission cards (DONE)
`src/components/DocumentSubmissionCards.tsx`, rendered on `/bookings/:id` between
the attachments block and the Activity log, gated SA+SM+super. 3 cards
(All-In-One / Down payment / LOU) each show the booking-level status + the
uploaded DV rows (extracted summary + status pill) + an upload button. LOU card
shows "Not required" for known cash deals.

### ✅ Phase F — completion engine (DONE, applied to prod, verified)
Migration `20260530_document_verification_complete.sql`:
`recompute_booking_documents` + `trg_document_verifications_recompute` +
`check_booking_complete` + `_dv_notify`/`_dv_notify_finance` + the
`guard_booking_field_writes` rewrite with the `app.system_op` bypass. Verified
end-to-end against a real booking in a rolled-back tx: cash deal with an approved
All-In-One + a covering down payment → `documents_complete=true`,
`commission_status` `not_eligible`→`pending`, and the
approved/down_payment_complete/booking_complete/commission_unlocked
notifications all fired; guard never raised; booking restored.

### Implementation notes / gotchas (resolved)
- **D3 (RM600 handling fee):** the LOU extractor captures whatever
  `handling_fee` the form states (`extracted_handling_fee`) for the record; no
  hardcoded constant was needed in the final logic.
- **`payment_type` auto-set:** `recompute_booking_documents` sets a null
  `payment_type` from the All-In-One's `extracted_payment_type` (cash/loan).
  `documents_complete` stays false while it's still null, so nothing unlocks
  prematurely. No bulk backfill was done — it fills in as docs land.
- **Only `recompute_booking_documents` writes the booking doc-status columns**
  (always under `app.system_op='on'`). The FE never PATCHes them. FA review =
  UPDATE on `document_verifications` → trigger recomputes.
- Storage prefix `document-verification/{uid}/{docType}-{ts}.{ext}` (uid-scoped
  for SA-own RLS), distinct from commission's `commission/{uid}/...`.
- Lint hygiene: `dv_set_updated_at` search_path pinned; `trg_dv_recompute`
  EXECUTE revoked from anon/authenticated/public. `check_booking_complete`
  stays authenticated-callable by design (the re-check path).

## How to resume / hand off

When you start a fresh Claude Code session in this repo, this file should appear automatically in context (Claude Code reads `CLAUDE.md` at session start). Re-read it before doing anything destructive. If a section above is out of date, fix it as you make the change — the file is the single source of truth for "what state is the system in right now."
