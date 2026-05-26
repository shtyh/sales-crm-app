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
  notes: string | null
  created_at: string
  updated_at: string
}

export type CommissionScheduleInsert = {
  model: string
  variant?: string | null
  base_commission: number
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

export type Customer = {
  id: string
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
  customer_id: string
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
  created_at: string
  updated_at: string
}

/** Same shape as Vehicle but with the customer joined in for convenience
 *  on list / detail views. */
export type VehicleWithCustomer = Vehicle & {
  customer: Pick<Customer, 'id' | 'name' | 'nric' | 'phone'> | null
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
  reorder_level: number
  location: string | null
  is_active: boolean
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
        'id' | 'registration_no' | 'chassis_no' | 'model' | 'variant' | 'color'
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
  vehicle_color: string

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

  // general_admin-owned JPJ tracking
  jpj_status: JpjStatus
  jpj_submitted_at: string | null
  jpj_expected_completion: string | null

  // Commission (auto-managed; manual fields gated by sales_manager)
  /** Snapshot of commission_schedules.base_commission at insert time. */
  base_commission: number | null
  /** Auto = greatest(0, base_commission - discount_amount). */
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
  vehicle_color: string
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
  deposit_status?: DepositStatus
  payment_status?: PaymentStatus
  /** general_admin JPJ tracking */
  jpj_status?: JpjStatus
  jpj_submitted_at?: string | null
  jpj_expected_completion?: string | null
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
