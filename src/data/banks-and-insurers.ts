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
  'Liberty',
  'Zurich Takaful',
] as const

export type LoanBank = (typeof LOAN_BANKS)[number]
export type Insurer = (typeof INSURERS)[number]
