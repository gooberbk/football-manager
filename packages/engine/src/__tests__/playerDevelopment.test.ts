import { applyWeeklyDevelopment } from '../players/development';
import { generateSeedData } from '../seed/generateSeedData';
import type {
  Player,
  PlayerAttributes,
  Position,
} from '@club-director/shared-types';

const SEASON_ID = 'season-test';
const SEEDS = [7, 42, 1337];

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
  age?: number;
  position?: Position;
  secondaryPositions?: Position[];
  currentAbility?: number;
  potentialAbility?: number;
  ageGrowthCurve?: Player['development']['ageGrowthCurve'];
  attributes?: PlayerAttributes;
}

function makePlayer(overrides: PlayerOverrides = {}): Player {
  const position = overrides.position ?? 'CM';
  return {
    id: overrides.id ?? 'player-1',
    firstName: 'Test',
    lastName: 'Player',
    nationality: 'Testland',
    age: overrides.age ?? 20,
    preferredFoot: 'right',
    primaryPosition: position,
    secondaryPositions: overrides.secondaryPositions ?? [],
    attributes: overrides.attributes ?? baseAttributes(),
    development: {
      currentAbility: overrides.currentAbility ?? 120,
      potentialAbility: overrides.potentialAbility ?? 180,
      ageGrowthCurve: overrides.ageGrowthCurve ?? 'normal',
    },
    status: {
      morale: 70,
      recentForm: [7, 7, 7, 7, 7],
      fitness: 90,
      injury: null,
    },
    contract: {
      clubId: 'club-1',
      wage: 10000,
      contractExpiryDate: new Date('2030-01-01'),
      marketValue: 1000000,
    },
  };
}

/** Run `weeks` sequential development weeks; returns ability deltas per seed. */
function runSeason(
  player: Player,
  weeks: number,
  participated: boolean,
  seasonId = SEASON_ID,
): number[] {
  return SEEDS.map((seed) => {
    // Vary the season id per seed so each seed explores a different stream.
    let current = player;
    const participation = new Set(participated ? [player.id] : []);
    for (let week = 1; week <= weeks; week++) {
      const [next] = applyWeeklyDevelopment(
        [current],
        participation,
        `${seasonId}-${seed}`,
        week,
      );
      current = next;
    }
    return current.development.currentAbility - player.development.currentAbility;
  });
}

function allAttributes(player: Player): Record<string, number> {
  return {
    ...player.attributes.technical,
    ...player.attributes.mental,
    ...player.attributes.physical,
  };
}

describe('applyWeeklyDevelopment — calibration over 30 weeks', () => {
  test('young player with large potential gap gains ~+2..+5 ability per season', () => {
    const youth = makePlayer({ age: 19, currentAbility: 110, potentialAbility: 180 });
    const deltas = runSeason(youth, 30, true);
    const mean = deltas.reduce((a, b) => a + b, 0) / deltas.length;
    deltas.forEach((d) => expect(d).toBeGreaterThanOrEqual(0));
    deltas.forEach((d) => expect(d).toBeLessThanOrEqual(8));
    expect(mean).toBeGreaterThanOrEqual(1.5);
    expect(mean).toBeLessThanOrEqual(6);
  });

  test('player near potential ability gains at most ~+1 per season', () => {
    const nearCap = makePlayer({ age: 19, currentAbility: 175, potentialAbility: 180 });
    const deltas = runSeason(nearCap, 30, true);
    const mean = deltas.reduce((a, b) => a + b, 0) / deltas.length;
    deltas.forEach((d) => expect(d).toBeLessThanOrEqual(2));
    expect(mean).toBeLessThanOrEqual(1.5);
  });

  test('prime-age player is mostly stagnant', () => {
    const prime = makePlayer({ age: 26, currentAbility: 140, potentialAbility: 180 });
    const deltas = runSeason(prime, 30, true);
    const mean = deltas.reduce((a, b) => a + b, 0) / deltas.length;
    deltas.forEach((d) => expect(d).toBeLessThanOrEqual(2));
    expect(mean).toBeLessThanOrEqual(1);
  });

  test('veteran declines ~-1..-3 ability per season', () => {
    const vet = makePlayer({ age: 33, currentAbility: 150, potentialAbility: 170, ageGrowthCurve: 'normal' });
    const deltas = runSeason(vet, 30, true);
    const mean = deltas.reduce((a, b) => a + b, 0) / deltas.length;
    deltas.forEach((d) => expect(d).toBeLessThanOrEqual(1));
    expect(mean).toBeLessThanOrEqual(0.5);
    expect(mean).toBeGreaterThanOrEqual(-5);
  });

  test('non-participants develop at the reduced 0.25 factor', () => {
    const youth = makePlayer({ age: 19, currentAbility: 110, potentialAbility: 180 });
    const played = runSeason(youth, 30, true);
    const benched = runSeason(youth, 30, false);
    const playedMean = played.reduce((a, b) => a + b, 0) / played.length;
    const benchedMean = benched.reduce((a, b) => a + b, 0) / benched.length;
    expect(playedMean).toBeGreaterThan(benchedMean);
  });
});

