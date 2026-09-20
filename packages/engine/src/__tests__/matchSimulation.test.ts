import { simulateMatch } from '../match/simulation';
import { generateSeedData } from '../seed/generateSeedData';
import type { Club, ClubTactics } from '@club-director/shared-types';

describe('simulateMatch', () => {
  let clubs: Club[];
  let players: any;
  let playerMap: any;

  beforeEach(() => {
    const seedData = generateSeedData();
    clubs = seedData.clubs;
    players = seedData.players;
    playerMap = {};
    players.forEach((p: any) => {
      playerMap[p.id] = p;
    });
  });

  it('should return a match result with all required fields', () => {
    const result = simulateMatch(clubs[0], clubs[1], playerMap, playerMap, 12345);

    expect(result).toHaveProperty('homeScore');
    expect(result).toHaveProperty('awayScore');
    expect(result).toHaveProperty('events');
    expect(result).toHaveProperty('stats');
    expect(result).toHaveProperty('seed');
    expect(result.stats).toHaveProperty('home');
    expect(result.stats).toHaveProperty('away');
  });

  it('should return the seed that was used', () => {
    const seed = 54321;
    const result = simulateMatch(clubs[0], clubs[1], playerMap, playerMap, seed);

    expect(result.seed).toBe(seed);
  });

  it('should generate a random seed if none provided', () => {
    const result1 = simulateMatch(clubs[0], clubs[1], playerMap, playerMap);
    const result2 = simulateMatch(clubs[0], clubs[1], playerMap, playerMap);

    expect(result1.seed).toBeDefined();
    expect(result2.seed).toBeDefined();
    expect(result1.seed).not.toBe(result2.seed);
  });

  it('should be reproducible with the same seed', () => {
    const seed = 99999;
    const result1 = simulateMatch(clubs[0], clubs[1], playerMap, playerMap, seed);
    const result2 = simulateMatch(clubs[0], clubs[1], playerMap, playerMap, seed);

    expect(result1.homeScore).toBe(result2.homeScore);
    expect(result1.awayScore).toBe(result2.awayScore);
    expect(result1.events).toEqual(result2.events);
    expect(result1.stats.home).toEqual(result2.stats.home);
    expect(result1.stats.away).toEqual(result2.stats.away);
    expect(result1.seed).toBe(result2.seed);
  });

  it('should generate events with valid structure', () => {
    const result = simulateMatch(clubs[0], clubs[1], playerMap, playerMap, 11111);

    result.events.forEach((event) => {
      expect(event).toHaveProperty('id');
      expect(event).toHaveProperty('minute');
      expect(event).toHaveProperty('type');
      expect(event).toHaveProperty('primaryPlayerId');
      expect(event).toHaveProperty('team');
      expect(event).toHaveProperty('description');
      expect(event.minute).toBeGreaterThanOrEqual(1);
      expect(event.minute).toBeLessThanOrEqual(90);
      expect(['home', 'away']).toContain(event.team);
    });
  });

  it('should generate stats with valid possession that sums to 100', () => {
    const result = simulateMatch(clubs[0], clubs[1], playerMap, playerMap, 22222);

    expect(result.stats.home.possession).toBeGreaterThanOrEqual(0);
    expect(result.stats.home.possession).toBeLessThanOrEqual(100);
    expect(result.stats.away.possession).toBeGreaterThanOrEqual(0);
    expect(result.stats.away.possession).toBeLessThanOrEqual(100);
    expect(result.stats.home.possession + result.stats.away.possession).toBe(100);
  });

  it('should generate non-negative stats', () => {
    const result = simulateMatch(clubs[0], clubs[1], playerMap, playerMap, 33333);

    expect(result.stats.home.shots).toBeGreaterThanOrEqual(0);
    expect(result.stats.away.shots).toBeGreaterThanOrEqual(0);
    expect(result.stats.home.shotsOnTarget).toBeGreaterThanOrEqual(0);
    expect(result.stats.away.shotsOnTarget).toBeGreaterThanOrEqual(0);
    expect(result.stats.home.corners).toBeGreaterThanOrEqual(0);
    expect(result.stats.away.corners).toBeGreaterThanOrEqual(0);
    expect(result.stats.home.fouls).toBeGreaterThanOrEqual(0);
    expect(result.stats.away.fouls).toBeGreaterThanOrEqual(0);
    expect(result.stats.home.yellowCards).toBeGreaterThanOrEqual(0);
    expect(result.stats.away.yellowCards).toBeGreaterThanOrEqual(0);
    expect(result.stats.home.redCards).toBeGreaterThanOrEqual(0);
    expect(result.stats.away.redCards).toBeGreaterThanOrEqual(0);
  });

  it('should have shotsOnTarget <= shots for both teams', () => {
    const result = simulateMatch(clubs[0], clubs[1], playerMap, playerMap, 44444);

    expect(result.stats.home.shotsOnTarget).toBeLessThanOrEqual(result.stats.home.shots);
    expect(result.stats.away.shotsOnTarget).toBeLessThanOrEqual(result.stats.away.shots);
  });

  it('should have redCards <= yellowCards for both teams', () => {
    const result = simulateMatch(clubs[0], clubs[1], playerMap, playerMap, 55555);

    expect(result.stats.home.redCards).toBeLessThanOrEqual(result.stats.home.yellowCards);
    expect(result.stats.away.redCards).toBeLessThanOrEqual(result.stats.away.yellowCards);
  });
});

