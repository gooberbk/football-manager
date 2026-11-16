import { assignSeasonObjectives } from '@club-director/engine';
import type { CareerState } from '../db/careerPersistence';
import type { SeasonObjective } from '@club-director/shared-types';

export type EnsureSeasonObjectivesAction =
  | 'unchanged'
  | 'recovered'
  | 'blocked'
  | 'corrupt';

export interface EnsureSeasonObjectivesResult {
  state: CareerState;
  action: EnsureSeasonObjectivesAction;
}

const VALID_AMBITIONS = new Set([
  'title_favorite',
  'title_contender',
  'upper_table',
  'mid_table',
  'progression',
  'survival',
]);

/**
 * Pre-settlement invariants of a current-season objective: settlement
 * writes these fields exactly once at rollover, so a current-season
 * objective carrying any settled value is incoherent.
 */
function isUnsettledObjective(objective: SeasonObjective): boolean {
  return (
    objective.objectiveMet === null &&
    objective.rewardPaid === 0 &&
    objective.debtRemaining === null &&
    objective.settledAt === null &&
    objective.sanction === 'none'
  );
}

function isWellFormedObjective(objective: SeasonObjective): boolean {
  return (
    typeof objective.seasonId === 'string' &&
    objective.seasonId.length > 0 &&
    typeof objective.clubId === 'string' &&
    objective.clubId.length > 0 &&
    Number.isInteger(objective.targetPosition) &&
    objective.targetPosition > 0 &&
    Number.isSafeInteger(objective.rewardAmount) &&
    objective.rewardAmount >= 0 &&
    VALID_AMBITIONS.has(objective.ambition) &&
    isUnsettledObjective(objective)
  );
}

/**
 * Ensure the career's current season has its season objectives, either
 * already present or recoverable from a provably untouched initial state.
 *
 * Pure: no I/O, no persistence, inputs never mutated. Classification:
 *
 * - 'unchanged': exactly one well-formed unsettled objective per league
 *   club for the current season (historical objectives are ignored for
 *   completeness but always preserved).
 * - 'recovered': no current-season objective AND the season is provably
 *   untouched — currentWeek 1, no played fixture, no match of this
 *   season, and a strictly empty transferHistory. transferHistory is
 *   cumulative and carries no seasonId, so ANY entry forbids recovery:
 *   a single transfer, even from a previous season, makes squad
 *   integrity unprovable. Matches of previous seasons do not block —
 *   they are filtered by seasonId.
 * - 'blocked': no current-season objective and integrity cannot be
 *   proven. The caller keeps the loaded state untouched; the rollover
 *   will still fail explicitly at settlement time.
 * - 'corrupt': the current-season collection is partial, duplicated,
 *   references foreign clubs, or carries incoherent fields. Never
 *   repaired or masked.
 *
 * assignSeasonObjectives may throw on invalid career data — the error
 * propagates to the caller, which surfaces it through its error channel.
 */
export function ensureSeasonObjectives(
  state: CareerState,
): EnsureSeasonObjectivesResult {
  const { league, season, clubs, players, seasonObjectives } = state;

  if (!Array.isArray(seasonObjectives)) {
    return { state, action: 'corrupt' };
  }

  const currentObjectives = seasonObjectives.filter(
    (o) => o.seasonId === season.id,
  );
  const historicalObjectives = seasonObjectives.filter(
    (o) => o.seasonId !== season.id,
  );

  if (currentObjectives.length > 0) {
    // Complete only when every league club has exactly one well-formed
    // unsettled objective — anything else is corruption, never repaired.
    const clubIds = new Set(league.clubIds);
    const seen = new Set<string>();
    const complete =
      currentObjectives.length === clubIds.size &&
      currentObjectives.every((o) => {
        if (!isWellFormedObjective(o) || !clubIds.has(o.clubId)) {
          return false;
        }
        if (seen.has(o.clubId)) {
          return false;
        }
        seen.add(o.clubId);
        return true;
      });
    return { state, action: complete ? 'unchanged' : 'corrupt' };
  }

  // No current-season objective: recovery requires proof that nothing
  // that feeds assignSeasonObjectives could have changed since the
  // season started.
  const integrityProven =
    season.currentWeek === 1 &&
    Array.isArray(league.fixtures) &&
    league.fixtures.every((f) => f.played !== true) &&
    (state.matches ?? []).every((m) => m.seasonId !== season.id) &&
    Array.isArray(state.transferHistory) &&
    state.transferHistory.length === 0;

  if (!integrityProven) {
    return { state, action: 'blocked' };
  }

  const seasonWeeks = league.fixtures.reduce(
    (max, fixture) => Math.max(max, fixture.week),
    0,
  );
  const generated = assignSeasonObjectives({
    seasonId: season.id,
    clubs,
    players,
    seasonWeeks,
  });

  return {
    state: {
      ...state,
      seasonObjectives: [...historicalObjectives, ...generated],
    },
    action: 'recovered',
  };
}
