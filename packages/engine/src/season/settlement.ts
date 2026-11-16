import {
  Club,
  League,
  SeasonAmbition,
  SeasonObjective,
} from '@club-director/shared-types';
import { compareStandingEntries } from './standings';

export interface SettleSeasonObjectivesInput {
  /** Season being settled — objectives are matched on this id. */
  seasonId: string;
  /** League whose final standings determine objective success. */
  league: League;
  /**
   * All clubs. Every league club must appear exactly once; clubs outside
   * the league are returned unchanged (same reference).
   */
  clubs: Club[];
  /**
   * Season objectives, possibly mixed with other seasons' history.
   * Only rows matching `seasonId` are validated and settled; other rows
   * pass through untouched.
   */
  objectives: SeasonObjective[];
  /** Managed club id — the only club eligible for a deferred sanction. */
  managedClubId: string;
  /** Settlement timestamp recorded on every settled objective. */
  settledAt: Date;
}

export interface SeasonSettlementResult {
  /** New club objects for settled league clubs; others same reference. */
  clubs: Club[];
  /** Input objectives with this season's rows replaced by settled copies. */
  objectives: SeasonObjective[];
}

const VALID_AMBITIONS = new Set<SeasonAmbition>([
  'title_favorite',
  'title_contender',
  'upper_table',
  'mid_table',
  'progression',
  'survival',
]);

/**
 * Settle a completed season's objectives exactly once.
 *
 * Pure: no RNG, no clock (settledAt is supplied), no I/O, inputs never
 * mutated. Every anomaly throws — a partially settled season is never
 * produced.
 *
 * Financial rule per club (rewardAmount is the persisted objective
 * value, never recomputed):
 *   met    → debtRepaid = min(reward, debt); balance += reward - debtRepaid;
 *            debt -= debtRepaid; rewardPaid = reward
 *   unmet  → rewardPaid = 0; balance and debt unchanged
 * The remainder credits `balance` only — `transferBudget` is never
 * touched. Real debt is never truncated: an unmet objective or a
 * reward smaller than the debt leaves the residual debt in place.
 *
 * sanction = 'dismissal_relegation_pending' only for the managed club
 * when debt remains after settlement — a recorded fact, never an
 * executed dismissal or relegation.
 */
