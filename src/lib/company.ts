/**
 * Company-wide letterhead used by printable documents (quotation,
 * job sheet, invoice, HP letter…). Centralised so we change one
 * constant if the showroom moves or the regulatory numbers change.
 *
 * Values verified from the printed invoice header on 2026-05-27.
 */
export const COMPANY = {
  name: 'SWL Motors Sdn Bhd',
  regNo: '200201017517',
  sstNo: 'P13-1808-38027678',
  // Address kept as a multi-line string so the print layout can render
  // it verbatim; line breaks already match the printed letterhead.
  address: [
    '2066, Jalan Persekutuan,',
    'Pematang Tinggi Light Industry,',
    'Bukit Mertajam, 14000 Penang',
  ],
  tel: '04-568 2066',
  hp: '012-448 2066',
  email: 'pesbbigway@gmail.com',
  /** Short marketing line under the company name. */
  tagline: 'Proton Authorised Dealer · Bukit Mertajam, Penang',
} as const
