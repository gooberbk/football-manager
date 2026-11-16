import type {
  Club,
  League,
  Player,
  PlayerAttributes,
  Season,
} from '@club-director/shared-types';
import { useGameState } from '../store/useGameState';
import {
  renewContract,
  MAX_CONTRACT_RENEWAL_WAGE,
} from './contractService';
import * as db from '../db';

// saveState() reaches saveCareer through '../db' (expo-sqlite) — mock it
// like the other service tests do.
jest.mock('../db', () => ({
  initializeDatabase: jest.fn().mockResolvedValue(undefined),
  saveCareer: jest.fn().mockResolvedValue(undefined),
  loadCareer: jest.fn(),
  deleteCareer: jest.fn(),
}));

const mockSaveCareer = db.saveCareer as jest.Mock;

const SEASON_DATE = new Date('2031-06-15T00:00:00Z'); // far from real time
const MONTH_MS = 30 * 24 * 60 * 60 * 1000;
// ability 120 -> demand floor 120_000; wage 10_000 -> demand = 120_000.
const DEMAND = 120_000;

function baseAttributes(value = 12): PlayerAttributes {
  return {
    technical: {
      passing: value, shooting: value, dribbling: value, tackling: value,
      heading: value, crossing: value, finishing: value, technique: value,
      longShots: value, freeKicks: value, firstTouch: value,
    },
    mental: {
      vision: value, decisions: value, composure: value, anticipation: value,
      positioning: value, workRate: value, determination: value,
      leadership: value, concentration: value, flair: value,
    },
    physical: {
      pace: value, acceleration: value, stamina: value, strength: value,
      agility: value, balance: value, jumping: value, naturalFitness: value,
    },
  };
}

function makePlayer(overrides: Partial<Player> & { id: string }): Player {
  const { contract, ...rest } = overrides;
  return {
    firstName: 'Test',
    lastName: overrides.id,
    nationality: 'Testland',
    age: 25,
    preferredFoot: 'right',
    primaryPosition: 'CM',
    secondaryPositions: [],
    attributes: baseAttributes(),
    development: {
      currentAbility: 120,
      potentialAbility: 180,
      ageGrowthCurve: 'normal',
    },
    status: {
      morale: 75,
      recentForm: [7, 7, 7, 7, 7],
      fitness: 90,
      injury: null,
    },
    ...rest,
    // 6 months after the GAME date — inside the renewal window.
    contract: contract ?? {
      clubId: 'club-1',
      wage: 10_000,
      contractExpiryDate: new Date(SEASON_DATE.getTime() + 6 * MONTH_MS),
      marketValue: 1_000_000,
    },
  };
}

function makeClub(id: string, squad: string[]): Club {
  return {
    id,
    name: id,
    nickname: id,
    foundedYear: 2000,
    reputation: 70,
    finances: {
      balance: 1_000_000,
      transferBudget: 1_000_000,
      wageBudget: 500_000,
      weeklyIncome: 100_000,
      debt: 0,
    },
    squad,
    stadium: { name: 'Stadium', capacity: 30_000 },
    tactics: {
      defaultFormation: '4-4-2',
      mentality: 'balanced',
      pressingIntensity: 10,
      tempo: 10,
      width: 10,
    },
  };
}

function makeLeague(clubIds: string[]): League {
  return {
    id: 'league-1',
    name: 'Test League',
    tier: 1,
    clubIds,
    standings: { entries: [] },
    fixtures: [],
  };
}

function makeSeason(currentDate: Date = SEASON_DATE): Season {
  return {
    id: 'season-1',
    leagueId: 'league-1',
    currentWeek: 10,
    currentDate,
    transferWindowOpen: true,
    fixturesCalendar: [],
  };
}

interface CareerFixture {
  players: Player[];
  clubs: Club[];
  season?: Season | null;
  managedClubId?: string | null;
}

