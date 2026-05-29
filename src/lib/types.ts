// Centralised TypeScript types for our domain entities.
// These should mirror the columns of the corresponding Supabase tables.

export type BookingStatus =
  | 'pending'
  | 'confirmed'
  | 'delivered'
  | 'cancelled'

export type LoanStatus =
  | 'not_applicable'
  | 'pending'
  | 'approved'
  | 'rejected'

/** Gate on a booking's discount: only 'pending' rows need manager attention. */
export type ApprovalStatus =
  | 'not_required'
  | 'pending'
  | 'approved'
  | 'rejected'

export type DepositStatus = 'unpaid' | 'received' | 'refunded'
export type PaymentStatus = 'unpaid' | 'partial' | 'paid'

/** JPJ registration state. general_admin-owned. */
export type JpjStatus = 'not_submitted' | 'submitted' | 'registered'

export const JPJ_STATUS_LABEL: Record<JpjStatus, string> = {
  not_submitted: 'Not submitted',
  submitted: 'Submitted',
  registered: 'Registered',
}

/** State machine for a booking's commission to a sales advisor. */
export type CommissionStatus =
  | 'not_eligible'  // default — booking not yet delivered+paid
  | 'pending'       // auto when delivered+paid; awaits SM
  | 'approved'      // SM signed off; awaits payout
  | 'rejected'      // SM rejected (e.g. fraud / cancelled)
  | 'paid'          // attached to a commission_payouts batch

export const COMMISSION_LABEL: Record<CommissionStatus, string> = {
  not_eligible: 'Not yet earned',
  pending: '⏳ Pending review',
  approved: '✓ Approved',
  rejected: '✗ Rejected',
  paid: '✓✓ Paid',
}

export type CommissionSchedule = {
  id: string
  model: string
  variant: string | null
  base_commission: number
  /** Auto-applied HQ rebate for this model/variant. Cannot be changed
   *  by the SA on the booking form; super_admin tunes it here. */
  hq_discount: number
  /** Auto-applied dealer support for this model/variant. Same gating. */
  dealer_support: number
  notes: string | null
  created_at: string
  updated_at: string
}

export type CommissionScheduleInsert = {
  model: string
  variant?: string | null
  base_commission: number
  hq_discount?: number
  dealer_support?: number
  notes?: string | null
}

export type CommissionPayout = {
  id: string
  label: string
  paid_at: string // YYYY-MM-DD
  paid_by: string | null
  notes: string | null
  created_at: string
  updated_at: string
}

export type CommissionPayoutInsert = {
  label: string
  paid_at: string
  notes?: string | null
}

/** Where each car is in its lifecycle. Independent of the booking flow. */
export type CarStatus = 'in_stock' | 'reserved' | 'delivered' | 'returned'

/** Floor-stock financing state — finance_admin owned. */
export type FloorStockStatus =
  | 'locked'              // bank-financed, not yet settled
  | 'pending_settlement'  // customer paid, we're settling with the bank
  | 'overdue'             // due date passed without settlement
  | 'paid_off'            // bank cleared, car is free to deliver

export const CAR_STATUS_LABEL: Record<CarStatus, string> = {
  in_stock: 'In stock',
  reserved: 'Reserved',
  delivered: 'Delivered',
  returned: 'Returned',
}

export const FLOOR_STOCK_LABEL: Record<FloorStockStatus, string> = {
  locked: '🔒 Locked',
  pending_settlement: '⏳ Pending settlement',
  overdue: '⚠ Overdue',
  paid_off: '✓ Paid off',
}

export type Car = {
  id: string
  chassis_no: string
  model: string
  variant: string | null
  color: string | null
  arrived_at: string // YYYY-MM-DD
  status: CarStatus
  floor_stock_bank: string | null
  financed_amount: number | null
  floor_stock_status: FloorStockStatus
  floor_stock_due: string | null
  created_at: string
  updated_at: string
}

export type AuditOperation = 'INSERT' | 'UPDATE' | 'DELETE'

export type AuditLogEntry = {
  id: string
  occurred_at: string
  actor_id: string | null
  actor_role: AppRole | null
  table_name: string
  row_id: string
  operation: AuditOperation
  /**
   * For INSERT: full row as JSON.
   * For UPDATE: only the columns that changed, mapped to their NEW value.
   * For DELETE: null.
   */
  changed: Record<string, unknown> | null
  /**
   * For UPDATE: same keys as `changed` but holding the OLD values.
   * For DELETE: the full row before deletion.
   * For INSERT: null.
   */
  old_values: Record<string, unknown> | null
}

