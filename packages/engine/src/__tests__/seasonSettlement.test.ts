import { settleSeasonObjectives } from '../season/settlement';
import { generateSeedData } from '../seed/generateSeedData';
import type {
  Club,
  League,
  SeasonObjective,
  StandingEntry,
} from '@club-director/shared-types';

const SEASON_ID = 'season-1';
const SETTLED_AT = new Date('2025-06-01T00:00:00Z');
const MANAGED = 'club-0';

const base = generateSeedData(1);
const TEMPLATE_CLUB = base.clubs[0];
const TEMPLATE_PLAYER_SQUAD = TEMPLATE_CLUB.squad;

function makeClub(
  id: string,
  finances: Partial<Club['finances']> = {},
): Club {
  return {
    ...TEMPLATE_CLUB,
    id,
    name: `Club ${id}`,
    squad: [...TEMPLATE_PLAYER_SQUAD],
    finances: {
      balance: 10_000_000,
      transferBudget: 5_000_000,
      wageBudget: 500_000,
      weeklyIncome: 1_000_000,
      debt: 0,
      ...finances,
    },
  };
}

function makeObjective(
  clubId: string,
  overrides: Partial<SeasonObjective> = {},
): SeasonObjective {
  return {
    seasonId: SEASON_ID,
    clubId,
    targetPosition: 2,
    rewardAmount: 10_000_000,
    ambition: 'upper_table',
    objectiveMet: null,
    rewardPaid: 0,
    debtRemaining: null,
    settledAt: null,
    sanction: 'none',
    ...overrides,
  };
}

function makeEntry(clubId: string): StandingEntry {
  return {
    clubId,
    played: 6,
    won: 3,
    drawn: 1,
    lost: 2,
    goalsFor: 10,
    goalsAgainst: 8,
    goalDifference: 2,
    points: 10,
  };
}

interface World {
  league: League;
  clubs: Club[];
  objectives: SeasonObjective[];
}

/** 4-club league; standings order = clubs[0..3] finishing 1st..4th. */
function world(opts: {
  clubIds?: string[];
  entryOrder?: string[];
  finances?: Record<string, Partial<Club['finances']>>;
  objectives?: SeasonObjective[];
} = {}): World {
  const clubIds = opts.clubIds ?? ['club-0', 'club-1', 'club-2', 'club-3'];
  const entryOrder = opts.entryOrder ?? [...clubIds];
  const clubs = clubIds.map((id) =>
    makeClub(id, opts.finances?.[id] ?? {}),
  );
  const objectives =
    opts.objectives ??
    clubIds.map((id) => makeObjective(id));
  const league: League = {
    id: 'league-1',
    name: 'Test League',
    tier: 1,
    clubIds,
    standings: { entries: entryOrder.map(makeEntry) },
    fixtures: [],
  };
  return { league, clubs, objectives };
}

function settle(w: World, overrides: Record<string, unknown> = {}) {
  return settleSeasonObjectives({
    seasonId: SEASON_ID,
    league: w.league,
    clubs: w.clubs,
    objectives: w.objectives,
    managedClubId: MANAGED,
    settledAt: SETTLED_AT,
    ...overrides,
  });
}

function clubById(clubs: Club[], id: string): Club {
  return clubs.find((c) => c.id === id)!;
}
function objectiveById(objectives: SeasonObjective[], id: string): SeasonObjective {
  return objectives.find((o) => o.clubId === id)!;
}

