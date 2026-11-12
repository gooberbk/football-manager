import { generateSeedData } from '@club-director/engine';
import { generateFixtures } from '@club-director/engine';
import type {
  Club,
  Player,
  League,
  Season,
  TransferRecord,
  TransferOffer,
  StandingEntry,
} from '@club-director/shared-types';
import { saveCareer, loadCareer, deleteCareer } from './careerPersistence';
import { getTestDatabase, resetTestDatabase } from './testDatabase';
import * as schema from './schema';

const buildState = () => {
  const seedData = generateSeedData(777);
  const clubs = seedData.clubs.slice(0, 3);
  const players = seedData.players.filter((p) =>
    clubs.some((c) => c.squad.includes(p.id)),
  );
  return {
    career: {
      id: 'active',
      managerName: 'Offer Manager',
      managedClubId: clubs[0].id,
      createdAt: new Date('2024-08-01'),
      lastPlayedAt: new Date(),
      schemaVersion: 1,
    },
    clubs,
    players,
    league: {
      id: 'league-1',
      name: 'Offer League',
      tier: 1,
      clubIds: clubs.map((c) => c.id),
      standings: { entries: [] },
      fixtures: [],
    },
    season: {
      id: 'season-1',
      leagueId: 'league-1',
      currentWeek: 1,
      currentDate: new Date('2024-08-01'),
      transferWindowOpen: true,
      fixturesCalendar: [],
    },
    transferHistory: [],
    transferOffers: [] as TransferOffer[],
  };
};

const makeOffer = (
  state: ReturnType<typeof buildState>,
  overrides: Partial<TransferOffer>,
): TransferOffer => ({
  id: 'offer-x',
  playerId: state.players[0].id,
  buyingClubId: state.clubs[1].id,
  sellingClubId: state.clubs[0].id,
  offerAmount: 500_000,
  status: 'pending',
  createdAt: new Date('2024-08-10T12:00:00Z'),
  ...overrides,
});

