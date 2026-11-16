import {
  renewalWageDemand,
  proposeContractRenewal,
} from '../season/contracts';
import type {
  Club,
  Player,
  PlayerAttributes,
} from '@club-director/shared-types';

const NOW = new Date('2024-08-01T00:00:00Z');
const MONTH_MS = 30 * 24 * 60 * 60 * 1000;

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
  clubId?: string | null;
  expiry?: Date;
  wage?: number;
  currentAbility?: number;
}

/** Default contract expires 6 months from NOW — inside the window. */
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
      currentAbility: overrides.currentAbility ?? 120,
      potentialAbility: 180,
      ageGrowthCurve: 'normal',
    },
    status: {
      morale: 75,
      recentForm: [7, 7, 7, 7, 7],
      fitness: 90,
      injury: null,
    },
    contract: {
      clubId: overrides.clubId === undefined ? 'club-1' : overrides.clubId,
      wage: overrides.wage ?? 10000,
      contractExpiryDate:
        overrides.expiry ?? new Date(NOW.getTime() + 6 * MONTH_MS),
      marketValue: 1000000,
    },
  };
}

function makeClub(id: string): Club {
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
      debt: 0,
    },
    squad: ['player-1'],
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

/** Default demand: max(wage=10000, ability 120 * 1000 = 120000). */
const DEMAND = 120000;

describe('renewalWageDemand', () => {
  it('returns max(contract.wage, currentAbility * 1000)', () => {
    expect(renewalWageDemand(makePlayer(), NOW)).toBe(DEMAND);
    // Old wage above the ability floor wins.
    expect(
      renewalWageDemand(makePlayer({ wage: 200000 }), NOW),
    ).toBe(200000);
    // Ability floor wins over a low wage.
    expect(
      renewalWageDemand(makePlayer({ wage: 5000, currentAbility: 300 }), NOW),
    ).toBe(300000);
  });

  it('throws on invalid now, wage or ability', () => {
    expect(() => renewalWageDemand(makePlayer(), new Date(NaN))).toThrow();
    const badWage = makePlayer();
    badWage.contract = { ...badWage.contract, wage: NaN };
    expect(() => renewalWageDemand(badWage, NOW)).toThrow();
    const badAbility = makePlayer({ currentAbility: -5 });
    expect(() => renewalWageDemand(badAbility, NOW)).toThrow();
    const infAbility = makePlayer({ currentAbility: Infinity });
    expect(() => renewalWageDemand(infAbility, NOW)).toThrow();
  });
});

describe('proposeContractRenewal — eligibility', () => {
  const club = makeClub('club-1');

  it('rejects a contract outside the 12-month window', () => {
    const player = makePlayer({
      expiry: new Date(NOW.getTime() + 12 * MONTH_MS + 1),
    });
    const result = proposeContractRenewal(player, club, {
      wage: DEMAND, years: 1, now: NOW,
    });
    expect(result).toEqual({
      success: false, reason: 'outside_renewal_window', wageDemand: null,
    });
  });

  it('accepts a contract exactly 12 months out (boundary inclusive)', () => {
    const player = makePlayer({
      expiry: new Date(NOW.getTime() + 12 * MONTH_MS),
    });
    const result = proposeContractRenewal(player, club, {
      wage: DEMAND, years: 1, now: NOW,
    });
    expect(result.success).toBe(true);
  });

  it('accepts a contract expiring tomorrow (1ms remaining)', () => {
    const player = makePlayer({ expiry: new Date(NOW.getTime() + 1) });
    const result = proposeContractRenewal(player, club, {
      wage: DEMAND, years: 1, now: NOW,
    });
    expect(result.success).toBe(true);
  });

  it('rejects a contract expiring exactly today', () => {
    const player = makePlayer({ expiry: NOW });
    const result = proposeContractRenewal(player, club, {
      wage: DEMAND, years: 1, now: NOW,
    });
    expect(result).toEqual({
      success: false, reason: 'contract_expired', wageDemand: null,
    });
  });

  it('rejects an already-expired contract', () => {
    const player = makePlayer({
      expiry: new Date(NOW.getTime() - 1),
    });
    const result = proposeContractRenewal(player, club, {
      wage: DEMAND, years: 1, now: NOW,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.reason).toBe('contract_expired');
    }
  });

  it('rejects an invalid expiry date conservatively', () => {
    const player = makePlayer({ expiry: new Date(NaN) });
    const result = proposeContractRenewal(player, club, {
      wage: DEMAND, years: 1, now: NOW,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.reason).toBe('contract_expired');
    }
  });

  it('rejects a free agent', () => {
    const player = makePlayer({ clubId: null });
    const result = proposeContractRenewal(player, club, {
      wage: DEMAND, years: 1, now: NOW,
    });
    expect(result).toEqual({
      success: false, reason: 'free_agent', wageDemand: null,
    });
  });

  it('rejects a player of another club', () => {
    const player = makePlayer({ clubId: 'club-2' });
    const result = proposeContractRenewal(player, club, {
      wage: DEMAND, years: 1, now: NOW,
    });
    expect(result).toEqual({
      success: false, reason: 'not_club_member', wageDemand: null,
    });
  });

  it('throws on an invalid now', () => {
    const player = makePlayer();
    expect(() =>
      proposeContractRenewal(player, club, {
        wage: DEMAND, years: 1, now: new Date(NaN),
      }),
    ).toThrow();
  });
});

