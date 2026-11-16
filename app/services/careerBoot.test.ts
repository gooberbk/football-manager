import type { CareerState } from '../db/careerPersistence';
import type { TransferOffer, TransferRecord } from '@club-director/shared-types';
import type { PersistedMatch } from '../db/matchRecords';
import {
  assignSeasonObjectives,
  generateFixtures,
  generateSeedData,
  scheduledFixturesToLeagueFixtures,
} from '@club-director/engine';

// Mock the database layer so the boot flow can be tested without expo-sqlite.
jest.mock('../db', () => ({
  initializeDatabase: jest.fn().mockResolvedValue(undefined),
  loadCareer: jest.fn(),
  saveCareer: jest.fn().mockResolvedValue(undefined),
}));

function buildLoadedCareer(transferOffers: TransferOffer[]): CareerState {
  return {
    career: {
      id: 'active',
      managerName: 'Boot Manager',
      managedClubId: 'club-1',
      createdAt: new Date('2024-08-01'),
      lastPlayedAt: new Date(),
      schemaVersion: 1,
    },
    clubs: [],
    players: [],
    league: {
      id: 'l1',
      name: 'L',
      tier: 1,
      clubIds: [],
      standings: { entries: [] },
      fixtures: [],
    },
    season: {
      id: 's1',
      leagueId: 'l1',
      // Week 2 keeps ensureSeasonObjectives on the 'blocked' path —
      // these fixtures exercise boot mechanics, not objective recovery.
      currentWeek: 2,
      currentDate: new Date('2024-08-01'),
      transferWindowOpen: true,
      fixturesCalendar: [],
    },
    transferHistory: [],
    transferOffers,
    matches: [],
    seasonObjectives: [],
  };
}

// careerBoot caches its boot promise at module level, so each test needs a
// fresh module registry to exercise the boot flow independently.
async function freshBoot() {
  jest.resetModules();
  const db = await import('../db');
  const { ensureCareerBoot } = await import('./careerBoot');
  const { useGameState } = await import('../store/useGameState');
  return {
    ensureCareerBoot,
    // Read state lazily: getState() is a snapshot, so it must be called
    // AFTER the boot promise resolves to observe populated values.
    getStore: () => useGameState.getState(),
    mockLoadCareer: db.loadCareer as jest.Mock,
    mockInitDatabase: db.initializeDatabase as jest.Mock,
    mockSaveCareer: db.saveCareer as jest.Mock,
  };
}

/**
 * A structurally valid 16-club career whose current season is provably
 * untouched — the only shape ensureSeasonObjectives can recover.
 */
function buildRecoverableCareer(
  overrides: Partial<CareerState> = {},
): CareerState {
  const seedData = generateSeedData(7);
  const clubs = seedData.clubs;
  const players = seedData.players.filter((p) =>
    clubs.some((c) => c.squad.includes(p.id)),
  );
  const fixtures = scheduledFixturesToLeagueFixtures(
    generateFixtures(clubs.map((c) => c.id), new Date('2024-08-01')),
  );
  return {
    career: {
      id: 'active',
      managerName: 'Legacy Manager',
      managedClubId: clubs[0].id,
      createdAt: new Date('2024-08-01'),
      lastPlayedAt: new Date(),
      schemaVersion: 1,
    },
    clubs,
    players,
    league: {
      id: 'l1',
      name: 'Legacy League',
      tier: 1,
      clubIds: clubs.map((c) => c.id),
      standings: { entries: [] },
      fixtures,
    },
    season: {
      id: 'season-1',
      leagueId: 'l1',
      currentWeek: 1,
      currentDate: new Date('2024-08-01'),
      transferWindowOpen: true,
      fixturesCalendar: [],
    },
    transferHistory: [],
    transferOffers: [],
    matches: [],
    seasonObjectives: [],
    ...overrides,
  };
}

