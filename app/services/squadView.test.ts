import {
  buildSquadView,
  filterSquadPlayers,
  getManagedSquadPlayers,
  isPlayerAvailable,
  isPlayerInjured,
  sortSquadPlayers,
  squadSummary,
  DEFAULT_SQUAD_FILTERS,
} from './squadView';
import type { Club, Player, PlayerAttributes } from '@club-director/shared-types';

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

interface PlayerOverrides {
  id: string;
  position?: Player['primaryPosition'];
  age?: number;
  ability?: number;
  morale?: number;
  fitness?: number;
  injury?: Player['status']['injury'];
  clubId?: string;
}

function makePlayer(o: PlayerOverrides): Player {
  return {
    id: o.id,
    firstName: o.id,
    lastName: 'Test',
    nationality: 'Testland',
    age: o.age ?? 25,
    preferredFoot: 'right',
    primaryPosition: o.position ?? 'CM',
    secondaryPositions: [],
    attributes: baseAttributes(),
    development: {
      currentAbility: o.ability ?? 120,
      potentialAbility: 180,
      ageGrowthCurve: 'normal',
    },
    status: {
      morale: o.morale ?? 70,
      recentForm: [7, 7, 7, 7, 7],
      fitness: o.fitness ?? 90,
      injury: o.injury ?? null,
    },
    contract: {
      clubId: o.clubId ?? 'managed',
      wage: 10000,
      contractExpiryDate: new Date('2030-01-01'),
      marketValue: 1000000,
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
      balance: 0, transferBudget: 0, wageBudget: 0, weeklyIncome: 0, debt: 0,
    },
    squad,
    stadium: { name: 'S', capacity: 1000 },
    tactics: {
      defaultFormation: '4-4-2',
      mentality: 'balanced',
      pressingIntensity: 10,
      tempo: 10,
      width: 10,
    },
  };
}

const INJURY = { type: 'Knee', daysRemaining: 10, severity: 'moderate' as const };

describe('squadView — membership', () => {
  it('returns only players of the managed club via club.squad', () => {
    const players = [
      makePlayer({ id: 'a', clubId: 'managed' }),
      makePlayer({ id: 'b', clubId: 'other' }),
      makePlayer({ id: 'c', clubId: 'managed' }),
    ];
    const clubs = [makeClub('managed', ['a', 'c']), makeClub('other', ['b'])];
    const squad = getManagedSquadPlayers(clubs, players, 'managed');
    expect(squad.map((p) => p.id)).toEqual(['a', 'c']);
  });

  it('uses club.squad order, not contract.clubId', () => {
    // contract.clubId disagrees with squad membership: squad wins.
    const players = [
      makePlayer({ id: 'a', clubId: 'other' }),
      makePlayer({ id: 'b', clubId: 'managed' }),
    ];
    const clubs = [makeClub('managed', ['b', 'a']), makeClub('other', [])];
    const squad = getManagedSquadPlayers(clubs, players, 'managed');
    expect(squad.map((p) => p.id)).toEqual(['b', 'a']);
  });

  it('returns empty for missing managedClubId or unknown club', () => {
    const players = [makePlayer({ id: 'a' })];
    const clubs = [makeClub('managed', ['a'])];
    expect(getManagedSquadPlayers(clubs, players, null)).toEqual([]);
    expect(getManagedSquadPlayers(clubs, players, 'nope')).toEqual([]);
    expect(getManagedSquadPlayers([], players, 'managed')).toEqual([]);
  });

  it('skips squad ids with no matching player', () => {
    const players = [makePlayer({ id: 'a' })];
    const clubs = [makeClub('managed', ['a', 'ghost'])];
    expect(getManagedSquadPlayers(clubs, players, 'managed').map((p) => p.id)).toEqual(['a']);
  });
});

describe('squadView — availability and summary', () => {
  it('marks injured players unavailable, healed/null available', () => {
    const hurt = makePlayer({ id: 'h', injury: INJURY });
    const healed = makePlayer({
      id: 'x',
      injury: { type: 'Knee', daysRemaining: 0, severity: 'minor' },
    });
    const fit = makePlayer({ id: 'f' });
    expect(isPlayerInjured(hurt)).toBe(true);
    expect(isPlayerAvailable(hurt)).toBe(false);
    expect(isPlayerAvailable(healed)).toBe(true); // daysRemaining 0 → healed
    expect(isPlayerAvailable(fit)).toBe(true);
  });

  it('summarizes total/injured/available', () => {
    const players = [
      makePlayer({ id: 'a' }),
      makePlayer({ id: 'b', injury: INJURY }),
      makePlayer({ id: 'c' }),
    ];
    expect(squadSummary(players)).toEqual({ total: 3, injured: 1, available: 2 });
  });
});