describe('settleSeasonObjectives', () => {
  // ---- financial cases ----

  it('objective met with zero debt: full reward credits balance', () => {
    const w = world({
      entryOrder: ['club-0', 'club-1', 'club-2', 'club-3'],
      objectives: [
        makeObjective('club-0', { targetPosition: 1, rewardAmount: 8_000_000 }),
        ...['club-1', 'club-2', 'club-3'].map((id) =>
          makeObjective(id, { targetPosition: 4 }),
        ),
      ],
    });
    const result = settle(w);
    const c0 = clubById(result.clubs, 'club-0');
    expect(c0.finances.balance).toBe(18_000_000);
    expect(c0.finances.debt).toBe(0);
    expect(c0.finances.transferBudget).toBe(5_000_000);
    const o0 = objectiveById(result.objectives, 'club-0');
    expect(o0.objectiveMet).toBe(true);
    expect(o0.rewardPaid).toBe(8_000_000);
    expect(o0.debtRemaining).toBe(0);
    expect(o0.settledAt).toEqual(SETTLED_AT);
    expect(o0.sanction).toBe('none');
  });

  it('objective met with debt below reward: debt cleared, remainder to balance', () => {
    const w = world({
      entryOrder: ['club-0', 'club-1', 'club-2', 'club-3'],
      finances: { 'club-0': { debt: 3_000_000 } },
      objectives: [
        makeObjective('club-0', { targetPosition: 1, rewardAmount: 8_000_000 }),
        ...['club-1', 'club-2', 'club-3'].map((id) =>
          makeObjective(id, { targetPosition: 4 }),
        ),
      ],
    });
    const result = settle(w);
    const c0 = clubById(result.clubs, 'club-0');
    expect(c0.finances.debt).toBe(0);
    expect(c0.finances.balance).toBe(15_000_000); // 10M + (8M - 3M)
    expect(objectiveById(result.objectives, 'club-0').debtRemaining).toBe(0);
  });

  it('objective met with debt exactly equal to reward', () => {
    const w = world({
      entryOrder: ['club-0', 'club-1', 'club-2', 'club-3'],
      finances: { 'club-0': { debt: 8_000_000 } },
      objectives: [
        makeObjective('club-0', { targetPosition: 1, rewardAmount: 8_000_000 }),
        ...['club-1', 'club-2', 'club-3'].map((id) =>
          makeObjective(id, { targetPosition: 4 }),
        ),
      ],
    });
    const result = settle(w);
    const c0 = clubById(result.clubs, 'club-0');
    expect(c0.finances.debt).toBe(0);
    expect(c0.finances.balance).toBe(10_000_000); // no remainder
  });

  it('objective met with debt above reward: residual debt stays, managed club sanctioned', () => {
    const w = world({
      entryOrder: ['club-0', 'club-1', 'club-2', 'club-3'],
      finances: { 'club-0': { debt: 12_000_000 } },
      objectives: [
        makeObjective('club-0', { targetPosition: 1, rewardAmount: 8_000_000 }),
        ...['club-1', 'club-2', 'club-3'].map((id) =>
          makeObjective(id, { targetPosition: 4 }),
        ),
      ],
    });
    const result = settle(w);
    const c0 = clubById(result.clubs, 'club-0');
    expect(c0.finances.debt).toBe(4_000_000);
    expect(c0.finances.balance).toBe(10_000_000); // reward fully absorbed by debt
    const o0 = objectiveById(result.objectives, 'club-0');
    expect(o0.rewardPaid).toBe(8_000_000);
    expect(o0.debtRemaining).toBe(4_000_000);
    // club-0 IS the managed club → deferred sanction recorded.
    expect(o0.sanction).toBe('dismissal_relegation_pending');
  });

  it('objective met with residual debt on an AI club: no sanction', () => {
    // club-1 finishes 2nd; targetPosition 2 → met. debt 12M > reward 8M.
    const w = world({
      entryOrder: ['club-0', 'club-1', 'club-2', 'club-3'],
      finances: { 'club-1': { debt: 12_000_000 } },
      objectives: [
        makeObjective('club-0', { targetPosition: 4 }),
        makeObjective('club-1', { targetPosition: 2, rewardAmount: 8_000_000 }),
        ...['club-2', 'club-3'].map((id) =>
          makeObjective(id, { targetPosition: 4 }),
        ),
      ],
    });
    const result = settle(w, { managedClubId: 'club-0' });
    const o1 = objectiveById(result.objectives, 'club-1');
    expect(o1.objectiveMet).toBe(true);
    expect(o1.debtRemaining).toBe(4_000_000);
    expect(o1.sanction).toBe('none'); // AI club: sanction never applies
  });

  it('objective unmet with debt: nothing paid, debt and sanction handled', () => {
    // club-3 finishes 4th with targetPosition 2 → unmet; it is managed.
    const w = world({
      entryOrder: ['club-0', 'club-1', 'club-2', 'club-3'],
      finances: { 'club-3': { debt: 5_000_000 } },
      objectives: [
        ...['club-0', 'club-1', 'club-2'].map((id) =>
          makeObjective(id, { targetPosition: 4 }),
        ),
        makeObjective('club-3', {
          targetPosition: 2,
          rewardAmount: 8_000_000,
        }),
      ],
    });
    const result = settle(w, { managedClubId: 'club-3' });
    const c3 = clubById(result.clubs, 'club-3');
    expect(c3.finances.balance).toBe(10_000_000);
    expect(c3.finances.debt).toBe(5_000_000);
    const o3 = objectiveById(result.objectives, 'club-3');
    expect(o3.objectiveMet).toBe(false);
    expect(o3.rewardPaid).toBe(0);
    expect(o3.debtRemaining).toBe(5_000_000);
    expect(o3.sanction).toBe('dismissal_relegation_pending'); // managed + residual debt
  });

  it('objective unmet without debt: no sanction even for managed club', () => {
    const w = world({
      entryOrder: ['club-0', 'club-1', 'club-2', 'club-3'],
      objectives: [
        ...['club-0', 'club-1', 'club-2'].map((id) =>
          makeObjective(id, { targetPosition: 4 }),
        ),
        makeObjective('club-3', { targetPosition: 1, rewardAmount: 8_000_000 }),
      ],
    });
    const result = settle(w, { managedClubId: 'club-3' });
    const o3 = objectiveById(result.objectives, 'club-3');
    expect(o3.objectiveMet).toBe(false);
    expect(o3.debtRemaining).toBe(0);
    expect(o3.sanction).toBe('none');
  });

  it('transferBudget is never modified by settlement', () => {
    const w = world({
      entryOrder: ['club-0', 'club-1', 'club-2', 'club-3'],
      finances: {
        'club-0': { debt: 20_000_000, transferBudget: 7_777_777 },
      },
      objectives: [
        makeObjective('club-0', { targetPosition: 1, rewardAmount: 8_000_000 }),
        ...['club-1', 'club-2', 'club-3'].map((id) =>
          makeObjective(id, { targetPosition: 4 }),
        ),
      ],
    });
    const result = settle(w);
    for (const club of result.clubs) {
      const before = w.clubs.find((c) => c.id === club.id)!;
      expect(club.finances.transferBudget).toBe(before.finances.transferBudget);
    }
  });

  // ---- rejections ----

  it('rejects an already-settled objective', () => {
    const w = world({
      objectives: [
        makeObjective('club-0', { settledAt: SETTLED_AT, objectiveMet: true, rewardPaid: 1, debtRemaining: 0 }),
        ...['club-1', 'club-2', 'club-3'].map((id) => makeObjective(id)),
      ],
    });
    expect(() => settle(w)).toThrow(/pre-settlement/);
  });

  it('rejects a missing objective for a league club', () => {
    const w = world({
      objectives: ['club-1', 'club-2', 'club-3'].map((id) => makeObjective(id)),
    });
    expect(() => settle(w)).toThrow(/no objective/);
  });

  it('rejects duplicate objectives for the same club and season', () => {
    const w = world({
      objectives: [
        makeObjective('club-0'),
        makeObjective('club-0'),
        ...['club-1', 'club-2', 'club-3'].map((id) => makeObjective(id)),
      ],
    });
    expect(() => settle(w)).toThrow(/duplicate objective/);
  });

  it('rejects an objective for a club outside the league', () => {
    const w = world({
      objectives: [
        ...['club-0', 'club-1', 'club-2', 'club-3'].map((id) =>
          makeObjective(id),
        ),
        makeObjective('club-foreign'),
      ],
    });
    expect(() => settle(w)).toThrow(/no league club/);
  });

  it('rejects a league club missing from clubs', () => {
    const w = world();
    w.clubs = w.clubs.filter((c) => c.id !== 'club-2');
    expect(() => settle(w)).toThrow(/missing from clubs/);
  });

  it('rejects a managedClubId outside the league', () => {
    const w = world();
    expect(() => settle(w, { managedClubId: 'club-foreign' })).toThrow(
      /not in the league/,
    );
  });

  it('rejects incomplete standings (missing club entry)', () => {
    const w = world({ entryOrder: ['club-0', 'club-1', 'club-2'] });
    expect(() => settle(w)).toThrow(/do not cover every league club/);
  });

  it('rejects duplicate standings entries', () => {
    const w = world({ entryOrder: ['club-0', 'club-0', 'club-1', 'club-2'] });
    // entryOrder length 4 but club-3 missing → also incomplete; duplicate check fires first
    expect(() => settle(w)).toThrow(/duplicate standings entry/);
  });

  it('rejects standings entries for non-league clubs', () => {
    const w = world({ entryOrder: ['club-0', 'club-1', 'club-2', 'club-x'] });
    expect(() => settle(w)).toThrow(/not a league club/);
  });

  it('rejects invalid debt values', () => {
    for (const bad of [-1, NaN, Infinity]) {
      const w = world({ finances: { 'club-0': { debt: bad } } });
      expect(() => settle(w)).toThrow(/invalid debt/);
    }
  });

  it('rejects invalid balance values', () => {
    for (const bad of [NaN, Infinity, 1.5]) {
      const w = world({ finances: { 'club-0': { balance: bad } } });
      expect(() => settle(w)).toThrow(/invalid balance/);
    }
  });

  it('rejects a settlement that would overflow safe-integer balance', () => {
    const w = world({
      entryOrder: ['club-0', 'club-1', 'club-2', 'club-3'],
      finances: { 'club-0': { balance: Number.MAX_SAFE_INTEGER } },
      objectives: [
        makeObjective('club-0', { targetPosition: 1, rewardAmount: 10_000 }),
        ...['club-1', 'club-2', 'club-3'].map((id) =>
          makeObjective(id, { targetPosition: 4 }),
        ),
      ],
    });
    expect(() => settle(w)).toThrow(/unsafe financial values/);
  });

  it('rejects invalid rewardAmount values', () => {
    for (const bad of [-1, 1.5, NaN, Infinity]) {
      const w = world({
        objectives: [
          makeObjective('club-0', { rewardAmount: bad }),
          ...['club-1', 'club-2', 'club-3'].map((id) => makeObjective(id)),
        ],
      });
      expect(() => settle(w)).toThrow(/invalid rewardAmount/);
    }
  });

  it('rejects invalid targetPosition values', () => {
    for (const bad of [0, -1, 1.5, 99]) {
      const w = world({
        objectives: [
          makeObjective('club-0', { targetPosition: bad }),
          ...['club-1', 'club-2', 'club-3'].map((id) => makeObjective(id)),
        ],
      });
      expect(() => settle(w)).toThrow(/invalid targetPosition/);
    }
  });

  it('rejects an invalid settledAt date', () => {
    const w = world();
    for (const bad of [new Date('invalid'), '2025-01-01' as unknown as Date, null as unknown as Date]) {
      expect(() => settle(w, { settledAt: bad })).toThrow(/valid Date/);
    }
  });

  it('rejects invalid seasonId and managedClubId', () => {
    const w = world();
    expect(() => settle(w, { seasonId: '' })).toThrow(/seasonId/);
    expect(() => settle(w, { seasonId: 42 as unknown as string })).toThrow(/seasonId/);
    expect(() => settle(w, { managedClubId: '' })).toThrow(/managedClubId/);
  });

  it('leaves non-league clubs strictly unchanged (same reference)', () => {
    const outsider = makeClub('club-outsider', { balance: 1, debt: 2 });
    const w = world();
    w.clubs = [...w.clubs, outsider];
    const result = settle(w);
    const after = result.clubs.find((c) => c.id === 'club-outsider')!;
    expect(after).toBe(outsider); // identical reference — untouched
  });

  it('passes through objectives of other seasons unchanged', () => {
    const history: SeasonObjective = {
      ...makeObjective('club-9'),
      seasonId: 'season-0',
      settledAt: new Date('2024-06-01'),
      objectiveMet: true,
      rewardPaid: 5_000_000,
      debtRemaining: 0,
      sanction: 'none',
    };
    const w = world();
    w.objectives = [...w.objectives, history];
    const result = settle(w);
    const after = result.objectives.find((o) => o.seasonId === 'season-0')!;
    expect(after).toBe(history); // same reference
  });

  it('does not mutate its inputs', () => {
    const w = world({
      finances: { 'club-0': { debt: 3_000_000 } },
    });
    const leagueSnap = structuredClone(w.league);
    const clubsSnap = structuredClone(w.clubs);
    const objSnap = structuredClone(w.objectives);
    settle(w);
    expect(w.league).toEqual(leagueSnap);
    expect(w.clubs).toEqual(clubsSnap);
    expect(w.objectives).toEqual(objSnap);
  });

  it('is deterministic for identical inputs', () => {
    const w = world({
      finances: {
        'club-0': { debt: 3_000_000 },
        'club-2': { debt: 7_000_000 },
      },
    });
    const a = settle(w);
    const b = settle(w);
    expect(b).toEqual(a);
  });

  // ---- d3a-C additions ----

  it('objective met with rewardAmount 0 and positive debt: no balance change, sanction by rule', () => {
    // club-0 finishes 1st, target 1 → met; reward 0 → nothing repaid.
    const w = world({
      entryOrder: ['club-0', 'club-1', 'club-2', 'club-3'],
      finances: { 'club-0': { debt: 4_000_000 } },
      objectives: [
        makeObjective('club-0', { targetPosition: 1, rewardAmount: 0 }),
        ...['club-1', 'club-2', 'club-3'].map((id) =>
          makeObjective(id, { targetPosition: 4 }),
        ),
      ],
    });
    const result = settle(w); // managedClubId = club-0
    const c0 = clubById(result.clubs, 'club-0');
    expect(c0.finances.balance).toBe(10_000_000);
    expect(c0.finances.debt).toBe(4_000_000);
    const o0 = objectiveById(result.objectives, 'club-0');
    expect(o0.objectiveMet).toBe(true);
    expect(o0.rewardPaid).toBe(0);
    expect(o0.debtRemaining).toBe(4_000_000);
    // Managed club with residual debt → deferred sanction.
    expect(o0.sanction).toBe('dismissal_relegation_pending');
  });

  it('credits a negative balance exactly and stays safe-integer', () => {
    const w = world({
      entryOrder: ['club-0', 'club-1', 'club-2', 'club-3'],
      finances: { 'club-0': { balance: -2_000_000, debt: 1_000_000 } },
      objectives: [
        makeObjective('club-0', { targetPosition: 1, rewardAmount: 8_000_000 }),
        ...['club-1', 'club-2', 'club-3'].map((id) =>
          makeObjective(id, { targetPosition: 4 }),
        ),
      ],
    });
    const result = settle(w);
    const c0 = clubById(result.clubs, 'club-0');
    // debtRepaid = 1M, credit = 7M → balance = -2M + 7M = 5M
    expect(c0.finances.balance).toBe(5_000_000);
    expect(c0.finances.debt).toBe(0);
    expect(Number.isSafeInteger(c0.finances.balance)).toBe(true);
  });

  it('rejects non-array clubs with an explicit domain error', () => {
    const w = world();
    for (const bad of [null, undefined, 'clubs', 42]) {
      expect(() =>
        settleSeasonObjectives({
          seasonId: SEASON_ID,
          league: w.league,
          clubs: bad as unknown as Club[],
          objectives: w.objectives,
          managedClubId: MANAGED,
          settledAt: SETTLED_AT,
        }),
      ).toThrow(/clubs must be an array/);
    }
  });

  it('rejects rewardAmount = 2 ** 53 (not a safe integer)', () => {
    const w = world({
      objectives: [
        makeObjective('club-0', { rewardAmount: 2 ** 53 }),
        ...['club-1', 'club-2', 'club-3'].map((id) => makeObjective(id)),
      ],
    });
    expect(() => settle(w)).toThrow(/invalid rewardAmount/);
  });

  it('rejects an invalid ambition value', () => {
    const w = world({
      objectives: [
        makeObjective('club-0', {
          ambition: 'world_beater' as SeasonObjective['ambition'],
        }),
        ...['club-1', 'club-2', 'club-3'].map((id) => makeObjective(id)),
      ],
    });
    expect(() => settle(w)).toThrow(/invalid ambition/);
  });

  it('rejects duplicate ids for a non-league club in clubs', () => {
    const w = world();
    const outsider = makeClub('club-outsider');
    w.clubs = [...w.clubs, outsider, { ...outsider }];
    expect(() => settle(w)).toThrow(/duplicate club id/);
  });

  it('gives each settled objective an independent Date instance', () => {
    const w = world();
    const result = settle(w);
    const settled = result.objectives.filter((o) => o.settledAt !== null);
    expect(settled).toHaveLength(4);

    // Same timestamp everywhere.
    for (const o of settled) {
      expect(o.settledAt!.getTime()).toBe(SETTLED_AT.getTime());
    }
    // Distinct instances.
    const instances = new Set(settled.map((o) => o.settledAt));
    expect(instances.size).toBe(4);
    // None aliases the input Date.
    for (const o of settled) {
      expect(o.settledAt).not.toBe(SETTLED_AT);
    }
    // Mutating one result date affects neither siblings nor the input.
    settled[0].settledAt!.setTime(0);
    for (const o of settled.slice(1)) {
      expect(o.settledAt!.getTime()).toBe(SETTLED_AT.getTime());
    }
    expect(SETTLED_AT.getTime()).toBe(
      new Date('2025-06-01T00:00:00Z').getTime(),
    );
  });

  it('rejects a pure duplicate standings entry with full coverage', () => {
    // 5 entries for a 4-club league: club-0 twice, all clubs still covered
    // by other entries — isolates the duplicate check from coverage.
    const w = world();
    w.league = {
      ...w.league,
      standings: {
        entries: [
          makeEntry('club-0'),
          makeEntry('club-0'), // duplicate
          makeEntry('club-1'),
          makeEntry('club-2'),
          makeEntry('club-3'),
        ],
      },
    };
    expect(() => settle(w)).toThrow(/duplicate standings entry/);
  });

  // ---- standings order validation (canonical computeStandings order) ----

  const statEntry = (
    clubId: string,
    stats: Partial<StandingEntry>,
  ): StandingEntry => ({ ...makeEntry(clubId), ...stats });

  const leagueWithEntries = (entries: StandingEntry[]): League => ({
    id: 'league-1',
    name: 'Test League',
    tier: 1,
    clubIds: ['club-0', 'club-1', 'club-2', 'club-3'],
    standings: { entries },
    fixtures: [],
  });

  it('accepts standings in canonical order (descending points)', () => {
    const w = world();
    w.league = leagueWithEntries([
      statEntry('club-0', { points: 15, goalDifference: 5, goalsFor: 20 }),
      statEntry('club-1', { points: 12, goalDifference: 3, goalsFor: 15 }),
      statEntry('club-2', { points: 9, goalDifference: 0, goalsFor: 10 }),
      statEntry('club-3', { points: 6, goalDifference: -8, goalsFor: 5 }),
    ]);
    const result = settle(w);
    // Positions follow the entries order: club-0 1st (met, target 2),
    // club-1 2nd (met), club-2/club-3 unmet.
    expect(objectiveById(result.objectives, 'club-0').objectiveMet).toBe(true);
    expect(objectiveById(result.objectives, 'club-1').objectiveMet).toBe(true);
    expect(objectiveById(result.objectives, 'club-3').objectiveMet).toBe(false);
  });

  it('rejects a reversed standings order before any settlement', () => {
    const w = world();
    w.league = leagueWithEntries([
      statEntry('club-3', { points: 6, goalDifference: -8, goalsFor: 5 }),
      statEntry('club-2', { points: 9, goalDifference: 0, goalsFor: 10 }),
      statEntry('club-1', { points: 12, goalDifference: 3, goalsFor: 15 }),
      statEntry('club-0', { points: 15, goalDifference: 5, goalsFor: 20 }),
    ]);
    const clubsSnap = structuredClone(w.clubs);
    const objSnap = structuredClone(w.objectives);

    expect(() => settle(w)).toThrow(/canonical order/);
    // Validation happens before the financial loop: inputs untouched.
    expect(w.clubs).toEqual(clubsSnap);
    expect(w.objectives).toEqual(objSnap);
  });

  it('rejects goal-difference order violations at equal points', () => {
    const w = world();
    w.league = leagueWithEntries([
      // Equal points; club-1 has the better GD but is listed second.
      statEntry('club-0', { points: 10, goalDifference: 2, goalsFor: 12 }),
      statEntry('club-1', { points: 10, goalDifference: 5, goalsFor: 15 }),
      statEntry('club-2', { points: 7, goalDifference: 0, goalsFor: 9 }),
      statEntry('club-3', { points: 4, goalDifference: -7, goalsFor: 4 }),
    ]);
    expect(() => settle(w)).toThrow(/canonical order/);
  });

  it('accepts goal-difference order at equal points when correct', () => {
    const w = world();
    w.league = leagueWithEntries([
      statEntry('club-1', { points: 10, goalDifference: 5, goalsFor: 15 }),
      statEntry('club-0', { points: 10, goalDifference: 2, goalsFor: 12 }),
      statEntry('club-2', { points: 7, goalDifference: 0, goalsFor: 9 }),
      statEntry('club-3', { points: 4, goalDifference: -7, goalsFor: 4 }),
    ]);
    const result = settle(w);
    // club-1 finished 1st despite being second in clubIds.
    expect(objectiveById(result.objectives, 'club-1').objectiveMet).toBe(true);
  });

  it('rejects goals-scored order violations at equal points and GD', () => {
    const w = world();
    w.league = leagueWithEntries([
      // Equal points AND goal difference; club-1 scores more but is second.
      statEntry('club-0', { points: 10, goalDifference: 2, goalsFor: 12 }),
      statEntry('club-1', { points: 10, goalDifference: 2, goalsFor: 15 }),
      statEntry('club-2', { points: 7, goalDifference: 0, goalsFor: 9 }),
      statEntry('club-3', { points: 4, goalDifference: -4, goalsFor: 4 }),
    ]);
    expect(() => settle(w)).toThrow(/canonical order/);
  });

  it('rejects full ties that are not in league.clubIds order', () => {
    const w = world();
    // Identical stats for every club: canonical order is clubIds order.
    w.league = leagueWithEntries([
      makeEntry('club-1'),
      makeEntry('club-0'),
      makeEntry('club-2'),
      makeEntry('club-3'),
    ]);
    expect(() => settle(w)).toThrow(/canonical order/);
  });

  it('accepts full ties in league.clubIds order', () => {
    const w = world();
    // Default makeEntry stats are identical — entryOrder === clubIds order.
    const result = settle(w);
    expect(result.objectives).toHaveLength(4);
  });
});
