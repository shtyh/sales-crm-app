// Proton models currently in the SWL Motors lineup and their variants.
// Easy to edit when Proton releases / retires a trim, or when SWL takes on
// additional brands (just add another section).

export const PROTON_LINEUP = {
  'Proton X90':     ['Lite', 'Prime', 'Prime X'],
  'Proton X70':     ['Executive', 'Premium'],
  'Proton X50':     ['Executive', 'Premium', 'Flagship', 'Flagship X'],
  'Proton S70':     ['Executive', 'Premium', 'Flagship', 'Flagship X'],
  'Proton Saga':    ['Standard', 'Executive', 'Premium'],
  'Proton Persona': ['Standard', 'Executive'],
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
