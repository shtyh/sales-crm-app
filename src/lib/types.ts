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
  customer_nric: string | null
  customer_phone: string
  customer_email: string | null

  vehicle_model: string
  vehicle_variant: string | null
  vehicle_color: string | null

  otr_price: number
  booking_fee: number

  booking_date: string // YYYY-MM-DD
  expected_delivery: string | null

  status: BookingStatus
  notes: string | null

  created_at: string
  updated_at: string
}

/**
 * Fields the user supplies when creating a booking. `code`, `owner_id`,
 * and timestamps are filled in by the database defaults.
 */
export type BookingInsert = {
  customer_name: string
  customer_nric?: string | null
  customer_phone: string
  customer_email?: string | null
  vehicle_model: string
  vehicle_variant?: string | null
  vehicle_color?: string | null
  otr_price: number
  booking_fee: number
  booking_date: string
  expected_delivery?: string | null
  status?: BookingStatus
  notes?: string | null
}
