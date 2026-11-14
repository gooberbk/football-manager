import {
  generateFixtures,
  generateSeedData,
  scheduledFixturesToLeagueFixtures,
} from '@club-director/engine';
import type {
  Club,
  Fixture,
  League,
  Player,
  Season,
} from '@club-director/shared-types';

import { useGameState } from '../store/useGameState';

// The service reads the store and imports buildPersistedMatch (pure);
// '../db' is only pulled in transitively via useGameState -> saveCareer,
// so mock it like the other service tests do.
jest.mock('../db', () => ({
  initializeDatabase: jest.fn().mockResolvedValue(undefined),
  saveCareer: jest.fn().mockResolvedValue(undefined),
  loadCareer: jest.fn(),
  deleteCareer: jest.fn(),
}));

const SEASON_START = new Date('2024-08-01T00:00:00Z');

/** An in-progress career: generated fixtures, nothing played yet. */
function buildLiveCareer() {
  const seedData = generateSeedData(777);
  const clubs = seedData.clubs.slice(0, 3) as Club[];
  const players = seedData.players.filter((p) =>
    clubs.some((c) => c.squad.includes(p.id)),
  ) as Player[];

  const scheduled = generateFixtures(
    clubs.map((c) => c.id),
    SEASON_START,
  );
  const fixtures: Fixture[] = scheduledFixturesToLeagueFixtures(scheduled);
  const weekOneFixtures = fixtures.filter((f) => f.week === 1);

  const league: League = {
    id: 'league-1',
    name: 'Live League',
    tier: 1,
    clubIds: clubs.map((c) => c.id),
    standings: {
      entries: clubs.map((c) => ({
        clubId: c.id,
        played: 0, won: 0, drawn: 0, lost: 0,
        goalsFor: 0, goalsAgainst: 0, goalDifference: 0, points: 0,
      })),
    },
    fixtures,
  };

  const season: Season = {
    id: 'season-1',
    leagueId: 'league-1',
    currentWeek: 1,
    currentDate: SEASON_START,
    transferWindowOpen: true,
    fixturesCalendar: [],
  };

  return { clubs, players, league, season, weekOneFixtures };
}

function populateLiveStore(
  career: ReturnType<typeof buildLiveCareer>,
  store: ReturnType<typeof useGameState.getState>,
) {
  store.setLeague(career.league);
  store.setSeason(career.season);
  store.setClubs(career.clubs);
  store.setPlayers(career.players);
  store.setTransferHistory([]);
  store.setTransferOffers([]);
  store.setMatches([]);
  store.setResultsHistory([]);
  store.setManagedClubId(career.clubs[0].id);
  store.setBootStatus('loaded');
  store.setIsLoading(false);
}

async function freshSimulation() {
  jest.resetModules();
  const { simulateMatchweek } = await import('./matchweekSimulation');
  const { useGameState } = await import('../store/useGameState');
  return {
    simulateMatchweek,
    getStore: () => useGameState.getState(),
  };
}

describe('simulateMatchweek', () => {
  it('applies the matchweek exactly once for two same-tick invocations', async () => {
    const { simulateMatchweek, getStore } = await freshSimulation();
    const career = buildLiveCareer();
    populateLiveStore(career, getStore());

    // Two invocations before any await boundary: the second must be
    // rejected by the in-flight lock instead of replaying week 1.
    const first = simulateMatchweek();
    const second = simulateMatchweek();
    const [r1, r2] = await Promise.all([first, second]);

    expect(r1).toEqual({
      status: 'applied',
      resultsCount: career.weekOneFixtures.length,
    });
    expect(r2).toEqual({ status: 'skipped', reason: 'in-flight' });

    const store = getStore();
    // Week advanced exactly once.
    expect(store.season?.currentWeek).toBe(2);
    // addResult ran once — a single results entry, not two.
    expect(store.resultsHistory).toHaveLength(1);
    // Match history contains exactly the week-1 fixtures, no duplicates.
    expect(store.matches).toHaveLength(career.weekOneFixtures.length);
    expect(new Set(store.matches.map((m) => m.id)).size).toBe(
      career.weekOneFixtures.length,
    );
    // Week-1 fixtures are played with scores.
    const played = store.league!.fixtures.filter(
      (f) => f.week === 1 && f.played,
    );
    expect(played).toHaveLength(career.weekOneFixtures.length);
  });

  it('releases the lock after a failure so a later retry succeeds', async () => {
    const { simulateMatchweek, getStore } = await freshSimulation();
    const career = buildLiveCareer();
    populateLiveStore(career, getStore());

    // Corrupt the calendar: a week-1 fixture references a missing club,
    // so advanceMatchweek throws before any setter runs.
    const brokenLeague: League = {
      ...career.league,
      fixtures: career.league.fixtures.map((f, i) =>
        i === 0 ? { ...f, homeClubId: 'ghost-club' } : f,
      ),
    };
    getStore().setLeague(brokenLeague);

    await expect(simulateMatchweek()).rejects.toThrow(/missing home club/);

    // The lock was released in finally: a valid retry works normally.
    getStore().setLeague(career.league);
    const retry = await simulateMatchweek();
    expect(retry.status).toBe('applied');
    expect(getStore().season?.currentWeek).toBe(2);
    expect(getStore().resultsHistory).toHaveLength(1);
  });

  it('skips without touching state when the season is already complete', async () => {
    const { simulateMatchweek, getStore } = await freshSimulation();
    const career = buildLiveCareer();
    populateLiveStore(career, getStore());
    // Mark every fixture played with scores → completed season.
    const completedLeague: League = {
      ...career.league,
      fixtures: career.league.fixtures.map((f) => ({
        ...f,
        played: true,
        homeScore: 1,
        awayScore: 0,
      })),
    };
    getStore().setLeague(completedLeague);
    const seasonBefore = getStore().season;
    const matchesBefore = getStore().matches;

    const result = await simulateMatchweek();

    expect(result).toEqual({ status: 'skipped', reason: 'season-complete' });
    expect(getStore().season).toBe(seasonBefore);
    expect(getStore().matches).toBe(matchesBefore);
    expect(getStore().resultsHistory).toHaveLength(0);
  });

  it('skips cleanly when no career is loaded', async () => {
    const { simulateMatchweek, getStore } = await freshSimulation();

    const result = await simulateMatchweek();

    expect(result).toEqual({ status: 'skipped', reason: 'no-career' });
    expect(getStore().season).toBeNull();
  });

  it('applies successive matchweeks on later calls once the lock clears', async () => {
    const { simulateMatchweek, getStore } = await freshSimulation();
    const career = buildLiveCareer();
    populateLiveStore(career, getStore());

    const r1 = await simulateMatchweek();
    const r2 = await simulateMatchweek();

    expect(r1.status).toBe('applied');
    expect(r2.status).toBe('applied');
    expect(getStore().season?.currentWeek).toBe(3);
    expect(getStore().resultsHistory).toHaveLength(2);
  });
});