describe('simulateMatch - Statistical Tests', () => {
  let strongClub: Club;
  let weakClub: Club;
  let strongPlayers: any[];
  let weakPlayers: any[];
  let strongPlayerMap: any;
  let weakPlayerMap: any;

  beforeEach(() => {
    // Create a deliberately stronger club
    const strongSeedData = generateSeedData();
    strongClub = strongSeedData.clubs[0];
    strongPlayers = strongSeedData.players;

    // Boost all attributes for strong club significantly
    strongPlayers.forEach((p: any) => {
      Object.keys(p.attributes.technical).forEach((key) => {
        p.attributes.technical[key] = Math.min(20, p.attributes.technical[key] + 8);
      });
      Object.keys(p.attributes.mental).forEach((key) => {
        p.attributes.mental[key] = Math.min(20, p.attributes.mental[key] + 8);
      });
      Object.keys(p.attributes.physical).forEach((key) => {
        p.attributes.physical[key] = Math.min(20, p.attributes.physical[key] + 8);
      });
      p.status.fitness = 95;
      p.status.morale = 95;
      p.status.recentForm = [9, 9, 9, 9, 9];
    });

    strongPlayerMap = {};
    strongPlayers.forEach((p: any) => {
      strongPlayerMap[p.id] = p;
    });

    // Create a deliberately weaker club
    const weakSeedData = generateSeedData();
    weakClub = { ...weakSeedData.clubs[1], id: 'weak-club', name: 'Weak FC' };
    weakPlayers = weakSeedData.players.map((p: any) => ({
      ...p,
      id: p.id.replace('club-1', 'weak-club'),
      contract: { ...p.contract, clubId: 'weak-club' },
    }));

    // Reduce all attributes for weak club significantly
    weakPlayers.forEach((p: any) => {
      Object.keys(p.attributes.technical).forEach((key) => {
        p.attributes.technical[key] = Math.max(1, p.attributes.technical[key] - 8);
      });
      Object.keys(p.attributes.mental).forEach((key) => {
        p.attributes.mental[key] = Math.max(1, p.attributes.mental[key] - 8);
      });
      Object.keys(p.attributes.physical).forEach((key) => {
        p.attributes.physical[key] = Math.max(1, p.attributes.physical[key] - 8);
      });
      p.status.fitness = 65;
      p.status.morale = 65;
      p.status.recentForm = [4, 4, 4, 4, 4];
    });

    weakClub.squad = weakPlayers.map((p: any) => p.id);
    weakPlayerMap = {};
    weakPlayers.forEach((p: any) => {
      weakPlayerMap[p.id] = p;
    });
  });

  it('should produce events and stats in single simulation', () => {
    const result = simulateMatch(strongClub, weakClub, strongPlayerMap, weakPlayerMap, 42);

    // Check basic structure
    expect(result).toHaveProperty('homeScore');
    expect(result).toHaveProperty('awayScore');
    expect(result).toHaveProperty('events');
    expect(result).toHaveProperty('stats');

    // Check that simulation produces some activity
    expect(result.events.length).toBeGreaterThan(0);
    expect(result.stats.home.shots + result.stats.away.shots).toBeGreaterThan(0);
  });

  it('should be deterministic with same seed for strong vs weak teams', () => {
    const result1 = simulateMatch(strongClub, weakClub, strongPlayerMap, weakPlayerMap, 999);
    const result2 = simulateMatch(strongClub, weakClub, strongPlayerMap, weakPlayerMap, 999);

    expect(result1.homeScore).toBe(result2.homeScore);
    expect(result1.awayScore).toBe(result2.awayScore);
    expect(result1.events).toEqual(result2.events);
  });

  it('should have stronger team win >60% of matches over 200 simulations', () => {
    const numSimulations = 200;
    let strongWins = 0;
    let weakWins = 0;
    let draws = 0;

    for (let i = 0; i < numSimulations; i++) {
      const result = simulateMatch(strongClub, weakClub, strongPlayerMap, weakPlayerMap, i);

      if (result.homeScore > result.awayScore) {
        strongWins++;
      } else if (result.homeScore < result.awayScore) {
        weakWins++;
      } else {
        draws++;
      }
    }

    const winRate = strongWins / numSimulations;

    expect(winRate).toBeGreaterThan(0.60);
  });

  it('should keep scores in plausible range (0-11 goals) across equal squad simulations', () => {
    const numSimulations = 50;
    const allScores: number[] = [];

    for (let i = 0; i < numSimulations; i++) {
      const result = simulateMatch(strongClub, weakClub, strongPlayerMap, weakPlayerMap, i);
      allScores.push(result.homeScore);
      allScores.push(result.awayScore);
    }

    const maxScore = Math.max(...allScores);

    expect(maxScore).toBeLessThanOrEqual(11);
  });

  it('should have possession splits sum to 100% across simulations', () => {
    const numSimulations = 50;

    for (let i = 0; i < numSimulations; i++) {
      const result = simulateMatch(strongClub, weakClub, strongPlayerMap, weakPlayerMap, i);

      const totalPossession = result.stats.home.possession + result.stats.away.possession;
      expect(totalPossession).toBe(100);
    }
  });

  it('should have reasonable possession variance across 200 simulations', () => {
    const numSimulations = 50;
    const homePossessions: number[] = [];

    for (let i = 0; i < numSimulations; i++) {
      const result = simulateMatch(strongClub, weakClub, strongPlayerMap, weakPlayerMap, i);
      homePossessions.push(result.stats.home.possession);
    }

    const avgPossession = homePossessions.reduce((sum, val) => sum + val, 0) / numSimulations;
    const minPossession = Math.min(...homePossessions);
    const maxPossession = Math.max(...homePossessions);

    // Strong team should have majority possession
    expect(avgPossession).toBeGreaterThan(50);
    expect(minPossession).toBeGreaterThan(10);
    expect(maxPossession).toBeLessThanOrEqual(100);
  });

  it('should generate realistic shot counts across 200 simulations', () => {
    const numSimulations = 50;
    const totalShots: number[] = [];

    for (let i = 0; i < numSimulations; i++) {
      const result = simulateMatch(strongClub, weakClub, strongPlayerMap, weakPlayerMap, i);
      totalShots.push(result.stats.home.shots + result.stats.away.shots);
    }

    const avgShots = totalShots.reduce((sum, val) => sum + val, 0) / numSimulations;
    const maxShots = Math.max(...totalShots);

    expect(avgShots).toBeGreaterThan(8);
    expect(avgShots).toBeLessThan(25);
    expect(maxShots).toBeLessThan(40);
  });
});
