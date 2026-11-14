import {
  computeStandings,
  generateFixtures,
  generateSeedData,
  scheduledFixturesToLeagueFixtures,
} from '@club-director/engine';
import type {
  Club,
  Fixture,
  League,
  MatchResult,
  Player,
  Season,
  TransferOffer,
  TransferRecord,
} from '@club-director/shared-types';
import type { CareerState } from '../db/careerPersistence';
import { saveCareer as saveCareerImpl, loadCareer as loadCareerImpl } from '../db/careerPersistence';
import { buildPersistedMatch, type PersistedMatch } from '../db/matchRecords';
import { getTestDatabase, resetTestDatabase } from '../db/testDatabase';
import * as schema from '../db/schema';
import { deleteCareer } from '../db/careerPersistence';

// The service imports saveCareer from '../db' (expo-sqlite); mock that
// wrapper so the module loads under jest. Real persistence is exercised
// through deps.saveCareerFn bound to the better-sqlite3 test database.
jest.mock('../db', () => ({
  initializeDatabase: jest.fn().mockResolvedValue(undefined),
  saveCareer: jest.fn().mockResolvedValue(undefined),
  loadCareer: jest.fn(),
  deleteCareer: jest.fn(),
}));

const SEASON_START = new Date('2024-08-01T00:00:00Z');

interface CompletedCareer {
  clubs: Club[];
  players: Player[];
  league: League;
  season: Season;
  transferHistory: TransferRecord[];
  transferOffers: TransferOffer[];
  matches: PersistedMatch[];
}

/**
 * Build a career whose season-1 is fully played: every generated fixture
 * has finite scores, the week counter sits one past the last fixture
 * week, and currentDate is exactly one week after the last fixture date
 * (what advanceMatchweek leaves behind).
 */
function buildCompletedCareer(): CompletedCareer {
  const seedData = generateSeedData(777);
  const clubs = seedData.clubs.slice(0, 3);
  const players = seedData.players.filter((p) =>
    clubs.some((c) => c.squad.includes(p.id)),
  );

  const scheduled = generateFixtures(
    clubs.map((c) => c.id),
    SEASON_START,
  );
  const fixtures: Fixture[] = scheduledFixturesToLeagueFixtures(scheduled).map(
    (f, i) => ({
      ...f,
      played: true,
      homeScore: i % 3,
      awayScore: (i + 1) % 3,
    }),
  );

  const lastFixtureDate = fixtures.reduce(
    (max, f) => (f.date.getTime() > max.getTime() ? f.date : max),
    fixtures[0].date,
  );
  const currentDate = new Date(lastFixtureDate);
  currentDate.setDate(currentDate.getDate() + 7);
  const lastWeek = fixtures.reduce((max, f) => Math.max(max, f.week), 0);

  const league: League = {
    id: 'league-1',
    name: 'Rollover League',
    tier: 1,
    clubIds: clubs.map((c) => c.id),
    standings: { entries: [] },
    fixtures,
  };
  league.standings = computeStandings(league);

  const season: Season = {
    id: 'season-1',
    leagueId: 'league-1',
    currentWeek: lastWeek + 1,
    currentDate,
    transferWindowOpen: true,
    fixturesCalendar: [],
  };

  const transferHistory: TransferRecord[] = [
    {
      id: 'transfer-1',
      playerId: players[0].id,
      fromClubId: clubs[1].id,
      toClubId: clubs[0].id,
      fee: 250_000,
      date: new Date('2024-09-01T12:00:00Z'),
    },
  ];

  const transferOffers: TransferOffer[] = [
    {
      id: 'offer-1',
      playerId: players[1].id,
      buyingClubId: clubs[2].id,
      sellingClubId: clubs[0].id,
      offerAmount: 400_000,
      status: 'pending',
      createdAt: new Date('2024-10-01T12:00:00Z'),
    },
  ];

  const firstFixture = fixtures[0];
  const homeClub = clubs.find((c) => c.id === firstFixture.homeClubId)!;
  const awayClub = clubs.find((c) => c.id === firstFixture.awayClubId)!;
  const result: MatchResult = {
    homeScore: firstFixture.homeScore!,
    awayScore: firstFixture.awayScore!,
    events: [
      {
        id: 'ev-1',
        minute: 10,
        type: 'goal',
        primaryPlayerId: players[0].id,
        secondaryPlayerId: undefined,
        team: 'home',
        description: 'GOAL!',
      },
    ],
    stats: {
      home: {
        possession: 55, shots: 10, shotsOnTarget: 4, corners: 5,
        fouls: 8, yellowCards: 1, redCards: 0,
      },
      away: {
        possession: 45, shots: 7, shotsOnTarget: 3, corners: 2,
        fouls: 10, yellowCards: 2, redCards: 0,
      },
    },
    seed: 424242,
    participantIds: [players[0].id, players[1].id],
  };
  const matches = [
    buildPersistedMatch({
      fixture: firstFixture,
      season,
      league,
      homeClub,
      awayClub,
      result,
    }),
  ];

  return {
    clubs,
    players,
    league,
    season,
    transferHistory,
    transferOffers,
    matches,
  };
}

