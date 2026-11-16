import {
  assignSeasonObjectives,
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
  SeasonObjective,
  TransferRecord,
} from '@club-director/shared-types';
import type { CareerState } from '../db/careerPersistence';
import type { PersistedMatch } from '../db/matchRecords';
import { ensureSeasonObjectives } from './seasonObjectiveInit';

const SEASON_START = new Date('2024-08-01T00:00:00Z');

interface CareerOverrides {
  seasonObjectives?: SeasonObjective[];
  transferHistory?: TransferRecord[];
  matches?: PersistedMatch[];
  currentWeek?: number;
  playedFixture?: boolean;
  clubs?: Club[];
  players?: Player[];
}

function buildCareer(overrides: CareerOverrides = {}): CareerState {
  const seedData = generateSeedData(1);
  const clubs = overrides.clubs ?? seedData.clubs;
  const players =
    overrides.players ??
    seedData.players.filter((p) =>
      clubs.some((c) => c.squad.includes(p.id)),
    );
  const fixtures: Fixture[] = scheduledFixturesToLeagueFixtures(
    generateFixtures(clubs.map((c) => c.id), SEASON_START),
  ).map((f, i) =>
    overrides.playedFixture && i === 0
      ? { ...f, played: true, homeScore: 1, awayScore: 0 }
      : f,
  );
  const league: League = {
    id: 'league-1',
    name: 'Test League',
    tier: 1,
    clubIds: clubs.map((c) => c.id),
    standings: { entries: [] },
    fixtures,
  };
  const season: Season = {
    id: 'season-1',
    leagueId: 'league-1',
    currentWeek: overrides.currentWeek ?? 1,
    currentDate: SEASON_START,
    transferWindowOpen: true,
    fixturesCalendar: [],
  };
  return {
    career: {
      id: 'active',
      managerName: 'Test Manager',
      managedClubId: clubs[0].id,
      createdAt: SEASON_START,
      lastPlayedAt: SEASON_START,
      schemaVersion: 1,
    },
    clubs,
    players,
    league,
    season,
    transferHistory: overrides.transferHistory ?? [],
    transferOffers: [],
    matches: overrides.matches ?? [],
    seasonObjectives: overrides.seasonObjectives ?? [],
  };
}

function validObjectives(state: CareerState): SeasonObjective[] {
  return assignSeasonObjectives({
    seasonId: state.season.id,
    clubs: state.clubs,
    players: state.players,
    seasonWeeks: 30,
  });
}

const historicalObjective = (clubId: string): SeasonObjective => ({
  seasonId: 'season-0',
  clubId,
  targetPosition: 8,
  rewardAmount: 1_000_000,
  ambition: 'mid_table',
  objectiveMet: true,
  rewardPaid: 1_000_000,
  debtRemaining: 0,
  settledAt: new Date('2024-06-01T00:00:00Z'),
  sanction: 'none',
});

const transferRecord = (): TransferRecord => ({
  id: 'transfer-1',
  playerId: 'p-x',
  fromClubId: 'club-a',
  toClubId: 'club-b',
  fee: 100_000,
  date: new Date('2024-08-05T00:00:00Z'),
});

