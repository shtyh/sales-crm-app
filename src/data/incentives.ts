// Sales incentive rules — edit here when the company changes policy.
//
// Rule (threshold-based, NOT cumulative):
//   Deliver `targetCars` or more in a single calendar month → earn `reward`.
//   The reward does not stack: 3 delivered = RM 800; 6 delivered = still RM 800.

export const MONTHLY_INCENTIVE = {
  targetCars: 3,
  reward: 800,
  currency: 'MYR' as const,
} as const

/**
 * Compute incentive numbers for a given count of cars delivered in the month.
 */
export function computeIncentive(delivered: number) {
  const { targetCars, reward } = MONTHLY_INCENTIVE
  const achieved = delivered >= targetCars
  const earned = achieved ? reward : 0
  const carsToTarget = Math.max(0, targetCars - delivered)
  const progress = Math.min(1, delivered / targetCars)

  return {
    delivered,
    earned,
    targetCars,
    reward,
    carsToTarget,
    progress,
    achieved,
  }
}
