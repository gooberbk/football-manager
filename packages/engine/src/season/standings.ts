import { Fixture, League, LeagueStandings, StandingEntry } from '@club-director/shared-types';

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

  // Convert to array and sort
  const entries = Array.from(standingsMap.values()).sort((a, b) => {
    // Primary: points
    if (b.points !== a.points) {
      return b.points - a.points;
    }
    // Secondary: goal difference
    if (b.goalDifference !== a.goalDifference) {
      return b.goalDifference - a.goalDifference;
    }
    // Tertiary: goals scored
    return b.goalsFor - a.goalsFor;
  });

  return { entries };
}