export type CarInsert = {
  chassis_no: string
  model: string
  variant?: string | null
  color?: string | null
  arrived_at?: string
  status?: CarStatus
  // Finance-only fields are intentionally omitted from INSERT shape; finance
  // sets them later via update. PATCHes reuse this type via Partial<CarInsert>.
  floor_stock_bank?: string | null
  financed_amount?: number | null
  floor_stock_status?: FloorStockStatus
  floor_stock_due?: string | null
}

/** Single-letter dropdown codes the legacy WMS uses. */
export type CustomerSex = 'M' | 'F'
export type CustomerRace = 'C' | 'M' | 'I' | 'O'
export type CustomerMaritalStatus = 'S' | 'M' | 'D'
export type CustomerStatus = 'active' | 'inactive'
/** Individual or Company. When 'company', `nric` holds the SSM / business
 *  registration number instead of an IC. */
export type CustomerType = 'individual' | 'company'

export type Customer = {
  id: string
  customer_type: CustomerType
  name: string
  nric: string
  phone: string
  email: string | null
  address: string | null
  // WMS-style account fields (2026-05-26)
  city: string | null
  state: string | null
  post_code: string | null
  phone2: string | null
  fax_no: string | null
  tin_no: string | null
  tax_no: string | null
  sex: CustomerSex | null
  race: CustomerRace | null
  marital_status: CustomerMaritalStatus | null
  birthday: string | null
  sales_dealer: string | null
  status: CustomerStatus
  fixed_discount_rate: number
  preference_list_price: string
  road_tax_renewal: string | null
  insurance_renewal: string | null
  driving_license_renewal: string | null
  road_tax_send_reminder: boolean
  insurance_send_reminder: boolean
  driving_license_send_reminder: boolean
  birthday_send_reminder: boolean
  send_next_service_reminder: boolean
  send_greeting_card: boolean
  created_at: string
  updated_at: string
}

export type CustomerInsert = {
  customer_type?: CustomerType
  name: string
  nric: string
  phone: string
  email?: string | null
  address?: string | null
  // WMS account fields — all optional on insert; DB defaults kick in
  // where appropriate.
  city?: string | null
  state?: string | null
  post_code?: string | null
  phone2?: string | null
  fax_no?: string | null
  tin_no?: string | null
  tax_no?: string | null
  sex?: CustomerSex | null
  race?: CustomerRace | null
  marital_status?: CustomerMaritalStatus | null
  birthday?: string | null
  sales_dealer?: string | null
  status?: CustomerStatus
  fixed_discount_rate?: number
  preference_list_price?: string
  road_tax_renewal?: string | null
  insurance_renewal?: string | null
  driving_license_renewal?: string | null
  road_tax_send_reminder?: boolean
  insurance_send_reminder?: boolean
  driving_license_send_reminder?: boolean
  birthday_send_reminder?: boolean
  send_next_service_reminder?: boolean
  send_greeting_card?: boolean
}

export type Vehicle = {
  id: string
  /** Nullable since 2026-05-29 — workshop seed rows imported from the
   *  vehicle_types master sit unassigned until a real car comes in. */
  customer_id: string | null
  /** Optional bridge to a SWL inventory cars row (when the workshop is
   *  servicing a car SWL originally sold). */
  car_id: string | null
  registration_no: string
  chassis_no: string | null
  model: string
  variant: string | null
  color: string | null
  year: number | null
  mileage: number | null
  notes: string | null
  // WMS-style account fields (2026-05-26)
  account_no: string | null
  membership_no: string | null
  engine_no: string | null
  capacity_cc: number | null
  year_make: number | null
  registration_date: string | null
  warranty_date: string | null
  /** Workshop side links to the AUTFDV02 model master (2026-05-29).
   *  Free-text `model` stays as the human label; this FK is for
   *  reporting + future autocomplete. */
  vehicle_type_id: string | null
  /** Workshop-side customer pool (2026-05-29 Pass 2). New rows write
   *  to this; legacy customer_id stays for back-compat. */
  service_customer_id: string | null
  created_at: string
  updated_at: string
}

/** Same shape as Vehicle but with the customer joined in for convenience
 *  on list / detail views. */
