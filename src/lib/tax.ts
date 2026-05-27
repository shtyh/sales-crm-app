/**
 * Malaysian SST (Sales and Service Tax) configuration.
 *
 * The service tax rate on workshop labour was raised from 6% to 8% in
 * March 2024 — change here if it moves again and every screen picks it up.
 */
export const SST_LABOUR_RATE = 0.08

/** Human label paired with SST_LABOUR_RATE for display in tax-code cells. */
export const SST_LABOUR_LABEL = `SST ${Math.round(SST_LABOUR_RATE * 100)}%`

/**
 * Service tax due on a labour line item. Parts (and any other kind)
 * return 0 — Malaysia's service tax only attaches to labour services,
 * not goods.
 */
export function labourSST(nett: number): number {
  return nett * SST_LABOUR_RATE
}