// `store` is a getState() snapshot from the post-resetModules registry —
// its setters are stable, so populating through it targets the fresh store.
function populateStore(store: any, career: CompletedCareer) {
  store.setLeague(career.league);
  store.setSeason(career.season);
  store.setClubs(career.clubs);
  store.setPlayers(career.players);
  store.setTransferHistory(career.transferHistory);
  store.setTransferOffers(career.transferOffers);
  store.setMatches(career.matches);
  store.setManagedClubId(career.clubs[0].id);
  store.setBootStatus('loaded');
  store.setIsLoading(false);
}

async function freshRollover() {
  jest.resetModules();
  const db = await import('../db');
  const { rolloverSeason } = await import('./seasonRollover');
  const { useGameState } = await import('../store/useGameState');
  return {
    rolloverSeason,
    getStore: () => useGameState.getState(),
    mockSaveCareer: db.saveCareer as jest.Mock,
  };
}

describe('rolloverSeason (unit, mocked persistence)', () => {
  it('rolls over a completed season and publishes the new state', async () => {
    const { rolloverSeason, getStore, mockSaveCareer } = await freshRollover();
    const career = buildCompletedCareer();
    populateStore(getStore(), career);
    const mockSave = jest.fn().mockResolvedValue(undefined);

    const result = await rolloverSeason({ saveCareerFn: mockSave });
    const store = getStore();

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.season.id).toBe('season-2');
      expect(result.season.currentWeek).toBe(1);
      // currentDate already points one week past the final fixture —
      // the new calendar starts there, not one week later.
      expect(result.season.currentDate.getTime()).toBe(
        career.season.currentDate.getTime(),
      );
      expect(result.season.transferWindowOpen).toBe(true);
    }

    expect(store.season?.id).toBe('season-2');
    expect(store.season?.currentWeek).toBe(1);
    expect(store.league?.id).toBe('league-1');
    // Fresh unplayed calendar, zeroed standings.
    expect(store.league?.fixtures.length).toBeGreaterThan(0);
    expect(
      store.league?.fixtures.every((f) => !f.played && f.homeScore === undefined),
    ).toBe(true);
    expect(
      store.league?.standings.entries.every((e) => e.points === 0 && e.played === 0),
    ).toBe(true);
    // Career-scoped collections are untouched in memory.
    expect(store.matches).toBe(career.matches);
    expect(store.transferHistory).toBe(career.transferHistory);
    expect(store.transferOffers).toBe(career.transferOffers);

    // Exactly one save carrying the complete post-rollover state.
    expect(mockSave).toHaveBeenCalledTimes(1);
    const saved = mockSave.mock.calls[0][0] as CareerState;
    expect(saved.season.id).toBe('season-2');
    expect(saved.league.fixtures.every((f) => !f.played)).toBe(true);
    expect(saved.matches).toBe(career.matches);
    expect(saved.transferHistory).toBe(career.transferHistory);
    expect(saved.transferOffers).toBe(career.transferOffers);
    expect(saved.clubs).toBe(career.clubs);
    expect(saved.players).toBe(career.players);
    expect(mockSaveCareer).not.toHaveBeenCalled();
  });

  it('uses the app saveCareer wrapper when no dependency is injected', async () => {
    const { rolloverSeason, getStore, mockSaveCareer } = await freshRollover();
    populateStore(getStore(), buildCompletedCareer());

    const result = await rolloverSeason();

    expect(result.ok).toBe(true);
    expect(mockSaveCareer).toHaveBeenCalledTimes(1);
    expect(getStore().season?.id).toBe('season-2');
  });

  it('refuses an incomplete season without saving or touching the store', async () => {
    const { rolloverSeason, getStore } = await freshRollover();
    const career = buildCompletedCareer();
    // Revert to an in-progress season: unplayed fixtures remain.
    career.league = {
      ...career.league,
      fixtures: career.league.fixtures.map((f, i) =>
        i === 0 ? { ...f, played: false, homeScore: undefined, awayScore: undefined } : f,
      ),
    };
    career.season = { ...career.season, currentWeek: 1, currentDate: SEASON_START };
    populateStore(getStore(), career);
    const mockSave = jest.fn().mockResolvedValue(undefined);

    const result = await rolloverSeason({ saveCareerFn: mockSave });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/not complete/);
    expect(mockSave).not.toHaveBeenCalled();
    expect(getStore().season?.id).toBe('season-1');
  });

  it('refuses a season with anomalies', async () => {
    const { rolloverSeason, getStore } = await freshRollover();
    const career = buildCompletedCareer();
    // Played fixture with a missing score = malformed played fixture.
    career.league = {
      ...career.league,
      fixtures: career.league.fixtures.map((f, i) =>
        i === 0 ? { ...f, homeScore: undefined } : f,
      ),
    };
    populateStore(getStore(), career);
    const mockSave = jest.fn().mockResolvedValue(undefined);

    const result = await rolloverSeason({ saveCareerFn: mockSave });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/anomal/);
    expect(mockSave).not.toHaveBeenCalled();
    expect(getStore().season?.id).toBe('season-1');
  });

  it('returns failure and leaves memory untouched when persistence fails', async () => {
    const { rolloverSeason, getStore } = await freshRollover();
    populateStore(getStore(), buildCompletedCareer());
    const mockSave = jest.fn().mockRejectedValue(new Error('disk full'));

    const result = await rolloverSeason({ saveCareerFn: mockSave });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/Failed to persist/);
    const store = getStore();
    expect(store.season?.id).toBe('season-1');
    expect(store.league?.fixtures.every((f) => f.played)).toBe(true);
  });

  it('shares a single attempt across concurrent callers', async () => {
    const { rolloverSeason, getStore } = await freshRollover();
    populateStore(getStore(), buildCompletedCareer());

    let releaseSave!: () => void;
    const gate = new Promise<void>((resolve) => {
      releaseSave = resolve;
    });
    const mockSave = jest.fn().mockImplementation(() => gate);

    const first = rolloverSeason({ saveCareerFn: mockSave });
    const second = rolloverSeason({ saveCareerFn: mockSave });
    releaseSave();

    const [r1, r2] = await Promise.all([first, second]);
    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(true);
    // One shared attempt: a single build + a single save, one new season.
    expect(mockSave).toHaveBeenCalledTimes(1);
    expect(getStore().season?.id).toBe('season-2');
  });

  it('rejects when a store mutation is queued between commit and publish', async () => {
    const { rolloverSeason, getStore } = await freshRollover();
    const career = buildCompletedCareer();
    populateStore(getStore(), career);

    const tamperedSeason: Season = { ...career.season, currentWeek: 999 };
    // Faithful model of the only real window: saveCareer's transaction
    // is synchronous (no JS can interleave mid-commit), so a mutation
    // can only land in the microtask gap after commit and before the
    // rollover continuation. queueMicrotask reproduces exactly that
    // ordering — the mutation runs before our post-save check.
    const mockSave = jest.fn().mockImplementation(() => {
      queueMicrotask(() => getStore().setSeason(tamperedSeason));
      return Promise.resolve();
    });

    const result = await rolloverSeason({ saveCareerFn: mockSave });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/changed while/);
      expect(result.error).toMatch(/restored to the latest in-memory/);
    }
    // The rollover must not clobber the intervening state.
    expect(getStore().season).toBe(tamperedSeason);
    // Two saves: the committed rollover, then the compensating save of
    // the latest in-memory career — which carries the tampered season,
    // never the proposed next season.
    expect(mockSave).toHaveBeenCalledTimes(2);
    const compensation = mockSave.mock.calls[1][0] as CareerState;
    expect(compensation.season).toBe(tamperedSeason);
    expect(compensation.season.id).toBe('season-1');
  });

  it('rejects when resultsHistory changes between commit and publish', async () => {
    const { rolloverSeason, getStore } = await freshRollover();
    const career = buildCompletedCareer();
    populateStore(getStore(), career);

    const concurrentHistory = ['CONCURRENT RESULT'];
    // Same microtask-window model as the season test: the mutation is
    // queued before the rollover continuation runs its post-save check.
    // resultsHistory is not persisted, but the service clears it on
    // publish — a concurrent value must survive the rejection.
    const mockSave = jest.fn().mockImplementation(() => {
      queueMicrotask(() => getStore().setResultsHistory(concurrentHistory));
      return Promise.resolve();
    });

    const result = await rolloverSeason({ saveCareerFn: mockSave });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/changed while/);
    expect(getStore().resultsHistory).toBe(concurrentHistory);
    expect(getStore().season?.id).toBe('season-1');
    // The compensating save persisted the in-memory season-1 state —
    // resultsHistory itself is ephemeral and absent from CareerState.
    expect(mockSave).toHaveBeenCalledTimes(2);
    const compensation = mockSave.mock.calls[1][0] as CareerState;
    expect(compensation.season.id).toBe('season-1');
    expect(compensation.matches).toBe(career.matches);
  });

  it('reports an explicit error when the compensating save fails', async () => {
    const { rolloverSeason, getStore } = await freshRollover();
    const career = buildCompletedCareer();
    populateStore(getStore(), career);

    const tamperedSeason: Season = { ...career.season, currentWeek: 999 };
    let calls = 0;
    const mockSave = jest.fn().mockImplementation(() => {
      calls += 1;
      if (calls === 1) {
        // Queue the concurrent mutation only for the rollover save.
        queueMicrotask(() => getStore().setSeason(tamperedSeason));
        return Promise.resolve();
      }
      return Promise.reject(new Error('compensation disk full'));
    });

    const result = await rolloverSeason({ saveCareerFn: mockSave });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/compensating save failed/);
      expect(result.error).toMatch(/compensation disk full/);
      // Must NOT claim the database was restored.
      expect(result.error).not.toMatch(/restored to the latest/);
    }
    expect(mockSave).toHaveBeenCalledTimes(2);
    // Memory still holds the concurrent state; nothing was published.
    expect(getStore().season).toBe(tamperedSeason);
  });

  it('gives up explicitly when the store keeps changing beyond the compensation limit', async () => {
    const { rolloverSeason, getStore } = await freshRollover();
    populateStore(getStore(), buildCompletedCareer());

    // A brand-new resultsHistory array on EVERY save: each post-save
    // check sees a different reference, so consistency is never
    // confirmed and the bounded retry loop must exhaust.
    const mockSave = jest.fn().mockImplementation(() => {
      queueMicrotask(() =>
        getStore().setResultsHistory([...getStore().resultsHistory, 'x']),
      );
      return Promise.resolve();
    });

    const result = await rolloverSeason({ saveCareerFn: mockSave });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/could not be confirmed/);
      expect(result.error).toMatch(/database may differ from memory/);
      // Must never claim the database was restored.
      expect(result.error).not.toMatch(/restored to the latest/);
    }
    // 1 rollover save + 3 compensating saves (the configured limit).
    expect(mockSave).toHaveBeenCalledTimes(4);
    // Nothing was published; the store still holds season-1.
    expect(getStore().season?.id).toBe('season-1');
  });

  it('refuses a repeated rollover after a successful one', async () => {
    const { rolloverSeason, getStore } = await freshRollover();
    populateStore(getStore(), buildCompletedCareer());
    const mockSave = jest.fn().mockResolvedValue(undefined);

    const first = await rolloverSeason({ saveCareerFn: mockSave });
    expect(first.ok).toBe(true);

    // The new season just started — it is not complete, so the engine
    // refuses and no second season is created.
    const second = await rolloverSeason({ saveCareerFn: mockSave });
    expect(second.ok).toBe(false);
    expect(mockSave).toHaveBeenCalledTimes(1);
    expect(getStore().season?.id).toBe('season-2');
  });

  it('fails cleanly when no career is loaded', async () => {
    const { rolloverSeason, getStore } = await freshRollover();
    const mockSave = jest.fn().mockResolvedValue(undefined);

    const result = await rolloverSeason({ saveCareerFn: mockSave });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/No active career/);
    expect(mockSave).not.toHaveBeenCalled();
    expect(getStore().season).toBeNull();
  });

  it('refuses before saving when bootStatus is not loaded', async () => {
    const { rolloverSeason, getStore } = await freshRollover();
    populateStore(getStore(), buildCompletedCareer());
    // Career collections stay populated — only the lifecycle flag is off.
    getStore().setBootStatus('pending');
    const mockSave = jest.fn().mockResolvedValue(undefined);

    const result = await rolloverSeason({ saveCareerFn: mockSave });

    expect(result.ok).toBe(false);
    expect(mockSave).not.toHaveBeenCalled();
    expect(getStore().season?.id).toBe('season-1');
  });

  it('refuses before saving while isLoading is true', async () => {
    const { rolloverSeason, getStore } = await freshRollover();
    populateStore(getStore(), buildCompletedCareer());
    getStore().setIsLoading(true);
    const mockSave = jest.fn().mockResolvedValue(undefined);

    const result = await rolloverSeason({ saveCareerFn: mockSave });

    expect(result.ok).toBe(false);
    expect(mockSave).not.toHaveBeenCalled();
    expect(getStore().season?.id).toBe('season-1');
  });

  it('refuses before saving when managedClubId is absent from clubs', async () => {
    const { rolloverSeason, getStore } = await freshRollover();
    populateStore(getStore(), buildCompletedCareer());
    getStore().setManagedClubId('club-does-not-exist');
    const mockSave = jest.fn().mockResolvedValue(undefined);

    const result = await rolloverSeason({ saveCareerFn: mockSave });

    expect(result.ok).toBe(false);
    expect(mockSave).not.toHaveBeenCalled();
    expect(getStore().season?.id).toBe('season-1');
  });

  it('refuses before saving when clubs are empty', async () => {
    const { rolloverSeason, getStore } = await freshRollover();
    populateStore(getStore(), buildCompletedCareer());
    getStore().setClubs([]);
    const mockSave = jest.fn().mockResolvedValue(undefined);

    const result = await rolloverSeason({ saveCareerFn: mockSave });

    expect(result.ok).toBe(false);
    expect(mockSave).not.toHaveBeenCalled();
  });

  it('refuses before saving when players are empty', async () => {
    const { rolloverSeason, getStore } = await freshRollover();
    populateStore(getStore(), buildCompletedCareer());
    getStore().setPlayers([]);
    const mockSave = jest.fn().mockResolvedValue(undefined);

    const result = await rolloverSeason({ saveCareerFn: mockSave });

    expect(result.ok).toBe(false);
    expect(mockSave).not.toHaveBeenCalled();
  });

  it.each([
    ['bootStatus', (store: any) => store.setBootStatus('pending')],
    ['isLoading', (store: any) => store.setIsLoading(true)],
  ])(
    'rejects compensation when %s transitions post-commit without touching collections',
    async (_label, mutate) => {
      const { rolloverSeason, getStore } = await freshRollover();
      populateStore(getStore(), buildCompletedCareer());

      // The lifecycle flag flips in the post-commit microtask gap while
      // all nine collection references stay identical — isSameSnapshot
      // must still detect the transition.
      const mockSave = jest.fn().mockImplementation(() => {
        queueMicrotask(() => mutate(getStore()));
        return Promise.resolve();
      });

      const result = await rolloverSeason({ saveCareerFn: mockSave });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        // No valid career remains loaded → no compensating save is even
        // attempted, and consistency is explicitly not guaranteed.
        expect(result.error).toMatch(/no valid career remains loaded/);
        expect(result.error).toMatch(/consistency cannot be guaranteed/);
      }
      expect(mockSave).toHaveBeenCalledTimes(1);
      // season-2 was never published; collections are untouched.
      expect(getStore().season?.id).toBe('season-1');
    },
  );
});

