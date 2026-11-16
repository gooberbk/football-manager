import {
  assignSeasonObjectives,
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
  SeasonObjective,
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
  seasonObjectives: SeasonObjective[];
}

/**
 * Build a career whose season-1 is fully played: every generated fixture
 * has finite scores, the week counter sits one past the last fixture
 * week, and currentDate is exactly one week after the last fixture date
 * (what advanceMatchweek leaves behind).
 */
function buildCompletedCareer(): CompletedCareer {
  const seedData = generateSeedData(777);
  // The objective system is defined for the 16-club championship — the
  // fixture must use the full league or rollover cannot settle/generate.
  const clubs = seedData.clubs;
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

  // Season-1 objectives assigned by the real engine function — the same
  // way a live career would have received them at season start.
  const seasonObjectives = assignSeasonObjectives({
    seasonId: season.id,
    clubs,
    players,
    seasonWeeks: lastWeek,
  });

  return {
    clubs,
    players,
    league,
    season,
    transferHistory,
    transferOffers,
    matches,
    seasonObjectives,
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
  store.setSeasonObjectives(career.seasonObjectives);
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
    // Clubs are the settled copies — same ids/squads, post-settlement
    // finances — never the pre-settlement references.
    expect(saved.clubs.map((c) => c.id)).toEqual(
      career.clubs.map((c) => c.id),
    );
    expect(saved.clubs).not.toBe(career.clubs);
    // Players are aged exactly +1 by buildNextSeason — new objects with
    // identical ids and preserved fields, never the input references.
    expect(saved.players).not.toBe(career.players);
    expect(saved.players.map((p) => p.id)).toEqual(
      career.players.map((p) => p.id),
    );
    saved.players.forEach((player, index) => {
      expect(player.age).toBe(career.players[index].age + 1);
    });
    // The store publishes the same aged collection that was persisted.
    expect(store.players).toBe(saved.players);
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

  it('refuses when a season objective is missing', async () => {
    const { rolloverSeason, getStore } = await freshRollover();
    const career = buildCompletedCareer();
    populateStore(getStore(), career);
    // Drop one objective: settlement must reject, never settle partially.
    getStore().setSeasonObjectives(career.seasonObjectives.slice(1));
    const mockSave = jest.fn().mockResolvedValue(undefined);

    const result = await rolloverSeason({ saveCareerFn: mockSave });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/objective/i);
    }
    expect(mockSave).not.toHaveBeenCalled();
    expect(getStore().season?.id).toBe('season-1');
  });

  it('refuses when a season objective is duplicated', async () => {
    const { rolloverSeason, getStore } = await freshRollover();
    const career = buildCompletedCareer();
    populateStore(getStore(), career);
    getStore().setSeasonObjectives([
      ...career.seasonObjectives,
      career.seasonObjectives[0],
    ]);
    const mockSave = jest.fn().mockResolvedValue(undefined);

    const result = await rolloverSeason({ saveCareerFn: mockSave });

    expect(result.ok).toBe(false);
    expect(mockSave).not.toHaveBeenCalled();
    expect(getStore().season?.id).toBe('season-1');
  });

  it('refuses when objectives for the next season already exist', async () => {
    const { rolloverSeason, getStore } = await freshRollover();
    const career = buildCompletedCareer();
    populateStore(getStore(), career);
    getStore().setSeasonObjectives([
      ...career.seasonObjectives,
      {
        ...career.seasonObjectives[0],
        seasonId: 'season-2',
      },
    ]);
    const mockSave = jest.fn().mockResolvedValue(undefined);

    const result = await rolloverSeason({ saveCareerFn: mockSave });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/already exist/);
    }
    expect(mockSave).not.toHaveBeenCalled();
  });

  it('accepts distinct (seasonId, clubId) pairs that naive concatenation would merge', async () => {
    const { rolloverSeason, getStore } = await freshRollover();
    const career = buildCompletedCareer();
    // 'season-'+'0x' === 'season-0'+'x' === 'season-0x' under plain string
    // concatenation — two genuinely different couples. Both are historical
    // (neither is season-1 nor the upcoming season-2), so they must pass
    // through untouched.
    const collisions: SeasonObjective[] = [
      { ...career.seasonObjectives[0], seasonId: 'season-', clubId: '0x' },
      { ...career.seasonObjectives[0], seasonId: 'season-0', clubId: 'x' },
    ];
    populateStore(getStore(), {
      ...career,
      seasonObjectives: [...career.seasonObjectives, ...collisions],
    });
    const mockSave = jest.fn().mockResolvedValue(undefined);

    const result = await rolloverSeason({ saveCareerFn: mockSave });

    expect(result.ok).toBe(true);
    expect(mockSave).toHaveBeenCalledTimes(1);
    const saved = mockSave.mock.calls[0][0] as CareerState;
    // Both collision pairs survived verbatim alongside history + season-2.
    expect(
      saved.seasonObjectives.filter((o) => o.seasonId === 'season-'),
    ).toHaveLength(1);
    expect(
      saved.seasonObjectives.filter((o) => o.seasonId === 'season-0'),
    ).toHaveLength(1);
    expect(saved.seasonObjectives).toHaveLength(34);
  });

  it('still rejects a true duplicate (seasonId, clubId) pair', async () => {
    const { rolloverSeason, getStore } = await freshRollover();
    const career = buildCompletedCareer();
    const duplicate: SeasonObjective = {
      ...career.seasonObjectives[0],
      seasonId: 'season-0',
      clubId: 'club-x',
      objectiveMet: true,
      rewardPaid: 1_000_000,
      debtRemaining: 0,
      settledAt: new Date('2024-06-01T00:00:00Z'),
    };
    populateStore(getStore(), {
      ...career,
      seasonObjectives: [
        ...career.seasonObjectives,
        duplicate,
        { ...duplicate },
      ],
    });
    const mockSave = jest.fn().mockResolvedValue(undefined);

    const result = await rolloverSeason({ saveCareerFn: mockSave });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/duplicate season objective/);
    }
    expect(mockSave).not.toHaveBeenCalled();
    expect(getStore().season?.id).toBe('season-1');
  });

  it('keeps legitimate historical objectives alongside the new season', async () => {
    const { rolloverSeason, getStore } = await freshRollover();
    const career = buildCompletedCareer();
    const history: SeasonObjective = {
      ...career.seasonObjectives[0],
      seasonId: 'season-0',
      clubId: career.clubs[0].id,
      objectiveMet: true,
      rewardPaid: 1_000_000,
      debtRemaining: 0,
      settledAt: new Date('2024-06-01T00:00:00Z'),
    };
    populateStore(getStore(), {
      ...career,
      seasonObjectives: [...career.seasonObjectives, history],
    });
    const mockSave = jest.fn().mockResolvedValue(undefined);

    const result = await rolloverSeason({ saveCareerFn: mockSave });

    expect(result.ok).toBe(true);
    const saved = mockSave.mock.calls[0][0] as CareerState;
    expect(saved.seasonObjectives).toHaveLength(33);
    expect(saved.seasonObjectives).toContainEqual(history);
  });

  it('rejects when objectives change between commit and publish', async () => {
    const { rolloverSeason, getStore } = await freshRollover();
    const career = buildCompletedCareer();
    populateStore(getStore(), career);

    const tamperedObjectives = career.seasonObjectives.slice(0, -1);
    const mockSave = jest.fn().mockImplementation(() => {
      queueMicrotask(() =>
        getStore().setSeasonObjectives(tamperedObjectives),
      );
      return Promise.resolve();
    });

    const result = await rolloverSeason({ saveCareerFn: mockSave });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/changed while/);
    }
    // The tampered collection was preserved, never clobbered.
    expect(getStore().seasonObjectives).toBe(tamperedObjectives);
    // Compensation carried the latest in-memory objectives.
    const compensation = mockSave.mock.calls[1][0] as CareerState;
    expect(compensation.seasonObjectives).toBe(tamperedObjectives);
    expect(compensation.season.id).toBe('season-1');
  });
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
        seasonObjectives: career.seasonObjectives,
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

  it('publishes and persists players aged exactly +1 year', async () => {
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
        seasonObjectives: career.seasonObjectives,
      },
      testDb,
    );
    populateStore(getStore(), career);

    const result = await rolloverSeason({ saveCareerFn: realSave });
    expect(result.ok).toBe(true);

    // Store: every player aged exactly once, order and ids preserved.
    const storePlayers = getStore().players;
    expect(storePlayers.map((p) => p.id)).toEqual(
      career.players.map((p) => p.id),
    );
    storePlayers.forEach((player, index) => {
      expect(player.age).toBe(career.players[index].age + 1);
      expect(player.development).toEqual(career.players[index].development);
      expect(player.attributes).toEqual(career.players[index].attributes);
      expect(player.contract).toEqual(career.players[index].contract);
      expect(player).not.toBe(career.players[index]);
    });

    // Database: the persisted players are the same aged collection —
    // memory and disk agree exactly.
    const loaded = await loadCareerImpl(testDb);
    expect(loaded!.players.map((p) => p.id)).toEqual(
      storePlayers.map((p) => p.id),
    );
    loaded!.players.forEach((player, index) => {
      expect(player.age).toBe(career.players[index].age + 1);
    });
    // Squad references still resolve after aging.
    loaded!.clubs.forEach((club) => {
      club.squad.forEach((id) => {
        expect(loaded!.players.some((p) => p.id === id)).toBe(true);
      });
    });
  });

  it('keeps players un-aged in the store when the save fails, then ages once on retry', async () => {
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
        seasonObjectives: career.seasonObjectives,
      },
      testDb,
    );
    populateStore(getStore(), career);

    // Force the rollover save to fail mid-transaction.
    testDb.run(`
      CREATE TRIGGER fail_rollover_players
      BEFORE INSERT ON players
      BEGIN
        SELECT RAISE(ABORT, 'injected player-save failure');
      END
    `);
    const failed = await rolloverSeason({ saveCareerFn: realSave });
    testDb.run('DROP TRIGGER IF EXISTS fail_rollover_players');
    expect(failed.ok).toBe(false);

    // No publish happened: the store still holds the un-aged players.
    expect(getStore().players).toBe(career.players);
    getStore().players.forEach((player, index) => {
      expect(player.age).toBe(career.players[index].age);
    });

    // Retry from the same un-aged state: exactly one aging, not two.
    const retried = await rolloverSeason({ saveCareerFn: realSave });
    expect(retried.ok).toBe(true);
    getStore().players.forEach((player, index) => {
      expect(player.age).toBe(career.players[index].age + 1);
    });
    const loaded = await loadCareerImpl(testDb);
    expect(loaded!.season.id).toBe('season-2');
    loaded!.players.forEach((player, index) => {
      expect(player.age).toBe(career.players[index].age + 1);
    });
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
        seasonObjectives: career.seasonObjectives,
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
        seasonObjectives: career.seasonObjectives,
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
    const compensatedStates: CareerState[] = [];
    const saveWithConcurrentMutation = async (state: CareerState) => {
      calls += 1;
      if (calls === 1) {
        queueMicrotask(() => getStore().setSeason(tamperedSeason));
      } else {
        // The compensating save must carry the LATEST in-memory career —
        // whose players were never published as aged.
        compensatedStates.push(state);
      }
      await saveCareerImpl(state, testDb);
    };

    const result = await rolloverSeason({
      saveCareerFn: saveWithConcurrentMutation,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/restored to the latest/);
    expect(calls).toBe(2);

    // The compensating save persisted UN-AGED players: exactly the
    // memory snapshot's ages, never the aged next.players collection.
    expect(compensatedStates).toHaveLength(1);
    const compensatedPlayers = compensatedStates[0].players;
    expect(compensatedPlayers.map((p) => p.id)).toEqual(
      career.players.map((p) => p.id),
    );
    compensatedPlayers.forEach((player, index) => {
      expect(player.age).toBe(career.players[index].age);
    });

    // After reload, persisted players still carry their original ages —
    // the accidentally committed aged collection was fully overwritten.
    const loaded = await loadCareerImpl(testDb);
    expect(loaded!.season.id).toBe('season-1');
    expect(loaded!.season.currentWeek).toBe(999);
    expect(loaded!.league.fixtures.every((f) => f.played)).toBe(true);
    expect(loaded!.matches).toHaveLength(career.matches.length);
    loaded!.players.forEach((player, index) => {
      expect(player.age).toBe(career.players[index].age);
    });

    // Memory and database agree on the concurrent state — including the
    // un-aged players that were never published.
    expect(getStore().season).toBe(tamperedSeason);
    expect(getStore().players).toBe(career.players);
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
        seasonObjectives: career.seasonObjectives,
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

  describe('season objective lifecycle', () => {
    const seedCareer = (career: CompletedCareer) =>
      saveCareerImpl(
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
          seasonObjectives: career.seasonObjectives,
        },
        testDb,
      );

    it('settles season-1 objectives once and generates fresh season-2 objectives', async () => {
      const { rolloverSeason, getStore } = await freshRollover();
      const career = buildCompletedCareer();
      await seedCareer(career);
      populateStore(getStore(), career);

      const result = await rolloverSeason({ saveCareerFn: realSave });
      expect(result.ok).toBe(true);

      const loaded = await loadCareerImpl(testDb);
      expect(loaded).not.toBeNull();
      const s1 = loaded!.seasonObjectives.filter(
        (o) => o.seasonId === 'season-1',
      );
      const s2 = loaded!.seasonObjectives.filter(
        (o) => o.seasonId === 'season-2',
      );
      // One objective per club per season, history preserved.
      expect(s1).toHaveLength(16);
      expect(s2).toHaveLength(16);
      expect(loaded!.seasonObjectives).toHaveLength(32);

      // Season-1 objectives settled exactly once, rewards never recomputed.
      const s1ByKey = new Map(s1.map((o) => [o.clubId, o]));
      for (const original of career.seasonObjectives) {
        const settled = s1ByKey.get(original.clubId)!;
        expect(settled.targetPosition).toBe(original.targetPosition);
        expect(settled.rewardAmount).toBe(original.rewardAmount);
        expect(settled.ambition).toBe(original.ambition);
        expect(settled.settledAt).toBeInstanceOf(Date);
        expect(typeof settled.objectiveMet).toBe('boolean');
        expect(settled.objectiveMet).toBe(
          (career.league.standings.entries.findIndex(
            (e) => e.clubId === original.clubId,
          ) + 1) <= original.targetPosition,
        );
        expect(settled.rewardPaid).toBe(
          settled.objectiveMet ? settled.rewardAmount : 0,
        );
      }

      // Season-2 objectives are freshly generated, unsettled, and equal
      // the deterministic engine output on the post-settlement state.
      for (const objective of s2) {
        expect(objective.objectiveMet).toBeNull();
        expect(objective.rewardPaid).toBe(0);
        expect(objective.debtRemaining).toBeNull();
        expect(objective.settledAt).toBeNull();
        expect(objective.sanction).toBe('none');
      }
      const seasonWeeks = Math.max(
        ...loaded!.league.fixtures.map((f) => f.week),
      );
      const byClubId = (a: SeasonObjective, b: SeasonObjective) =>
        a.clubId < b.clubId ? -1 : a.clubId > b.clubId ? 1 : 0;
      expect([...s2].sort(byClubId)).toEqual(
        assignSeasonObjectives({
          seasonId: 'season-2',
          clubs: loaded!.clubs,
          players: loaded!.players,
          seasonWeeks,
        }).sort(byClubId),
      );

      // No duplicate (seasonId, clubId) anywhere in the collection.
      const keys = new Set(
        loaded!.seasonObjectives.map((o) => `${o.seasonId}${o.clubId}`),
      );
      expect(keys.size).toBe(loaded!.seasonObjectives.length);

      // The store carries the same complete collection.
      expect(getStore().seasonObjectives).toHaveLength(32);
    });

    it('applies settlement finances to the clubs carried into season-2', async () => {
      const { rolloverSeason, getStore } = await freshRollover();
      const career = buildCompletedCareer();

      // Inject debts sized to exercise both branches: club A debt far
      // below any reward, club B debt far above any reward.
      const clubA = career.clubs[4];
      const clubB = career.clubs[9];
      clubA.finances.debt = 1;
      clubB.finances.debt = 900_000_000_000;
      const balanceABefore = clubA.finances.balance;
      const balanceBBefore = clubB.finances.balance;
      const debtBBefore = clubB.finances.debt;

      await seedCareer(career);
      populateStore(getStore(), career);

      const result = await rolloverSeason({ saveCareerFn: realSave });
      expect(result.ok).toBe(true);

      const loaded = await loadCareerImpl(testDb);
      const loadedA = loaded!.clubs.find((c) => c.id === clubA.id)!;
      const loadedB = loaded!.clubs.find((c) => c.id === clubB.id)!;
      const objA = loaded!.seasonObjectives.find(
        (o) => o.seasonId === 'season-1' && o.clubId === clubA.id,
      )!;
      const objB = loaded!.seasonObjectives.find(
        (o) => o.seasonId === 'season-1' && o.clubId === clubB.id,
      )!;

      // Exact settlement math, whichever branch each club landed on.
      for (const [club, obj, balanceBefore, debtBefore] of [
        [loadedA, objA, balanceABefore, 1],
        [loadedB, objB, balanceBBefore, debtBBefore],
      ] as const) {
        const met = obj.objectiveMet === true;
        const rewardPaid = met ? obj.rewardAmount : 0;
        const debtRepaid = met ? Math.min(obj.rewardAmount, debtBefore) : 0;
        expect(obj.rewardPaid).toBe(rewardPaid);
        expect(obj.debtRemaining).toBe(debtBefore - debtRepaid);
        expect(club.finances.balance).toBe(
          balanceBefore + (rewardPaid - debtRepaid),
        );
        expect(club.finances.debt).toBe(debtBefore - debtRepaid);
        // transferBudget is never touched by settlement.
        expect(club.finances.transferBudget).toBe(
          career.clubs.find((c) => c.id === club.id)!.finances
            .transferBudget,
        );
      }
      // Club A's tiny debt is always fully repaid when met.
      if (objA.objectiveMet) {
        expect(loadedA.finances.debt).toBe(0);
      }
      // Club B's huge debt can never be fully repaid.
      expect(loadedB.finances.debt).toBeGreaterThan(0);
    });

    it('records a pending sanction only for the managed club with residual debt', async () => {
      const { rolloverSeason, getStore } = await freshRollover();
      const career = buildCompletedCareer();

      // Force two clubs to miss their objectives: set each target one
      // position below its actual final standing (position > 1 clubs
      // only — a winner cannot miss).
      const positionOf = (clubId: string) =>
        career.league.standings.entries.findIndex((e) => e.clubId === clubId) + 1;
      const finishers = career.clubs
        .map((c) => ({ club: c, position: positionOf(c.id) }))
        .filter(({ position }) => position > 1);
      const managedPick = finishers[0];
      const aiPick = finishers[1];
      for (const pick of [managedPick, aiPick]) {
        const objective = career.seasonObjectives.find(
          (o) => o.clubId === pick.club.id,
        )!;
        objective.targetPosition = pick.position - 1;
        pick.club.finances.debt = 5_000_000;
      }

      await seedCareer(career);
      populateStore(getStore(), career);
      // The managed club is the forced-miss club, not clubs[0].
      getStore().setManagedClubId(managedPick.club.id);

      const result = await rolloverSeason({ saveCareerFn: realSave });
      expect(result.ok).toBe(true);

      const loaded = await loadCareerImpl(testDb);
      const managedObjective = loaded!.seasonObjectives.find(
        (o) => o.seasonId === 'season-1' && o.clubId === managedPick.club.id,
      )!;
      const aiObjective = loaded!.seasonObjectives.find(
        (o) => o.seasonId === 'season-1' && o.clubId === aiPick.club.id,
      )!;

      expect(managedObjective.objectiveMet).toBe(false);
      expect(managedObjective.debtRemaining).toBe(5_000_000);
      expect(managedObjective.sanction).toBe(
        'dismissal_relegation_pending',
      );
      // Identical situation for an AI club: debt recorded, no sanction.
      expect(aiObjective.objectiveMet).toBe(false);
      expect(aiObjective.debtRemaining).toBe(5_000_000);
      expect(aiObjective.sanction).toBe('none');
      // Every other objective stays 'none'.
      expect(
        loaded!.seasonObjectives.filter(
          (o) => o.sanction === 'dismissal_relegation_pending',
        ),
      ).toHaveLength(1);
    });

    it('accumulates objectives across successive rollovers without duplicates', async () => {
      const { rolloverSeason, getStore } = await freshRollover();
      const career = buildCompletedCareer();
      await seedCareer(career);
      populateStore(getStore(), career);

      expect(
        (await rolloverSeason({ saveCareerFn: realSave })).ok,
      ).toBe(true);

      // Complete season-2 in memory exactly like advanceMatchweek
      // would leave it, then roll over again.
      const store = getStore();
      const playedFixtures = store.league!.fixtures.map((f, i) => ({
        ...f,
        played: true,
        homeScore: i % 3,
        awayScore: (i + 1) % 3,
      }));
      const lastWeek = playedFixtures.reduce(
        (max, f) => Math.max(max, f.week),
        0,
      );
      const lastDate = playedFixtures.reduce(
        (max, f) => (f.date.getTime() > max.getTime() ? f.date : max),
        playedFixtures[0].date,
      );
      const nextDate = new Date(lastDate);
      nextDate.setDate(nextDate.getDate() + 7);
      const league2 = {
        ...store.league!,
        fixtures: playedFixtures,
      };
      league2.standings = computeStandings(league2);
      store.setLeague(league2);
      store.setSeason({
        ...store.season!,
        currentWeek: lastWeek + 1,
        currentDate: nextDate,
      });

      expect(
        (await rolloverSeason({ saveCareerFn: realSave })).ok,
      ).toBe(true);

      const loaded = await loadCareerImpl(testDb);
      expect(loaded!.season.id).toBe('season-3');
      const counts = new Map<string, number>();
      for (const o of loaded!.seasonObjectives) {
        counts.set(o.seasonId, (counts.get(o.seasonId) ?? 0) + 1);
      }
      expect(counts.get('season-1')).toBe(16);
      expect(counts.get('season-2')).toBe(16);
      expect(counts.get('season-3')).toBe(16);
      // Seasons 1 and 2 are settled; season 3 is fresh.
      expect(
        loaded!.seasonObjectives.filter(
          (o) => o.seasonId !== 'season-3' && o.settledAt === null,
        ),
      ).toHaveLength(0);
      expect(
        loaded!.seasonObjectives.filter(
          (o) => o.seasonId === 'season-3' && o.settledAt !== null,
        ),
      ).toHaveLength(0);
      const keys = new Set(
        loaded!.seasonObjectives.map((o) => `${o.seasonId}${o.clubId}`),
      );
      expect(keys.size).toBe(loaded!.seasonObjectives.length);
    });
  });
});
