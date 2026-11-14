import { Fixture, League, Season } from '@club-director/shared-types';

/**
 * Whether the season's league fixtures have all been played to a
 * recorded result.
 *
 * Semantics:
 * - A season is complete only when the league has at least one fixture
 *   AND every fixture has `played === true` with both scores recorded.
 * - An empty fixture list is NOT a completed season — it means "no
 *   calendar", not "finished".
 * - A `played` fixture missing numeric scores is malformed data and
 *   blocks completion rather than being silently accepted (the
 *   standings computation also ignores score-less fixtures, so treating
 *   it as played would declare the season over while its result is
 *   absent from the table).
 * - Bye weeks of odd-sized leagues produce no fixture rows at all, so
 *   they cannot be mistaken for missing matches.
 * - `Fixture` has no postponed status in the current model; any
 *   unplayed fixture — whatever the reason — prevents completion.
 *
 * The `season` parameter is part of the contract for future completion
 * rules (e.g. calendar-length checks); completion is currently derived
 * entirely from the league fixture list. Pure and deterministic.
 */
export function isSeasonComplete(league: League, season: Season): boolean {
  const fixtures = league.fixtures;
  if (!Array.isArray(fixtures) || fixtures.length === 0) {
    return false;
  }
  return fixtures.every(
    (fixture) =>
      fixture.played === true &&
      Number.isFinite(fixture.homeScore) &&
      Number.isFinite(fixture.awayScore),
  );
}

export interface SeasonAnomalies {
  /**
   * Fixtures marked `played === true` but missing a finite home or away
   * score. These can never be re-simulated (advanceMatchweek only picks
   * unplayed fixtures) nor counted as complete — a permanent blocker.
   */
  malformedPlayedFixtures: Fixture[];
  /**
   * Fixtures not played whose `week` is already in the past
   * (`week < season.currentWeek`). advanceMatchweek only selects
   * fixtures of the current week, so these are orphaned forever.
   */
  orphanedUnplayedFixtures: Fixture[];
  /** Fixtures whose `week` is not an integer >= 1. */
  invalidWeekFixtures: Fixture[];
}

/**
 * Detect structural inconsistencies in a season's fixture list without
 * repairing anything. Results preserve the league's fixture order
 * (deterministic). A clean season returns three empty arrays.
 */
export function getSeasonAnomalies(
  league: League,
  season: Season,
): SeasonAnomalies {
  const anomalies: SeasonAnomalies = {
    malformedPlayedFixtures: [],
    orphanedUnplayedFixtures: [],
    invalidWeekFixtures: [],
  };
  for (const fixture of league.fixtures) {
    if (
      !Number.isInteger(fixture.week) ||
      fixture.week < 1
    ) {
      anomalies.invalidWeekFixtures.push(fixture);
    }
    if (
      fixture.played === true &&
      (!Number.isFinite(fixture.homeScore) ||
        !Number.isFinite(fixture.awayScore))
    ) {
      anomalies.malformedPlayedFixtures.push(fixture);
    }
    if (fixture.played !== true && fixture.week < season.currentWeek) {
      anomalies.orphanedUnplayedFixtures.push(fixture);
    }
  }
  return anomalies;
}