export type VehicleWithCustomer = Vehicle & {
  customer: Pick<Customer, 'id' | 'name' | 'nric' | 'phone'> | null
  /** Joined vehicle_type, when one is linked via vehicle_type_id. */
  vehicle_type: { id: string; code: string; name: string } | null
}

export type VehicleInsert = {
  customer_id: string
  car_id?: string | null
  registration_no: string
  chassis_no?: string | null
  model: string
  variant?: string | null
  color?: string | null
  year?: number | null
  mileage?: number | null
  notes?: string | null
  account_no?: string | null
  membership_no?: string | null
  engine_no?: string | null
  capacity_cc?: number | null
  year_make?: number | null
  registration_date?: string | null
  warranty_date?: string | null
}

// ---------- Service orders (workshop side) ---------------------------------

export type ServiceOrderStatus =
  | 'open'
  | 'in_progress'
  | 'awaiting_parts'
  | 'completed'
  | 'collected'
  | 'cancelled'

export const SERVICE_ORDER_STATUS_LABEL: Record<ServiceOrderStatus, string> = {
  open: 'Open',
  in_progress: 'In progress',
  awaiting_parts: 'Awaiting parts',
  completed: 'Completed',
  collected: 'Collected',
  cancelled: 'Cancelled',
}

export type QuoteStatus = 'none' | 'sent' | 'approved' | 'rejected'

export const QUOTE_STATUS_LABEL: Record<QuoteStatus, string> = {
  none: 'No quote',
  sent: 'Awaiting approval',
  approved: 'Approved',
  rejected: 'Rejected',
}

export type ServiceItemKind = 'part' | 'labour'

export type ServiceOrderItem = {
  id: string
  service_order_id: string
  kind: ServiceItemKind
  part_id: string | null
  description: string
  quantity: number
  unit_price: number
  line_total: number
  created_at: string
}

export type ServiceOrderItemInsert = {
  service_order_id: string
  kind: ServiceItemKind
  part_id?: string | null
  description: string
  quantity: number
  unit_price: number
  line_total: number
}

export type ServiceOrderInsert = {
  customer_id: string
  vehicle_id: string
  technician_id?: string | null
  service_advisor_id?: string | null
  status?: ServiceOrderStatus
  quote_status?: QuoteStatus
  complaint?: string | null
  diagnosis?: string | null
  mileage_in?: number | null
  notes?: string | null
  subtotal?: number
  tax_amount?: number
  total_amount?: number
  // WMS-style intake fields
  service_types?: ServiceType[]
  appointment_type?: AppointmentType
  days_to_complete?: number | null
}

export type Attendance = {
  id: string
  profile_id: string
  work_date: string
  check_in_at: string
  check_in_lat: number
  check_in_lng: number
  check_in_distance_m: number
  // Lunch (2026-05-27) — all nullable; skip-lunch days stay null.
  lunch_out_at: string | null
  lunch_out_lat: number | null
  lunch_out_lng: number | null
  lunch_out_distance_m: number | null
  lunch_in_at: string | null
  lunch_in_lat: number | null
  lunch_in_lng: number | null
  lunch_in_distance_m: number | null
  check_out_at: string | null
  check_out_lat: number | null
  check_out_lng: number | null
  check_out_distance_m: number | null
  created_at: string
  updated_at: string
}

export type AttendanceInsert = {
  profile_id: string
  work_date: string
  check_in_at?: string
  check_in_lat: number
  check_in_lng: number
  check_in_distance_m: number
}

export type AttendanceCheckOut = {
  check_out_at: string
  check_out_lat: number
  check_out_lng: number
  check_out_distance_m: number
}

export type AttendanceLunchOut = {
  lunch_out_at: string
  lunch_out_lat: number
  lunch_out_lng: number
  lunch_out_distance_m: number
}

export type AttendanceLunchIn = {
  lunch_in_at: string
  lunch_in_lat: number
  lunch_in_lng: number
  lunch_in_distance_m: number
}

export type Technician = {
  id: string
  profile_id: string | null
  name: string
  employee_no: string | null
  phone: string | null
  specialty: string | null
  is_active: boolean
  created_at: string
  updated_at: string
}

export type PartCategory = 'OIL' | 'PRT'

export const PART_CATEGORY_LABEL: Record<PartCategory, string> = {
  OIL: 'OIL',
  PRT: 'PRT',
}

// ----- Service customers --------------------------------------------------
//
// Workshop-side mirror of the sales customers table. Populated by the
// auto-import trigger on bookings.status='delivered', plus manual inserts
// via /service/customers. NEVER reference public.customers from workshop
// queries — go through service_customers.

