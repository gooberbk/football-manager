import { Fixture } from '@club-director/shared-types';

export interface ScheduledFixture {
  matchweek: number;
  date: Date;
  homeClubId: string;
  awayClubId: string;
}

/**
 * Generate a double round-robin fixture schedule using the circle method.
 * Each club plays every other club twice (once home, once away).
 * Fixtures are spread across weekly matchweeks, with each club playing exactly once per week.
 * For odd numbers of clubs, a dummy club is added to represent bye weeks.
 */
export function generateFixtures(
  clubIds: string[],
  seasonStartDate: Date,
): ScheduledFixture[] {
  const numClubs = clubIds.length;
  const fixtures: ScheduledFixture[] = [];

  if (numClubs < 2) {
    return fixtures;
  }

  // If odd number of clubs, add a dummy club for bye weeks
  const isOdd = numClubs % 2 !== 0;
  const workingClubs = isOdd ? [...clubIds, 'BYE'] : [...clubIds];
  const numWorkingClubs = workingClubs.length;

  // Circle method for round-robin scheduling
  const totalMatchweeks = 2 * (numClubs - 1);

  // First half of season
  let roundClubs = [...workingClubs];
  for (let round = 0; round < numClubs - 1; round++) {
    const matchweek = round + 1;
    const weekDate = new Date(seasonStartDate);
    weekDate.setDate(weekDate.getDate() + round * 7);

    // Pair clubs: first with last, second with second-to-last, etc.
    for (let i = 0; i < numWorkingClubs / 2; i++) {
      const homeClubId = roundClubs[i];
      const awayClubId = roundClubs[numWorkingClubs - 1 - i];

      // Skip fixtures involving the dummy club (bye weeks)
      if (homeClubId !== 'BYE' && awayClubId !== 'BYE') {
        fixtures.push({
          matchweek,
          date: new Date(weekDate),
          homeClubId,
          awayClubId,
        });
      }
    }

    // Rotate clubs (keep first fixed, rotate the rest clockwise)
    const lastClub = roundClubs[numWorkingClubs - 1];
    for (let i = numWorkingClubs - 1; i > 1; i--) {
      roundClubs[i] = roundClubs[i - 1];
    }
    roundClubs[1] = lastClub;
  }

  // Second half of season (swap home/away)
  roundClubs = [...workingClubs];
  for (let round = 0; round < numClubs - 1; round++) {
    const matchweek = numClubs + round;
    const weekDate = new Date(seasonStartDate);
    weekDate.setDate(weekDate.getDate() + matchweek * 7);

    for (let i = 0; i < numWorkingClubs / 2; i++) {
      const homeClubId = roundClubs[i];
      const awayClubId = roundClubs[numWorkingClubs - 1 - i];

      // Skip fixtures involving the dummy club (bye weeks)
      if (homeClubId !== 'BYE' && awayClubId !== 'BYE') {
        // Swap home/away for second half
        fixtures.push({
          matchweek,
          date: new Date(weekDate),
          homeClubId: awayClubId,
          awayClubId: homeClubId,
        });
      }
    }

    // Rotate clubs
    const lastClub = roundClubs[numWorkingClubs - 1];
    for (let i = numWorkingClubs - 1; i > 1; i--) {
      roundClubs[i] = roundClubs[i - 1];
    }
    roundClubs[1] = lastClub;
  }

  return fixtures;
}

/**
 * Convert scheduled fixtures to league fixtures format
 */
export function scheduledFixturesToLeagueFixtures(
  scheduledFixtures: ScheduledFixture[],
): Fixture[] {
  return scheduledFixtures.map((sf, index) => ({
    id: `fixture-${index}`,
    homeClubId: sf.homeClubId,
    awayClubId: sf.awayClubId,
    week: sf.matchweek,
    date: sf.date,
    played: false,
  }));
}
