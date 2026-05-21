// Proton models currently in the SWL Motors lineup and their variants.
// Easy to edit when Proton releases / retires a trim, or when SWL takes on
// additional brands (just add another section).

export const PROTON_LINEUP = {
  'Proton X90':   ['Executive', 'Premium', 'Flagship'],
  'Proton X70':   ['Executive', 'Premium', 'Premium X', 'Flagship'],
  'Proton X50':   ['Standard', 'Executive', 'Premium', 'Flagship', 'Flagship X'],
  'Proton S70':   ['Executive', 'Premium', 'Flagship', 'X'],
  'Proton Saga':  ['Standard MT', 'Standard AT', 'Premium S'],
  'Proton Persona': ['Standard', 'Executive'],
  'Proton Iriz':  ['Standard', 'Executive'],
  'Proton Exora': ['Executive'],
} as const

export const PROTON_MODELS = Object.keys(PROTON_LINEUP) as Array<
  keyof typeof PROTON_LINEUP
>

export type ProtonModel = (typeof PROTON_MODELS)[number]

/** Variants available for a given model (empty array if model unknown). */
export function variantsFor(model: string): readonly string[] {
  return (
    (PROTON_LINEUP as Record<string, readonly string[]>)[model] ?? []
  )
}