export type ServiceCustomer = {
  id: string
  sales_customer_id: string | null
  name: string
  nric: string | null
  phone: string
  email: string | null
  address: string | null
  city: string | null
  state: string | null
  post_code: string | null
  phone2: string | null
  fax_no: string | null
  tin_no: string | null
  tax_no: string | null
  sex: string | null
  race: string | null
  marital_status: string | null
  birthday: string | null
  sales_dealer: string | null
  status: string
  customer_type: string
  created_at: string
  updated_at: string
}

export type ServiceCustomerWithCounts = ServiceCustomer & {
  vehicle_count: number
  job_count: number
}

// ----- Vehicle Types master ----------------------------------------------

export type VehicleType = {
  id: string
  code: string
  name: string
  profit_center: string | null
  legacy_modified: string | null
  is_active: boolean
  created_at: string
  updated_at: string
}

export type VehicleTypeWithCount = VehicleType & {
  /** How many workshop `vehicles` rows have a `model` matching this type's
   *  name (case-insensitive substring). Lets the inquiry page surface a
   *  rough "how many of these are in our shop" count without a schema FK. */
  vehicle_count: number
}

// ----- Stock Receive module -----------------------------------------------

export type Supplier = {
  id: string
  code: string
  name: string
  person: string | null
  phone: string | null
  phone2: string | null
  fax: string | null
  email: string | null
  address_line1: string | null
  address_line2: string | null
  address_line3: string | null
  postcode: string | null
  sst_no: string | null
  tin_no: string | null
  biz_activity: string | null
  msic_code: string | null
  is_active: boolean
  created_at: string
  updated_at: string
}

export type StockReceipt = {
  id: string
  receipt_no: number
  receipt_date: string
  supplier_id: string | null
  invoice_no: string | null
  invoice_date: string | null
  do_no: string | null
  po_no: string | null
  remarks: string | null
  total_qty: number
  total_cost: number
  created_by: string | null
  created_at: string
}

export type StockReceiptItem = {
  id: string
  receipt_id: string
  part_id: string
  qty: number
  unit_cost: number
  line_total: number
  created_at: string
}

export type NewStockReceipt = {
  receipt_date: string
  supplier_id: string | null
  invoice_no: string | null
  invoice_date: string | null
  do_no: string | null
  po_no: string | null
  remarks: string | null
  items: Array<{
    part_id: string
    qty: number
    unit_cost: number
  }>
}

export type StockReceiptRow = StockReceipt & {
  supplier_name: string | null
  supplier_code: string | null
  item_count: number
}

export type Part = {
  id: string
  part_no: string
  name: string
  description: string | null
  brand: string | null
  unit: string
  unit_cost: number
  unit_price: number
  stock_qty: number
  /** Period Qty Received from the closing-stock XLSX. Synced manually
   *  per stock period; defaults to 0. */
  qty_received: number
  /** Period Qty Issued from the closing-stock XLSX. */
  qty_issued: number
  reorder_level: number
  location: string | null
  is_active: boolean
  /** Group bucket the Stock On Hand report rolls up by. Defaults to
   *  'PRT' for existing rows; 'OIL' for engine / transmission /
   *  brake-fluid stock. */
  category: PartCategory
  created_at: string
  updated_at: string
}

/** Intake checkboxes on the WMS-style Job Sheet dialog. */
export type ServiceType =
  | 'maintenance'
  | 'int_g_repair'
  | 'warranty_service'
  | 'service_coupon'
  | 'come_back_job'
  | 'body_repair'
  | 'inspection'

export const SERVICE_TYPE_LABEL: Record<ServiceType, string> = {
  maintenance: 'Maintenance',
  int_g_repair: 'Int./G. Repair',
  warranty_service: 'Warranty / Service',
  service_coupon: 'Service Coupon / Others',
  come_back_job: 'Come Back Job',
  body_repair: 'Body Repair',
  inspection: 'Inspection',
}

export type AppointmentType = 'walk_in' | 'by_appointment'

// ─── Customer-facing service appointments ──────────────────────────────
// `/book` (public) and `/service/book` (staff) write here via the
// `submit_appointment` RPC; workshop staff confirm or reject at
// `/service/appointments`. Confirmed rows are read-only on the public
// `/book/:token` page — that's the "slot lock" the customer sees.
export type AppointmentStatus =
  | 'pending'
  | 'confirmed'
  | 'rejected'
  | 'cancelled'

