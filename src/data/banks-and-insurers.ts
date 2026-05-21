// Common Malaysian car-loan banks and motor-insurance companies for use in
// the booking form dropdowns. Edit freely as SWL Motors changes partners.

export const LOAN_BANKS = [
  'Maybank',
  'CIMB Bank',
  'Public Bank',
  'Hong Leong Bank',
  'RHB Bank',
  'AmBank',
  'Affin Bank',
  'Alliance Bank',
  'Bank Islam',
  'Bank Rakyat',
  'MBSB Bank',
  'HSBC',
  'OCBC Bank',
] as const

export const INSURERS = [
  'Allianz',
  'Tokio Marine',
  'AmGeneral',
  'AIA General',
  'Etiqa',
  'MSIG',
  'RHB Insurance',
  'Berjaya Sompo',
  'Liberty Insurance',
  'Lonpac Insurance',
  'Zurich Malaysia',
  'AXA Affin General',
  'Pacific & Orient',
  'Tune Protect',
] as const

export type LoanBank = (typeof LOAN_BANKS)[number]
export type Insurer = (typeof INSURERS)[number]
