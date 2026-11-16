import {
  applyWeeklyMorale,
  buildMatchClubByPlayerId,
  collectClubsWithNewUnpaidWages,
  detectInjuryTransitions,
  DEFAULT_WEEKLY_MORALE_PARAMS,
  NEUTRAL_MORALE,
  type WeeklyMoraleContext,
  type WeeklyMoraleMatch,
  type WeeklyMoraleParams,
} from '../players/morale';
import type {
  Club,
  InjurySeverity,
  Player,
  PlayerAttributes,
} from '@club-director/shared-types';

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
  id?: string;
  morale?: number;
  clubId?: string;
  injury?: Player['status']['injury'];
}

function makePlayer(overrides: PlayerOverrides = {}): Player {
  return {
    id: overrides.id ?? 'player-1',
    firstName: 'Test',
    lastName: 'Player',
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
      morale: overrides.morale ?? NEUTRAL_MORALE,
      recentForm: [7, 7, 7, 7, 7],
      fitness: 90,
      injury: overrides.injury ?? null,
    },
    contract: {
      clubId: overrides.clubId ?? 'club-1',
      wage: 10000,
      contractExpiryDate: new Date('2030-01-01'),
      marketValue: 1000000,
    },
  };
}

function makeClub(id: string, squad: string[], debt = 0): Club {
  return {
    id,
    name: id,
    nickname: id,
    foundedYear: 2000,
    reputation: 70,
    finances: {
      balance: 1000000,
      transferBudget: 1000000,
      wageBudget: 1000000,
      weeklyIncome: 100000,
      debt,
    },
    squad,
    stadium: { name: 'Stadium', capacity: 30000 },
    tactics: {
      defaultFormation: '4-4-2',
      mentality: 'balanced',
      pressingIntensity: 10,
      tempo: 10,
      width: 10,
    },
  };
}

function emptyContext(overrides: Partial<WeeklyMoraleContext> = {}): WeeklyMoraleContext {
  return {
    matchClubByPlayerId: new Map(),
    matches: [],
    injuries: [],
    clubsWithUnpaidWages: new Set(),
    ...overrides,
  };
}

function match(
  homeClubId: string,
  awayClubId: string,
  homeScore: number,
  awayScore: number,
  participantIds: string[],
): WeeklyMoraleMatch {
  return { homeClubId, awayClubId, homeScore, awayScore, participantIds };
}

/** Expected morale per the spec formula, for assertion clarity. */
function expectedMorale(
  base: number,
  eventDelta: number,
  params: WeeklyMoraleParams = DEFAULT_WEEKLY_MORALE_PARAMS,
): number {
  const clampedBase = Math.max(0, Math.min(100, Number.isFinite(base) ? base : NEUTRAL_MORALE));
  const clampedDelta = Math.max(-params.eventDeltaClamp, Math.min(params.eventDeltaClamp, eventDelta));
  const reversion = params.reversionRate * (NEUTRAL_MORALE - clampedBase);
  return Math.max(0, Math.min(100, clampedBase + clampedDelta + reversion));
}