export type AppointmentPeriod = 'am' | 'pm'

export const APPOINTMENT_STATUS_LABEL: Record<AppointmentStatus, string> = {
  pending: 'Pending',
  confirmed: 'Confirmed',
  rejected: 'Rejected',
  cancelled: 'Cancelled',
}

export const APPOINTMENT_PERIOD_LABEL: Record<AppointmentPeriod, string> = {
  am: 'Morning (AM)',
  pm: 'Afternoon (PM)',
}

/** Hour-long slot timestamps stored as Postgres `time` (HH:MM:SS).
 *  Mon–Sat workshop hours are 9am–5pm, eight slots a day. Sunday is
 *  closed and rejected at the DB level. Change these and the matching
 *  arrays inside the `submit_appointment` + `get_available_slots` RPCs
 *  together. */
export const SLOT_TIMES = [
  '09:00:00',
  '10:00:00',
  '11:00:00',
  '12:00:00',
  '13:00:00',
  '14:00:00',
  '15:00:00',
  '16:00:00',
] as const

export type SlotTime = (typeof SLOT_TIMES)[number]

export const SLOT_LABEL: Record<SlotTime, string> = {
  '09:00:00': '9:00 AM',
  '10:00:00': '10:00 AM',
  '11:00:00': '11:00 AM',
  '12:00:00': '12:00 PM',
  '13:00:00': '1:00 PM',
  '14:00:00': '2:00 PM',
  '15:00:00': '3:00 PM',
  '16:00:00': '4:00 PM',
}

/** Format any slot value (HH:MM:SS, HH:MM, or null) into a human label. */
export function formatSlot(raw: string | null | undefined): string {
  if (!raw) return '—'
  const norm = raw.length === 5 ? `${raw}:00` : raw
  return (SLOT_LABEL as Record<string, string>)[norm] ?? raw
}

/** Number of cars the workshop can run in parallel per slot. Mirrors
 *  the `v_capacity` value inside the RPCs. */
export const SLOT_CAPACITY = 2

/** Standard service intervals (km). Customer picks one of these on the
 *  booking form so the workshop knows which interval it is. */
export const SERVICE_MILEAGE_OPTIONS = [
  1000,
  5000,
  10000,
  15000,
  20000,
  30000,
  40000,
  50000,
  60000,
  80000,
  100000,
] as const

export type ServiceMileage = (typeof SERVICE_MILEAGE_OPTIONS)[number]

/** Pretty label like "10,000 km" for a service mileage tier. */
export function formatServiceMileage(km: number | null | undefined): string {
  if (km == null) return '—'
  return `${km.toLocaleString('en-US')} km`
}

/** One row returned by `get_available_slots(date)`. */
export type AvailableSlot = {
  slot_time: string // HH:MM:SS
  taken: number
  capacity: number
}

export type ServiceAppointment = {
  id: string
  token: string
  customer_name: string
  customer_phone: string
  /** Legacy — no longer collected by the public form. Kept for old rows. */
  customer_nric: string | null
  customer_email: string | null
  vehicle_reg: string
  vehicle_chassis: string | null
  vehicle_model: string | null
  preferred_date: string // YYYY-MM-DD
  /** Hour slot, HH:MM:SS. Nullable on legacy rows from before the slot
   *  refactor; new rows always have a value. */
  slot_time: string | null
  preferred_period: AppointmentPeriod
  /** Service interval tier in km (1000, 10000, …). Nullable on legacy
   *  rows; new rows always have a value. */
  service_mileage: number | null
  complaint: string | null
  status: AppointmentStatus
  service_order_id: string | null
  confirmed_by: string | null
  confirmed_at: string | null
  rejected_reason: string | null
  submitted_by: string | null
  /** `phone` = staff entered on behalf via the phone-block toggle. */
  source: 'public' | 'staff' | 'phone'
  created_at: string
  updated_at: string
}

/** Public read-back via `get_appointment_by_token` — staff-only fields
 *  (confirmed_by, submitted_by, internal ids) are intentionally omitted. */
export type PublicServiceAppointment = {
  id: string
  token: string
  customer_name: string
  customer_phone: string
  customer_email: string | null
  vehicle_reg: string
  vehicle_chassis: string | null
  vehicle_model: string | null
  preferred_date: string
  slot_time: string | null
  preferred_period: AppointmentPeriod
  service_mileage: number | null
  complaint: string | null
  status: AppointmentStatus
  confirmed_at: string | null
  rejected_reason: string | null
  created_at: string
}

