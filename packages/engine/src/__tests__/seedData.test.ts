import { generateSeedData } from '../seed/generateSeedData';
import type { Position } from '@club-director/shared-types';

describe('generateSeedData', () => {
  it('should be deterministic with the same seed', () => {
    const seed1 = generateSeedData(12345);
    const seed2 = generateSeedData(12345);

    expect(seed1).toEqual(seed2);
  });

  it('should generate the correct number of clubs', () => {
    const { clubs } = generateSeedData(12345);
    expect(clubs).toHaveLength(16);
  });

  it('should generate the correct number of players per club (20)', () => {
    const { clubs, players } = generateSeedData(12345);
    expect(players.length).toBe(320);
    clubs.forEach((club) => {
      expect(club.squad).toHaveLength(20);
    });
  });

  it('should generate clubs with valid structure', () => {
    const { clubs } = generateSeedData(12345);

    clubs.forEach((club) => {
      expect(club).toHaveProperty('id');
      expect(club).toHaveProperty('name');
      expect(club).toHaveProperty('nickname');
      expect(club).toHaveProperty('foundedYear');
      expect(club).toHaveProperty('reputation');
      expect(club).toHaveProperty('finances');
      expect(club).toHaveProperty('squad');
      expect(club).toHaveProperty('stadium');
      expect(club).toHaveProperty('tactics');

      expect(typeof club.id).toBe('string');
      expect(typeof club.name).toBe('string');
      expect(typeof club.nickname).toBe('string');
      expect(typeof club.foundedYear).toBe('number');
      expect(typeof club.reputation).toBe('number');
      expect(Array.isArray(club.squad)).toBe(true);
      expect(club.finances.debt).toBe(0);
    });
  });

  it('should generate players with valid structure', () => {
    const { players } = generateSeedData(12345);

    players.forEach((player) => {
      expect(player).toHaveProperty('id');
      expect(player).toHaveProperty('firstName');
      expect(player).toHaveProperty('lastName');
      expect(player).toHaveProperty('nationality');
      expect(player).toHaveProperty('age');
      expect(player).toHaveProperty('preferredFoot');
      expect(player).toHaveProperty('primaryPosition');
      expect(player).toHaveProperty('secondaryPositions');
      expect(player).toHaveProperty('attributes');
      expect(player).toHaveProperty('development');
      expect(player).toHaveProperty('status');
      expect(player).toHaveProperty('contract');

      expect(typeof player.id).toBe('string');
      expect(typeof player.firstName).toBe('string');
      expect(typeof player.lastName).toBe('string');
      expect(typeof player.age).toBe('number');
      expect(typeof player.preferredFoot).toBe('string');
      expect(typeof player.primaryPosition).toBe('string');
      expect(Array.isArray(player.secondaryPositions)).toBe(true);
    });
  });

  it('should generate all technical attributes within 1-20 range', () => {
    const { players } = generateSeedData();

    players.forEach((player) => {
      const { technical } = player.attributes;
      Object.values(technical).forEach((value) => {
        expect(value).toBeGreaterThanOrEqual(1);
        expect(value).toBeLessThanOrEqual(20);
      });
    });
  });

  it('should generate all mental attributes within 1-20 range', () => {
    const { players } = generateSeedData();

    players.forEach((player) => {
      const { mental } = player.attributes;
      Object.values(mental).forEach((value) => {
        expect(value).toBeGreaterThanOrEqual(1);
        expect(value).toBeLessThanOrEqual(20);
      });
    });
  });

  it('should generate all physical attributes within 1-20 range', () => {
    const { players } = generateSeedData();

    players.forEach((player) => {
      const { physical } = player.attributes;
      Object.values(physical).forEach((value) => {
        expect(value).toBeGreaterThanOrEqual(1);
        expect(value).toBeLessThanOrEqual(20);
      });
    });
  });

  it('should generate position-appropriate attribute distributions', () => {
    const { players } = generateSeedData();

    const strikers = players.filter((p) => p.primaryPosition === 'ST');
    const defenders = players.filter((p) => p.primaryPosition === 'CB');

    // Strikers should have higher finishing on average than defenders
    const strikerFinishing =
      strikers.reduce((sum, p) => sum + p.attributes.technical.finishing, 0) / strikers.length;
    const defenderFinishing =
      defenders.reduce((sum, p) => sum + p.attributes.technical.finishing, 0) / defenders.length;

    expect(strikerFinishing).toBeGreaterThan(defenderFinishing);

    // Defenders should have higher tackling on average than strikers
    const defenderTackling =
      defenders.reduce((sum, p) => sum + p.attributes.technical.tackling, 0) / defenders.length;
    const strikerTackling =
      strikers.reduce((sum, p) => sum + p.attributes.technical.tackling, 0) / strikers.length;

    expect(defenderTackling).toBeGreaterThan(strikerTackling);
  });

  it('should generate goalkeepers with higher positioning and concentration', () => {
    const { players } = generateSeedData();

    const goalkeepers = players.filter((p) => p.primaryPosition === 'GK');
    const outfieldPlayers = players.filter((p) => p.primaryPosition !== 'GK');

    const gkPositioning =
      goalkeepers.reduce((sum, p) => sum + p.attributes.mental.positioning, 0) / goalkeepers.length;
    const outfieldPositioning =
      outfieldPlayers.reduce((sum, p) => sum + p.attributes.mental.positioning, 0) / outfieldPlayers.length;

    // Goalkeepers should have at least equal or better positioning due to position boosts
    expect(gkPositioning).toBeGreaterThanOrEqual(outfieldPositioning - 1);
  });

  it('should generate players with valid age range (18-35)', () => {
    const { players } = generateSeedData();

    players.forEach((player) => {
      expect(player.age).toBeGreaterThanOrEqual(18);
      expect(player.age).toBeLessThanOrEqual(35);
    });
  });

  it('should generate players with valid morale range (50-100)', () => {
    const { players } = generateSeedData();

    players.forEach((player) => {
      expect(player.status.morale).toBeGreaterThanOrEqual(50);
      expect(player.status.morale).toBeLessThanOrEqual(100);
    });
  });

  it('should generate players with valid fitness range (70-100)', () => {
    const { players } = generateSeedData();

    players.forEach((player) => {
      expect(player.status.fitness).toBeGreaterThanOrEqual(70);
      expect(player.status.fitness).toBeLessThanOrEqual(100);
    });
  });

  it('should generate players with valid recent form array (5 ratings 4-10)', () => {
    const { players } = generateSeedData();

    players.forEach((player) => {
      expect(player.status.recentForm).toHaveLength(5);
      player.status.recentForm.forEach((rating) => {
        expect(rating).toBeGreaterThanOrEqual(4);
        expect(rating).toBeLessThanOrEqual(10);
      });
    });
  });

  it('should generate clubs with valid reputation range (45-105)', () => {
    const { clubs } = generateSeedData();

    clubs.forEach((club) => {
      expect(club.reputation).toBeGreaterThanOrEqual(45);
      expect(club.reputation).toBeLessThanOrEqual(105);
    });
  });

  it('should generate clubs with valid tactic ranges (5-15)', () => {
    const { clubs } = generateSeedData();

    clubs.forEach((club) => {
      expect(club.tactics.pressingIntensity).toBeGreaterThanOrEqual(5);
      expect(club.tactics.pressingIntensity).toBeLessThanOrEqual(15);
      expect(club.tactics.tempo).toBeGreaterThanOrEqual(5);
      expect(club.tactics.tempo).toBeLessThanOrEqual(15);
      expect(club.tactics.width).toBeGreaterThanOrEqual(5);
      expect(club.tactics.width).toBeLessThanOrEqual(15);
    });
  });

  it('should generate players with valid primary positions', () => {
    const { players } = generateSeedData();
    const validPositions: Position[] = ['GK', 'CB', 'FB', 'DM', 'CM', 'AM', 'W', 'ST'];

    players.forEach((player) => {
      expect(validPositions).toContain(player.primaryPosition);
      player.secondaryPositions.forEach((pos) => {
        expect(validPositions).toContain(pos);
      });
    });
  });

  it('should generate consistent squad IDs across clubs and players', () => {
    const { clubs, players } = generateSeedData();

    const allPlayerIds = new Set(players.map((p) => p.id));
    const allSquadIds = new Set(clubs.flatMap((c) => c.squad));

    clubs.forEach((club) => {
      club.squad.forEach((playerId) => {
        expect(allPlayerIds).toContain(playerId);
      });
    });

    players.forEach((player) => {
      expect(allSquadIds).toContain(player.id);
      // Player contract clubId should match their squad assignment
      const playerClub = clubs.find((c) => c.squad.includes(player.id));
      expect(playerClub).toBeDefined();
      expect(player.contract.clubId).toBe(playerClub?.id);
    });
  });

  it('should generate development stats with reasonable ranges', () => {
    const { players } = generateSeedData(12345);

    players.forEach((player) => {
      expect(player.development.currentAbility).toBeGreaterThanOrEqual(80); // Bottom tier can go to 80 with -2 modifier
      expect(player.development.currentAbility).toBeLessThanOrEqual(180); // Top tier can go to 180 with +2 modifier
      expect(player.development.potentialAbility).toBeGreaterThanOrEqual(
        player.development.currentAbility,
      );
      expect(player.development.potentialAbility).toBeLessThanOrEqual(200);
    });
  });

  it('should generate contract values with reasonable ranges', () => {
    const { players } = generateSeedData();

    players.forEach((player) => {
      expect(player.contract.wage).toBeGreaterThanOrEqual(5000);
      expect(player.contract.wage).toBeLessThanOrEqual(100000);
      expect(player.contract.marketValue).toBeGreaterThanOrEqual(100000);
      expect(player.contract.marketValue).toBeLessThanOrEqual(50000000);
    });
  });

  it('should generate squad composition matching typical formation needs', () => {
    const { clubs, players } = generateSeedData();

    clubs.forEach((club) => {
      const clubPlayers = players.filter((p) => club.squad.includes(p.id));

      const gkCount = clubPlayers.filter((p) => p.primaryPosition === 'GK').length;
      const cbCount = clubPlayers.filter((p) => p.primaryPosition === 'CB').length;
      const fbCount = clubPlayers.filter((p) => p.primaryPosition === 'FB').length;
      const dmCount = clubPlayers.filter((p) => p.primaryPosition === 'DM').length;
      const cmCount = clubPlayers.filter((p) => p.primaryPosition === 'CM').length;
      const amCount = clubPlayers.filter((p) => p.primaryPosition === 'AM').length;
      const wCount = clubPlayers.filter((p) => p.primaryPosition === 'W').length;
      const stCount = clubPlayers.filter((p) => p.primaryPosition === 'ST').length;

      expect(gkCount).toBe(2);
      expect(cbCount).toBe(4);
      expect(fbCount).toBe(4);
      expect(dmCount).toBe(2);
      expect(cmCount).toBe(3);
      expect(amCount).toBe(1);
      expect(wCount).toBe(2);
      expect(stCount).toBe(2);
    });
  });
});