describe('applyWeeklyMorale — match results', () => {
  it('applies +4 to participants of the winning side', () => {
    const player = makePlayer({ id: 'p1', morale: NEUTRAL_MORALE });
    const ctx = emptyContext({
      matchClubByPlayerId: new Map([['p1', 'club-1']]),
      matches: [match('club-1', 'club-2', 2, 1, ['p1'])],
    });
    const [next] = applyWeeklyMorale([player], ctx);
    expect(next.status.morale).toBeCloseTo(expectedMorale(75, 4), 10);
    expect(next.status.morale).toBeCloseTo(79, 10);
  });

  it('applies -4 to participants of the losing side', () => {
    const player = makePlayer({ id: 'p1', morale: NEUTRAL_MORALE });
    const ctx = emptyContext({
      matchClubByPlayerId: new Map([['p1', 'club-2']]),
      matches: [match('club-1', 'club-2', 2, 1, ['p1'])],
    });
    const [next] = applyWeeklyMorale([player], ctx);
    expect(next.status.morale).toBeCloseTo(expectedMorale(75, -4), 10);
    expect(next.status.morale).toBeCloseTo(71, 10);
  });

  it('applies 0 event delta on a draw but keeps weekly reversion', () => {
    const player = makePlayer({ id: 'p1', morale: 80 });
    const ctx = emptyContext({
      matchClubByPlayerId: new Map([['p1', 'club-1']]),
      matches: [match('club-1', 'club-2', 1, 1, ['p1'])],
    });
    const [next] = applyWeeklyMorale([player], ctx);
    expect(next.status.morale).toBeCloseTo(expectedMorale(80, 0), 10);
    expect(next.status.morale).toBeCloseTo(79.25, 10);
  });

  it('attributes home and away results independently within one match', () => {
    const home = makePlayer({ id: 'h', morale: NEUTRAL_MORALE });
    const away = makePlayer({ id: 'a', morale: NEUTRAL_MORALE });
    const ctx = emptyContext({
      matchClubByPlayerId: new Map([
        ['h', 'club-1'],
        ['a', 'club-2'],
      ]),
      matches: [match('club-1', 'club-2', 3, 0, ['h', 'a'])],
    });
    const [hNext, aNext] = applyWeeklyMorale([home, away], ctx);
    expect(hNext.status.morale).toBeCloseTo(79, 10);
    expect(aNext.status.morale).toBeCloseTo(71, 10);
  });

  it('gives no result delta to players absent from the club snapshot', () => {
    const player = makePlayer({ id: 'p1', morale: NEUTRAL_MORALE });
    const ctx = emptyContext({
      matchClubByPlayerId: new Map(), // p1 not snapshotted
      matches: [match('club-1', 'club-2', 5, 0, ['p1'])],
    });
    const [next] = applyWeeklyMorale([player], ctx);
    expect(next.status.morale).toBe(NEUTRAL_MORALE); // reversion is 0 at 75
  });

  it('ignores a participant mapped to a third club', () => {
    const player = makePlayer({ id: 'p1', morale: NEUTRAL_MORALE });
    const ctx = emptyContext({
      matchClubByPlayerId: new Map([['p1', 'club-3']]),
      matches: [match('club-1', 'club-2', 5, 0, ['p1'])],
    });
    const [next] = applyWeeklyMorale([player], ctx);
    expect(next.status.morale).toBe(NEUTRAL_MORALE);
  });

  it('uses contract.clubId (post-transfer club) only for unpaid wages, never for results', () => {
    // Player played for club-1 but was transferred: contract.clubId is
    // now club-2. The match-time snapshot still maps him to club-1.
    const player = makePlayer({ id: 'p1', morale: NEUTRAL_MORALE, clubId: 'club-2' });
    const ctx = emptyContext({
      matchClubByPlayerId: new Map([['p1', 'club-1']]),
      matches: [match('club-1', 'club-2', 2, 0, ['p1'])],
      clubsWithUnpaidWages: new Set(['club-2']),
    });
    const [next] = applyWeeklyMorale([player], ctx);
    // Win of club-1 (+4) AND unpaid wages of club-2 (-2): +2 net.
    expect(next.status.morale).toBeCloseTo(expectedMorale(75, 2), 10);
    expect(next.status.morale).toBeCloseTo(77, 10);
  });
});

