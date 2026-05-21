// Centralised TypeScript types for our domain entities.
// These should mirror the columns of the corresponding Supabase tables.

export type BookingStatus =
  | 'pending'
  | 'confirmed'
  | 'delivered'
  | 'cancelled'

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

  booking_date: string // YYYY-MM-DD

  status: BookingStatus
  notes: string | null

  created_at: string
  updated_at: string
}

/**
 * Fields the user supplies when creating a booking. `code`, `owner_id`,
 * and timestamps are filled in by the database defaults.
 */
export type AttachmentKind = 'bank_transaction' | 'lou' | 'other'

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
  booking_date: string
  status?: BookingStatus
  notes?: string | null
}