describe('ensureCareerBoot', () => {
  it('restores persisted transfer offers into the store', async () => {
    const { ensureCareerBoot, getStore, mockLoadCareer } = await freshBoot();
    const offers: TransferOffer[] = [
      {
        id: 'offer-1',
        playerId: 'p1',
        buyingClubId: 'club-2',
        sellingClubId: 'club-1',
        offerAmount: 300_000,
        status: 'pending',
        createdAt: new Date('2024-08-10'),
      },
    ];
    mockLoadCareer.mockResolvedValue(buildLoadedCareer(offers));

    const result = await ensureCareerBoot();
    const store = getStore();

    expect(result).toBe('loaded');
    expect(store.bootStatus).toBe('loaded');
    expect(store.transferOffers).toEqual(offers);
    expect(store.managedClubId).toBe('club-1');
    expect(store.isLoading).toBe(false);
  });


  it('restores persisted matches into the store', async () => {
    const { ensureCareerBoot, getStore, mockLoadCareer } = await freshBoot();
    const match: PersistedMatch = {
      id: 'match-8:league-18:season-19:fixture-7',
      fixtureId: 'fixture-7',
      seasonId: 'season-1',
      leagueId: 'l1',
      date: new Date('2024-08-10T15:00:00Z'),
      status: 'completed',
      homeClubId: 'club-1',
      awayClubId: 'club-2',
      homeScore: 2,
      awayScore: 1,
      homeTactics: {
        defaultFormation: '4-4-2',
        mentality: 'balanced',
        pressingIntensity: 10,
        tempo: 10,
        width: 10,
      },
      awayTactics: {
        defaultFormation: '4-3-3',
        mentality: 'balanced',
        pressingIntensity: 10,
        tempo: 10,
        width: 10,
      },
      stats: {
        home: {
          possession: 55, shots: 12, shotsOnTarget: 5, corners: 6,
          fouls: 8, yellowCards: 1, redCards: 0,
        },
        away: {
          possession: 45, shots: 7, shotsOnTarget: 3, corners: 2,
          fouls: 10, yellowCards: 2, redCards: 0,
        },
      },
      seed: 987654,
      participantIds: ['p1', 'p2'],
      events: [
        {
          id: 'match-8:league-18:season-19:fixture-7:12:goal:0',
          minute: 12,
          type: 'goal',
          primaryPlayerId: 'p1',
          secondaryPlayerId: null,
          team: 'home',
          clubId: 'club-1',
          description: 'GOAL!',
        },
      ],
    };
    const career = buildLoadedCareer([]);
    career.matches = [match];
    mockLoadCareer.mockResolvedValue(career);

    const result = await ensureCareerBoot();
    const store = getStore();

    expect(result).toBe('loaded');
    expect(store.matches).toEqual([match]);
  });

  it('reports empty when no career exists', async () => {
    const { ensureCareerBoot, getStore, mockLoadCareer } = await freshBoot();
    mockLoadCareer.mockResolvedValue(null);

    const result = await ensureCareerBoot();
    const store = getStore();

    expect(result).toBe('empty');
    expect(store.bootStatus).toBe('empty');
    expect(store.transferOffers).toEqual([]);
    expect(store.isLoading).toBe(false);
  });

  it('reports error — not empty — when loading fails, and retry succeeds', async () => {
    const { ensureCareerBoot, getStore, mockLoadCareer } = await freshBoot();
    mockLoadCareer.mockRejectedValue(new Error('database is corrupted'));

    const first = await ensureCareerBoot();
    expect(first).toBe('error');
    expect(getStore().bootStatus).toBe('error');
    expect(getStore().isLoading).toBe(false);

    // Retry must re-run the boot (the cached failure is cleared) and must
    // not duplicate initialization for concurrent callers.
    mockLoadCareer.mockResolvedValue(buildLoadedCareer([]));
    const second = await ensureCareerBoot();
    expect(second).toBe('loaded');
    expect(getStore().bootStatus).toBe('loaded');
    expect(mockLoadCareer).toHaveBeenCalledTimes(2);
  });

  it('shares a single boot attempt across concurrent callers', async () => {
    const { ensureCareerBoot, getStore, mockLoadCareer, mockInitDatabase } =
      await freshBoot();

    // Hold the load open so all callers pile onto the same in-flight boot.
    let releaseLoad!: (career: CareerState | null) => void;
    const loadGate = new Promise<CareerState | null>((resolve) => {
      releaseLoad = resolve;
    });
    mockLoadCareer.mockReturnValue(loadGate);

    const callers = [
      ensureCareerBoot(),
      ensureCareerBoot(),
      ensureCareerBoot(),
    ];
    // While the attempt is in flight the shared status is 'pending' — this
    // is what the tab-layout guard keys its loading view on.
    expect(getStore().bootStatus).toBe('pending');
    releaseLoad(buildLoadedCareer([]));

    const results = await Promise.all(callers);
    expect(results).toEqual(['loaded', 'loaded', 'loaded']);
    // Exactly one initialization and one load for the shared attempt.
    expect(mockInitDatabase).toHaveBeenCalledTimes(1);
    expect(mockLoadCareer).toHaveBeenCalledTimes(1);
    expect(getStore().bootStatus).toBe('loaded');
  });

  it('starts exactly one new attempt when retrying after an error', async () => {
    const { ensureCareerBoot, getStore, mockLoadCareer, mockInitDatabase } =
      await freshBoot();

    mockLoadCareer.mockRejectedValueOnce(new Error('transient failure'));
    expect(await ensureCareerBoot()).toBe('error');
    expect(mockLoadCareer).toHaveBeenCalledTimes(1);
    expect(mockInitDatabase).toHaveBeenCalledTimes(1);

    // Retry with the load held open; a concurrent caller must join the same
    // new attempt rather than starting another.
    let releaseLoad!: (career: CareerState | null) => void;
    const loadGate = new Promise<CareerState | null>((resolve) => {
      releaseLoad = resolve;
    });
    mockLoadCareer.mockReturnValue(loadGate);

    const retryA = ensureCareerBoot();
    const retryB = ensureCareerBoot();
    // The retry flips shared status back to 'pending' while in flight.
    expect(getStore().bootStatus).toBe('pending');
    releaseLoad(buildLoadedCareer([]));

    expect(await Promise.all([retryA, retryB])).toEqual(['loaded', 'loaded']);
    // One failed attempt + exactly one retry attempt: init ran twice total
    // and load ran twice total — the two concurrent retry callers shared
    // the single new attempt rather than each starting their own.
    expect(mockInitDatabase).toHaveBeenCalledTimes(2);
    expect(mockLoadCareer).toHaveBeenCalledTimes(2);
    expect(getStore().bootStatus).toBe('loaded');
  });

  it('reports error when database initialization fails', async () => {
    const { ensureCareerBoot, mockInitDatabase, mockLoadCareer } =
      await freshBoot();
    mockInitDatabase.mockRejectedValue(new Error('migration failed'));

    const result = await ensureCareerBoot();

    expect(result).toBe('error');
    // loadCareer must never run against an uninitialized database.
    expect(mockLoadCareer).not.toHaveBeenCalled();
  });

  describe('season objective recovery', () => {
    it('recovers and persists objectives for an untouched legacy career', async () => {
      const { ensureCareerBoot, getStore, mockLoadCareer, mockSaveCareer } =
        await freshBoot();
      mockLoadCareer.mockResolvedValue(buildRecoverableCareer());

      const result = await ensureCareerBoot();
      const store = getStore();

      expect(result).toBe('loaded');
      // The recovered state was persisted BEFORE publication.
      expect(mockSaveCareer).toHaveBeenCalledTimes(1);
      const saved = mockSaveCareer.mock.calls[0][0] as CareerState;
      expect(saved.seasonObjectives).toHaveLength(16);
      expect(
        saved.seasonObjectives.every((o) => o.seasonId === 'season-1'),
      ).toBe(true);
      expect(store.seasonObjectives).toHaveLength(16);
      expect(store.bootStatus).toBe('loaded');
    });

    it('preserves historical objectives during recovery', async () => {
      const { ensureCareerBoot, mockLoadCareer, mockSaveCareer } =
        await freshBoot();
      const base = buildRecoverableCareer();
      const history = base.clubs.slice(0, 3).map((c) => ({
        seasonId: 'season-0',
        clubId: c.id,
        targetPosition: 8,
        rewardAmount: 1_000_000,
        ambition: 'mid_table' as const,
        objectiveMet: true,
        rewardPaid: 1_000_000,
        debtRemaining: 0,
        settledAt: new Date('2024-06-01T00:00:00Z'),
        sanction: 'none' as const,
      }));
      mockLoadCareer.mockResolvedValue(
        buildRecoverableCareer({ seasonObjectives: history }),
      );

      await ensureCareerBoot();

      const saved = mockSaveCareer.mock.calls[0][0] as CareerState;
      expect(saved.seasonObjectives).toHaveLength(19);
      expect(saved.seasonObjectives.slice(0, 3)).toEqual(history);
    });

    it('does not save again when objectives are already complete', async () => {
      const { ensureCareerBoot, mockLoadCareer, mockSaveCareer } =
        await freshBoot();
      const base = buildRecoverableCareer();
      const objectives = assignSeasonObjectives({
        seasonId: 'season-1',
        clubs: base.clubs,
        players: base.players,
        seasonWeeks: 30,
      });
      mockLoadCareer.mockResolvedValue(
        buildRecoverableCareer({ seasonObjectives: objectives }),
      );

      const result = await ensureCareerBoot();

      expect(result).toBe('loaded');
      expect(mockSaveCareer).not.toHaveBeenCalled();
    });

    it('boots normally without mutation when recovery is blocked', async () => {
      const { ensureCareerBoot, getStore, mockLoadCareer, mockSaveCareer } =
        await freshBoot();
      const transfer: TransferRecord = {
        id: 'transfer-1',
        playerId: 'p-x',
        fromClubId: 'club-a',
        toClubId: 'club-b',
        fee: 100_000,
        date: new Date('2024-08-05T00:00:00Z'),
      };
      mockLoadCareer.mockResolvedValue(
        buildRecoverableCareer({ transferHistory: [transfer] }),
      );

      const result = await ensureCareerBoot();

      expect(result).toBe('loaded');
      expect(mockSaveCareer).not.toHaveBeenCalled();
      expect(getStore().seasonObjectives).toEqual([]);
    });

    it('boots normally without mutation when objectives are corrupt', async () => {
      const { ensureCareerBoot, mockLoadCareer, mockSaveCareer } =
        await freshBoot();
      const base = buildRecoverableCareer();
      const partial = assignSeasonObjectives({
        seasonId: 'season-1',
        clubs: base.clubs,
        players: base.players,
        seasonWeeks: 30,
      }).slice(0, 10);
      mockLoadCareer.mockResolvedValue(
        buildRecoverableCareer({ seasonObjectives: partial }),
      );

      const result = await ensureCareerBoot();

      expect(result).toBe('loaded');
      expect(mockSaveCareer).not.toHaveBeenCalled();
    });

    it('persists before publishing: no setter runs before saveCareer resolves', async () => {
      const { ensureCareerBoot, getStore, mockLoadCareer, mockSaveCareer } =
        await freshBoot();
      mockLoadCareer.mockResolvedValue(buildRecoverableCareer());
      // Snapshot the store at the moment saveCareer is invoked: nothing
      // may have been published yet.
      let storeAtSaveTime: {
        league: unknown;
        seasonObjectives: unknown;
      } | null = null;
      mockSaveCareer.mockImplementation(() => {
        const s = getStore();
        storeAtSaveTime = {
          league: s.league,
          seasonObjectives: s.seasonObjectives,
        };
        return Promise.resolve();
      });

      await ensureCareerBoot();

      expect(storeAtSaveTime).not.toBeNull();
      expect(storeAtSaveTime!.league).toBeNull();
      expect(storeAtSaveTime!.seasonObjectives).toEqual([]);
      // Publication still happens afterwards.
      expect(getStore().seasonObjectives).toHaveLength(16);
    });

    it('reports error and publishes nothing when the recovery save fails', async () => {
      const { ensureCareerBoot, getStore, mockLoadCareer, mockSaveCareer } =
        await freshBoot();
      mockLoadCareer.mockResolvedValue(buildRecoverableCareer());
      mockSaveCareer.mockRejectedValue(new Error('disk full'));

      const result = await ensureCareerBoot();
      const store = getStore();

      expect(result).toBe('error');
      expect(store.bootStatus).toBe('error');
      // The recovered objectives were never published.
      expect(store.seasonObjectives).toEqual([]);
      expect(store.league).toBeNull();
    });
  });
});