describe('applyWeeklyMorale — injuries', () => {
  const severities: InjurySeverity[] = ['minor', 'moderate', 'serious', 'severe'];
  const expected: Record<InjurySeverity, number> = {
    minor: -6,
    moderate: -8,
    serious: -10,
    severe: -10,
  };

  severities.forEach((severity) => {
    it(`applies ${expected[severity]} for a newly contracted ${severity} injury`, () => {
      const player = makePlayer({ id: 'p1', morale: NEUTRAL_MORALE });
      const ctx = emptyContext({
        injuries: [{ playerId: 'p1', kind: 'contracted', severity }],
      });
      const [next] = applyWeeklyMorale([player], ctx);
      expect(next.status.morale).toBeCloseTo(expectedMorale(75, expected[severity]), 10);
    });
  });

  it('applies +4 when an injury heals', () => {
    const player = makePlayer({ id: 'p1', morale: NEUTRAL_MORALE });
    const ctx = emptyContext({
      injuries: [{ playerId: 'p1', kind: 'healed' }],
    });
    const [next] = applyWeeklyMorale([player], ctx);
    expect(next.status.morale).toBeCloseTo(expectedMorale(75, 4), 10);
    expect(next.status.morale).toBeCloseTo(79, 10);
  });

  it('does not apply injury deltas to unrelated players', () => {
    const p1 = makePlayer({ id: 'p1', morale: NEUTRAL_MORALE });
    const p2 = makePlayer({ id: 'p2', morale: NEUTRAL_MORALE });
    const ctx = emptyContext({
      injuries: [{ playerId: 'p1', kind: 'contracted', severity: 'serious' }],
    });
    const [, next2] = applyWeeklyMorale([p1, p2], ctx);
    expect(next2.status.morale).toBe(NEUTRAL_MORALE);
  });
});

describe('applyWeeklyMorale — unpaid wages', () => {
  it('applies -2 once to every player of a club with new unpaid wages', () => {
    const p1 = makePlayer({ id: 'p1', morale: NEUTRAL_MORALE, clubId: 'club-1' });
    const p2 = makePlayer({ id: 'p2', morale: NEUTRAL_MORALE, clubId: 'club-1' });
    const p3 = makePlayer({ id: 'p3', morale: NEUTRAL_MORALE, clubId: 'club-2' });
    const ctx = emptyContext({ clubsWithUnpaidWages: new Set(['club-1']) });
    const [n1, n2, n3] = applyWeeklyMorale([p1, p2, p3], ctx);
    expect(n1.status.morale).toBeCloseTo(expectedMorale(75, -2), 10);
    expect(n2.status.morale).toBeCloseTo(expectedMorale(75, -2), 10);
    expect(n3.status.morale).toBe(NEUTRAL_MORALE);
  });
});

describe('applyWeeklyMorale — reversion and bounds', () => {
  it('pulls morale above 75 down toward neutral each week', () => {
    const player = makePlayer({ id: 'p1', morale: 90 });
    const [next] = applyWeeklyMorale([player], emptyContext());
    expect(next.status.morale).toBeCloseTo(90 + 0.15 * (75 - 90), 10);
    expect(next.status.morale).toBeCloseTo(87.75, 10);
  });

  it('pulls morale below 75 up toward neutral each week', () => {
    const player = makePlayer({ id: 'p1', morale: 60 });
    const [next] = applyWeeklyMorale([player], emptyContext());
    expect(next.status.morale).toBeCloseTo(60 + 0.15 * (75 - 60), 10);
    expect(next.status.morale).toBeCloseTo(62.25, 10);
  });

  it('keeps morale at exactly 75 unchanged (same object reference)', () => {
    const player = makePlayer({ id: 'p1', morale: NEUTRAL_MORALE });
    const [next] = applyWeeklyMorale([player], emptyContext());
    expect(next).toBe(player);
  });

  it('never exceeds 100', () => {
    const player = makePlayer({ id: 'p1', morale: 99 });
    const ctx = emptyContext({
      matchClubByPlayerId: new Map([['p1', 'club-1']]),
      matches: [match('club-1', 'club-2', 5, 0, ['p1'])],
      injuries: [{ playerId: 'p1', kind: 'healed' }],
    });
    const [next] = applyWeeklyMorale([player], ctx);
    expect(next.status.morale).toBeLessThanOrEqual(100);
    expect(next.status.morale).toBe(100);
  });

  it('never drops below 0', () => {
    const player = makePlayer({ id: 'p1', morale: 1 });
    const ctx = emptyContext({
      matchClubByPlayerId: new Map([['p1', 'club-1']]),
      matches: [match('club-1', 'club-2', 0, 5, ['p1'])],
      injuries: [{ playerId: 'p1', kind: 'contracted', severity: 'serious' }],
      clubsWithUnpaidWages: new Set(['club-1']),
    });
    const [next] = applyWeeklyMorale([player], ctx, {
      ...DEFAULT_WEEKLY_MORALE_PARAMS,
      reversionRate: 0, // isolate the floor
    });
    // eventDelta = -4 -10 -2 = -16 → clamped to -12; 1 - 12 < 0 → 0
    expect(next.status.morale).toBe(0);
  });

  it('clamps an initial morale above 100 before computing', () => {
    const player = makePlayer({ id: 'p1', morale: 150 });
    const [next] = applyWeeklyMorale([player], emptyContext());
    // base=100, reversion=0.15*(75-100)=-3.75 → 96.25
    expect(next.status.morale).toBeCloseTo(96.25, 10);
  });

  it('clamps an initial morale below 0 before computing', () => {
    const player = makePlayer({ id: 'p1', morale: -20 });
    const [next] = applyWeeklyMorale([player], emptyContext());
    // base=0, reversion=0.15*75=11.25 → 11.25
    expect(next.status.morale).toBeCloseTo(11.25, 10);
  });

  it('treats a non-finite morale as neutral', () => {
    const player = makePlayer({ id: 'p1', morale: NaN });
    const [next] = applyWeeklyMorale([player], emptyContext());
    expect(next.status.morale).toBe(NEUTRAL_MORALE);
  });
});

