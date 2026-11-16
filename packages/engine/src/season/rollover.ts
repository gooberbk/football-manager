import {
  Club,
  League,
  Player,
  Season,
} from '@club-director/shared-types';
import { generateFixtures, scheduledFixturesToLeagueFixtures } from './scheduling';
import { computeStandings } from './standings';
import { getSeasonAnomalies, isSeasonComplete } from './completion';

export interface BuildNextSeasonInput {
  league: League;
  season: Season;
  /**
   * Clubs are carried over unchanged and returned by reference. Players
   * are part of the input contract (callers pass the full career state)
   * but are NOT returned as-is: every player ages exactly one year as
   * part of the new-season construction (see NextSeasonState.players).
   */
  clubs: Club[];
  players: Player[];
  /** e.g. 'season-2'. Must be non-blank and different from season.id. */
  newSeasonId: string;
  /** First day of the new season; also the fixture-calendar base date. */
  newStartDate: Date;
}

export interface NextSeasonState {
  league: League;
  season: Season;
  clubs: Club[];
  /**
   * Every input player with `age + 1` — the annual aging applied once
   * per successful season rollover. New objects; all other fields
   * (attributes, development, status, contract) are preserved by
   * reference/value. Input players are never mutated.
   */
  players: Player[];
}

/**
 * Build the domain state for the season following a completed one.
 *
 * Pure and deterministic: no clock, no randomness, no I/O. All
 * preconditions are validated up front and violations throw — nothing
 * is silently repaired.
 *
 * Preconditions (all required):
 * - The current season is complete (isSeasonComplete).
 * - No structural anomalies (getSeasonAnomalies is empty).
 * - season.leagueId === league.id.
 * - league.clubIds are non-blank, unique strings (>= 2 clubs).
 * - newSeasonId is non-blank and different from season.id.
 * - newStartDate is a valid Date.
 *
 * Output:
 * - season: same leagueId, currentWeek 1, supplied start date (copied),
 *   transferWindowOpen true, fixturesCalendar [].
 * - league: same id/name/tier/clubIds; fixtures regenerated via the
 *   existing double round-robin scheduler; standings reset to zero for
 *   every club.
 * - clubs: returned as the same reference, untouched.
 * - players: every player ages exactly one year (`age + 1`). This is the
 *   single annual aging point of the career lifecycle — callers must
 *   publish `next.players` (never the input array) so memory and
 *   persistence stay consistent. All other player fields are preserved;
 *   inputs are never mutated.
 */
