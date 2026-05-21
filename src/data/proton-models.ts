// Proton models currently in the SWL Motors lineup.
// Easy to extend or replace when SWL takes on additional brands.
export const PROTON_MODELS = [
  'Proton X90',
  'Proton X70',
  'Proton X50',
  'Proton S70',
  'Proton Saga',
  'Proton Persona',
  'Proton Iriz',
  'Proton Exora',
] as const

export type ProtonModel = (typeof PROTON_MODELS)[number]