describe('applyWeeklyMorale — event combination and clamping', () => {
  it('clamps the summed eventDelta to ±12 (reversion excluded)', () => {
    const player = makePlayer({ id: 'p1', morale: NEUTRAL_MORALE });
    const ctx = emptyContext({
      matchClubByPlayerId: new Map([['p1', 'club-1']]),
      matches: [match('club-1', 'club-2', 0, 3, ['p1'])], // -4
      injuries: [{ playerId: 'p1', kind: 'contracted', severity: 'serious' }], // -10
      clubsWithUnpaidWages: new Set(['club-1']), // -2
    });
    // raw = -16 → clamped to -12 → 75 - 12 + 0 = 63
    const [next] = applyWeeklyMorale([player], ctx);
    expect(next.status.morale).toBeCloseTo(63, 10);
  });

  it('combines win + heal + unpaid into a single clamped delta', () => {
    const player = makePlayer({ id: 'p1', morale: NEUTRAL_MORALE });
    const ctx = emptyContext({
      matchClubByPlayerId: new Map([['p1', 'club-1']]),
      matches: [match('club-1', 'club-2', 2, 0, ['p1'])], // +4
      injuries: [{ playerId: 'p1', kind: 'healed' }], // +4
      clubsWithUnpaidWages: new Set(['club-1']), // -2
    });
    // raw = +6 → 75 + 6 = 81
    const [next] = applyWeeklyMorale([player], ctx);
    expect(next.status.morale).toBeCloseTo(81, 10);
  });
});

describe('applyWeeklyMorale — purity and structure', () => {
  it('does not mutate inputs and preserves all other fields', () => {
    const player = makePlayer({ id: 'p1', morale: 60 });
    const originalStatus = player.status;
    const ctx = emptyContext({
      matchClubByPlayerId: new Map([['p1', 'club-1']]),
      matches: [match('club-1', 'club-2', 2, 0, ['p1'])],
    });
    const [next] = applyWeeklyMorale([player], ctx);
    // Input untouched: same status object, morale unchanged.
    expect(player.status).toBe(originalStatus);
    expect(player.status.morale).toBe(60);
    expect(next.id).toBe(player.id);
    expect(next.attributes).toBe(player.attributes);
    expect(next.development).toBe(player.development);
    expect(next.contract).toBe(player.contract);
    expect(next.status.recentForm).toBe(player.status.recentForm);
    expect(next.status.injury).toBe(player.status.injury);
    expect(next.status.fitness).toBe(player.status.fitness);
    expect(next).not.toBe(player);
  });

  it('preserves player order and keeps unchanged players by reference', () => {
    const p1 = makePlayer({ id: 'p1', morale: NEUTRAL_MORALE });
    const p2 = makePlayer({ id: 'p2', morale: 90 });
    const p3 = makePlayer({ id: 'p3', morale: NEUTRAL_MORALE });
    const ctx = emptyContext({
      matchClubByPlayerId: new Map([['p2', 'club-1']]),
      matches: [match('club-1', 'club-2', 0, 2, ['p2'])],
    });
    const result = applyWeeklyMorale([p1, p2, p3], ctx);
    expect(result.map((p) => p.id)).toEqual(['p1', 'p2', 'p3']);
    expect(result[0]).toBe(p1); // at 75, no events → unchanged
    expect(result[2]).toBe(p3);
    expect(result[1]).not.toBe(p2);
  });

  it('is deterministic across repeated calls', () => {
    const players = [
      makePlayer({ id: 'p1', morale: 70 }),
      makePlayer({ id: 'p2', morale: 40 }),
    ];
    const ctx = emptyContext({
      matchClubByPlayerId: new Map([
        ['p1', 'club-1'],
        ['p2', 'club-2'],
      ]),
      matches: [match('club-1', 'club-2', 1, 0, ['p1', 'p2'])],
      injuries: [{ playerId: 'p2', kind: 'contracted', severity: 'moderate' }],
      clubsWithUnpaidWages: new Set(['club-2']),
    });
    const first = applyWeeklyMorale(players, ctx);
    const second = applyWeeklyMorale(players, ctx);
    expect(first).toEqual(second);
  });
});

