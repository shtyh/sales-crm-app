/**
 * Format an amount in Malaysian Ringgit. Uses compact notation for big
 * numbers (e.g. `RM 1.2M`) when `compact` is true.
 */
export function formatMYR(amount: number, opts?: { compact?: boolean }) {
  if (opts?.compact && amount >= 100_000) {
    return new Intl.NumberFormat('en-MY', {
      style: 'currency',
      currency: 'MYR',
      notation: 'compact',
      maximumFractionDigits: 1,
    }).format(amount)
  }
  return new Intl.NumberFormat('en-MY', {
    style: 'currency',
    currency: 'MYR',
    maximumFractionDigits: 0,
  }).format(amount)
}

/** "21 May 2026" */
export function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-MY', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })
}

/** True if the given YYYY-MM-DD date string falls in the current calendar month. */
export function isThisMonth(isoDate: string) {
  const d = new Date(isoDate)
  const now = new Date()
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth()
}
