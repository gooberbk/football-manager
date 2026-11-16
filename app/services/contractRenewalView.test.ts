import {
  isRenewalOfferedFor,
  parseRenewalWageInput,
  renewalDemandFor,
  renewalRejectionMessage,
  RENEWAL_DURATION_OPTIONS,
} from './contractRenewalView';
import type { ContractRenewalRejection } from './contractService';
import type { Player, PlayerAttributes } from '@club-director/shared-types';

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

function makePlayer(clubId: string | null = 'club-1'): Player {
  return {
    id: 'p1',
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
      morale: 75,
      recentForm: [7, 7, 7, 7, 7],
      fitness: 90,
      injury: null,
    },
    contract: {
      clubId,
      wage: 10_000,
      contractExpiryDate: new Date(NOW.getTime() + 6 * MONTH_MS),
      marketValue: 1_000_000,
    },
  };
}

describe('contractRenewalView', () => {
  describe('isRenewalOfferedFor', () => {
    it('offers renewal only for players contracted to the managed club', () => {
      const player = makePlayer('club-1');
      expect(isRenewalOfferedFor(player, 'club-1')).toBe(true);
      expect(isRenewalOfferedFor(player, 'club-2')).toBe(false);
      expect(isRenewalOfferedFor(player, null)).toBe(false);
      expect(isRenewalOfferedFor(makePlayer(null), 'club-1')).toBe(false);
    });
  });

  describe('renewalDemandFor', () => {
    it('returns the engine demand and null on corrupt data', () => {
      // max(wage 10_000, ability 120 * 1000) = 120_000
      expect(renewalDemandFor(makePlayer(), NOW)).toBe(120_000);
      const corrupt = makePlayer();
      corrupt.contract = { ...corrupt.contract, wage: NaN };
      expect(renewalDemandFor(corrupt, NOW)).toBeNull();
    });
  });

  describe('parseRenewalWageInput', () => {
    it('accepts plain positive integers only', () => {
      expect(parseRenewalWageInput('120000')).toBe(120000);
      expect(parseRenewalWageInput(' 50000 ')).toBe(50000);
      expect(parseRenewalWageInput('0')).toBeNull();
      expect(parseRenewalWageInput('-5')).toBeNull();
      expect(parseRenewalWageInput('12.5')).toBeNull();
      expect(parseRenewalWageInput('abc')).toBeNull();
      expect(parseRenewalWageInput('')).toBeNull();
      expect(parseRenewalWageInput('1e6')).toBeNull();
    });
  });

  describe('renewalRejectionMessage', () => {
    it('maps every rejection reason to a user-facing message', () => {
      const reasons: ContractRenewalRejection[] = [
        'wage_below_demand', 'free_agent', 'not_club_member',
        'contract_expired', 'outside_renewal_window', 'invalid_duration',
        'invalid_wage', 'invalid_player_id', 'player_not_found',
        'managed_club_not_found', 'season_unavailable',
        'contract_data_invalid',
      ];
      for (const reason of reasons) {
        const message = renewalRejectionMessage(reason, null);
        expect(message.length).toBeGreaterThan(0);
        // Technical constants are never leaked verbatim.
        expect(message).not.toContain(reason);
      }
    });

    it('includes the wage demand when available', () => {
      const message = renewalRejectionMessage('wage_below_demand', 120000);
      expect(message).toContain('120,000');
      const noDemand = renewalRejectionMessage('wage_below_demand', null);
      expect(noDemand).not.toContain('minimum');
    });
  });

  it('exposes exactly the three engine durations', () => {
    expect([...RENEWAL_DURATION_OPTIONS]).toEqual([1, 2, 3]);
  });
});