describe('morale context helpers', () => {
  it('buildMatchClubByPlayerId maps every squad member to its club', () => {
    const clubs = [
      makeClub('club-1', ['a', 'b']),
      makeClub('club-2', ['c']),
    ];
    const map = buildMatchClubByPlayerId(clubs);
    expect(map.get('a')).toBe('club-1');
    expect(map.get('b')).toBe('club-1');
    expect(map.get('c')).toBe('club-2');
    expect(map.size).toBe(3);
  });

  it('detectInjuryTransitions detects contracted, healed and persistent injuries', () => {
    const injured = { type: 'Test', daysRemaining: 10, severity: 'moderate' as const };
    const before = [
      makePlayer({ id: 'new', injury: null }),
      makePlayer({ id: 'healed', injury: { ...injured, daysRemaining: 3 } }),
      makePlayer({ id: 'ongoing', injury: { ...injured, daysRemaining: 10 } }),
      makePlayer({ id: 'healthy', injury: null }),
    ];
    const after = [
      makePlayer({ id: 'new', injury: { ...injured, severity: 'serious' as const, daysRemaining: 20 } }),
      makePlayer({ id: 'healed', injury: null }),
      makePlayer({ id: 'ongoing', injury: { ...injured, daysRemaining: 3 } }),
      makePlayer({ id: 'healthy', injury: null }),
    ];
    const events = detectInjuryTransitions(before, after);
    expect(events).toEqual([
      { playerId: 'new', kind: 'contracted', severity: 'serious' },
      { playerId: 'healed', kind: 'healed' },
    ]);
  });

  it('collectClubsWithNewUnpaidWages flags only strictly positive debt deltas', () => {
    const before = [makeClub('club-1', [], 0), makeClub('club-2', [], 100), makeClub('club-3', [], 0)];
    const after = [
      makeClub('club-1', [], 500),   // new unpaid → flagged
      makeClub('club-2', [], 100),   // unchanged historical debt → not flagged
      makeClub('club-3', [], 0),     // solvent → not flagged
    ];
    const unpaid = collectClubsWithNewUnpaidWages(before, after);
    expect(unpaid.has('club-1')).toBe(true);
    expect(unpaid.has('club-2')).toBe(false);
    expect(unpaid.has('club-3')).toBe(false);
  });
});

