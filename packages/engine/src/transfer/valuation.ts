import { Player, Club } from '@club-director/shared-types';

/**
 * Calculate a player's market value based on multiple factors.
 * Value peaks in mid-20s, declines after ~30, and is affected by ability,
 * potential, contract length, and recent form.
 */
export function calculateMarketValue(player: Player): number {
  const { development, status, contract, age } = player;

  // Base value from current ability (scaled to millions)
  let baseValue = (development.currentAbility / 200) * 50; // 0-50M base

  // Potential bonus (up to 30M extra if potential is much higher than current)
  const potentialGap = development.potentialAbility - development.currentAbility;
  const potentialBonus = Math.min(30, (potentialGap / 50) * 30);
  baseValue += potentialBonus;

  // Age curve multiplier
  let ageMultiplier = 1.0;
  if (age < 20) {
    ageMultiplier = 0.6 + (age / 20) * 0.3; // 0.6-0.9 for young players
  } else if (age <= 26) {
    ageMultiplier = 1.0; // Peak years
  } else if (age <= 30) {
    ageMultiplier = 1.0 - ((age - 26) / 4) * 0.2; // 1.0-0.8 gradual decline
  } else {
    ageMultiplier = 0.8 - ((age - 30) / 10) * 0.5; // 0.8-0.3 rapid decline
  }
  baseValue *= ageMultiplier;

  // Contract length penalty (expiring soon = lower value)
  const now = new Date();
  const contractMonthsRemaining = Math.max(
    0,
    (contract.contractExpiryDate.getTime() - now.getTime()) / (30 * 24 * 60 * 60 * 1000),
  );

  if (contractMonthsRemaining < 6) {
    baseValue *= 0.5; // 50% reduction for expiring contracts
  } else if (contractMonthsRemaining < 12) {
    baseValue *= 0.7; // 30% reduction for <1 year
  } else if (contractMonthsRemaining < 24) {
    baseValue *= 0.85; // 15% reduction for <2 years
  }

  // Recent form bonus/penalty
  const avgForm = status.recentForm.reduce((a, b) => a + b, 0) / status.recentForm.length;
  if (avgForm >= 7.5) {
    baseValue *= 1.15; // 15% bonus for excellent form
  } else if (avgForm >= 6.0) {
    baseValue *= 1.05; // 5% bonus for good form
  } else if (avgForm <= 4.0) {
    baseValue *= 0.9; // 10% penalty for poor form
  } else if (avgForm <= 3.0) {
    baseValue *= 0.8; // 20% penalty for terrible form
  }

  // Injury penalty
  if (status.injury) {
    baseValue *= 0.7; // 30% reduction for injured players
  }

  // Clamp to reasonable range (minimum 500K, maximum 200M)
  return Math.max(500000, Math.min(200000000, Math.round(baseValue * 1000000)));
}

/**
 * Update a player's market value (to be called periodically).
 */
export function updatePlayerMarketValue(player: Player): Player {
  const newValue = calculateMarketValue(player);
  return {
    ...player,
    contract: {
      ...player.contract,
      marketValue: newValue,
    },
  };
}
