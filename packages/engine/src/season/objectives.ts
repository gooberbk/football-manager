import {
  Club,
  Player,
  SeasonAmbition,
  SeasonObjective,
} from '@club-director/shared-types';

export interface AssignSeasonObjectivesInput {
  /** Season the objectives belong to (UUID). Never recomputed later. */
  seasonId: string;
  /** All clubs participating in the league — exactly 16 required. */
  clubs: Club[];
  /** All players; squad members are resolved by id. */
  players: Player[];
  /** Number of matchweeks in the season (e.g. 30 for 16 clubs). */
  seasonWeeks: number;
}

const EXPECTED_CLUB_COUNT = 16;
const MIN_VALID_SQUAD_PLAYERS = 11;
const REWARD_INCOME_WEIGHT = 0.15;
const REWARD_WAGE_WEIGHT = 0.10;
const REWARD_ROUNDING = 10_000;

const AMBITION_COEFFICIENTS: Record<SeasonAmbition, number> = {
  title_favorite: 1.4,
  title_contender: 1.2,
  upper_table: 1.0,
  mid_table: 0.85,
  progression: 0.7,
  survival: 0.55,
};

// Rank bands for a 16-club championship: [maxRank, ambition, targetPosition].
const AMBITION_BANDS: ReadonlyArray<readonly [number, SeasonAmbition, number]> = [
  [1, 'title_favorite', 1],
  [3, 'title_contender', 3],
  [6, 'upper_table', 6],
  [10, 'mid_table', 10],
  [13, 'progression', 13],
  [16, 'survival', 14],
];

function ambitionForRank(rank: number): {
  ambition: SeasonAmbition;
  targetPosition: number;
} {
  for (const [maxRank, ambition, targetPosition] of AMBITION_BANDS) {
    if (rank <= maxRank) {
      return { ambition, targetPosition };
    }
  }
  // Unreachable while EXPECTED_CLUB_COUNT === 16; kept total for safety.
  return { ambition: 'survival', targetPosition: 14 };
}

/**
 * Assign one season objective per club, fixed at season start.
 *
 * Pure and deterministic: no RNG, no clock, no I/O, inputs never mutated.
 * Every precondition violation throws — invalid state is rejected, never
 * silently repaired.
 *
 * Strength ranking: mean `development.currentAbility` over the club's
 * squad (resolved players only), then `reputation` descending, then
 * `clubId` ascending — a total order, so ties are always resolved.
 *
 * Reward (Phase 2E.3d approved formula):
 *   roundTo10k(coeff(ambition) *
 *     (0.15 * weeklyIncome * seasonWeeks +
 *      0.10 * actualWeeklyWageBill * seasonWeeks))
 * where actualWeeklyWageBill is the sum of `contract.wage` over squad
 * players — never `finances.wageBudget` (a 1.5x affordability envelope).
 */