describe('applyWeeklyMorale — multi-week calibration', () => {
  interface WeekScript {
    /** 'W' | 'D' | 'L' for the player's club, or null when not playing. */
    result: 'W' | 'D' | 'L' | null;
    contractedInjury?: InjurySeverity;
    healed?: boolean;
    unpaid?: boolean;
  }

  /** Drive the pure engine week by week with scripted events. */
  function runTrajectory(weeks: number, script: (week: number) => WeekScript) {
    let player = makePlayer({ id: 'p1', morale: NEUTRAL_MORALE });
    let min = Infinity;
    let max = -Infinity;
    for (let week = 1; week <= weeks; week++) {
      const s = script(week);
      const scores =
        s.result === 'W' ? [2, 0] : s.result === 'L' ? [0, 2] : [1, 1];
      const ctx: WeeklyMoraleContext = {
        matchClubByPlayerId: new Map([['p1', 'club-1']]),
        matches:
          s.result === null
            ? []
            : [match('club-1', 'club-2', scores[0], scores[1], ['p1'])],
        injuries: [
          ...(s.contractedInjury
            ? [{ playerId: 'p1', kind: 'contracted' as const, severity: s.contractedInjury }]
            : []),
          ...(s.healed ? [{ playerId: 'p1', kind: 'healed' as const }] : []),
        ],
        clubsWithUnpaidWages: s.unpaid ? new Set(['club-1']) : new Set(),
      };
      [player] = applyWeeklyMorale([player], ctx);
      min = Math.min(min, player.status.morale);
      max = Math.max(max, player.status.morale);
    }
    return { end: player.status.morale, min, max };
  }

  const scenarios: Array<{
    name: string;
    script: (week: number) => WeekScript;
    end30: number;
    end60: number;
    minBound: number;
    maxBound: number;
  }> = [
    {
      name: 'wins',
      script: () => ({ result: 'W' }),
      end30: 100, end60: 100, minBound: 75, maxBound: 100,
    },
    {
      name: 'losses',
      script: () => ({ result: 'L' }),
      end30: 48.5, end60: 48.3, minBound: 40, maxBound: 75,
    },
    {
      name: 'alternating W/L',
      script: (w) => ({ result: w % 2 ? 'L' : 'W' }),
      end30: 77.1, end60: 77.2, minBound: 65, maxBound: 80,
    },
    {
      name: 'draws',
      script: () => ({ result: 'D' }),
      end30: 75, end60: 75, minBound: 75, maxBound: 75,
    },
    {
      name: 'losses + persistent unpaid wages',
      script: () => ({ result: 'L', unpaid: true }),
      end30: 35.3, end60: 35.0, minBound: 30, maxBound: 72,
    },
    {
      name: 'wins + unpaid wages',
      script: () => ({ result: 'W', unpaid: true }),
      end30: 88.2, end60: 88.3, minBound: 75, maxBound: 95,
    },
    {
      name: 'losses + punctual injury and healing',
      script: (w) => ({
        result: 'L',
        contractedInjury: w === 5 ? 'moderate' : undefined,
        healed: w === 12,
      }),
      end30: 48.6, end60: 48.3, minBound: 40, maxBound: 75,
    },
    {
      name: 'losses + unpaid + injury (combined)',
      script: (w) => ({
        result: 'L',
        unpaid: true,
        contractedInjury: w === 5 ? 'moderate' : undefined,
        healed: w === 12,
      }),
      end30: 35.4, end60: 35.0, minBound: 30, maxBound: 72,
    },
    {
      name: 'injured player out for 8 weeks on a losing team',
      script: (w) => ({
        result: w >= 5 && w <= 12 ? null : 'L',
        contractedInjury: w === 5 ? 'moderate' : undefined,
        healed: w === 12,
      }),
      end30: 49.7, end60: 48.3, minBound: 40, maxBound: 75,
    },
  ];

  scenarios.forEach(({ name, script, end30, end60, minBound, maxBound }) => {
    it(`${name}: bounded trajectory over 30 and 60 weeks`, () => {
      const t30 = runTrajectory(30, script);
      const t60 = runTrajectory(60, script);
      expect(t30.end).toBeCloseTo(end30, 1);
      expect(t60.end).toBeCloseTo(end60, 1);
      [t30, t60].forEach((t) => {
        expect(t.min).toBeGreaterThanOrEqual(minBound);
        expect(t.max).toBeLessThanOrEqual(maxBound);
        expect(t.min).toBeGreaterThanOrEqual(0);
        expect(t.max).toBeLessThanOrEqual(100);
      });
    });
  });
});