function populateStore(fixture: CareerFixture) {
  const store = useGameState.getState();
  store.reset();
  const clubs = fixture.clubs;
  useGameState.setState({
    league: makeLeague(clubs.map((c) => c.id)),
    season: fixture.season === undefined ? makeSeason() : fixture.season,
    clubs,
    players: fixture.players,
    managedClubId:
      fixture.managedClubId === undefined ? 'club-1' : fixture.managedClubId,
    isLoading: false,
    bootStatus: 'loaded',
  });
  return useGameState.getState();
}

beforeEach(() => {
  mockSaveCareer.mockClear();
  mockSaveCareer.mockResolvedValue(undefined);
});

describe('renewContract', () => {
  it('renews a contract inside the window and persists via saveState', async () => {
    const target = makePlayer({ id: 'p1' });
    const other = makePlayer({ id: 'p2' });
    const club = makeClub('club-1', ['p1', 'p2']);
    const clubsBefore = [club];
    populateStore({ players: [target, other], clubs: clubsBefore });

    const result = await renewContract('p1', DEMAND, 2);

    expect(result.status).toBe('renewed');
    if (result.status !== 'renewed') return;
    expect(result.wageDemand).toBe(DEMAND);

    const store = useGameState.getState();
    const renewed = store.players.find((p) => p.id === 'p1')!;
    expect(renewed.contract.wage).toBe(DEMAND);
    // New expiry = old expiry + 2 years (game clock, not wall clock).
    const expected = new Date(target.contract.contractExpiryDate);
    expected.setFullYear(expected.getFullYear() + 2);
    expect(renewed.contract.contractExpiryDate.getTime())
      .toBe(expected.getTime());

    // Only the target player was replaced; the other keeps its reference.
    expect(store.players.find((p) => p.id === 'p2')).toBe(other);
    // Clubs are untouched — same array, same wageBudget.
    expect(store.clubs).toBe(clubsBefore);
    expect(store.clubs[0].finances.wageBudget).toBe(500_000);

    // Standard autosave path ran.
    expect(mockSaveCareer).toHaveBeenCalledTimes(1);
  });

  it('rejects a wage below the demand without touching the store', async () => {
    const target = makePlayer({ id: 'p1' });
    populateStore({ players: [target], clubs: [makeClub('club-1', ['p1'])] });
    const playersBefore = useGameState.getState().players;

    const result = await renewContract('p1', DEMAND - 1, 1);

    expect(result).toEqual({
      status: 'rejected',
      reason: 'wage_below_demand',
      wageDemand: DEMAND,
    });
    expect(useGameState.getState().players).toBe(playersBefore);
    expect(mockSaveCareer).not.toHaveBeenCalled();
  });

  it('rejects an unknown player id', async () => {
    populateStore({
      players: [makePlayer({ id: 'p1' })],
      clubs: [makeClub('club-1', ['p1'])],
    });
    const result = await renewContract('ghost', DEMAND, 1);
    expect(result.status).toBe('rejected');
    if (result.status === 'rejected') {
      expect(result.reason).toBe('player_not_found');
    }
    expect(mockSaveCareer).not.toHaveBeenCalled();
  });

  it('rejects when the managed club is missing', async () => {
    populateStore({
      players: [makePlayer({ id: 'p1' })],
      clubs: [makeClub('club-1', ['p1'])],
      managedClubId: null,
    });
    const result = await renewContract('p1', DEMAND, 1);
    expect(result.status).toBe('rejected');
    if (result.status === 'rejected') {
      expect(result.reason).toBe('managed_club_not_found');
    }
  });

  it('rejects a free agent', async () => {
    const freeAgent = makePlayer({
      id: 'fa',
      contract: {
        clubId: null,
        wage: 10_000,
        contractExpiryDate: new Date(SEASON_DATE.getTime() + 6 * MONTH_MS),
        marketValue: 500_000,
      },
    });
    populateStore({
      players: [freeAgent],
      clubs: [makeClub('club-1', [])],
    });
    const result = await renewContract('fa', DEMAND, 1);
    expect(result.status).toBe('rejected');
    if (result.status === 'rejected') {
      expect(result.reason).toBe('free_agent');
    }
  });

  it('rejects a contract outside the renewal window', async () => {
    const far = makePlayer({
      id: 'p1',
      contract: {
        clubId: 'club-1',
        wage: 10_000,
        contractExpiryDate: new Date(SEASON_DATE.getTime() + 18 * MONTH_MS),
        marketValue: 1_000_000,
      },
    });
    populateStore({ players: [far], clubs: [makeClub('club-1', ['p1'])] });
    const result = await renewContract('p1', DEMAND, 1);
    expect(result.status).toBe('rejected');
    if (result.status === 'rejected') {
      expect(result.reason).toBe('outside_renewal_window');
      // The demand is still reported when computable.
      expect(result.wageDemand).toBe(DEMAND);
    }
  });

  it.each([0, 4, 1.5, NaN])('rejects invalid duration %s', async (years) => {
    populateStore({
      players: [makePlayer({ id: 'p1' })],
      clubs: [makeClub('club-1', ['p1'])],
    });
    const result = await renewContract('p1', DEMAND, years);
    expect(result.status).toBe('rejected');
    if (result.status === 'rejected') {
      expect(result.reason).toBe('invalid_duration');
    }
  });

  it.each([0, -5, 1.5, NaN, MAX_CONTRACT_RENEWAL_WAGE + 1])(
    'rejects invalid wage %s',
    async (wage) => {
      populateStore({
        players: [makePlayer({ id: 'p1' })],
        clubs: [makeClub('club-1', ['p1'])],
      });
      const result = await renewContract('p1', wage, 1);
      expect(result.status).toBe('rejected');
      if (result.status === 'rejected') {
        expect(result.reason).toBe('invalid_wage');
      }
    },
  );

  it('rejects an empty player id', async () => {
    populateStore({
      players: [makePlayer({ id: 'p1' })],
      clubs: [makeClub('club-1', ['p1'])],
    });
    const result = await renewContract('  ', DEMAND, 1);
    expect(result.status).toBe('rejected');
    if (result.status === 'rejected') {
      expect(result.reason).toBe('invalid_player_id');
    }
  });

  it('uses season.currentDate as the game clock, never wall time', async () => {
    // The game date is 2031 — far from the real current date. A contract
    // expiring relative to THAT date must renew correctly.
    const target = makePlayer({ id: 'p1' });
    populateStore({
      players: [target],
      clubs: [makeClub('club-1', ['p1'])],
      season: makeSeason(new Date('2031-06-15T00:00:00Z')),
    });
    const result = await renewContract('p1', DEMAND, 1);
    expect(result.status).toBe('renewed');
  });

  it('rejects when the season date is unavailable', async () => {
    populateStore({
      players: [makePlayer({ id: 'p1' })],
      clubs: [makeClub('club-1', ['p1'])],
      season: null,
    });
    const result = await renewContract('p1', DEMAND, 1);
    expect(result.status).toBe('rejected');
    if (result.status === 'rejected') {
      expect(result.reason).toBe('season_unavailable');
    }
  });

  it('rejects corrupt contract data instead of throwing', async () => {
    const corrupt = makePlayer({ id: 'p1' });
    corrupt.contract = { ...corrupt.contract, wage: NaN };
    populateStore({ players: [corrupt], clubs: [makeClub('club-1', ['p1'])] });
    const result = await renewContract('p1', DEMAND, 1);
    expect(result.status).toBe('rejected');
    if (result.status === 'rejected') {
      expect(result.reason).toBe('contract_data_invalid');
    }
  });

  it('still reports renewed when the autosave itself fails', async () => {
    // saveState() catches persistence errors internally — the renewal
    // is applied to the store and the failure is only logged. This is
    // the same durability guarantee every other mutation has.
    mockSaveCareer.mockRejectedValueOnce(new Error('disk full'));
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    populateStore({
      players: [makePlayer({ id: 'p1' })],
      clubs: [makeClub('club-1', ['p1'])],
    });

    const result = await renewContract('p1', DEMAND, 1);

    expect(result.status).toBe('renewed');
    expect(useGameState.getState().players[0].contract.wage).toBe(DEMAND);
    spy.mockRestore();
  });
});
