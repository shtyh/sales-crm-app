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

  // Finance-admin + accountant fields
  deposit_status: DepositStatus
  payment_status: PaymentStatus

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
}
