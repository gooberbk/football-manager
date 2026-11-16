import { Fixture, League, LeagueStandings, StandingEntry } from '@club-director/shared-types';

/**
 * Canonical standings comparison: points, then goal difference, then
 * goals scored — all descending. This is the ONLY ranking comparator in
 * the engine; computeStandings relies on Array.sort stability to resolve
 * full ties in league.clubIds insertion order, so callers needing a
 * total order must apply that same clubIds tiebreak explicitly.
 */
export function compareStandingEntries(
  a: StandingEntry,
  b: StandingEntry,
): number {
  if (b.points !== a.points) {
    return b.points - a.points;
  }
  if (b.goalDifference !== a.goalDifference) {
    return b.goalDifference - a.goalDifference;
  }
  return b.goalsFor - a.goalsFor;
}

/**
 * Compute league standings from fixtures and results.
 * Sorted by points, then goal difference, then goals scored.
 */
export function computeStandings(league: League): LeagueStandings {
  const standingsMap = new Map<string, StandingEntry>();

  // Initialize standings for all clubs
  league.clubIds.forEach((clubId) => {
    standingsMap.set(clubId, {
      clubId,
      played: 0,
      won: 0,
      drawn: 0,
      lost: 0,
      goalsFor: 0,
      goalsAgainst: 0,
      goalDifference: 0,
      points: 0,
    });
  });

  // Process all played fixtures
  league.fixtures.forEach((fixture) => {
    if (!fixture.played || fixture.homeScore === undefined || fixture.awayScore === undefined) {
      return;
    }

    const homeEntry = standingsMap.get(fixture.homeClubId);
    const awayEntry = standingsMap.get(fixture.awayClubId);

    if (!homeEntry || !awayEntry) {
      return;
    }

    // Update played count
    homeEntry.played++;
    awayEntry.played++;

    // Update goals
    homeEntry.goalsFor += fixture.homeScore;
    homeEntry.goalsAgainst += fixture.awayScore;
    awayEntry.goalsFor += fixture.awayScore;
    awayEntry.goalsAgainst += fixture.homeScore;

    // Update goal difference
    homeEntry.goalDifference = homeEntry.goalsFor - homeEntry.goalsAgainst;
    awayEntry.goalDifference = awayEntry.goalsFor - awayEntry.goalsAgainst;

    // Update points and win/draw/loss
    if (fixture.homeScore > fixture.awayScore) {
      homeEntry.won++;
      homeEntry.points += 3;
      awayEntry.lost++;
    } else if (fixture.homeScore < fixture.awayScore) {
      awayEntry.won++;
      awayEntry.points += 3;
      homeEntry.lost++;
    } else {
      homeEntry.drawn++;
      awayEntry.drawn++;
      homeEntry.points += 1;
      awayEntry.points += 1;
    }
  });

  // Convert to array and sort — stable sort keeps league.clubIds order
  // for entries tied on every comparison key.
  const entries = Array.from(standingsMap.values()).sort(compareStandingEntries);

  return { entries };
}
