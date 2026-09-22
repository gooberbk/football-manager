import { simulateMatch } from '../match/simulation';
import { generateSeedData } from '../seed/generateSeedData';

describe('simulateMatch - Legacy Compatibility', () => {
  it('should work with seed data generator', () => {
    const seedData = generateSeedData(12345);
    const clubs = seedData.clubs;
    const players = seedData.players;

    const playerMap: any = {};
    players.forEach((p: any) => {
      playerMap[p.id] = p;
    });

    const result = simulateMatch(clubs[0], clubs[1], playerMap, playerMap, 12345);

    expect(result).toHaveProperty('homeScore');
    expect(result).toHaveProperty('awayScore');
    expect(result).toHaveProperty('events');
    expect(result).toHaveProperty('stats');
    expect(result).toHaveProperty('seed');
  });
});