export type ServiceAppointmentInput = {
  customer_name: string
  customer_phone: string
  /** Email is now required by the form + RPC. */
  customer_email: string
  vehicle_reg: string
  /** Model is required by the form + RPC. Chassis is no longer
   *  collected on the booking flow — workshop fills it in later when
   *  the service order is created. */
  vehicle_model: string
  preferred_date: string
  slot_time: string // HH:MM:SS
  /** Service interval in km. Required. */
  service_mileage: number
  complaint?: string | null
  /** Staff-only: marks the row as a phone-call booking, skips pending,
   *  occupies the slot immediately. The RPC rejects this from anon
   *  callers and from non-workshop roles. */
  phone_block?: boolean
}

export type ServiceOrder = {
  id: string
  order_no: string | null
  customer_id: string
  vehicle_id: string
  technician_id: string | null
  service_advisor_id: string | null
  status: ServiceOrderStatus
  complaint: string | null
  diagnosis: string | null
  mileage_in: number | null
  opened_at: string
  completed_at: string | null
  collected_at: string | null
  subtotal: number
  tax_amount: number
  total_amount: number
  notes: string | null
  quote_status: QuoteStatus
  // WMS-style intake fields (2026-05-26)
  service_types: ServiceType[]
  appointment_type: AppointmentType
  days_to_complete: number | null
  created_at: string
  updated_at: string
}

/** Service order joined with its vehicle, customer, and technician — used
 *  by the workshop dashboard table where we need names, not just ids. */
export type ServiceOrderWithJoins = ServiceOrder & {
  vehicle:
    | Pick<
        Vehicle,
        | 'id'
        | 'registration_no'
        | 'chassis_no'
        | 'model'
        | 'variant'
        | 'color'
        | 'account_no'
      >
    | null
  customer: Pick<Customer, 'id' | 'name' | 'phone'> | null
  technician: { id: string; name: string } | null
}

export type Booking = {
  id: string
  code: string
  owner_id: string

  customer_name: string
  customer_nric: string
  customer_phone: string
  customer_email: string | null

  vehicle_model: string
  vehicle_variant: string
  /** One or more colour preferences the customer is open to. Stored as
   *  text[] since 2026-05-28; legacy single-colour rows are 1-element
   *  arrays. Nullable when the SA hasn't captured one yet. */
  vehicle_color: string[] | null

  otr_price: number
  booking_fee: number
  /** MYR off OTR. Free for SA to set; no manager approval required. */
  discount_amount: number
  /** Manager-granted RM bonus on top of base commission. SM-only write. */
  special_support: number
  /**
   * Legacy: pre-2026-05-23 discount approval state. New bookings default
   * to 'not_required'; column kept for historical rows.
   */
  approval_status: ApprovalStatus

  booking_date: string // YYYY-MM-DD
  delivered_at: string | null // ISO timestamp, auto-set when status → 'delivered'

  // Finance-admin-only fields
  loan_bank: string | null
  insurance_company: string | null
  /** Insurance premium in MYR. Finance Admin owns. */
  insurance_amount: number | null

  loan_status: LoanStatus
  loan_notes: string | null
  /** Bank-disbursed loan amount (MYR). Finance Admin owns. Used by the
   *  HP disbursement letter at print time. Null until set. */
  loan_amount: number | null

  // finance_admin-owned cash status
  deposit_status: DepositStatus
  payment_status: PaymentStatus
  /** How the booking fee was received: cash / qr / transfer (null until set). */
  booking_fee_method: 'cash' | 'qr' | 'transfer' | null
  /** Official receipt number issued for the booking fee. Free text. */
  official_receipt_no: string | null

  // general_admin-owned JPJ tracking
  jpj_status: JpjStatus
  jpj_submitted_at: string | null
  jpj_expected_completion: string | null

  // Commission (auto-managed; manual fields gated by sales_manager)
  /** Snapshot of commission_schedules.base_commission at insert time. */
  base_commission: number | null
  /** Snapshot of commission_schedules.hq_discount at insert time.
   *  Auto-applied, never counted toward SA commission. */
  hq_discount: number
  /** Snapshot of commission_schedules.dealer_support at insert time.
   *  Auto-applied, never counted toward SA commission. */
  dealer_support: number
  /** Manager's note when approving / rejecting an over-commission
   *  SA discount. */
  approval_notes: string | null
  /** Auto = base_commission - discount_amount + special_support
   *  (can go negative). */
  commission_amount: number | null
  commission_status: CommissionStatus
  /** Set when SM groups this booking into a payout batch. */
  commission_payout_id: string | null

  /** Which car in inventory this booking is fulfilled by. */
  car_id: string | null
  /** Canonical customer link. Older rows may still be null until the FE
   *  is fully migrated; falls back to the customer_* snapshot fields. */
  customer_id: string | null

  status: BookingStatus
  notes: string | null

  created_at: string
  updated_at: string
}