describe('applyWeeklyDevelopment — age growth curves', () => {
  test('early-peak declines earlier than late-bloomer at the same age', () => {
    // Age 27: early-peak is in decline (declineStart 26), late-bloomer
    // is still in its prime window (declineStart 31).
    const early = makePlayer({ age: 27, ageGrowthCurve: 'early-peak', currentAbility: 140, potentialAbility: 180 });
    const late = makePlayer({ age: 27, ageGrowthCurve: 'late-bloomer', currentAbility: 140, potentialAbility: 180 });
    // ~200 weeks gives the decline branch enough rolls to separate the
    // two curves statistically while staying deterministic.
    const earlyDeltas = runSeason(early, 200, true);
    const lateDeltas = runSeason(late, 200, true);
    const earlyMean = earlyDeltas.reduce((a, b) => a + b, 0) / earlyDeltas.length;
    const lateMean = lateDeltas.reduce((a, b) => a + b, 0) / lateDeltas.length;
    expect(earlyMean).toBeLessThan(lateMean);
  });
});

describe('applyWeeklyDevelopment — attributes', () => {
  test('development touches position-relevant attributes, not irrelevant ones', () => {
    const striker = makePlayer({
      age: 19, position: 'ST', currentAbility: 110, potentialAbility: 200,
    });
    let current = striker;
    const gained = new Set<string>();
    for (let week = 1; week <= 200; week++) {
      const [next] = applyWeeklyDevelopment(
        [current], new Set([current.id]), `${SEASON_ID}-attr`, week,
      );
      const before = allAttributes(current);
      const after = allAttributes(next);
      for (const [name, value] of Object.entries(after)) {
        if (value > before[name]) gained.add(name);
      }
      current = next;
    }
    // ST-relevant attributes must have grown at least once.
    expect(
      ['finishing', 'shooting', 'firstTouch', 'technique', 'heading']
        .some((name) => gained.has(name)),
    ).toBe(true);
    // 'crossing' is not in the ST relevance list — it must never grow.
    expect(gained.has('crossing')).toBe(false);
    expect(gained.has('freeKicks')).toBe(false);
  });

  test('physical attributes decline before mental ones for veterans', () => {
    // Age 32 'normal': physical decline active (declineStart 29) but
    // mentalDeclineAge is 34 — mental attributes must stay untouched.
    const vet = makePlayer({ age: 32, currentAbility: 150, potentialAbility: 170 });
    let current = vet;
    let physicalDeclined = false;
    for (let week = 1; week <= 200; week++) {
      const [next] = applyWeeklyDevelopment(
        [current], new Set([current.id]), `${SEASON_ID}-phys`, week,
      );
      for (const name of Object.keys(current.attributes.physical)) {
        const key = name as keyof typeof current.attributes.physical;
        if (next.attributes.physical[key] < current.attributes.physical[key]) {
          physicalDeclined = true;
        }
      }
      for (const name of Object.keys(current.attributes.mental)) {
        const key = name as keyof typeof current.attributes.mental;
        expect(next.attributes.mental[key]).toBe(current.attributes.mental[key]);
      }
      current = next;
    }
    expect(physicalDeclined).toBe(true);
  });

  test('attributes stay within [1,20]', () => {
    const maxed = makePlayer({
      age: 19, currentAbility: 110, potentialAbility: 200,
      attributes: (() => {
        const a = baseAttributes(20);
        return a;
      })(),
    });
    let current = maxed;
    for (let week = 1; week <= 60; week++) {
      const [next] = applyWeeklyDevelopment(
        [current], new Set([current.id]), `${SEASON_ID}-bounds`, week,
      );
      for (const value of Object.values(allAttributes(next))) {
        expect(value).toBeGreaterThanOrEqual(1);
        expect(value).toBeLessThanOrEqual(20);
      }
      current = next;
    }
  });
});

