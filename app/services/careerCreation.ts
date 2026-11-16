import { assignSeasonObjectives, generateSeedData, generateFixtures, scheduledFixturesToLeagueFixtures } from '@club-director/engine';
import { saveCareer, initializeDatabase } from '../db';
import type { League, Season } from '@club-director/shared-types';
import { useGameState } from '../store/useGameState';

/**
 * Create a new career for the club at `clubIndex`: initialize the database,
 * build the league/season from seed data, persist the career, then publish
 * the populated state to the store.
 *
 * Ordering contract: `bootStatus` is set to 'loaded' only AFTER
 * `saveCareer` resolves and the store is populated, so a persistence
 * failure can never leave the app claiming a career exists. On failure
 * this function throws before touching the store and `bootStatus` keeps
 * its previous value (typically 'empty').
 */
export async function createCareer(clubIndex: number): Promise<void> {
  await initializeDatabase();

  const seedData = generateSeedData(12345);
  const clubs = seedData.clubs;
  const players = seedData.players;

  const selectedClub = clubs[clubIndex];

  const league: League = {
    id: 'league-1',
    name: 'Premier Division',
    tier: 1,
    clubIds: clubs.map((c) => c.id),
    standings: {
      entries: clubs.map((club) => ({
        clubId: club.id,
        played: 0,
        won: 0,
        drawn: 0,
        lost: 0,
        goalsFor: 0,
        goalsAgainst: 0,
        goalDifference: 0,
        points: 0,
      })),
    },
    fixtures: [],
  };

  const season: Season = {
    id: 'season-1',
    leagueId: 'league-1',
    currentWeek: 1,
    currentDate: new Date('2024-08-01'),
    transferWindowOpen: true,
    fixturesCalendar: [],
  };

  // Generate fixtures
  const scheduledFixtures = generateFixtures(clubs.map((c) => c.id), new Date('2024-08-01'));
  league.fixtures = scheduledFixturesToLeagueFixtures(scheduledFixtures);

  // Season objectives are assigned at season start, before the career is
  // persisted — the same transaction then carries them atomically. The
  // generator is pure/deterministic and throws on invalid data, which
  // aborts creation before saveCareer (no partial career).
  const seasonWeeks = league.fixtures.reduce(
    (max, fixture) => Math.max(max, fixture.week),
    0,
  );
  const seasonObjectives = assignSeasonObjectives({
    seasonId: season.id,
    clubs,
    players,
    seasonWeeks,
  });

  const careerState = {
    career: {
      id: 'active',
      managerName: 'Player',
      managedClubId: selectedClub.id,
      createdAt: new Date(),
      lastPlayedAt: new Date(),
      schemaVersion: 1,
    },
    clubs,
    players,
    league,
    season,
    transferHistory: [],
    transferOffers: [],
    matches: [],
    seasonObjectives,
  };

  await saveCareer(careerState);

  // Update Zustand store — only after persistence has succeeded.
  const store = useGameState.getState();
  store.setLeague(league);
  store.setSeason(season);
  store.setClubs(clubs);
  store.setPlayers(players);
  store.setManagedClubId(selectedClub.id);
  store.setTransferHistory([]);
  store.setTransferOffers([]);
  store.setMatches([]);
  store.setSeasonObjectives(seasonObjectives);
  store.setResultsHistory([]);
  store.setBootStatus('loaded');
  store.setIsLoading(false);
}