export function settleSeasonObjectives(
  input: SettleSeasonObjectivesInput,
): SeasonSettlementResult {
  const { seasonId, league, clubs, objectives, managedClubId, settledAt } =
    input;

  if (typeof seasonId !== 'string' || seasonId.trim().length === 0) {
    throw new Error('settleSeasonObjectives: seasonId must be a non-empty string.');
  }
  if (typeof managedClubId !== 'string' || managedClubId.trim().length === 0) {
    throw new Error('settleSeasonObjectives: managedClubId must be a non-empty string.');
  }
  if (!(settledAt instanceof Date) || !Number.isFinite(settledAt.getTime())) {
    throw new Error('settleSeasonObjectives: settledAt must be a valid Date.');
  }
  if (!league || !Array.isArray(league.clubIds)) {
    throw new Error('settleSeasonObjectives: league.clubIds must be an array.');
  }

  // League club ids: non-empty, unique.
  const clubIds = league.clubIds;
  const leagueClubIdSet = new Set<string>();
  for (const clubId of clubIds) {
    if (typeof clubId !== 'string' || clubId.length === 0) {
      throw new Error('settleSeasonObjectives: league.clubIds contains an invalid id.');
    }
    if (leagueClubIdSet.has(clubId)) {
      throw new Error(`settleSeasonObjectives: duplicate league club id '${clubId}'.`);
    }
    leagueClubIdSet.add(clubId);
  }
  if (!leagueClubIdSet.has(managedClubId)) {
    throw new Error(
      `settleSeasonObjectives: managedClubId '${managedClubId}' is not in the league.`,
    );
  }

  // Final standings must contain exactly the league clubs — same set,
  // no duplicates, no missing, no foreign entries.
  const entries = league.standings?.entries;
  if (!Array.isArray(entries)) {
    throw new Error('settleSeasonObjectives: league.standings.entries must be an array.');
  }
  const positionByClubId = new Map<string, number>();
  entries.forEach((entry, index) => {
    const entryClubId = entry?.clubId;
    if (typeof entryClubId !== 'string' || entryClubId.length === 0) {
      throw new Error('settleSeasonObjectives: standings entry has an invalid clubId.');
    }
    if (!leagueClubIdSet.has(entryClubId)) {
      throw new Error(
        `settleSeasonObjectives: standings entry '${entryClubId}' is not a league club.`,
      );
    }
    if (positionByClubId.has(entryClubId)) {
      throw new Error(
        `settleSeasonObjectives: duplicate standings entry for '${entryClubId}'.`,
      );
    }
    positionByClubId.set(entryClubId, index + 1);
  });
  if (positionByClubId.size !== leagueClubIdSet.size) {
    throw new Error(
      'settleSeasonObjectives: final standings do not cover every league club.',
    );
  }

  // The standings array order IS the final classification, so it must
  // already be in canonical order: compareStandingEntries descending
  // (points, goal difference, goals scored), with full ties resolved by
  // league.clubIds order — the same total order computeStandings produces
  // through its stable sort over clubIds-insertion-ordered entries, and
  // the same order loadCareer restores. A misordered table is rejected
  // outright; it is never silently re-sorted.
  const standingsOrder = new Map(
    clubIds.map((clubId, index) => [clubId, index]),
  );
  for (let i = 1; i < entries.length; i++) {
    const previous = entries[i - 1];
    const current = entries[i];
    const comparison = compareStandingEntries(previous, current);
    const outOfOrder =
      comparison > 0 ||
      (comparison === 0 &&
        standingsOrder.get(previous.clubId)! >
          standingsOrder.get(current.clubId)!);
    if (outOfOrder) {
      throw new Error(
        'settleSeasonObjectives: final standings are not in canonical ' +
          'order (points, goal difference, goals scored, then clubIds).',
      );
    }
  }

  if (!Array.isArray(clubs)) {
    throw new Error('settleSeasonObjectives: clubs must be an array.');
  }

  // League clubs must each appear exactly once in `clubs`; their
  // finances must be valid safe integers (balance may be negative).
  const clubById = new Map<string, Club>();
  for (const club of clubs) {
    if (typeof club?.id === 'string' && club.id.length > 0) {
      if (clubById.has(club.id)) {
        if (leagueClubIdSet.has(club.id)) {
          throw new Error(
            `settleSeasonObjectives: league club '${club.id}' appears more than once in clubs.`,
          );
        }
        // Duplicate non-league club: harmless for settlement but still
        // an inconsistent input — reject rather than pick arbitrarily.
        throw new Error(
          `settleSeasonObjectives: duplicate club id '${club.id}' in clubs.`,
        );
      }
      clubById.set(club.id, club);
    }
  }
  const leagueClubs = clubIds.map((clubId) => {
    const club = clubById.get(clubId);
    if (!club) {
      throw new Error(
        `settleSeasonObjectives: league club '${clubId}' is missing from clubs.`,
      );
    }
    const { balance, debt } = club.finances;
    if (!Number.isSafeInteger(balance)) {
      throw new Error(
        `settleSeasonObjectives: club '${clubId}' has an invalid balance (${balance}).`,
      );
    }
    if (!Number.isSafeInteger(debt) || debt < 0) {
      throw new Error(
        `settleSeasonObjectives: club '${clubId}' has an invalid debt (${debt}).`,
      );
    }
    return club;
  });

  // This season's objectives: exactly one per league club, none for
  // foreign clubs, none already settled, no duplicates.
  if (!Array.isArray(objectives)) {
    throw new Error('settleSeasonObjectives: objectives must be an array.');
  }
  const seasonObjectives = new Map<string, SeasonObjective>();
  const settledObjectiveKeys = new Set<string>();
  for (const objective of objectives) {
    if (objective?.seasonId !== seasonId) {
      continue; // other seasons' history passes through untouched
    }
    const key = objective.clubId;
    if (typeof key !== 'string' || key.length === 0) {
      throw new Error('settleSeasonObjectives: objective has an invalid clubId.');
    }
    if (settledObjectiveKeys.has(key)) {
      throw new Error(
        `settleSeasonObjectives: duplicate objective for club '${key}' in season '${seasonId}'.`,
      );
    }
    settledObjectiveKeys.add(key);

    if (!leagueClubIdSet.has(key)) {
      throw new Error(
        `settleSeasonObjectives: objective for '${key}' belongs to no league club.`,
      );
    }
    // Unsettled-row invariants: settlement fields must still be empty.
    if (
      objective.objectiveMet !== null ||
      objective.debtRemaining !== null ||
      objective.settledAt !== null ||
      objective.rewardPaid !== 0 ||
      objective.sanction !== 'none'
    ) {
      throw new Error(
        `settleSeasonObjectives: objective for '${key}' is not in a clean pre-settlement state.`,
      );
    }
    if (
      !Number.isInteger(objective.targetPosition) ||
      objective.targetPosition < 1 ||
      objective.targetPosition > clubIds.length
    ) {
      throw new Error(
        `settleSeasonObjectives: objective for '${key}' has an invalid targetPosition (${objective.targetPosition}).`,
      );
    }
    if (!Number.isSafeInteger(objective.rewardAmount) || objective.rewardAmount < 0) {
      throw new Error(
        `settleSeasonObjectives: objective for '${key}' has an invalid rewardAmount (${objective.rewardAmount}).`,
      );
    }
    if (!VALID_AMBITIONS.has(objective.ambition)) {
      throw new Error(
        `settleSeasonObjectives: objective for '${key}' has an invalid ambition.`,
      );
    }
    seasonObjectives.set(key, objective);
  }

  for (const clubId of clubIds) {
    if (!seasonObjectives.has(clubId)) {
      throw new Error(
        `settleSeasonObjectives: league club '${clubId}' has no objective for season '${seasonId}'.`,
      );
    }
  }

  // Settle every league club; produce new club/objective objects.
  const settledClubById = new Map<string, Club>();
  const settledObjectiveById = new Map<string, SeasonObjective>();

  for (const club of leagueClubs) {
    const objective = seasonObjectives.get(club.id)!;
    const position = positionByClubId.get(club.id)!;
    const met = position <= objective.targetPosition;
    const debtBefore = club.finances.debt;
    const balanceBefore = club.finances.balance;

    let balanceAfter = balanceBefore;
    let debtAfter = debtBefore;
    let rewardPaid = 0;

    if (met) {
      const debtRepaid = Math.min(objective.rewardAmount, debtBefore);
      const balanceCredit = objective.rewardAmount - debtRepaid;
      balanceAfter = balanceBefore + balanceCredit;
      debtAfter = debtBefore - debtRepaid;
      rewardPaid = objective.rewardAmount;
    }

    if (!Number.isSafeInteger(balanceAfter) || !Number.isSafeInteger(debtAfter)) {
      throw new Error(
        `settleSeasonObjectives: settlement for club '${club.id}' produces unsafe financial values.`,
      );
    }

    settledClubById.set(club.id, {
      ...club,
      finances: {
        ...club.finances,
        balance: balanceAfter,
        debt: debtAfter,
        // transferBudget and every other finance field: untouched.
      },
    });

    settledObjectiveById.set(club.id, {
      ...objective,
      objectiveMet: met,
      rewardPaid,
      debtRemaining: debtAfter,
      // Independent Date instance per objective: mutating one settled
      // row must never alias the others or the caller's input Date.
      settledAt: new Date(settledAt.getTime()),
      sanction:
        club.id === managedClubId && debtAfter > 0
          ? 'dismissal_relegation_pending'
          : 'none',
    });
  }

  return {
    clubs: clubs.map((club) => settledClubById.get(club.id) ?? club),
    objectives: objectives.map(
      (objective) =>
        objective?.seasonId === seasonId
          ? settledObjectiveById.get(objective.clubId) ?? objective
          : objective,
    ),
  };
}