describe('applyWeeklyDevelopment — invariants', () => {
  test('currentAbility never exceeds potentialAbility', () => {
    const capped = makePlayer({ age: 19, currentAbility: 179, potentialAbility: 180 });
    const deltas = runSeason(capped, 60, true);
    deltas.forEach((d) => expect(d).toBeLessThanOrEqual(1));
  });

  test('determinism: identical inputs produce identical outputs', () => {
    const players = generateSeedData(99).players.slice(0, 40);
    const participation = new Set(players.slice(0, 20).map((p) => p.id));
    const first = applyWeeklyDevelopment(players, participation, 'season-1', 5);
    const second = applyWeeklyDevelopment(players, participation, 'season-1', 5);
    expect(first).toEqual(second);
  });

  test('player order in the array does not affect individual results', () => {
    const players = generateSeedData(7).players.slice(0, 30);
    const participation = new Set(players.map((p) => p.id));
    const forward = applyWeeklyDevelopment(players, participation, 'season-1', 3);
    const reversed = applyWeeklyDevelopment([...players].reverse(), participation, 'season-1', 3);
    const byId = new Map(reversed.map((p) => [p.id, p]));
    for (const player of forward) {
      expect(byId.get(player.id)).toEqual(player);
    }
  });

  test('inputs are never mutated', () => {
    const players = generateSeedData(5).players.slice(0, 20);
    const participation = new Set(players.map((p) => p.id));
    const snapshot = JSON.stringify(players);
    applyWeeklyDevelopment(players, participation, 'season-1', 2);
    expect(JSON.stringify(players)).toBe(snapshot);
  });

  test('produces no NaN or out-of-range values on real seed data', () => {
    const players = generateSeedData(2024).players;
    const participation = new Set(players.map((p) => p.id));
    const result = applyWeeklyDevelopment(players, participation, 'season-1', 1);
    for (const player of result) {
      expect(Number.isFinite(player.development.currentAbility)).toBe(true);
      expect(player.development.currentAbility).toBeLessThanOrEqual(
        player.development.potentialAbility,
      );
      for (const value of Object.values(allAttributes(player))) {
        expect(Number.isFinite(value)).toBe(true);
        expect(value).toBeGreaterThanOrEqual(1);
        expect(value).toBeLessThanOrEqual(20);
      }
    }
  });

  test('player at potential with inverted data never grows but may decline', () => {
    // currentAbility > potentialAbility (atypical): gap clamps to 0 so
    // no growth; the value is never "repaired" downward.
    const odd = makePlayer({ age: 19, currentAbility: 150, potentialAbility: 100 });
    const [result] = applyWeeklyDevelopment(
      [odd], new Set([odd.id]), SEASON_ID, 1,
    );
    expect(result.development.currentAbility).toBeLessThanOrEqual(150);
    expect(result.development.potentialAbility).toBe(100);
  });

  test('rejects invalid top-level inputs', () => {
    const player = makePlayer();
    const participation = new Set([player.id]);
    expect(() =>
      // @ts-expect-error deliberate bad input
      applyWeeklyDevelopment('nope', participation, SEASON_ID, 1),
    ).toThrow();
    expect(() =>
      applyWeeklyDevelopment([player], participation, '  ', 1),
    ).toThrow();
    expect(() =>
      applyWeeklyDevelopment([player], participation, SEASON_ID, 0),
    ).toThrow();
    expect(() =>
      // @ts-expect-error deliberate bad input
      applyWeeklyDevelopment([player], ['id'], SEASON_ID, 1),
    ).toThrow();
  });

  test('rejects players with non-finite development data', () => {
    const bad = makePlayer({ currentAbility: NaN });
    expect(() =>
      applyWeeklyDevelopment([bad], new Set([bad.id]), SEASON_ID, 1),
    ).toThrow(/invalid age\/development/);
  });
});
