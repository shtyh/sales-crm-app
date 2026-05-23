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

// Manufacturer-published colour palette per model (from
// "Proton model colour product_colors.xlsx"). Persona isn't on that sheet,
// so it falls back to an empty list and the input degrades to free-text.
export const PROTON_COLOURS = {
  'Proton X90':     ['Marine Blue', 'Jet Grey', 'Quartz Black', 'Armour Silver'],
  'Proton X70':     ['Marine Blue', 'Ruby Red', 'Jet Grey', 'Armour Silver', 'Snow White', 'Black SE'],
  'Proton X50':     ['Teal Bayou Green', 'Black', 'Jet Grey', 'Armour Silver', 'Snow White'],
  'Proton S70':     ['Marine Blue', 'Ruby Red', 'Space Grey', 'Quartz Black', 'Armour Silver', 'Snow White'],
  'Proton Saga':    ['Ruby Red', 'Snow White', 'Space Grey', 'Marine Blue', 'Armour Silver'],
  'Proton Persona': [],
} as const

/** Factory colours for a given model. Empty array means "no constraint". */
export function coloursFor(model: string): readonly string[] {
  return (
    (PROTON_COLOURS as Record<string, readonly string[]>)[model] ?? []
  )
}
