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
| `general_admin` | General Admin | `/` (AdminDashboard, purple) | Inserts cars, edits vehicle attributes, edits non-financial booking fields. |
| `sales_manager` | Sales Manager | `/` (AdminDashboard, blue) | Cancels bookings, approves SA discount, approves SA commission, reassigns leads (owner_id), creates payout batches. Dual identity: also takes own bookings. |
| `finance_admin` | Finance Admin | `/finance` (amber) | Owns `loan_bank`, `loan_status`, `loan_notes`, `insurance_company`, `deposit_status`, `payment_status` on bookings, and `floor_stock_*` on cars. |
| `sales_advisor` | Sales Advisor | `/` (DashboardPage, plain) | Default role for new users. Creates own bookings. Can set discount (routes through SM for approval). Sees own commission. |
| `accountant` | — | — | **DEPRECATED.** Enum value remains but no one is assignable to it (filtered out of UI dropdown). All accountant responsibilities are folded into `finance_admin`. See migration `20260522_revert_accountant_module.sql`. |

Current real users (`select id, full_name, role from public.profiles`):

- Axelrod Han (`651800d5-1c86-4636-ba7d-6d98f751db26`) — super_admin
- Lia — general_admin
- Johnson — sales_manager
- Others — sales_advisor (Bhotti, Hong, Minie, Munis, Suren, Vikna, plus one anonymous swlmotors88)

## Tables

| Table | Owner of writes | Notable columns |
|---|---|---|
| `profiles` | self / super_admin (role changes by super only) | `role app_role`, `is_admin` (generated = role <> 'sales_advisor'), `full_name`, `email` |
| `bookings` | per-column gated by trigger | see below |
| `booking_attachments` | booking owner + any admin | `kind` enum (bank_transaction / bank_statement / lou / cancellation_form / other) |
| `cars` | per-column gated by trigger | `chassis_no unique`, `floor_stock_*`, `status enum(in_stock/reserved/delivered/returned)` |
| `commission_schedules` | super_admin | `(model, variant) → base_commission` (variant nullable as catch-all) |
| `commission_payouts` | sales_manager + super_admin | batch label, paid_at, paid_by |
| `audit_log` | trigger only (postgres) | reads = super_admin only; one row per INSERT/UPDATE/DELETE on bookings + cars |
| storage bucket `booking-files` | matches `booking_attachments` ownership | private |

## bookings.* column ownership matrix

These are enforced by `public.guard_booking_field_writes` BEFORE INSERT/UPDATE.
`super_admin` early-returns and bypasses everything.

| Column | Who can write |
|---|---|
| `customer_*`, `vehicle_*`, `otr_price`, `booking_fee`, `booking_date`, `status` (non-cancel), `notes` | booking owner (SA) + any privileged role (general_admin / sales_manager / finance_admin) |
| `discount_amount` | same set; if SA sets non-zero → `approval_status` auto-flips to `pending` |
| `approval_status` | sales_manager only (when explicit). System auto-recomputes from discount changes. |
| `owner_id` (lead reassignment) | sales_manager only |
| `loan_bank`, `loan_status`, `loan_notes`, `insurance_company` | finance_admin only |
| `deposit_status`, `payment_status` | finance_admin only |
| `status='cancelled'` transition | sales_manager only |
| `car_id` | general_admin (or super_admin) |
| `base_commission` | system trigger only (snapshot on INSERT from `commission_schedules`); super_admin can override |
| `commission_amount` | auto = greatest(0, base − discount); sales_manager can override |
| `commission_status` | system auto-flips to `pending` when delivered+paid (or `approved` if owner is SM). sales_manager flips manually after. |
| `commission_payout_id` | sales_manager (set when bundling into a payout batch) |

## cars.* column ownership

Enforced by `public.guard_car_field_writes`. Bypasses guard when transaction-local `app.system_op = 'on'` (used by `recompute_car_status`).

| Column | Who |
|---|---|
| `chassis_no`, `model`, `variant`, `color`, `arrived_at`, `status` | general_admin only |
| `floor_stock_bank`, `financed_amount`, `floor_stock_status`, `floor_stock_due` | finance_admin only |

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
| `/` | RoleHome → AdminDashboardPage or DashboardPage; finance_admin redirected to `/finance` | any auth |
| `/bookings` | BookingsPage (list) | any auth |
| `/bookings/new` | NewBookingPage | any auth (RLS still gates insert) |
| `/bookings/:id` | BookingDetailPage | any auth (RLS still gates select) |
| `/cars` | CarsPage (list) | any auth |
| `/cars/new` | NewCarPage | general_admin + super_admin |
| `/cars/:id` | CarDetailPage | any auth; column gates within the page |
| `/finance` | FinancePage | finance_admin + super_admin only |
| `/commissions` | CommissionsPage (SM payout flow) | sales_manager + super_admin |
| `/admin/commissions` | CommissionSchedulesPage (base rates) | super_admin only |
| `/admin/users` | AdminUsersPage | super_admin only |
| `/account` | AccountPage (personal display name) | any auth |

Top nav shows role-appropriate links (Bookings, Inventory, +New always; Finance / Commissions / Rates / Super Admin link conditionally).

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