export function buildNextSeason(input: BuildNextSeasonInput): NextSeasonState {
  const { league, season, clubs, players, newSeasonId, newStartDate } = input;

  // Anomalies are checked first: they are the more precise diagnosis —
  // e.g. a played fixture with a missing score also makes the season
  // incomplete, but "malformed played fixture" is the actionable error.
  const anomalies = getSeasonAnomalies(league, season);
  const anomalyCount =
    anomalies.malformedPlayedFixtures.length +
    anomalies.orphanedUnplayedFixtures.length +
    anomalies.invalidWeekFixtures.length;
  if (anomalyCount > 0) {
    throw new Error(
      `Cannot start next season: ${anomalyCount} fixture anomaly(ies) ` +
        `(${anomalies.malformedPlayedFixtures.length} malformed played, ` +
        `${anomalies.orphanedUnplayedFixtures.length} orphaned unplayed, ` +
        `${anomalies.invalidWeekFixtures.length} invalid week).`,
    );
  }

  if (!isSeasonComplete(league, season)) {
    throw new Error(
      'Cannot start next season: current season is not complete ' +
        '(every fixture must be played with finite scores).',
    );
  }

  if (season.leagueId !== league.id) {
    throw new Error(
      `Cannot start next season: season.leagueId '${season.leagueId}' ` +
        `does not match league.id '${league.id}'.`,
    );
  }

  if (!Number.isInteger(season.currentWeek) || season.currentWeek < 1) {
    throw new Error(
      'Cannot start next season: season.currentWeek must be a finite ' +
        `integer >= 1, got ${season.currentWeek}.`,
    );
  }

  const clubIds = league.clubIds;
  if (
    !Array.isArray(clubIds) ||
    clubIds.length < 2 ||
    clubIds.some((id) => typeof id !== 'string' || id.trim() === '') ||
    new Set(clubIds).size !== clubIds.length
  ) {
    throw new Error(
      'Cannot start next season: league.clubIds must contain at least ' +
        'two unique non-blank club ids.',
    );
  }

  // Every league club must resolve to exactly one entry in input.clubs.
  // Extra clubs are allowed (the career may span several leagues); only
  // referenced ids are checked, and duplicates of a referenced id are
  // rejected because they make the league's club identity ambiguous.
  if (!Array.isArray(clubs)) {
    throw new Error('Cannot start next season: input.clubs must be an array.');
  }
  const clubCountById = new Map<string, number>();
  for (const club of clubs) {
    clubCountById.set(club.id, (clubCountById.get(club.id) ?? 0) + 1);
  }
  const missingClubIds = clubIds.filter((id) => !clubCountById.has(id));
  if (missingClubIds.length > 0) {
    throw new Error(
      'Cannot start next season: league.clubIds references club id(s) ' +
        `absent from input.clubs: ${missingClubIds.join(', ')}.`,
    );
  }
  const duplicatedClubIds = clubIds.filter(
    (id) => (clubCountById.get(id) ?? 0) > 1,
  );
  if (duplicatedClubIds.length > 0) {
    throw new Error(
      'Cannot start next season: input.clubs contains duplicate entries ' +
        `for league club id(s): ${duplicatedClubIds.join(', ')}.`,
    );
  }

  if (typeof newSeasonId !== 'string' || newSeasonId.trim() === '') {
    throw new Error('Cannot start next season: newSeasonId must be non-blank.');
  }
  if (newSeasonId === season.id) {
    throw new Error(
      `Cannot start next season: newSeasonId '${newSeasonId}' is identical ` +
        'to the current season id.',
    );
  }

  if (!(newStartDate instanceof Date) || Number.isNaN(newStartDate.getTime())) {
    throw new Error('Cannot start next season: newStartDate is invalid.');
  }

  // The new calendar must not start before the last played fixture:
  // season.currentDate already points one week past it in the normal
  // flow, but a corrupted state could violate that. Fixture dates are
  // validated too — a NaN date would silently poison the comparison.
  let lastFixtureTime = Number.NEGATIVE_INFINITY;
  for (const fixture of league.fixtures) {
    const fixtureTime =
      fixture.date instanceof Date ? fixture.date.getTime() : NaN;
    if (!Number.isFinite(fixtureTime)) {
      throw new Error(
        `Cannot start next season: fixture ${fixture.id} has an invalid date.`,
      );
    }
    if (fixtureTime > lastFixtureTime) {
      lastFixtureTime = fixtureTime;
    }
  }
  if (newStartDate.getTime() < lastFixtureTime) {
    throw new Error(
      'Cannot start next season: newStartDate precedes the last fixture ' +
        'date of the completed season.',
    );
  }

  const scheduled = generateFixtures(clubIds, newStartDate);
  const fixtures = scheduledFixturesToLeagueFixtures(scheduled);

  const newLeague: League = {
    ...league,
    fixtures,
    standings: computeStandings({ ...league, fixtures: [] }),
  };

  const newSeason: Season = {
    id: newSeasonId,
    leagueId: league.id,
    currentWeek: 1,
    currentDate: new Date(newStartDate.getTime()),
    transferWindowOpen: true,
    fixturesCalendar: [],
  };

  // Annual aging: exactly +1 year for every player, applied once per
  // rollover construction. Deterministic (no RNG), order-preserving and
  // non-mutating — a retried rollover recomputes the same result from
  // the same un-aged inputs, so aging can never be applied twice to the
  // same source state.
  const agedPlayers = players.map((player) => ({
    ...player,
    age: player.age + 1,
  }));

  return {
    league: newLeague,
    season: newSeason,
    clubs,
    players: agedPlayers,
  };
}