/**
 * Fields the user supplies when creating a booking. `code`, `owner_id`,
 * and timestamps are filled in by the database defaults.
 */
/**
 * RBAC roles. Mirrors the `public.app_role` enum in Supabase. Order is the
 * privilege hierarchy from most → least powerful (super_admin first, plain
 * sales_advisor last).
 */
export type AppRole =
  | 'super_admin'
  | 'general_admin'
  | 'sales_manager'
  | 'finance_admin'
  | 'accountant'
  | 'sales_advisor'
  // Workshop side — added 2026-05-26.
  | 'service_manager'
  | 'service_advisor'
  | 'store_keeper'
  | 'mechanic'

export const ROLE_LABEL: Record<AppRole, string> = {
  super_admin: 'Super Admin',
  general_admin: 'General Admin',
  sales_manager: 'Sales Manager',
  finance_admin: 'Finance Admin',
  accountant: 'Accountant',
  sales_advisor: 'Sales Advisor',
  service_manager: 'Service Manager',
  service_advisor: 'Service Advisor',
  store_keeper: 'Store Keeper',
  mechanic: 'Mechanic',
}

export type Profile = {
  id: string
  full_name: string | null
  email: string | null
  role: AppRole
  /**
   * Server-side generated: true when role is anything other than sales_advisor.
   * Kept for back-compat with code that historically branched on isAdmin.
   * Read-only — the DB rejects direct writes.
   */
  is_admin: boolean
  created_at: string
  updated_at: string
}

export type AttachmentKind =
  | 'bank_transaction'
  | 'bank_statement'
  | 'lou'
  | 'cancellation_form'
  | 'other'

export type Attachment = {
  id: string
  booking_id: string
  kind: AttachmentKind
  file_path: string
  file_name: string
  mime_type: string | null
  size_bytes: number | null
  uploaded_by: string | null
  uploaded_at: string
}

export type BookingInsert = {
  customer_name: string
  customer_nric: string
  customer_phone: string
  customer_email?: string | null
  vehicle_model: string
  vehicle_variant: string
  /** Multi-select; pass an empty array if no colour preference. */
  vehicle_color: string[]
  otr_price: number
  booking_fee: number
  discount_amount?: number
  /** sales_manager-only; bumps commission up by this much. */
  special_support?: number
  booking_date: string
  status?: BookingStatus
  notes?: string | null
  loan_bank?: string | null
  insurance_company?: string | null
  insurance_amount?: number | null
  loan_status?: LoanStatus
  loan_notes?: string | null
  loan_amount?: number | null
  // Update-only fields (defaults on DB; not meant for INSERT). Typed here
  // because we reuse this shape as Partial<BookingInsert> for PATCHes.
  approval_status?: ApprovalStatus
  /** sales_manager note left when approving / rejecting an SA discount
   *  that exceeds commission. */
  approval_notes?: string | null
  deposit_status?: DepositStatus
  payment_status?: PaymentStatus
  /** general_admin JPJ tracking */
  jpj_status?: JpjStatus
  jpj_submitted_at?: string | null
  jpj_expected_completion?: string | null
  /** Booking-fee receipt info — captured at intake. */
  booking_fee_method?: 'cash' | 'qr' | 'transfer' | null
  official_receipt_no?: string | null
  /** sales_manager reassignment of leads */
  owner_id?: string
  /** general_admin links the booking to a specific physical car. */
  car_id?: string | null
  /** FK to the customers table (created/upserted by NRIC before insert). */
  customer_id?: string | null
}

// ---------- Payments + Invoices (finance-admin owned) ---------------------

export type PaymentType = 'deposit' | 'full' | 'partial'
export type PaymentMethod = 'cash' | 'bank_transfer' | 'card'

