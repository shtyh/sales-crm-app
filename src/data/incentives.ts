// Sales incentive rules — edit here when the company changes policy.
// Rule: every N delivered cars earns the salesperson RM X in the same month.
// e.g. with carsPerTier=3 and rewardPerTier=800:
//   3 delivered → RM 800
//   6 delivered → RM 1,600
//   9 delivered → RM 2,400
//   …

export const MONTHLY_INCENTIVE = {
  carsPerTier: 3,
  rewardPerTier: 800,
  currency: 'MYR' as const,
} as const

/**
 * Compute incentive numbers for a given count of cars delivered in the month.
 */
export function computeIncentive(delivered: number) {
  const { carsPerTier, rewardPerTier } = MONTHLY_INCENTIVE
  const tiersAchieved = Math.floor(delivered / carsPerTier)
  const earned = tiersAchieved * rewardPerTier

  const nextTierAt = (tiersAchieved + 1) * carsPerTier
  const nextTierReward = (tiersAchieved + 1) * rewardPerTier
  const carsToNext = nextTierAt - delivered
  const progress = nextTierAt > 0 ? delivered / nextTierAt : 0

  return {
    delivered,
    earned,
    tiersAchieved,
    nextTierAt,
    nextTierReward,
    carsToNext,
    progress,
  }
}
