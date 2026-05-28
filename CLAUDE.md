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
| `service_order_items` | any auth read; non-SA write; super delete | `service_order_id` FK (cascade), `kind` enum (part/labour), `part_id?` (required when kind=part), description, quantity, unit_price, line_total. |
| `bookings` | per-column gated by trigger. INSERT allowed for `sales_advisor` / `sales_manager` (with `owner_id = auth.uid()`) and `super_admin` (no owner constraint). | see below. `hq_discount`, `dealer_support`, `approval_notes`, `vehicle_color text[]` added 2026-05-28. |
| `booking_attachments` | booking owner + any admin | `kind` enum (bank_transaction / bank_statement / lou / cancellation_form / other) |
| `cars` | per-column gated by trigger; delete super only (UI exposed at `/cars/:id` ★ Delete; two-step chassis-typed confirm; bookings.car_id is `on delete set null` so deletion never blocks) | `chassis_no unique`, `floor_stock_*`, `status enum(in_stock/reserved/delivered/returned)` |
| `commission_schedules` | super_admin | `(model, variant) → base_commission` (variant nullable as catch-all) |
| `commission_payouts` | sales_manager + super_admin | batch label, paid_at, paid_by |
| `audit_log` | trigger only (postgres) | reads = super_admin only; one row per INSERT/UPDATE/DELETE on bookings + cars |
| storage bucket `booking-files` | matches `booking_attachments` ownership | private |
| `attendance` | own row write/read; is_admin reads all; super_admin delete | one row per `(profile_id, work_date)`. check_in_* required at insert (lat/lng/distance_m + timestamp); check_out_* set later via UPDATE. **Lunch (2026-05-27)**: lunch_out_* and lunch_in_* (timestamptz + lat/lng/distance_m, all nullable). work_date is Asia/KL local YYYY-MM-DD, FE-supplied. |
| `commission_verifications` | SA writes own; SM + super UPDATE any; super DELETE. SELECT visible to SA on own, SM/FA/super on all. | `booking_id` FK (set null on delete), `uploaded_by` FK→profiles, `image_path` (Storage path), `extracted_*` fields from the Gemini extraction, `matched` boolean, `discrepancy_notes`. Populated by the `/commission-verify` upload flow + `match_commission_verification(id)` RPC. |

## bookings.* column ownership matrix

These are enforced by `public.guard_booking_field_writes` BEFORE INSERT/UPDATE.
`super_admin` early-returns and bypasses everything.

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
| `/bookings/new` | NewBookingPage | sales_advisor / sales_manager / super_admin (nav link hidden from others; RLS gates insert to the same three roles) |
| `/bookings/:id` | BookingDetailPage | any auth (RLS still gates select) |
| `/cars` | CarsPage (list) | any auth |
| `/cars/new` | NewCarPage | finance_admin + super_admin (was general_admin until 2026-05-26) |
| `/cars/:id` | CarDetailPage | any auth; column gates within the page |
| `/finance` | FinancePage (overview cards + insurance / payment / invoice / commission tables, plus floor-stock + LOU below) | finance_admin + super_admin only |
| `/commissions` | CommissionsPage (SM payout flow) | sales_manager + super_admin |
| `/admin/commissions` | CommissionSchedulesPage (base rates) | super_admin only |
| `/admin/users` | AdminUsersPage | super_admin only |
| `/account` | AccountPage (personal display name) | any auth |
| `/clock-in` | ClockInPage (GPS-gated check in / out) | any auth |
| `/attendance` | MyAttendancePage (own calendar + monthly summary) | any auth |
| `/admin/attendance` | TeamAttendancePage (today + month-by-employee, **org-chart scoped**) | super_admin / sales_manager / service_manager only (others redirected to `/attendance`) |
| `/commission-verify` | CommissionVerifyPage (upload All-In-One photo → Gemini extracts → auto-match to booking → discrepancy table) | sales_advisor / sales_manager / super_admin (nav link shown to SA+SM only) |

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
| sales_advisor | Home · Bookings · Verify Commission |
| sales_manager | Home · Bookings · Customers · Inventory · Commissions · Verify Commission |
| general_admin | Home · Bookings · Customers · Inventory |
| finance_admin | Bookings · Inventory · Finance (Home link hidden — Finance is the landing) |
| super_admin (Sales workspace) | Home · Bookings · Customers · Inventory · Commissions · + New |
| super_admin (Service workspace) | Home · + Job order (Vehicles reached via Housekeeping tile) |
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
  Purchase Order, Stock Received, Stock Issued, FIFO / WIP
  Re-Calculate (placeholders until a stock-movements ledger lands).
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
  screen has a working catalogue.

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
    one of the 8 hour slots (full ones disabled) and submits.
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
20260529_commission_verifications.sql              commission_verifications table + RLS + match_commission_verification RPC + storage policies for commission/{uid}/* prefix on booking-files. audit_log loosened (row_id nullable, ops now include 'CALL'/'ERROR') so the extract-allinone edge function can log events.
20260528_booking_vehicle_color_multi.sql           bookings.vehicle_color text → text[] (legacy single-colour rows become 1-element arrays). Multi-select pill picker in NewBookingPage + BookingDetailPage.
20260528_hq_discount_dealer_support_approval.sql   commission_schedules + bookings get hq_discount + dealer_support; bookings +approval_notes; lookup_schedule_for() helper; guard rewrite to snapshot HQ+dealer + auto-flip approval_status on the discount-vs-commission rule (manager's decision sticks once set)
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