export function assignSeasonObjectives(
  input: AssignSeasonObjectivesInput,
): SeasonObjective[] {
  const { seasonId, clubs, players, seasonWeeks } = input;

  if (typeof seasonId !== 'string' || seasonId.trim().length === 0) {
    throw new Error('assignSeasonObjectives: seasonId must be a non-empty string.');
  }
  if (!Number.isInteger(seasonWeeks) || seasonWeeks <= 0) {
    throw new Error(
      `assignSeasonObjectives: seasonWeeks must be a positive integer, got ${seasonWeeks}.`,
    );
  }
  if (!Array.isArray(clubs) || clubs.length !== EXPECTED_CLUB_COUNT) {
    throw new Error(
      `assignSeasonObjectives: exactly ${EXPECTED_CLUB_COUNT} clubs are required, got ${clubs?.length}.`,
    );
  }
  if (!Array.isArray(players)) {
    throw new Error('assignSeasonObjectives: players must be an array.');
  }

  // Index players by id; duplicate ids corrupt every downstream lookup.
  const playerById = new Map<string, Player>();
  for (const player of players) {
    if (typeof player?.id !== 'string' || player.id.length === 0) {
      throw new Error('assignSeasonObjectives: every player must have a non-empty id.');
    }
    if (playerById.has(player.id)) {
      throw new Error(
        `assignSeasonObjectives: duplicate player id '${player.id}'.`,
      );
    }
    playerById.set(player.id, player);
  }

  // Validate clubs and compute per-club strength/wage data.
  const clubIds = new Set<string>();
  const scored = clubs.map((club) => {
    if (typeof club?.id !== 'string' || club.id.length === 0) {
      throw new Error('assignSeasonObjectives: every club must have a non-empty id.');
    }
    if (clubIds.has(club.id)) {
      throw new Error(
        `assignSeasonObjectives: duplicate club id '${club.id}'.`,
      );
    }
    clubIds.add(club.id);

    if (!Number.isFinite(club.reputation) || club.reputation < 0) {
      throw new Error(
        `assignSeasonObjectives: club '${club.id}' has an invalid reputation (${club.reputation}).`,
      );
    }

    if (!Array.isArray(club.squad)) {
      throw new Error(
        `assignSeasonObjectives: club '${club.id}' squad must be an array.`,
      );
    }
    const squadIds = new Set<string>();
    // Wage bill accumulated step by step so a precision-losing partial sum
    // is rejected immediately instead of detected only at the end.
    // Identical to calculateWageBill for valid inputs (same order).
    let wageBill = 0;
    for (const playerId of club.squad) {
      if (typeof playerId !== 'string' || playerId.length === 0) {
        throw new Error(
          `assignSeasonObjectives: club '${club.id}' squad contains an invalid player id.`,
        );
      }
      if (squadIds.has(playerId)) {
        throw new Error(
          `assignSeasonObjectives: club '${club.id}' squad lists player '${playerId}' twice.`,
        );
      }
      squadIds.add(playerId);

      const player = playerById.get(playerId);
      if (!player) {
        throw new Error(
          `assignSeasonObjectives: club '${club.id}' references unknown player '${playerId}'.`,
        );
      }
      if (!Number.isFinite(player.development?.currentAbility)) {
        throw new Error(
          `assignSeasonObjectives: player '${playerId}' has a non-finite currentAbility.`,
        );
      }
      if (
        !Number.isFinite(player.contract?.wage) ||
        (player.contract?.wage ?? 0) < 0
      ) {
        throw new Error(
          `assignSeasonObjectives: player '${playerId}' has an invalid contract wage.`,
        );
      }
      wageBill += player.contract.wage;
      if (!Number.isSafeInteger(wageBill)) {
        throw new Error(
          `assignSeasonObjectives: club '${club.id}' cumulative wage bill exceeds safe integer precision.`,
        );
      }
    }
    if (club.squad.length < MIN_VALID_SQUAD_PLAYERS) {
      throw new Error(
        `assignSeasonObjectives: club '${club.id}' has ${club.squad.length} valid squad players, minimum is ${MIN_VALID_SQUAD_PLAYERS}.`,
      );
    }

    const { weeklyIncome } = club.finances;
    if (!Number.isFinite(weeklyIncome) || weeklyIncome < 0) {
      throw new Error(
        `assignSeasonObjectives: club '${club.id}' has an invalid weeklyIncome.`,
      );
    }

    const abilitySum = club.squad.reduce(
      (sum, playerId) => sum + playerById.get(playerId)!.development.currentAbility,
      0,
    );

    return {
      club,
      strengthScore: abilitySum / club.squad.length,
      wageBill,
    };
  });

  // Total deterministic order: strength desc, reputation desc, clubId asc.
  scored.sort(
    (a, b) =>
      b.strengthScore - a.strengthScore ||
      b.club.reputation - a.club.reputation ||
      a.club.id.localeCompare(b.club.id),
  );

  return scored.map(({ club, wageBill }, index) => {
    const rank = index + 1;
    const { ambition, targetPosition } = ambitionForRank(rank);
    const rawReward =
      AMBITION_COEFFICIENTS[ambition] *
      (REWARD_INCOME_WEIGHT * club.finances.weeklyIncome * seasonWeeks +
        REWARD_WAGE_WEIGHT * wageBill * seasonWeeks);
    const rewardAmount =
      Math.round(rawReward / REWARD_ROUNDING) * REWARD_ROUNDING;

    if (
      !Number.isFinite(rewardAmount) ||
      !Number.isSafeInteger(rewardAmount) ||
      rewardAmount < 0
    ) {
      throw new Error(
        `assignSeasonObjectives: computed reward for club '${club.id}' is not a safe non-negative integer (${rewardAmount}).`,
      );
    }

    return {
      seasonId,
      clubId: club.id,
      targetPosition,
      rewardAmount,
      ambition,
      objectiveMet: null,
      rewardPaid: 0,
      debtRemaining: null,
      settledAt: null,
      sanction: 'none',
    };
  });
}