describe('ensureSeasonObjectives', () => {
  it('recovers a provably untouched season with no objectives at all', () => {
    const state = buildCareer();
    const result = ensureSeasonObjectives(state);

    expect(result.action).toBe('recovered');
    expect(result.state.seasonObjectives).toHaveLength(16);
    expect(
      result.state.seasonObjectives.every(
        (o) => o.seasonId === 'season-1' && o.objectiveMet === null,
      ),
    ).toBe(true);
    // Generation is exactly the engine output on the same inputs.
    expect(result.state.seasonObjectives).toEqual(validObjectives(state));
  });

  it('recovers case E: history-only collection preserved exactly', () => {
    const base = buildCareer();
    const history = base.clubs.slice(0, 4).map((c) => historicalObjective(c.id));
    const state = buildCareer({ seasonObjectives: history });

    const result = ensureSeasonObjectives(state);

    expect(result.action).toBe('recovered');
    expect(result.state.seasonObjectives).toHaveLength(20);
    // Historical rows preserved verbatim, current ones appended.
    expect(result.state.seasonObjectives.slice(0, 4)).toEqual(history);
    expect(
      result.state.seasonObjectives.slice(4).every(
        (o) => o.seasonId === 'season-1',
      ),
    ).toBe(true);
  });

  it('blocks recovery when transferHistory contains any entry', () => {
    for (const history of [
      [transferRecord()],
    ]) {
      const result = ensureSeasonObjectives(
        buildCareer({ transferHistory: history }),
      );
      expect(result.action).toBe('blocked');
      expect(result.state.seasonObjectives).toEqual([]);
    }
  });

  it('blocks recovery for a history-only collection with transfers', () => {
    const base = buildCareer();
    const history = [historicalObjective(base.clubs[0].id)];
    const result = ensureSeasonObjectives(
      buildCareer({
        seasonObjectives: history,
        transferHistory: [transferRecord()],
      }),
    );
    expect(result.action).toBe('blocked');
    expect(result.state.seasonObjectives).toEqual(history);
  });

  it('blocks recovery once the season has advanced past week 1', () => {
    const result = ensureSeasonObjectives(
      buildCareer({ currentWeek: 2 }),
    );
    expect(result.action).toBe('blocked');
  });

  it('blocks recovery when a fixture is already played', () => {
    const result = ensureSeasonObjectives(
      buildCareer({ playedFixture: true }),
    );
    expect(result.action).toBe('blocked');
  });

  it('blocks recovery when a match of the current season exists', () => {
    const match = {
      seasonId: 'season-1',
    } as unknown as PersistedMatch;
    const result = ensureSeasonObjectives(
      buildCareer({ matches: [match] }),
    );
    expect(result.action).toBe('blocked');
  });

  it('recovers when only previous-season matches exist', () => {
    const oldMatch = {
      seasonId: 'season-0',
    } as unknown as PersistedMatch;
    const result = ensureSeasonObjectives(
      buildCareer({ matches: [oldMatch] }),
    );
    expect(result.action).toBe('recovered');
    expect(result.state.seasonObjectives).toHaveLength(16);
  });

  it('returns unchanged for a complete current-season collection', () => {
    const base = buildCareer();
    const objectives = validObjectives(base);
    const state = buildCareer({
      seasonObjectives: [historicalObjective('club-old'), ...objectives],
    });

    const result = ensureSeasonObjectives(state);

    expect(result.action).toBe('unchanged');
    expect(result.state.seasonObjectives).toHaveLength(17);
  });

  it('flags a partial current-season collection as corrupt', () => {
    const base = buildCareer();
    const partial = validObjectives(base).slice(0, 15);
    const result = ensureSeasonObjectives(
      buildCareer({ seasonObjectives: partial }),
    );
    expect(result.action).toBe('corrupt');
    expect(result.state.seasonObjectives).toHaveLength(15);
  });

  it('flags duplicate current-season objectives as corrupt', () => {
    const base = buildCareer();
    const objectives = validObjectives(base);
    const duplicated = [
      ...objectives,
      { ...objectives[0] },
    ];
    const result = ensureSeasonObjectives(
      buildCareer({ seasonObjectives: duplicated }),
    );
    expect(result.action).toBe('corrupt');
  });

  it('flags an objective for a foreign club as corrupt', () => {
    const base = buildCareer();
    const objectives = validObjectives(base);
    objectives[0] = { ...objectives[0], clubId: 'club-foreign' };
    const result = ensureSeasonObjectives(
      buildCareer({ seasonObjectives: objectives }),
    );
    expect(result.action).toBe('corrupt');
  });

  it('flags a settled current-season objective as corrupt', () => {
    const base = buildCareer();
    const objectives = validObjectives(base);
    objectives[0] = {
      ...objectives[0],
      objectiveMet: true,
      rewardPaid: objectives[0].rewardAmount,
      settledAt: new Date('2025-01-01T00:00:00Z'),
    };
    const result = ensureSeasonObjectives(
      buildCareer({ seasonObjectives: objectives }),
    );
    expect(result.action).toBe('corrupt');
  });

  it('never treats a missing transferHistory as empty', () => {
    const state = buildCareer();
    (state as { transferHistory?: unknown }).transferHistory = undefined;
    const result = ensureSeasonObjectives(state);
    expect(result.action).toBe('blocked');
    expect(result.state.seasonObjectives).toEqual([]);
  });

  it.each([
    ['null', null],
    ['a non-array object', {}],
    ['a non-array string', 'yes'],
  ])(
    'blocks recovery when transferHistory is %s',
    (_label, value) => {
      const state = buildCareer();
      (state as { transferHistory?: unknown }).transferHistory = value;

      const result = ensureSeasonObjectives(state);

      expect(result.action).toBe('blocked');
      // Nothing generated, nothing repaired: the collection is untouched.
      expect(result.state.seasonObjectives).toEqual([]);
    },
  );

  it.each([
    ['null', null],
    ['a non-array object', {}],
    ['a non-array string', 'yes'],
  ])(
    'flags corrupt when seasonObjectives is %s',
    (_label, value) => {
      const state = buildCareer();
      (state as { seasonObjectives?: unknown }).seasonObjectives = value;

      const result = ensureSeasonObjectives(state);

      expect(result.action).toBe('corrupt');
      // Malformed input is returned verbatim — never repaired or masked.
      expect(result.state.seasonObjectives).toBe(value);
    },
  );

  it('flags corrupt when 16 current objectives hide a duplicate and a missing club', () => {
    const base = buildCareer();
    const objectives = validObjectives(base);
    // Exactly 16 rows, but club A now has two objectives and club B none.
    objectives[1] = { ...objectives[0] };

    const result = ensureSeasonObjectives(
      buildCareer({ seasonObjectives: objectives }),
    );

    expect(result.action).toBe('corrupt');
    expect(result.state.seasonObjectives).toHaveLength(16);
    expect(result.state.seasonObjectives[1].clubId).toBe(
      objectives[0].clubId,
    );
  });

  it('propagates generator errors on invalid career data', () => {
    const state = buildCareer({ players: [] });
    expect(() => ensureSeasonObjectives(state)).toThrow(
      /assignSeasonObjectives/,
    );
  });

  it('never mutates the input state or its collections', () => {
    const history = [historicalObjective('club-x')];
    const state = buildCareer({ seasonObjectives: history });
    const snapshot = structuredClone(state);

    const result = ensureSeasonObjectives(state);

    expect(state).toEqual(snapshot);
    expect(result.state).not.toBe(state);
    expect(result.state.seasonObjectives).not.toBe(
      state.seasonObjectives,
    );
  });

  it('leaves clubs, players and finances untouched by recovery', () => {
    const state = buildCareer();
    const financesBefore = state.clubs.map((c) => ({ ...c.finances }));

    const result = ensureSeasonObjectives(state);

    expect(result.state.clubs).toBe(state.clubs);
    expect(result.state.players).toBe(state.players);
    result.state.clubs.forEach((club, i) => {
      expect(club.finances).toEqual(financesBefore[i]);
    });
  });
});