describe('rolloverSeason (real SQLite)', () => {
  let testDb: any;

  beforeEach(() => {
    testDb = getTestDatabase();
    resetTestDatabase();
  });

  afterEach(async () => {
    await deleteCareer(testDb);
  });

  const realSave = (state: CareerState) => saveCareerImpl(state, testDb);

  it('persists season-2 atomically while preserving clubs, players, matches, transfers and offers', async () => {
    const { rolloverSeason, getStore } = await freshRollover();
    const career = buildCompletedCareer();

    // Seed the database with the completed season-1 career.
    await saveCareerImpl(
      {
        career: {
          id: 'active',
          managerName: 'Rollover Manager',
          managedClubId: career.clubs[0].id,
          createdAt: new Date('2024-08-01'),
          lastPlayedAt: new Date(),
          schemaVersion: 1,
        },
        clubs: career.clubs,
        players: career.players,
        league: career.league,
        season: career.season,
        transferHistory: career.transferHistory,
        transferOffers: career.transferOffers,
        matches: career.matches,
      },
      testDb,
    );
    populateStore(getStore(), career);

    const result = await rolloverSeason({ saveCareerFn: realSave });
    expect(result.ok).toBe(true);

    // Memory and database agree on the new season.
    const store = getStore();
    expect(store.season?.id).toBe('season-2');
    const loaded = await loadCareerImpl(testDb);
    expect(loaded).not.toBeNull();
    expect(loaded!.season.id).toBe('season-2');
    expect(loaded!.season.currentWeek).toBe(1);
    expect(loaded!.season.currentDate.getTime()).toBe(
      career.season.currentDate.getTime(),
    );
    expect(loaded!.season.transferWindowOpen).toBe(true);

    // Season-scoped data replaced: fresh unplayed fixtures, zeroed table.
    expect(loaded!.league.fixtures.length).toBeGreaterThan(0);
    expect(loaded!.league.fixtures.every((f) => !f.played)).toBe(true);
    expect(
      loaded!.league.standings.entries.every((e) => e.points === 0),
    ).toBe(true);

    // Career-scoped data preserved through the save/load round-trip.
    expect(loaded!.clubs.map((c) => c.id)).toEqual(career.clubs.map((c) => c.id));
    expect(loaded!.players.map((p) => p.id)).toEqual(career.players.map((p) => p.id));
    expect(loaded!.matches).toHaveLength(career.matches.length);
    expect(loaded!.matches![0].id).toContain('season-1');
    expect(loaded!.matches![0].events).toHaveLength(1);
    expect(loaded!.transferHistory).toEqual(career.transferHistory);
    expect(loaded!.transferOffers).toEqual(career.transferOffers);
  });

  it('rolls back the whole save when persistence fails mid-transaction', async () => {
    const { rolloverSeason, getStore } = await freshRollover();
    const career = buildCompletedCareer();
    await saveCareerImpl(
      {
        career: {
          id: 'active',
          managerName: 'Rollover Manager',
          managedClubId: career.clubs[0].id,
          createdAt: new Date('2024-08-01'),
          lastPlayedAt: new Date(),
          schemaVersion: 1,
        },
        clubs: career.clubs,
        players: career.players,
        league: career.league,
        season: career.season,
        transferHistory: career.transferHistory,
        transferOffers: career.transferOffers,
        matches: career.matches,
      },
      testDb,
    );
    populateStore(getStore(), career);

    // Inject a real SQLite failure during the fixtures insert — the
    // transaction must roll back every preceding write.
    testDb.run(`
      CREATE TRIGGER fail_rollover_fixtures
      BEFORE INSERT ON fixtures
      BEGIN
        SELECT RAISE(ABORT, 'injected rollover failure');
      END
    `);

    const result = await rolloverSeason({ saveCareerFn: realSave });
    testDb.run('DROP TRIGGER IF EXISTS fail_rollover_fixtures');

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/Failed to persist/);

    // Database still holds the completed season-1 career, untouched.
    const loaded = await loadCareerImpl(testDb);
    expect(loaded!.season.id).toBe('season-1');
    expect(loaded!.league.fixtures.every((f) => f.played)).toBe(true);
    expect(loaded!.matches).toHaveLength(career.matches.length);

    // Memory was never updated either.
    expect(getStore().season?.id).toBe('season-1');
  });

  it('compensates the committed rollover when a concurrent mutation lands post-commit', async () => {
    const { rolloverSeason, getStore } = await freshRollover();
    const career = buildCompletedCareer();
    await saveCareerImpl(
      {
        career: {
          id: 'active',
          managerName: 'Rollover Manager',
          managedClubId: career.clubs[0].id,
          createdAt: new Date('2024-08-01'),
          lastPlayedAt: new Date(),
          schemaVersion: 1,
        },
        clubs: career.clubs,
        players: career.players,
        league: career.league,
        season: career.season,
        transferHistory: career.transferHistory,
        transferOffers: career.transferOffers,
        matches: career.matches,
      },
      testDb,
    );
    populateStore(getStore(), career);

    // Faithful post-commit window: the mutation microtask is queued
    // during the first (rollover) save only, so it runs after the
    // synchronous transaction commits but before the rollover
    // continuation's staleness check.
    const tamperedSeason: Season = { ...career.season, currentWeek: 999 };
    let calls = 0;
    const saveWithConcurrentMutation = async (state: CareerState) => {
      calls += 1;
      if (calls === 1) {
        queueMicrotask(() => getStore().setSeason(tamperedSeason));
      }
      await saveCareerImpl(state, testDb);
    };

    const result = await rolloverSeason({
      saveCareerFn: saveWithConcurrentMutation,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/restored to the latest/);
    expect(calls).toBe(2);

    // The compensating save rewrote the database with the LATEST
    // in-memory career — loadCareer sees season-1 (tampered), never
    // the accidentally committed season-2.
    const loaded = await loadCareerImpl(testDb);
    expect(loaded!.season.id).toBe('season-1');
    expect(loaded!.season.currentWeek).toBe(999);
    expect(loaded!.league.fixtures.every((f) => f.played)).toBe(true);
    expect(loaded!.matches).toHaveLength(career.matches.length);

    // Memory and database agree on the concurrent state.
    expect(getStore().season).toBe(tamperedSeason);
  });

  it('re-compensates with the newest state when the store mutates during a compensation save', async () => {
    const { rolloverSeason, getStore } = await freshRollover();
    const career = buildCompletedCareer();
    await saveCareerImpl(
      {
        career: {
          id: 'active',
          managerName: 'Rollover Manager',
          managedClubId: career.clubs[0].id,
          createdAt: new Date('2024-08-01'),
          lastPlayedAt: new Date(),
          schemaVersion: 1,
        },
        clubs: career.clubs,
        players: career.players,
        league: career.league,
        season: career.season,
        transferHistory: career.transferHistory,
        transferOffers: career.transferOffers,
        matches: career.matches,
      },
      testDb,
    );
    populateStore(getStore(), career);

    // Two consecutive post-commit mutations: one lands after the
    // rollover save, a second (newest) one lands during the first
    // compensating save — forcing a second, verified compensation.
    const tamperedFirst: Season = { ...career.season, currentWeek: 999 };
    const tamperedSecond: Season = { ...career.season, currentWeek: 998 };
    let calls = 0;
    const saveWithStagedMutations = async (state: CareerState) => {
      calls += 1;
      if (calls === 1) {
        queueMicrotask(() => getStore().setSeason(tamperedFirst));
      } else if (calls === 2) {
        queueMicrotask(() => getStore().setSeason(tamperedSecond));
      }
      await saveCareerImpl(state, testDb);
    };

    const result = await rolloverSeason({
      saveCareerFn: saveWithStagedMutations,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/restored to the latest/);
    // 1 rollover save + 2 compensating saves; the second compensation
    // used the newest in-memory state and was verified unchanged.
    expect(calls).toBe(3);

    // SQLite ends up matching the NEWEST in-memory state — never the
    // accidentally committed season-2, never the intermediate one.
    const loaded = await loadCareerImpl(testDb);
    expect(loaded!.season.id).toBe('season-1');
    expect(loaded!.season.currentWeek).toBe(998);
    expect(loaded!.league.fixtures.every((f) => f.played)).toBe(true);

    // season-2 was never published to the store.
    expect(getStore().season).toBe(tamperedSecond);
  });
});
