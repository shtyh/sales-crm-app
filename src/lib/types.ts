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
  /** MYR off OTR. SA-set non-zero → flips approval_status to 'pending'. */
  discount_amount: number
  /**
   * State machine for the discount: 'not_required' when discount==0,
   * 'pending' awaiting manager review, 'approved'/'rejected' after.
   * Only sales_manager (or super_admin) can flip it explicitly.
   */
  approval_status: ApprovalStatus

  booking_date: string // YYYY-MM-DD
  delivered_at: string | null // ISO timestamp, auto-set when status → 'delivered'

  // Finance-admin-only fields
  loan_bank: string | null
  insurance_company: string | null

  loan_status: LoanStatus
  loan_notes: string | null

  // finance_admin-owned cash status
  deposit_status: DepositStatus
  payment_status: PaymentStatus

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

export const ROLE_LABEL: Record<AppRole, string> = {
  super_admin: 'Super Admin',
  general_admin: 'General Admin',
  sales_manager: 'Sales Manager',
  finance_admin: 'Finance Admin',
  accountant: 'Accountant',
  sales_advisor: 'Sales Advisor',
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
  booking_date: string
  status?: BookingStatus
  notes?: string | null
  loan_bank?: string | null
  insurance_company?: string | null
  loan_status?: LoanStatus
  loan_notes?: string | null
  // Update-only fields (defaults on DB; not meant for INSERT). Typed here
  // because we reuse this shape as Partial<BookingInsert> for PATCHes.
  approval_status?: ApprovalStatus
  deposit_status?: DepositStatus
  payment_status?: PaymentStatus
  /** sales_manager reassignment of leads */
  owner_id?: string
  /** general_admin links the booking to a specific physical car. */
  car_id?: string | null
}
