import type { Booking, Profile } from './types'

/** Format an ISO timestamp or YYYY-MM-DD string as YYYY-MM-DD. Empty for null. */
function dateOnly(value: string | null | undefined): string {
  if (!value) return ''
  // booking_date is already YYYY-MM-DD; created_at / delivered_at are ISO.
  return value.slice(0, 10)
}

/**
 * Build the row of values we put in the spreadsheet for one booking.
 * Kept as a plain object so xlsx's json_to_sheet can pick up the header
 * order from Object.keys.
 */
function toRow(b: Booking, ownerName: string) {
  return {
    Code: b.code,
    // The two dates the user explicitly asked for. Key-in date is when the
    // booking was created in the system (created_at); Booking date is the
    // SA-entered date stamped on the booking.
    'Key-in date': dateOnly(b.created_at),
    'Booking date': dateOnly(b.booking_date),
    'Customer name': b.customer_name,
    NRIC: b.customer_nric,
    Phone: b.customer_phone,
    Email: b.customer_email ?? '',
    Model: b.vehicle_model,
    Variant: b.vehicle_variant,
    Colour: b.vehicle_color,
    Status: b.status,
    Owner: ownerName,
    'Booking fee (RM)': b.booking_fee,
    'Discount (RM)': b.discount_amount,
    'Loan bank': b.loan_bank ?? '',
    'Loan status': b.loan_status,
    'Deposit status': b.deposit_status,
    'Payment status': b.payment_status,
    'Delivered at': dateOnly(b.delivered_at),
    Notes: b.notes ?? '',
  }
}

/**
 * Build an XLSX workbook from the given bookings and trigger a browser
 * download. xlsx is dynamically imported so it stays out of the main bundle.
 */
export async function exportBookingsToExcel(
  bookings: Booking[],
  profileById: Map<string, Profile>,
) {
  const XLSX = await import('xlsx')

  const rows = bookings.map((b) => {
    const p = profileById.get(b.owner_id)
    const ownerName = p?.full_name || p?.email || ''
    return toRow(b, ownerName)
  })

  const ws = XLSX.utils.json_to_sheet(rows)
  // Force NRIC and Phone to text so Excel doesn't reformat long digits into
  // scientific notation. Columns are E (NRIC) and F (Phone) given the order
  // in toRow above.
  for (let i = 0; i < rows.length; i++) {
    const r = i + 2 // 1-indexed and skip header
    const nric = ws[`E${r}`]
    const phone = ws[`F${r}`]
    if (nric) nric.t = 's'
    if (phone) phone.t = 's'
  }
  // A reasonable default width so the sheet is readable without manual fitting.
  ws['!cols'] = Object.keys(rows[0] ?? toRow({} as Booking, '')).map((k) => ({
    wch: Math.max(12, k.length + 2),
  }))

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Bookings')

  const stamp = new Date().toISOString().slice(0, 10)
  XLSX.writeFile(wb, `bookings-${stamp}.xlsx`)
}