export const PAYMENT_METHOD_LABEL: Record<PaymentMethod, string> = {
  cash: 'Cash',
  bank_transfer: 'Bank transfer',
  card: 'Card',
}

export type Payment = {
  id: string
  booking_id: string
  amount: number
  payment_type: PaymentType
  payment_method: PaymentMethod
  received_by: string
  received_at: string
  notes: string | null
  created_at: string
}

export type InvoiceStatus = 'draft' | 'issued' | 'paid'

export const INVOICE_STATUS_LABEL: Record<InvoiceStatus, string> = {
  draft: 'Draft',
  issued: 'Issued',
  paid: 'Paid',
}

export type Invoice = {
  id: string
  booking_id: string
  customer_id: string
  invoice_number: string | null
  invoice_date: string
  subtotal: number
  tax_amount: number
  total_amount: number
  status: InvoiceStatus
  created_at: string
}

// ----- Commission verification --------------------------------------------
//
// Sales advisor uploads a photo of the "All In One Preparation" form;
// the extract-allinone Edge Function reads it with Gemini and returns the
// fields below. The user confirms / edits, we insert a row into
// commission_verifications, then call match_commission_verification(id)
// to auto-link to the matching booking and flag any commission diff.

/** Raw extraction result from Gemini. All fields optional — the model may
 *  fail to read individual cells of the form. */
export type ExtractedAllInOne = {
  customer_name?: string
  sa_name?: string
  model?: string
  otr_price?: number
  total_otr?: number
  booking_fee?: number
  commission_amount?: number
  payment_type?: string // 'cash' or 'loan' (free text fallback)
  date?: string // YYYY-MM-DD
  ncd_discount?: number
  own_discount?: number
  pesb_discount?: number
}

export type CommissionVerification = {
  id: string
  booking_id: string | null
  uploaded_by: string
  uploaded_at: string
  image_path: string
  extracted_customer_name: string | null
  extracted_sa_name: string | null
  extracted_model: string | null
  extracted_otr_price: number | null
  extracted_commission: number | null
  extracted_payment_type: string | null
  extracted_date: string | null
  matched: boolean
  discrepancy_notes: string | null
}

/** Joined shape returned by the verification list query — includes the
 *  matched booking's commission so the table can render side-by-side. */
export type CommissionVerificationRow = CommissionVerification & {
  booking_commission: number | null
  uploader_name: string | null
}

// ----- 3-way reconciliation -----------------------------------------------
//
// Super admin uploads bank statement PDF → extract-bank-statement fills
// bank_statement_lines. FA uploads LOU + bank-in receipts via
// booking_attachments → extract-document fills attachment_extractions.
// SA uploads All-In-One → commission_verifications. Triggers run
// reconcile_booking() which upserts booking_reconciliations.

export type BankStatement = {
  id: string
  uploaded_by: string
  uploaded_at: string
  file_path: string
  period_start: string | null
  period_end: string | null
  notes: string | null
}

export type BankStatementLine = {
  id: string
  statement_id: string
  line_date: string
  amount: number
  description: string | null
  raw: unknown
  created_at: string
}

export type AttachmentExtraction = {
  id: string
  attachment_id: string
  doc_type: 'lou' | 'bank_transaction' | 'cancellation_form' | 'other'
  extracted_amount: number | null
  extracted_date: string | null
  extracted_customer_name: string | null
  raw: unknown
  created_at: string
}

export type ReconciliationStatus = 'complete' | 'discrepancy' | 'missing'

export type ReconciliationDiff = {
  field: string
  doc: 'all_in_one' | 'lou' | 'bank_in' | 'statement'
  expected: number | string | null
  got: number | string | null
}

export type BookingReconciliation = {
  id: string
  booking_id: string
  status: ReconciliationStatus
  all_in_one_id: string | null
  lou_extraction_id: string | null
  bankin_extraction_id: string | null
  statement_line_id: string | null
  details: {
    missing?: string[]
    diffs?: ReconciliationDiff[]
  }
  updated_at: string
}

/** Joined shape for the reconciliation queue — includes the booking
 *  customer name + model + the totals from each source doc so we can
 *  render a single row per booking without N+1 queries. */
export type BookingReconciliationRow = BookingReconciliation & {
  booking_code: string
  customer_name: string
  vehicle_model: string
  booking_fee: number
  loan_amount: number | null
  commission_amount: number | null
  otr_price: number
}