describe('squadView — filters', () => {
  const players = [
    makePlayer({ id: 'gk', position: 'GK' }),
    makePlayer({ id: 'cb', position: 'CB' }),
    makePlayer({ id: 'cm', position: 'CM' }),
    makePlayer({ id: 'st', position: 'ST' }),
    makePlayer({ id: 'hurt-st', position: 'ST', injury: INJURY }),
  ];

  it('filters by primary position', () => {
    const out = filterSquadPlayers(players, { position: 'ST', availableOnly: false });
    expect(out.map((p) => p.id)).toEqual(['st', 'hurt-st']);
  });

  it('filters available only', () => {
    const out = filterSquadPlayers(players, { position: 'all', availableOnly: true });
    expect(out.map((p) => p.id)).toEqual(['gk', 'cb', 'cm', 'st']);
  });

  it('combines position + availability', () => {
    const out = filterSquadPlayers(players, { position: 'ST', availableOnly: true });
    expect(out.map((p) => p.id)).toEqual(['st']);
  });

  it('returns all with default filters', () => {
    expect(filterSquadPlayers(players, DEFAULT_SQUAD_FILTERS)).toHaveLength(5);
  });
});

describe('squadView — sorting', () => {
  const players = [
    makePlayer({ id: 'p1', ability: 100, age: 30, morale: 50, fitness: 60 }),
    makePlayer({ id: 'p2', ability: 150, age: 20, morale: 90, fitness: 95 }),
    makePlayer({ id: 'p3', ability: 150, age: 22, morale: 90, fitness: 95 }),
    makePlayer({ id: 'p4', ability: 120, age: 18, morale: 70, fitness: 80 }),
  ];

  it('sorts by ability descending', () => {
    expect(sortSquadPlayers(players, 'ability').map((p) => p.id)).toEqual(['p2', 'p3', 'p4', 'p1']);
  });

  it('sorts by age ascending', () => {
    expect(sortSquadPlayers(players, 'age').map((p) => p.id)).toEqual(['p4', 'p2', 'p3', 'p1']);
  });

  it('sorts by morale descending', () => {
    expect(sortSquadPlayers(players, 'morale').map((p) => p.id)).toEqual(['p2', 'p3', 'p4', 'p1']);
  });

  it('sorts by fitness descending', () => {
    expect(sortSquadPlayers(players, 'fitness').map((p) => p.id)).toEqual(['p2', 'p3', 'p4', 'p1']);
  });

  it('breaks ties deterministically by id regardless of input order', () => {
    const shuffled = [players[2], players[0], players[3], players[1]];
    expect(sortSquadPlayers(shuffled, 'ability').map((p) => p.id)).toEqual(
      sortSquadPlayers(players, 'ability').map((p) => p.id),
    );
  });
});

describe('squadView — pipeline and purity', () => {
  it('buildSquadView applies membership + filters + sort', () => {
    const players = [
      makePlayer({ id: 'a', position: 'ST', ability: 100, clubId: 'managed' }),
      makePlayer({ id: 'b', position: 'ST', ability: 140, clubId: 'managed' }),
      makePlayer({ id: 'c', position: 'CM', ability: 160, clubId: 'managed' }),
      makePlayer({ id: 'x', position: 'ST', ability: 200, clubId: 'other' }),
    ];
    const clubs = [makeClub('managed', ['a', 'b', 'c']), makeClub('other', ['x'])];
    const view = buildSquadView(clubs, players, 'managed',
      { position: 'ST', availableOnly: false }, 'ability');
    expect(view.map((p) => p.id)).toEqual(['b', 'a']); // x excluded (other club)
  });

  it('does not mutate inputs', () => {
    const players = [makePlayer({ id: 'a' }), makePlayer({ id: 'b' })];
    const clubs = [makeClub('managed', ['a', 'b'])];
    const snapshot = JSON.stringify(players);
    buildSquadView(clubs, players, 'managed', DEFAULT_SQUAD_FILTERS, 'ability');
    expect(JSON.stringify(players)).toBe(snapshot);
    expect(clubs[0].squad).toEqual(['a', 'b']);
  });
});
