import { assignSeasonObjectives } from '../season/objectives';
import { generateSeedData } from '../seed/generateSeedData';
import type {
  Club,
  Player,
  SeasonObjective,
} from '@club-director/shared-types';

const SEASON_WEEKS = 30;
const SEASON_ID = 'season-test-1';

function seedWorld(seed = 42) {
  const { clubs, players } = generateSeedData(seed);
  return { clubs, players };
}

function assign(clubs: Club[], players: Player[], seasonWeeks = SEASON_WEEKS) {
  return assignSeasonObjectives({
    seasonId: SEASON_ID,
    clubs,
    players,
    seasonWeeks,
  });
}

/** Expected ambition/target table indexed by rank (1-based). */
const EXPECTED_BY_RANK: Array<[string, number]> = [
  ['title_favorite', 1],
  ['title_contender', 3],
  ['title_contender', 3],
  ['upper_table', 6],
  ['upper_table', 6],
  ['upper_table', 6],
  ['mid_table', 10],
  ['mid_table', 10],
  ['mid_table', 10],
  ['mid_table', 10],
  ['progression', 13],
  ['progression', 13],
  ['progression', 13],
  ['survival', 14],
  ['survival', 14],
  ['survival', 14],
];

describe('assignSeasonObjectives', () => {
  it('assigns exactly 16 objectives, one per club, in strength rank order', () => {
    const { clubs, players } = seedWorld();
    const objectives = assign(clubs, players);

    expect(objectives).toHaveLength(16);
    expect(new Set(objectives.map((o) => o.clubId)).size).toBe(16);
    expect(new Set(clubs.map((c) => c.id))).toEqual(
      new Set(objectives.map((o) => o.clubId)),
    );
  });

  it('maps each rank to the exact approved ambition and target position', () => {
    const { clubs, players } = seedWorld();
    const objectives = assign(clubs, players);

    objectives.forEach((objective, index) => {
      const [ambition, targetPosition] = EXPECTED_BY_RANK[index];
      expect(objective.ambition).toBe(ambition);
      expect(objective.targetPosition).toBe(targetPosition);
    });
  });

  it('is deterministic: identical inputs produce identical outputs', () => {
    const { clubs, players } = seedWorld(7);
    const first = assign(clubs, players);
    const second = assign(clubs, players);
    expect(second).toEqual(first);
  });

  it('produces the same ranking regardless of input club order', () => {
    const { clubs, players } = seedWorld(123);
    const reversed = [...clubs].reverse();
    const a = assign(clubs, players);
    const b = assign(reversed, players);
    expect(b).toEqual(a);
  });

  it('initializes every settlement field to its pre-settlement value', () => {
    const { clubs, players } = seedWorld();
    for (const objective of assign(clubs, players)) {
      expect(objective).toMatchObject({
        seasonId: SEASON_ID,
        objectiveMet: null,
        rewardPaid: 0,
        debtRemaining: null,
        settledAt: null,
        sanction: 'none',
      });
      expect(typeof objective.rewardAmount).toBe('number');
      expect(objective.rewardAmount).toBeGreaterThanOrEqual(0);
    }
  });

  it('computes rewardAmount with the approved formula C and 10k rounding', () => {
    const { clubs, players } = seedWorld(42);
    const objectives = assign(clubs, players);
    const byClub = new Map(clubs.map((c) => [c.id, c]));
    const playerById = new Map(players.map((p) => [p.id, p]));
    const COEFF: Record<string, number> = {
      title_favorite: 1.4,
      title_contender: 1.2,
      upper_table: 1.0,
      mid_table: 0.85,
      progression: 0.7,
      survival: 0.55,
    };

    for (const objective of objectives) {
      const club = byClub.get(objective.clubId)!;
      const wageBill = club.squad.reduce(
        (sum, id) => sum + playerById.get(id)!.contract.wage,
        0,
      );
      const raw =
        COEFF[objective.ambition] *
        (0.15 * club.finances.weeklyIncome * SEASON_WEEKS +
          0.1 * wageBill * SEASON_WEEKS);
      const expected = Math.round(raw / 10_000) * 10_000;
      expect(objective.rewardAmount).toBe(expected);
    }
  });

  it('uses the actual squad wage bill, not finances.wageBudget', () => {
    const { clubs, players } = seedWorld(42);
    // Corrupt wageBudget to a wildly different value — reward must not move.
    const tampered = clubs.map((c) => ({
      ...c,
      finances: { ...c.finances, wageBudget: 1 },
    }));
    const baseline = assign(clubs, players);
    const after = assign(tampered, players);
    expect(after).toEqual(baseline);
  });

  it('does not mutate its inputs', () => {
    const { clubs, players } = seedWorld(555);
    // structuredClone preserves Date objects (contractExpiryDate).
    const clubsSnapshot = structuredClone(clubs);
    const playersSnapshot = structuredClone(players);
    assign(clubs, players);
    expect(clubs).toEqual(clubsSnapshot);
    expect(players).toEqual(playersSnapshot);
  });

  // ---- tie-breaking ----

  function customWorld(opts: {
    abilities: number[]; // one mean ability per club (11 identical players)
    reputations?: number[];
    incomes?: number[];
    wages?: number[];
  }): { clubs: Club[]; players: Player[] } {
    const base = generateSeedData(1);
    const templateClub = base.clubs[0];
    const templatePlayer = base.players.find((p) =>
      templateClub.squad.includes(p.id),
    )!;
    const clubs: Club[] = [];
    const players: Player[] = [];

    opts.abilities.forEach((ability, i) => {
      const clubId = `club-${String(i).padStart(2, '0')}`;
      const squad: string[] = [];
      for (let j = 0; j < 11; j++) {
        const pid = `${clubId}-p${j}`;
        squad.push(pid);
        players.push({
          ...templatePlayer,
          id: pid,
          contract: {
            ...templatePlayer.contract,
            clubId,
            wage: opts.wages?.[i] ?? 10_000,
          },
          development: {
            ...templatePlayer.development,
            currentAbility: ability,
          },
        });
      }
      clubs.push({
        ...templateClub,
        id: clubId,
        name: `Club ${i}`,
        reputation: opts.reputations?.[i] ?? 50 + i,
        squad,
        finances: {
          ...templateClub.finances,
          weeklyIncome: opts.incomes?.[i] ?? 1_000_000,
        },
      });
    });
    return { clubs, players };
  }

  it('breaks equal strength ties by reputation descending', () => {
    // All clubs identical strength; reputations deliberately reversed vs ids.
    const reputations = [90, 80, 70, 60, 50, 40, 30, 20, 10, 5, 95, 85, 75, 65, 55, 45];
    const { clubs, players } = customWorld({
      abilities: Array(16).fill(130),
      reputations,
    });
    const objectives = assign(clubs, players);
    // Highest reputation first regardless of club id order.
    expect(objectives[0].clubId).toBe('club-10'); // rep 95
    expect(objectives[1].clubId).toBe('club-00'); // rep 90
    expect(objectives[2].clubId).toBe('club-11'); // rep 85
  });

  it('breaks equal strength and reputation ties by clubId ascending', () => {
    const { clubs, players } = customWorld({
      abilities: Array(16).fill(130),
      reputations: Array(16).fill(50),
    });
    const objectives = assign(clubs, players);
    expect(objectives.map((o) => o.clubId)).toEqual(
      [...clubs.map((c) => c.id)].sort(),
    );
  });

  it('ranks a strictly stronger squad first even with worse reputation', () => {
    const reputations = Array(16).fill(50);
    reputations[0] = 99; // weakest club, best reputation — still last
    const abilities = Array(16).fill(120);
    abilities[0] = 100; // weakest squad overall
    abilities[15] = 160; // strongest squad overall
    const { clubs, players } = customWorld({ abilities, reputations });
    const objectives = assign(clubs, players);
    expect(objectives[0].clubId).toBe('club-15');
    expect(objectives[0].ambition).toBe('title_favorite');
    expect(objectives[15].clubId).toBe('club-00');
    expect(objectives[15].ambition).toBe('survival');
  });

  // ---- reward boundaries ----

  it('returns rewardAmount 0 when income and wage bill are both zero', () => {
    const { clubs, players } = customWorld({
      abilities: Array(16).fill(130).map((_, i) => 130 + i),
      incomes: Array(16).fill(0),
      wages: Array(16).fill(0),
    });
    const objectives = assign(clubs, players, 30);
    for (const o of objectives) {
      expect(o.rewardAmount).toBe(0);
    }
  });

  it('rounds half-up at the 10k boundary', () => {
    // coeff 1.0 (upper_table, rank 4-6), seasonWeeks 1:
    // raw = 0.15 * income * 1 + 0.10 * wage * 1.
    // Pick income = 100_000, wage = 0 → raw = 15_000 → 15_000/10_000 = 1.5
    // Math.round(1.5) = 2 → reward 20_000.
    const { clubs, players } = customWorld({
      abilities: Array(16).fill(130).map((_, i) => 100 + i),
      incomes: Array(16).fill(100_000),
      wages: Array(16).fill(0),
    });
    // All clubs tie on strength → order by reputation (50+i default) then id.
    // Ranks 4-6 get coeff 1.0.
    const objectives = assign(clubs, players, 1);
    const upper = objectives.filter((o) => o.ambition === 'upper_table');
    expect(upper.length).toBe(3);
    for (const o of upper) {
      expect(o.rewardAmount).toBe(20_000);
    }
  });

  it('keeps rewardAmount finite and safe-integer for large but valid inputs', () => {
    // Large enough to exercise float arithmetic, small enough that both
    // the wage bill and the reward stay within safe-integer range.
    const { clubs, players } = customWorld({
      abilities: Array(16).fill(130).map((_, i) => 100 + i),
      incomes: Array(16).fill(100_000_000_000_000), // 1e14
      wages: Array(16).fill(1_000_000_000_000), // 1e12 per player
    });
    const objectives = assign(clubs, players, 30);
    for (const o of objectives) {
      expect(Number.isSafeInteger(o.rewardAmount)).toBe(true);
      expect(o.rewardAmount).toBeGreaterThanOrEqual(0);
    }
  });

  // ---- rejections ----

  it('rejects a championship that is not exactly 16 clubs', () => {
    const { clubs, players } = seedWorld();
    expect(() => assign(clubs.slice(0, 15), players)).toThrow(/exactly 16/);
    expect(() =>
      assign([...clubs, { ...clubs[0], id: 'club-17' }], [
        ...players,
        ...clubs[0].squad.map((id, i) => ({
          ...players.find((p) => p.id === id)!,
          id: `extra-${i}`,
        })),
      ]),
    ).toThrow(/exactly 16/);
  });

  it('rejects an empty or invalid seasonId', () => {
    const { clubs, players } = seedWorld();
    expect(() =>
      assignSeasonObjectives({ seasonId: '', clubs, players, seasonWeeks: 30 }),
    ).toThrow(/seasonId/);
    expect(() =>
      assignSeasonObjectives({ seasonId: '   ', clubs, players, seasonWeeks: 30 }),
    ).toThrow(/seasonId/);
  });

  it('rejects a non-positive or non-integer seasonWeeks', () => {
    const { clubs, players } = seedWorld();
    for (const w of [0, -1, 1.5, NaN]) {
      expect(() => assign(clubs, players, w)).toThrow(/seasonWeeks/);
    }
  });

  it('rejects duplicate club ids', () => {
    const { clubs, players } = seedWorld();
    const dup = clubs.map((c, i) => (i === 15 ? { ...c, id: clubs[0].id } : c));
    expect(() => assign(dup, players)).toThrow(/duplicate club id/);
  });

  it('rejects duplicate player ids in the players collection', () => {
    const { clubs, players } = seedWorld();
    const dup = [...players, players[0]];
    expect(() => assign(clubs, dup)).toThrow(/duplicate player id/);
  });

  it('rejects a squad listing the same player twice', () => {
    const { clubs, players } = seedWorld();
    const mutated = clubs.map((c, i) =>
      i === 0 ? { ...c, squad: [...c.squad.slice(0, -1), c.squad[0]] } : c,
    );
    expect(() => assign(mutated, players)).toThrow(/twice/);
  });

  it('rejects a squad referencing an unknown player', () => {
    const { clubs, players } = seedWorld();
    const mutated = clubs.map((c, i) =>
      i === 0 ? { ...c, squad: [...c.squad.slice(0, -1), 'ghost-player'] } : c,
    );
    expect(() => assign(mutated, players)).toThrow(/unknown player/);
  });

  it('rejects a squad with fewer than 11 players', () => {
    const { clubs, players } = seedWorld();
    const mutated = clubs.map((c, i) =>
      i === 0 ? { ...c, squad: c.squad.slice(0, 10) } : c,
    );
    expect(() => assign(mutated, players)).toThrow(/minimum is 11/);
  });

  it('rejects a non-finite currentAbility on a squad player', () => {
    const { clubs, players } = seedWorld();
    const squadId = clubs[0].squad[0];
    const mutatedPlayers = players.map((p) =>
      p.id === squadId
        ? {
            ...p,
            development: { ...p.development, currentAbility: NaN },
          }
        : p,
    );
    expect(() => assign(clubs, mutatedPlayers)).toThrow(/currentAbility/);
  });

  it('rejects invalid weeklyIncome and contract wages', () => {
    const { clubs, players } = seedWorld();

    const badIncome = clubs.map((c, i) =>
      i === 0 ? { ...c, finances: { ...c.finances, weeklyIncome: -1 } } : c,
    );
    expect(() => assign(badIncome, players)).toThrow(/weeklyIncome/);

    const nanIncome = clubs.map((c, i) =>
      i === 0
        ? { ...c, finances: { ...c.finances, weeklyIncome: NaN } }
        : c,
    );
    expect(() => assign(nanIncome, players)).toThrow(/weeklyIncome/);

    const squadId = clubs[0].squad[0];
    const badWage = players.map((p) =>
      p.id === squadId ? { ...p, contract: { ...p.contract, wage: -5 } } : p,
    );
    expect(() => assign(clubs, badWage)).toThrow(/contract wage/);

    const nanWage = players.map((p) =>
      p.id === squadId
        ? { ...p, contract: { ...p.contract, wage: NaN } }
        : p,
    );
    expect(() => assign(clubs, nanWage)).toThrow(/contract wage/);
  });

  // ---- safe-integer precision (R1) ----

  it('rejects a computed rewardAmount above MAX_SAFE_INTEGER', () => {
    // weeklyIncome is finite and >= 0 but large enough that the reward
    // formula produces a non-safe-integer result.
    const { clubs, players } = customWorld({
      abilities: Array(16).fill(130).map((_, i) => 100 + i),
      incomes: Array(16).fill(Number.MAX_SAFE_INTEGER / 4),
      wages: Array(16).fill(10_000),
    });
    expect(() => assign(clubs, players, 30)).toThrow(
      /not a safe non-negative integer/,
    );
  });

  it('rejects a cumulative wage bill exceeding safe integer precision mid-accumulation', () => {
    // Each individual wage passes validation; the running sum overflows
    // on the second squad player.
    const { clubs, players } = customWorld({
      abilities: Array(16).fill(130).map((_, i) => 100 + i),
      wages: Array(16).fill(Number.MAX_SAFE_INTEGER),
    });
    expect(() => assign(clubs, players, 30)).toThrow(
      /cumulative wage bill exceeds safe integer precision/,
    );
  });

  it('keeps seed-data rewards unchanged after the safe-integer checks', () => {
    const { clubs, players } = seedWorld(42);
    const objectives = assign(clubs, players);
    // Sanity: rewards remain ordinary safe integers on real data.
    for (const o of objectives) {
      expect(Number.isSafeInteger(o.rewardAmount)).toBe(true);
    }
    // Spot-check the top club: title_favorite coeff 1.4.
    const top = objectives[0];
    const club = clubs.find((c) => c.id === top.clubId)!;
    const wageBill = club.squad.reduce(
      (s, id) => s + players.find((p) => p.id === id)!.contract.wage,
      0,
    );
    const expected =
      Math.round(
        (1.4 *
          (0.15 * club.finances.weeklyIncome * 30 +
            0.1 * wageBill * 30)) /
          10_000,
      ) * 10_000;
    expect(top.rewardAmount).toBe(expected);
  });

  // ---- reputation validation (R2) ----

  it.each([NaN, Infinity, -Infinity, -5])(
    'rejects an invalid club reputation: %s',
    (badRep) => {
      const reputations = Array(16).fill(50);
      reputations[3] = badRep;
      const { clubs, players } = customWorld({
        abilities: Array(16).fill(130),
        reputations,
      });
      expect(() => assign(clubs, players)).toThrow(
        /invalid reputation/,
      );
    },
  );

  // ---- players outside squads are ignored ----

  it('ignores corrupt players that belong to no squad', () => {
    const { clubs, players } = seedWorld(42);
    const baseline = assign(clubs, players);
    const template = players[0];
    const outsiders = [
      {
        ...template,
        id: 'outsider-1',
        development: { ...template.development, currentAbility: NaN },
        contract: { ...template.contract, wage: -100 },
      },
      {
        ...template,
        id: 'outsider-2',
        development: { ...template.development, currentAbility: -999 },
        contract: { ...template.contract, wage: NaN },
      },
    ];
    const after = assign(clubs, [...players, ...outsiders]);
    expect(after).toEqual(baseline);
  });

  // ---- input type rejections ----

  it('rejects a non-string seasonId', () => {
    const { clubs, players } = seedWorld();
    for (const bad of [42, null, undefined, {}]) {
      expect(() =>
        assignSeasonObjectives({
          seasonId: bad as unknown as string,
          clubs,
          players,
          seasonWeeks: 30,
        }),
      ).toThrow(/seasonId/);
    }
  });

  it('rejects non-array clubs and players inputs', () => {
    const { clubs, players } = seedWorld();
    expect(() =>
      assignSeasonObjectives({
        seasonId: SEASON_ID,
        clubs: null as unknown as Club[],
        players,
        seasonWeeks: 30,
      }),
    ).toThrow(/exactly 16 clubs/);
    expect(() =>
      assignSeasonObjectives({
        seasonId: SEASON_ID,
        clubs,
        players: null as unknown as Player[],
        seasonWeeks: 30,
      }),
    ).toThrow(/players must be an array/);
  });
});
