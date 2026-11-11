import { generateSeedData } from '@club-director/engine';
import { generateFixtures } from '@club-director/engine';
import type {
  Club,
  Player,
  League,
  Season,
  TransferRecord,
  StandingEntry,
} from '@club-director/shared-types';
import { saveCareer, loadCareer, deleteCareer } from './careerPersistence';
import { getTestDatabase, resetTestDatabase } from './testDatabase';

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
});