describe('proposeContractRenewal — terms validation', () => {
  const club = makeClub('club-1');
  const player = makePlayer();

  it.each([1, 2, 3])('accepts a %i-year renewal', (years) => {
    const result = proposeContractRenewal(player, club, {
      wage: DEMAND, years, now: NOW,
    });
    expect(result.success).toBe(true);
  });

  it.each([0, 4, -1, 1.5, NaN, Infinity])(
    'rejects invalid duration %s',
    (years) => {
      const result = proposeContractRenewal(player, club, {
        wage: DEMAND, years, now: NOW,
      });
      expect(result).toEqual({
        success: false, reason: 'invalid_duration', wageDemand: null,
      });
    },
  );

  it.each([0, -100, 1.5, NaN, Infinity])(
    'rejects invalid wage %s',
    (wage) => {
      const result = proposeContractRenewal(player, club, {
        wage, years: 1, now: NOW,
      });
      expect(result).toEqual({
        success: false, reason: 'invalid_wage', wageDemand: null,
      });
    },
  );

  it('rejects a wage below the demand and reports the demand', () => {
    const result = proposeContractRenewal(player, club, {
      wage: DEMAND - 1, years: 1, now: NOW,
    });
    expect(result).toEqual({
      success: false, reason: 'wage_below_demand', wageDemand: DEMAND,
    });
  });

  it('accepts a wage exactly equal to the demand', () => {
    const result = proposeContractRenewal(player, club, {
      wage: DEMAND, years: 1, now: NOW,
    });
    expect(result.success).toBe(true);
  });

  it('accepts a wage above the demand', () => {
    const result = proposeContractRenewal(player, club, {
      wage: DEMAND + 50000, years: 2, now: NOW,
    });
    expect(result.success).toBe(true);
  });

  it('uses the current wage as demand floor when it exceeds ability*1000', () => {
    const rich = makePlayer({ wage: 200000 });
    const below = proposeContractRenewal(rich, club, {
      wage: 150000, years: 1, now: NOW,
    });
    expect(below).toEqual({
      success: false, reason: 'wage_below_demand', wageDemand: 200000,
    });
    const at = proposeContractRenewal(rich, club, {
      wage: 200000, years: 1, now: NOW,
    });
    expect(at.success).toBe(true);
  });
});

describe('proposeContractRenewal — accepted result', () => {
  const club = makeClub('club-1');

  it('computes the new expiry from the OLD expiry, not from now', () => {
    const oldExpiry = new Date(NOW.getTime() + 6 * MONTH_MS);
    const player = makePlayer({ expiry: oldExpiry });
    const result = proposeContractRenewal(player, club, {
      wage: DEMAND, years: 2, now: NOW,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      const expected = new Date(oldExpiry);
      expected.setFullYear(expected.getFullYear() + 2);
      expect(result.player.contract.contractExpiryDate.getTime())
        .toBe(expected.getTime());
      expect(result.player.contract.wage).toBe(DEMAND);
      expect(result.wageDemand).toBe(DEMAND);
    }
  });

  it('returns new player and contract references, preserving everything else', () => {
    const player = makePlayer();
    const wageBefore = player.contract.wage;
    const expiryBefore = player.contract.contractExpiryDate.getTime();
    const contractRef = player.contract;
    const result = proposeContractRenewal(player, club, {
      wage: DEMAND + 1, years: 1, now: NOW,
    });
    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.player).not.toBe(player);
    expect(result.player.contract).not.toBe(player.contract);

    // Every field except wage/expiryDate is deeply identical.
    const { contract: newContract, ...restNew } = result.player;
    const { contract: oldContract, ...restOld } = player;
    expect(restNew).toEqual(restOld);
    expect({ ...newContract, wage: oldContract.wage,
      contractExpiryDate: oldContract.contractExpiryDate })
      .toEqual(oldContract);
    // Input untouched: same contract reference, same wage and expiry.
    expect(player.contract).toBe(contractRef);
    expect(player.contract.wage).toBe(wageBefore);
    expect(player.contract.contractExpiryDate.getTime()).toBe(expiryBefore);
  });

  it('does not modify the club or its wageBudget', () => {
    const clubBefore = JSON.parse(JSON.stringify(club));
    const player = makePlayer();
    proposeContractRenewal(player, club, {
      wage: DEMAND, years: 1, now: NOW,
    });
    expect(club).toEqual(clubBefore);
    expect(club.finances.wageBudget).toBe(1000000);
  });

  it('rejects an immediate second renewal as outside the window', () => {
    const player = makePlayer();
    const first = proposeContractRenewal(player, club, {
      wage: DEMAND, years: 1, now: NOW,
    });
    expect(first.success).toBe(true);
    if (!first.success) return;

    const second = proposeContractRenewal(first.player, club, {
      wage: DEMAND * 2, years: 1, now: NOW,
    });
    expect(second).toEqual({
      success: false, reason: 'outside_renewal_window', wageDemand: null,
    });
  });

  it('is deterministic for identical inputs', () => {
    const player = makePlayer();
    const a = proposeContractRenewal(player, club, {
      wage: DEMAND, years: 3, now: NOW,
    });
    const b = proposeContractRenewal(player, club, {
      wage: DEMAND, years: 3, now: NOW,
    });
    expect(a).toEqual(b);
  });
});