describe('Career Persistence (Real SQLite)', () => {
  let testDb: any;

  beforeEach(() => {
    testDb = getTestDatabase();
    resetTestDatabase();
  });

  afterEach(() => {
    // Clean up after each test
    deleteCareer(testDb);
  });

  it('should return null when no career exists yet', async () => {
    // Test that loadCareer returns null when no career has been saved
    // This runs against the real (empty) test database
    const loaded = await loadCareer(testDb);
    expect(loaded).toBeNull();
  });

  it('should round-trip career state through SQLite', async () => {
    // Build a game state in memory
    const seedData = generateSeedData(12345);
    const clubs = seedData.clubs;
    const players = seedData.players;

    const league: League = {
      id: 'league-1',
      name: 'Test League',
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

    const transferHistory: TransferRecord[] = [];

    const careerState = {
      career: {
        id: 'active',
        managerName: 'Test Manager',
        managedClubId: clubs[0].id,
        createdAt: new Date('2024-08-01'),
        lastPlayedAt: new Date(),
        schemaVersion: 1,
      },
      clubs,
      players,
      league,
      season,
      transferHistory,
      transferOffers: [],
    };

    // Call the real saveCareer() against the test SQLite instance
    await saveCareer(careerState, testDb);

    // Discard the original in-memory objects to prevent accidental self-comparison
    const originalManagerName = careerState.career.managerName;
    const originalManagedClubId = careerState.career.managedClubId;
    const originalClubCount = careerState.clubs.length;
    const originalPlayerCount = careerState.players.length;
    const originalLeagueName = careerState.league.name;
    const originalLeagueTier = careerState.league.tier;
    const originalCurrentWeek = careerState.season.currentWeek;
    const originalTransferWindowOpen = careerState.season.transferWindowOpen;
    const originalTransferHistoryCount = careerState.transferHistory.length;
    const originalClubName = careerState.clubs[0].name;
    const originalClubBalance = careerState.clubs[0].finances.balance;
    const originalClubReputation = careerState.clubs[0].reputation;
    const originalPlayerFirstName = careerState.players[0].firstName;
    const originalPlayerPassing = careerState.players[0].attributes.technical.passing;
    const originalPlayerWage = careerState.players[0].contract.wage;

    // Clear the original object
    Object.assign(careerState, {
      career: null,
      clubs: [],
      players: [],
      league: null,
      season: null,
      transferHistory: [],
    });

    // Call the real loadCareer() from SQLite
    const loaded = await loadCareer(testDb);

    // Assert the reloaded values match the original
    expect(loaded).not.toBeNull();
    expect(loaded!.career.managerName).toBe(originalManagerName);
    expect(loaded!.career.managedClubId).toBe(originalManagedClubId);
    expect(loaded!.clubs.length).toBe(originalClubCount);
    expect(loaded!.players.length).toBe(originalPlayerCount);
    expect(loaded!.league.name).toBe(originalLeagueName);
    expect(loaded!.league.tier).toBe(originalLeagueTier);
    expect(loaded!.league.clubIds).toEqual(clubs.map((c) => c.id));
    expect(loaded!.league.standings.entries.length).toBe(clubs.length);
    expect(loaded!.season.currentWeek).toBe(originalCurrentWeek);
    expect(loaded!.season.transferWindowOpen).toBe(originalTransferWindowOpen);
    expect(loaded!.transferHistory.length).toBe(originalTransferHistoryCount);

    // Compare specific club fields
    expect(loaded!.clubs[0].name).toBe(originalClubName);
    expect(loaded!.clubs[0].finances.balance).toBe(originalClubBalance);
    expect(loaded!.clubs[0].reputation).toBe(originalClubReputation);

    // Compare specific player fields
    expect(loaded!.players[0].firstName).toBe(originalPlayerFirstName);
    expect(loaded!.players[0].attributes.technical.passing).toBe(originalPlayerPassing);
    expect(loaded!.players[0].contract.wage).toBe(originalPlayerWage);
  });

  it('should persist mid-season state through SQLite', async () => {
    // Build initial state with fixtures
    const seedData = generateSeedData(12345);
    const clubs = seedData.clubs.slice(0, 6); // Use 6 clubs for faster test
    const players = seedData.players.filter((p) => clubs.some((c) => c.squad.includes(p.id)));

    const league: League = {
      id: 'league-1',
      name: 'Test League',
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
    league.fixtures = scheduledFixtures.map((f) => ({
      id: `fixture-${f.matchweek}-${f.homeClubId}-${f.awayClubId}`,
      leagueId: 'league-1',
      homeClubId: f.homeClubId,
      awayClubId: f.awayClubId,
      week: f.matchweek,
      date: f.date,
      played: false,
    }));

    const careerState = {
      career: {
        id: 'active',
        managerName: 'Test Manager',
        managedClubId: clubs[0].id,
        createdAt: new Date('2024-08-01'),
        lastPlayedAt: new Date(),
        schemaVersion: 1,
      },
      clubs,
      players,
      league,
      season,
      transferHistory: [],
      transferOffers: [],
    };

    // Save initial state
    await saveCareer(careerState, testDb);

    // Simulate advancing a few matchweeks by marking fixtures as played
    league.fixtures[0].played = true;
    league.fixtures[0].homeScore = 2;
    league.fixtures[0].awayScore = 1;
    league.fixtures[1].played = true;
    league.fixtures[1].homeScore = 0;
    league.fixtures[1].awayScore = 3;
    season.currentWeek = 3;

    // Update standings
    league.standings.entries[0].played = 2;
    league.standings.entries[0].won = 1;
    league.standings.entries[0].lost = 1;
    league.standings.entries[0].goalsFor = 2;
    league.standings.entries[0].goalsAgainst = 1;
    league.standings.entries[0].goalDifference = 1;
    league.standings.entries[0].points = 3;

    league.standings.entries[1].played = 2;
    league.standings.entries[1].won = 1;
    league.standings.entries[1].lost = 1;
    league.standings.entries[1].goalsFor = 4;
    league.standings.entries[1].goalsAgainst = 0;
    league.standings.entries[1].goalDifference = 4;
    league.standings.entries[1].points = 3;

    // Save mid-season state
    await saveCareer(careerState, testDb);

    // Reload (simulating app relaunch)
    const loaded = await loadCareer(testDb);
    expect(loaded).not.toBeNull();

    // Assert fixtures continue correctly from where they left off
    expect(loaded!.season.currentWeek).toBe(3);
    expect(loaded!.league.fixtures.length).toBe(league.fixtures.length);
    expect(loaded!.league.fixtures[0].played).toBe(true);
    expect(loaded!.league.fixtures[0].homeScore).toBe(2);
    expect(loaded!.league.fixtures[0].awayScore).toBe(1);
    expect(loaded!.league.fixtures[1].played).toBe(true);
    expect(loaded!.league.fixtures[1].homeScore).toBe(0);
    expect(loaded!.league.fixtures[1].awayScore).toBe(3);
    expect(loaded!.league.fixtures[2].played).toBe(false); // Next fixture not played
    expect(loaded!.league.fixtures[2].homeScore).toBeUndefined();
    expect(loaded!.league.fixtures[2].awayScore).toBeUndefined();

    // Assert standings are preserved
    expect(loaded!.league.standings.entries[0].played).toBe(2);
    expect(loaded!.league.standings.entries[0].points).toBe(3);
    expect(loaded!.league.standings.entries[1].played).toBe(2);
    expect(loaded!.league.standings.entries[1].points).toBe(3);
  });

  it('should persist transfer state through SQLite', async () => {
    const seedData = generateSeedData(12345);
    const clubs = seedData.clubs.slice(0, 2);
    const players = seedData.players.filter((p) => clubs.some((c) => c.squad.includes(p.id)));

    const league: League = {
      id: 'league-1',
      name: 'Test League',
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

    // Execute a transfer
    const playerToTransfer = players.find((p) => p.contract.clubId === clubs[1].id);
    const transferFee = 5000000;

    // Store original balances
    const originalBuyerBalance = clubs[0].finances.balance;
    const originalSellerBalance = clubs[1].finances.balance;

    // Update player
    playerToTransfer!.contract.clubId = clubs[0].id;
    playerToTransfer!.contract.wage = 80000;

    // Update finances
    clubs[0].finances.balance -= transferFee;
    clubs[1].finances.balance += transferFee;

    // Update squads
    clubs[1].squad = clubs[1].squad.filter((id) => id !== playerToTransfer!.id);
    clubs[0].squad.push(playerToTransfer!.id);

    const transferHistory: TransferRecord[] = [
      {
        id: 'transfer-1',
        playerId: playerToTransfer!.id,
        fromClubId: clubs[1].id,
        toClubId: clubs[0].id,
        fee: transferFee,
        date: new Date(),
      },
    ];

    const careerState = {
      career: {
        id: 'active',
        managerName: 'Test Manager',
        managedClubId: clubs[0].id,
        createdAt: new Date('2024-08-01'),
        lastPlayedAt: new Date(),
        schemaVersion: 1,
      },
      clubs,
      players,
      league,
      season,
      transferHistory,
      transferOffers: [],
    };

    // Save with transfer
    await saveCareer(careerState, testDb);

    // Reload
    const loaded = await loadCareer(testDb);
    expect(loaded).not.toBeNull();

    // Assert buyer/seller squads reflect the transfer
    expect(loaded!.clubs[0].squad).toContain(playerToTransfer!.id);
    expect(loaded!.clubs[1].squad).not.toContain(playerToTransfer!.id);

    // Assert finances reflect the transfer
    expect(loaded!.clubs[0].finances.balance).toBe(originalBuyerBalance - transferFee);
    expect(loaded!.clubs[1].finances.balance).toBe(originalSellerBalance + transferFee);

    // Assert player's new club
    expect(loaded!.players.find((p) => p.id === playerToTransfer!.id)!.contract.clubId).toBe(clubs[0].id);
    expect(loaded!.players.find((p) => p.id === playerToTransfer!.id)!.contract.wage).toBe(80000);

    // Assert transfer history
    expect(loaded!.transferHistory.length).toBe(1);
    expect(loaded!.transferHistory[0].playerId).toBe(playerToTransfer!.id);
    expect(loaded!.transferHistory[0].fromClubId).toBe(clubs[1].id);
    expect(loaded!.transferHistory[0].toClubId).toBe(clubs[0].id);
    expect(loaded!.transferHistory[0].fee).toBe(transferFee);
  });

  it('should handle career overwrite through SQLite', async () => {
    // Create first career
    const seedData1 = generateSeedData(12345);
    const clubs1 = seedData1.clubs.slice(0, 2);
    const players1 = seedData1.players.filter((p) => clubs1.some((c) => c.squad.includes(p.id)));

    const careerState1 = {
      career: {
        id: 'active',
        managerName: 'Manager 1',
        managedClubId: clubs1[0].id,
        createdAt: new Date('2024-08-01'),
        lastPlayedAt: new Date(),
        schemaVersion: 1,
      },
      clubs: clubs1,
      players: players1,
      league: {
        id: 'league-1',
        name: 'League 1',
        tier: 1,
        clubIds: clubs1.map((c) => c.id),
        standings: { entries: [] },
        fixtures: [],
      },
      season: {
        id: 'season-1',
        leagueId: 'league-1',
        currentWeek: 1,
        currentDate: new Date('2024-08-01'),
        transferWindowOpen: true,
        fixturesCalendar: [],
      },
      transferHistory: [],
      transferOffers: [],
    };

    await saveCareer(careerState1, testDb);

    // Create second career (should overwrite)
    const seedData2 = generateSeedData(99999); // Different seed
    const clubs2 = seedData2.clubs.slice(0, 2);
    const players2 = seedData2.players.filter((p) => clubs2.some((c) => c.squad.includes(p.id)));

    const careerState2 = {
      career: {
        id: 'active',
        managerName: 'Manager 2',
        managedClubId: clubs2[0].id,
        createdAt: new Date('2024-08-01'),
        lastPlayedAt: new Date(),
        schemaVersion: 1,
      },
      clubs: clubs2,
      players: players2,
      league: {
        id: 'league-1',
        name: 'League 2',
        tier: 1,
        clubIds: clubs2.map((c) => c.id),
        standings: { entries: [] },
        fixtures: [],
      },
      season: {
        id: 'season-1',
        leagueId: 'league-1',
        currentWeek: 1,
        currentDate: new Date('2024-08-01'),
        transferWindowOpen: true,
        fixturesCalendar: [],
      },
      transferHistory: [],
      transferOffers: [],
    };

    await saveCareer(careerState2, testDb);

    // Load and assert only second career exists
    const loaded = await loadCareer(testDb);
    expect(loaded).not.toBeNull();
    expect(loaded!.career.managerName).toBe('Manager 2');
    expect(loaded!.career.managedClubId).toBe(clubs2[0].id);
    expect(loaded!.clubs.length).toBe(clubs2.length);
    expect(loaded!.players.length).toBe(players2.length);
    expect(loaded!.league.name).toBe('League 2');

    // Assert career state represents the second seed data
    expect(loaded!.career.managerName).not.toBe(careerState1.career.managerName);
    expect(loaded!.league.name).not.toBe(careerState1.league.name);
  });

  it('should roll back the entire save when a write fails mid-transaction', async () => {
    const snapshotAll = async () => ({
      career: await testDb.select().from(schema.career),
      clubs: await testDb.select().from(schema.clubs),
      players: await testDb.select().from(schema.players),
      leagues: await testDb.select().from(schema.leagues),
      leagueStandings: await testDb.select().from(schema.leagueStandings),
      fixtures: await testDb.select().from(schema.fixtures),
      seasons: await testDb.select().from(schema.seasons),
      matches: await testDb.select().from(schema.matches),
      matchEvents: await testDb.select().from(schema.matchEvents),
      transfers: await testDb.select().from(schema.transfers),
      transferOffers: await testDb.select().from(schema.transferOffers),
    });

    const buildCareerState = (
      managerName: string,
      leagueName: string,
      seed: number,
    ) => {
      const seedData = generateSeedData(seed);
      const clubs = seedData.clubs.slice(0, 2);
      const players = seedData.players.filter((p) =>
        clubs.some((c) => c.squad.includes(p.id)),
      );
      return {
        career: {
          id: 'active',
          managerName,
          managedClubId: clubs[0].id,
          createdAt: new Date('2024-08-01'),
          lastPlayedAt: new Date(),
          schemaVersion: 1,
        },
        clubs,
        players,
        league: {
          id: 'league-1',
          name: leagueName,
          tier: 1,
          clubIds: clubs.map((c) => c.id),
          standings: { entries: [] },
          fixtures: [],
        },
        season: {
          id: 'season-1',
          leagueId: 'league-1',
          currentWeek: 1,
          currentDate: new Date('2024-08-01'),
          transferWindowOpen: true,
          fixturesCalendar: [],
        },
        transferHistory: [],
        transferOffers: [],
      };
    };

    // 1. Save a valid career.
    const careerA = buildCareerState('Manager One', 'League One', 12345);
    await saveCareer(careerA, testDb);

    // 2. Capture the complete persisted state.
    const beforeSnapshot = await snapshotAll();
    expect(beforeSnapshot.career).toHaveLength(1);
    expect(beforeSnapshot.players.length).toBeGreaterThan(0);

    // 3. Attempt a second save that fails AFTER the career upsert, all
    //    deletes, and the club inserts have already executed: a player with
    //    a null firstName violates the NOT NULL constraint during the
    //    players insert phase.
    const careerB = buildCareerState('Manager Two', 'League Two', 99999);
    careerB.players[0] = { ...careerB.players[0], firstName: null as any };

    await expect(saveCareer(careerB, testDb)).rejects.toThrow();

    // 4. Every persisted row must be identical to the pre-failure state.
    const afterSnapshot = await snapshotAll();
    expect(afterSnapshot).toEqual(beforeSnapshot);

    // 5. The original career must still load correctly.
    const loaded = await loadCareer(testDb);
    expect(loaded).not.toBeNull();
    expect(loaded!.career.managerName).toBe('Manager One');
    expect(loaded!.league.name).toBe('League One');
    expect(loaded!.players.length).toBe(careerA.players.length);
    expect(loaded!.clubs.length).toBe(careerA.clubs.length);
  });

  describe('transfer offer persistence', () => {
    it('round-trips a pending offer with null resolvedAt', async () => {
      const state = buildState();
      const offer = makeOffer(state, { id: 'offer-pending' });
      await saveCareer({ ...state, transferOffers: [offer] }, testDb);

      const loaded = await loadCareer(testDb);
      expect(loaded!.transferOffers).toHaveLength(1);
      const loadedOffer = loaded!.transferOffers![0];
      expect(loadedOffer).toEqual({
        id: 'offer-pending',
        playerId: offer.playerId,
        buyingClubId: offer.buyingClubId,
        sellingClubId: offer.sellingClubId,
        offerAmount: 500_000,
        status: 'pending',
        createdAt: offer.createdAt,
        resolvedAt: undefined,
      });
      expect(loadedOffer.createdAt).toBeInstanceOf(Date);
    });

    it('round-trips accepted, rejected and withdrawn offers with resolvedAt', async () => {
      const state = buildState();
      const resolvedAt = new Date('2024-08-20T09:30:00Z');
      const offers: TransferOffer[] = (
        ['accepted', 'rejected', 'withdrawn'] as const
      ).map((status, i) =>
        makeOffer(state, {
          id: `offer-${status}`,
          status,
          offerAmount: 100_000 * (i + 1),
          resolvedAt,
        }),
      );
      await saveCareer({ ...state, transferOffers: offers }, testDb);

      const loaded = await loadCareer(testDb);
      expect(loaded!.transferOffers).toHaveLength(3);
      for (const status of ['accepted', 'rejected', 'withdrawn'] as const) {
        const found = loaded!.transferOffers!.find((o) => o.id === `offer-${status}`);
        expect(found).toBeDefined();
        expect(found!.status).toBe(status);
        expect(found!.resolvedAt).toEqual(resolvedAt);
        expect(found!.resolvedAt).toBeInstanceOf(Date);
      }
    });

    it('preserves multiple simultaneous offers including AI-to-AI offers', async () => {
      const state = buildState();
      // managedClubId is clubs[0]; offers between clubs[1] and clubs[2] are
      // AI-to-AI and must persist just like user-facing offers.
      const offers: TransferOffer[] = [
        makeOffer(state, {
          id: 'offer-user',
          buyingClubId: state.clubs[1].id,
          sellingClubId: state.clubs[0].id,
          playerId: state.players[0].id,
        }),
        makeOffer(state, {
          id: 'offer-ai-1',
          buyingClubId: state.clubs[1].id,
          sellingClubId: state.clubs[2].id,
          playerId: state.players[1].id,
          offerAmount: 250_000,
        }),
        makeOffer(state, {
          id: 'offer-ai-2',
          buyingClubId: state.clubs[2].id,
          sellingClubId: state.clubs[1].id,
          playerId: state.players[2].id,
          status: 'accepted',
          offerAmount: 750_000,
          resolvedAt: new Date('2024-08-18'),
        }),
      ];
      await saveCareer({ ...state, transferOffers: offers }, testDb);

      const loaded = await loadCareer(testDb);
      expect(loaded!.transferOffers).toHaveLength(3);
      const ids = loaded!.transferOffers!.map((o) => o.id).sort();
      expect(ids).toEqual(['offer-ai-1', 'offer-ai-2', 'offer-user']);
      const ai1 = loaded!.transferOffers!.find((o) => o.id === 'offer-ai-1')!;
      expect(ai1.sellingClubId).toBe(state.clubs[2].id);
      expect(ai1.status).toBe('pending');
    });

    it('loads an empty offer collection as an empty array', async () => {
      const state = buildState();
      await saveCareer(state, testDb); // transferOffers omitted entirely

      const loaded = await loadCareer(testDb);
      expect(loaded!.transferOffers).toEqual([]);
    });

    it('saving twice replaces offers without duplicates', async () => {
      const state = buildState();
      const offerA = makeOffer(state, { id: 'offer-a' });
      await saveCareer({ ...state, transferOffers: [offerA] }, testDb);

      // Second save: offer A withdrawn, offer B added.
      const offerB = makeOffer(state, {
        id: 'offer-b',
        status: 'accepted',
        resolvedAt: new Date('2024-08-25'),
      });
      const offerAWithdrawn = {
        ...offerA,
        status: 'withdrawn' as const,
        resolvedAt: new Date('2024-08-22'),
      };
      await saveCareer(
        { ...state, transferOffers: [offerAWithdrawn, offerB] },
        testDb,
      );

      const rows = await testDb.select().from(schema.transferOffers);
      expect(rows).toHaveLength(2);

      const loaded = await loadCareer(testDb);
      expect(loaded!.transferOffers).toHaveLength(2);
      const a = loaded!.transferOffers!.find((o) => o.id === 'offer-a')!;
      expect(a.status).toBe('withdrawn');
      expect(a.resolvedAt).toEqual(new Date('2024-08-22'));
    });

    it('rolls back the entire save when offer persistence fails', async () => {
      const state = buildState();
      const goodOffer = makeOffer(state, { id: 'offer-good' });
      await saveCareer({ ...state, transferOffers: [goodOffer] }, testDb);

      // Snapshot EVERY persisted career table before the failing save.
      const snapshotAll = async () => ({
        career: await testDb.select().from(schema.career),
        clubs: await testDb.select().from(schema.clubs),
        players: await testDb.select().from(schema.players),
        leagues: await testDb.select().from(schema.leagues),
        leagueStandings: await testDb.select().from(schema.leagueStandings),
        fixtures: await testDb.select().from(schema.fixtures),
        seasons: await testDb.select().from(schema.seasons),
        matches: await testDb.select().from(schema.matches),
        matchEvents: await testDb.select().from(schema.matchEvents),
        transfers: await testDb.select().from(schema.transfers),
        transferOffers: await testDb.select().from(schema.transferOffers),
      });
      const beforeSnapshot = await snapshotAll();
      expect(beforeSnapshot.transferOffers).toHaveLength(1);

      // A second save whose offer violates NOT NULL on offer_amount fails
      // at the very end of the transaction — everything must roll back.
      const badState = {
        ...state,
        career: { ...state.career, managerName: 'Should Not Persist' },
        transferOffers: [
          makeOffer(state, { offerAmount: null as any }),
        ],
      };
      await expect(saveCareer(badState, testDb)).rejects.toThrow();

      // Every persisted table is byte-identical to the pre-failure state.
      expect(await snapshotAll()).toEqual(beforeSnapshot);

      // The previous career and all previous offers remain intact.
      const loaded = await loadCareer(testDb);
      expect(loaded).not.toBeNull();
      expect(loaded!.career.managerName).toBe('Offer Manager');
      expect(loaded!.transferOffers).toHaveLength(1);
      expect(loaded!.transferOffers![0].id).toBe('offer-good');
    });

    it('preserves persisted offers when the save omits transferOffers', async () => {
      const state = buildState();
      const offer = makeOffer(state, { id: 'offer-kept' });
      await saveCareer({ ...state, transferOffers: [offer] }, testDb);

      // Simulate a caller that does not provide the collection at all
      // (e.g. code written before offer persistence). The field is required
      // at compile time, so bypass the type to exercise the runtime guard.
      const { transferOffers: _omitted, ...stateWithoutOffers } = state;
      await saveCareer(stateWithoutOffers as any, testDb);

      const loaded = await loadCareer(testDb);
      expect(loaded!.transferOffers).toHaveLength(1);
      expect(loaded!.transferOffers![0].id).toBe('offer-kept');

      // An explicit empty array still clears the collection.
      await saveCareer({ ...state, transferOffers: [] }, testDb);
      const cleared = await loadCareer(testDb);
      expect(cleared!.transferOffers).toEqual([]);
      expect(await testDb.select().from(schema.transferOffers)).toHaveLength(0);
    });
  });

  describe('career deletion', () => {
    const careerTables = async () => ({
      career: await testDb.select().from(schema.career),
      clubs: await testDb.select().from(schema.clubs),
      players: await testDb.select().from(schema.players),
      leagues: await testDb.select().from(schema.leagues),
      leagueStandings: await testDb.select().from(schema.leagueStandings),
      fixtures: await testDb.select().from(schema.fixtures),
      seasons: await testDb.select().from(schema.seasons),
      matches: await testDb.select().from(schema.matches),
      matchEvents: await testDb.select().from(schema.matchEvents),
      transfers: await testDb.select().from(schema.transfers),
      transferOffers: await testDb.select().from(schema.transferOffers),
    });

    const seedMatchData = (state: ReturnType<typeof buildState>) => {
      testDb.insert(schema.matches).values({
        id: 'match-1',
        homeClubId: state.clubs[0].id,
        awayClubId: state.clubs[1].id,
        seasonId: 'season-1',
        date: 1722470400000,
        status: 'completed',
        homeScore: 2,
        awayScore: 1,
        homeTactics: '4-4-2',
        awayTactics: '4-3-3',
      }).run();
      testDb.insert(schema.matchEvents).values({
        id: 'event-1',
        matchId: 'match-1',
        minute: 45,
        type: 'goal',
        playerId: state.players[0].id,
        clubId: state.clubs[0].id,
        description: 'Goal',
      }).run();
    };

    it('removes the career and every career-owned record', async () => {
      const state = buildState();
      const offer = makeOffer(state, { id: 'offer-doomed' });
      await saveCareer({ ...state, transferOffers: [offer] }, testDb);
      seedMatchData(state);

      // Seed migration metadata — infrastructure that must survive.
      testDb.insert(schema.schemaMigrations).values({
        version: 1,
        name: 'baseline-schema',
        appliedAt: 1,
      }).run();

      await deleteCareer(testDb);

      // No career remains.
      expect(await loadCareer(testDb)).toBeNull();

      // Every career-owned table is empty.
      const remaining = await careerTables();
      for (const [table, rows] of Object.entries(remaining)) {
        expect(`${table}: ${rows.length}`).toBe(`${table}: 0`);
      }

      // Migration metadata is untouched.
      const migrations = await testDb.select().from(schema.schemaMigrations);
      expect(migrations).toHaveLength(1);
      expect(migrations[0].version).toBe(1);
    });

    it('rolls back the entire deletion when a delete fails', async () => {
      const state = buildState();
      const offer = makeOffer(state, { id: 'offer-safe' });
      await saveCareer({ ...state, transferOffers: [offer] }, testDb);
      seedMatchData(state);

      const snapshotAll = async () => ({
        ...(await careerTables()),
        schemaMigrations: await testDb.select().from(schema.schemaMigrations),
      });
      const before = await snapshotAll();
      expect(before.players.length).toBeGreaterThan(0);
      expect(before.transferOffers).toHaveLength(1);
      expect(before.matches).toHaveLength(1);
      expect(before.matchEvents).toHaveLength(1);

      // Real SQLite failure injection: a trigger aborts DELETEs on players,
      // which run late in the deletion order — earlier deletes must roll back.
      testDb.run(`
        CREATE TRIGGER fail_delete_test
        BEFORE DELETE ON players
        BEGIN
          SELECT RAISE(ABORT, 'injected delete failure');
        END
      `);

      await expect(deleteCareer(testDb)).rejects.toThrow(
        /injected delete failure/,
      );
      testDb.run('DROP TRIGGER fail_delete_test');

      // Every table is byte-identical to the pre-deletion state.
      expect(await snapshotAll()).toEqual(before);

      // The career still loads intact.
      const loaded = await loadCareer(testDb);
      expect(loaded).not.toBeNull();
      expect(loaded!.career.managerName).toBe('Offer Manager');
      expect(loaded!.transferOffers).toHaveLength(1);
    });
  });

  describe('loadCareer error handling', () => {
    it('returns null only when no career exists', async () => {
      expect(await loadCareer(testDb)).toBeNull();
    });

    it('rejects with context when career data is inconsistent', async () => {
      const state = buildState();
      await saveCareer(state, testDb);

      // Remove the league row while the career row still exists: the career
      // is present but the persisted data is incomplete. This must surface
      // as an error, not be silently treated as "no career".
      await testDb.delete(schema.leagues).run();

      await expect(loadCareer(testDb)).rejects.toThrow(
        /Failed to load career/,
      );

      // The original cause is preserved for debugging.
      try {
        await loadCareer(testDb);
        fail('expected loadCareer to reject');
      } catch (error: any) {
        expect(error.cause).toBeDefined();
      }
    });

    it('rejects when the database operation itself fails', async () => {
      const state = buildState();
      await saveCareer(state, testDb);

      // Drop a table the loader must read — a genuine SQL failure. Restore
      // it afterwards so the shared afterEach cleanup still works.
      testDb.run('DROP TABLE fixtures');
      try {
        await expect(loadCareer(testDb)).rejects.toThrow(
          /Failed to load career/,
        );
      } finally {
        testDb.run(`
          CREATE TABLE IF NOT EXISTS fixtures (
            id TEXT PRIMARY KEY,
            league_id TEXT NOT NULL,
            home_club_id TEXT NOT NULL,
            away_club_id TEXT NOT NULL,
            week INTEGER NOT NULL,
            date INTEGER NOT NULL,
            played INTEGER NOT NULL,
            home_score INTEGER,
            away_score INTEGER
          )
        `);
      }
    });
  });
});
