import {
  generateFixtures,
  scheduledFixturesToLeagueFixtures,
} from '../season/scheduling';
import { computeStandings } from '../season/standings';
import { advanceMatchweek } from '../season/advanceMatchweek';
import { generateSeedData } from '../seed/generateSeedData';
import { League, Fixture, Season, Club, Player, StandingEntry } from '@club-director/shared-types';

describe('Season Scheduling', () => {
  describe('generateFixtures', () => {
    it('should generate correct number of fixtures for N clubs', () => {
      const clubIds = ['club-1', 'club-2', 'club-3', 'club-4'];
      const startDate = new Date('2024-08-01');

      const fixtures = generateFixtures(clubIds, startDate);

      // For N clubs, total fixtures should be N * (N - 1)
      const expectedFixtures = clubIds.length * (clubIds.length - 1);
      expect(fixtures.length).toBe(expectedFixtures);
    });

    it('should ensure every pair of clubs meets exactly twice (once home, once away)', () => {
      const clubIds = ['club-1', 'club-2', 'club-3', 'club-4'];
      const startDate = new Date('2024-08-01');

      const fixtures = generateFixtures(clubIds, startDate);

      // Check total number of fixtures
      const expectedFixtures = clubIds.length * (clubIds.length - 1);
      expect(fixtures.length).toBe(expectedFixtures);

      // Check each club appears in correct number of fixtures
      clubIds.forEach((clubId) => {
        const clubFixtures = fixtures.filter(
          (f) => f.homeClubId === clubId || f.awayClubId === clubId,
        );
        expect(clubFixtures.length).toBe(2 * (clubIds.length - 1));
      });
    });

    it('should spread fixtures across weekly matchweeks', () => {
      const clubIds = ['club-1', 'club-2', 'club-3', 'club-4'];
      const startDate = new Date('2024-08-01');

      const fixtures = generateFixtures(clubIds, startDate);

      // Each club should play approximately the same number of fixtures per week
      const expectedMatchweeks = 2 * (clubIds.length - 1);
      expect(fixtures.length).toBe(clubIds.length * (clubIds.length - 1));

      // Check that fixtures are distributed across matchweeks
      const weekCounts = new Map<number, number>();
      fixtures.forEach((f) => {
        weekCounts.set(f.matchweek, (weekCounts.get(f.matchweek) || 0) + 1);
      });

      expect(weekCounts.size).toBe(expectedMatchweeks);
    });

    it('should ensure each club appears exactly once per matchweek (even number of clubs)', () => {
      const clubIds = ['club-1', 'club-2', 'club-3', 'club-4'];
      const startDate = new Date('2024-08-01');

      const fixtures = generateFixtures(clubIds, startDate);

      const expectedMatchweeks = 2 * (clubIds.length - 1);

      for (let week = 1; week <= expectedMatchweeks; week++) {
        const weekFixtures = fixtures.filter((f) => f.matchweek === week);
        const clubCounts = new Map<string, number>();

        weekFixtures.forEach((f) => {
          clubCounts.set(f.homeClubId, (clubCounts.get(f.homeClubId) || 0) + 1);
          clubCounts.set(f.awayClubId, (clubCounts.get(f.awayClubId) || 0) + 1);
        });

        // Each club should appear exactly once (either as home or away)
        clubIds.forEach((clubId) => {
          const count = clubCounts.get(clubId) || 0;
          expect(count).toBe(1);
        });
      }
    });

    it('should handle odd number of clubs with bye weeks', () => {
      const clubIds = ['club-1', 'club-2', 'club-3'];
      const startDate = new Date('2024-08-01');

      const fixtures = generateFixtures(clubIds, startDate);

      const expectedMatchweeks = 2 * (clubIds.length - 1);

      for (let week = 1; week <= expectedMatchweeks; week++) {
        const weekFixtures = fixtures.filter((f) => f.matchweek === week);
        const clubCounts = new Map<string, number>();

        weekFixtures.forEach((f) => {
          clubCounts.set(f.homeClubId, (clubCounts.get(f.homeClubId) || 0) + 1);
          clubCounts.set(f.awayClubId, (clubCounts.get(f.awayClubId) || 0) + 1);
        });

        // Each club should appear at most once (some may have bye weeks)
        clubIds.forEach((clubId) => {
          const count = clubCounts.get(clubId) || 0;
          expect(count).toBeLessThanOrEqual(1);
        });
      }
    });

    it('should handle 2 clubs correctly', () => {
      const clubIds = ['club-1', 'club-2'];
      const startDate = new Date('2024-08-01');

      const fixtures = generateFixtures(clubIds, startDate);

      expect(fixtures.length).toBe(2);
      // Should have one fixture each way
      const homeFixtures = fixtures.filter((f) => f.homeClubId === 'club-1' && f.awayClubId === 'club-2');
      const awayFixtures = fixtures.filter((f) => f.homeClubId === 'club-2' && f.awayClubId === 'club-1');
      expect(homeFixtures.length).toBe(1);
      expect(awayFixtures.length).toBe(1);
    });

    it('should return empty array for single club', () => {
      const clubIds = ['club-1'];
      const startDate = new Date('2024-08-01');

      const fixtures = generateFixtures(clubIds, startDate);

      expect(fixtures.length).toBe(0);
    });
  });

  describe('scheduledFixturesToLeagueFixtures', () => {
    it('should convert scheduled fixtures to league fixtures format', () => {
      const scheduledFixtures = [
        {
          matchweek: 1,
          date: new Date('2024-08-01'),
          homeClubId: 'club-1',
          awayClubId: 'club-2',
        },
      ];

      const leagueFixtures = scheduledFixturesToLeagueFixtures(scheduledFixtures);

      expect(leagueFixtures).toHaveLength(1);
      expect(leagueFixtures[0].id).toBe('fixture-0');
      expect(leagueFixtures[0].homeClubId).toBe('club-1');
      expect(leagueFixtures[0].awayClubId).toBe('club-2');
      expect(leagueFixtures[0].week).toBe(1);
      expect(leagueFixtures[0].played).toBe(false);
    });
  });

  describe('computeStandings', () => {
    it('should calculate standings from played fixtures', () => {
      const league: League = {
        id: 'league-1',
        name: 'Test League',
        tier: 1,
        clubIds: ['club-1', 'club-2', 'club-3'],
        standings: { entries: [] },
        fixtures: [
          {
            id: 'fixture-1',
            homeClubId: 'club-1',
            awayClubId: 'club-2',
            week: 1,
            date: new Date('2024-08-01'),
            played: true,
            homeScore: 2,
            awayScore: 1,
          },
          {
            id: 'fixture-2',
            homeClubId: 'club-2',
            awayClubId: 'club-3',
            week: 1,
            date: new Date('2024-08-01'),
            played: true,
            homeScore: 0,
            awayScore: 0,
          },
        ],
      };

      const standings = computeStandings(league);

      expect(standings.entries).toHaveLength(3);

      // Club 1: won 1, GF 2, GA 1, GD 1, Points 3
      const club1 = standings.entries.find((e: StandingEntry) => e.clubId === 'club-1');
      expect(club1).toBeDefined();
      expect(club1?.played).toBe(1);
      expect(club1?.won).toBe(1);
      expect(club1?.drawn).toBe(0);
      expect(club1?.lost).toBe(0);
      expect(club1?.goalsFor).toBe(2);
      expect(club1?.goalsAgainst).toBe(1);
      expect(club1?.goalDifference).toBe(1);
      expect(club1?.points).toBe(3);

      // Club 2: lost 1, drawn 1, GF 1, GA 2, GD -1, Points 1
      const club2 = standings.entries.find((e: StandingEntry) => e.clubId === 'club-2');
      expect(club2).toBeDefined();
      expect(club2?.played).toBe(2);
      expect(club2?.won).toBe(0);
      expect(club2?.drawn).toBe(1);
      expect(club2?.lost).toBe(1);
      expect(club2?.goalsFor).toBe(1);
      expect(club2?.goalsAgainst).toBe(2);
      expect(club2?.goalDifference).toBe(-1);
      expect(club2?.points).toBe(1);

      // Club 3: drawn 1, GF 0, GA 0, GD 0, Points 1
      const club3 = standings.entries.find((e: StandingEntry) => e.clubId === 'club-3');
      expect(club3).toBeDefined();
      expect(club3?.played).toBe(1);
      expect(club3?.won).toBe(0);
      expect(club3?.drawn).toBe(1);
      expect(club3?.lost).toBe(0);
      expect(club3?.goalsFor).toBe(0);
      expect(club3?.goalsAgainst).toBe(0);
      expect(club3?.goalDifference).toBe(0);
      expect(club3?.points).toBe(1);
    });

    it('should sort standings by points, then goal difference, then goals scored', () => {
      const league: League = {
        id: 'league-1',
        name: 'Test League',
        tier: 1,
        clubIds: ['club-1', 'club-2', 'club-3'],
        standings: { entries: [] },
        fixtures: [
          {
            id: 'fixture-1',
            homeClubId: 'club-1',
            awayClubId: 'club-2',
            week: 1,
            date: new Date('2024-08-01'),
            played: true,
            homeScore: 3,
            awayScore: 0,
          },
          {
            id: 'fixture-2',
            homeClubId: 'club-2',
            awayClubId: 'club-3',
            week: 1,
            date: new Date('2024-08-01'),
            played: true,
            homeScore: 2,
            awayScore: 1,
          },
          {
            id: 'fixture-3',
            homeClubId: 'club-3',
            awayClubId: 'club-1',
            week: 2,
            date: new Date('2024-08-08'),
            played: true,
            homeScore: 1,
            awayScore: 0,
          },
        ],
      };

      const standings = computeStandings(league);

      // All have 3 points, sorted by GD: club-1 (GD 2), club-3 (GD 0), club-2 (GD -2)
      expect(standings.entries[0].clubId).toBe('club-1');
      expect(standings.entries[0].points).toBe(3);
      expect(standings.entries[0].goalDifference).toBe(2);
      expect(standings.entries[1].clubId).toBe('club-3');
      expect(standings.entries[1].points).toBe(3);
      expect(standings.entries[1].goalDifference).toBe(0);
      expect(standings.entries[2].clubId).toBe('club-2');
      expect(standings.entries[2].points).toBe(3);
      expect(standings.entries[2].goalDifference).toBe(-2);
    });

    it('should handle tie-break by goal difference', () => {
      const league: League = {
        id: 'league-1',
        name: 'Test League',
        tier: 1,
        clubIds: ['club-1', 'club-2'],
        standings: { entries: [] },
        fixtures: [
          {
            id: 'fixture-1',
            homeClubId: 'club-1',
            awayClubId: 'club-2',
            week: 1,
            date: new Date('2024-08-01'),
            played: true,
            homeScore: 2,
            awayScore: 0,
          },
          {
            id: 'fixture-2',
            homeClubId: 'club-2',
            awayClubId: 'club-1',
            week: 2,
            date: new Date('2024-08-08'),
            played: true,
            homeScore: 1,
            awayScore: 2,
          },
        ],
      };

      const standings = computeStandings(league);

      // Club 1 won both: 6 points, GF 4, GA 1, GD 3
      // Club 2 lost both: 0 points, GF 1, GA 4, GD -3
      expect(standings.entries[0].clubId).toBe('club-1');
      expect(standings.entries[0].points).toBe(6);
      expect(standings.entries[0].goalDifference).toBe(3);
      expect(standings.entries[1].clubId).toBe('club-2');
      expect(standings.entries[1].points).toBe(0);
      expect(standings.entries[1].goalDifference).toBe(-3);
    });

    it('should handle tie-break by goals scored when GD is equal', () => {
      const league: League = {
        id: 'league-1',
        name: 'Test League',
        tier: 1,
        clubIds: ['club-1', 'club-2'],
        standings: { entries: [] },
        fixtures: [
          {
            id: 'fixture-1',
            homeClubId: 'club-1',
            awayClubId: 'club-2',
            week: 1,
            date: new Date('2024-08-01'),
            played: true,
            homeScore: 3,
            awayScore: 1,
          },
          {
            id: 'fixture-2',
            homeClubId: 'club-2',
            awayClubId: 'club-1',
            week: 2,
            date: new Date('2024-08-08'),
            played: true,
            homeScore: 2,
            awayScore: 2,
          },
        ],
      };

      const standings = computeStandings(league);

      // Club 1: won 1, drawn 1 = 4 points, GF 5, GA 3, GD 2
      // Club 2: drawn 2 = 2 points, GF 3, GA 5, GD -2
      expect(standings.entries[0].clubId).toBe('club-1');
      expect(standings.entries[0].points).toBe(4);
      expect(standings.entries[0].goalsFor).toBe(5);
      expect(standings.entries[1].clubId).toBe('club-2');
      expect(standings.entries[1].points).toBeGreaterThanOrEqual(1);
      expect(standings.entries[1].goalsFor).toBe(3);
    });
  });

  describe('advanceMatchweek', () => {
    it('should advance season when no fixtures to play', () => {
      const seedData = generateSeedData();
      const clubs = seedData.clubs.slice(0, 2);
      const players = seedData.players;

      const season: Season = {
        id: 'season-1',
        leagueId: 'league-1',
        currentWeek: 1,
        currentDate: new Date('2024-08-01'),
        transferWindowOpen: true,
        fixturesCalendar: [],
      };

      const league: League = {
        id: 'league-1',
        name: 'Test League',
        tier: 1,
        clubIds: clubs.map((c) => c.id),
        standings: { entries: [] },
        fixtures: [],
      };

      const advancement = advanceMatchweek(season, league, clubs, players);

      expect(advancement.results).toHaveLength(0);
      expect(advancement.updatedSeason.currentWeek).toBe(2);
      expect(advancement.updatedSeason.currentDate).toEqual(new Date('2024-08-08'));
      expect(advancement.updatedClubs).toEqual(clubs);
      expect(advancement.transferOffers).toEqual([]);
    });

    it('should simulate fixtures and update standings', () => {
      const seedData = generateSeedData();
      const clubs = seedData.clubs.slice(0, 2);
      const players = seedData.players;

      const season: Season = {
        id: 'season-1',
        leagueId: 'league-1',
        currentWeek: 1,
        currentDate: new Date('2024-08-01'),
        transferWindowOpen: true,
        fixturesCalendar: [],
      };

      const league: League = {
        id: 'league-1',
        name: 'Test League',
        tier: 1,
        clubIds: clubs.map((c) => c.id),
        standings: { entries: [] },
        fixtures: [
          {
            id: 'fixture-1',
            homeClubId: clubs[0].id,
            awayClubId: clubs[1].id,
            week: 1,
            date: new Date('2024-08-01'),
            played: false,
          },
        ],
      };

      const advancement = advanceMatchweek(season, league, clubs, players);

      expect(advancement.results).toHaveLength(1);
      expect(advancement.updatedLeague.fixtures[0].played).toBe(true);
      expect(advancement.updatedLeague.fixtures[0].homeScore).toBeDefined();
      expect(advancement.updatedLeague.fixtures[0].awayScore).toBeDefined();
      expect(advancement.updatedSeason.currentWeek).toBe(2);
      expect(advancement.updatedClubs).toEqual(clubs);
      expect(advancement.transferOffers).toEqual([]);
    });

    it('should reduce fitness for players who played', () => {
      const seedData = generateSeedData();
      const clubs = seedData.clubs.slice(0, 2);
      const players = seedData.players;

      const initialFitness = players[0].status.fitness;

      const season: Season = {
        id: 'season-1',
        leagueId: 'league-1',
        currentWeek: 1,
        currentDate: new Date('2024-08-01'),
        transferWindowOpen: true,
        fixturesCalendar: [],
      };

      const league: League = {
        id: 'league-1',
        name: 'Test League',
        tier: 1,
        clubIds: clubs.map((c) => c.id),
        standings: { entries: [] },
        fixtures: [
          {
            id: 'fixture-1',
            homeClubId: clubs[0].id,
            awayClubId: clubs[1].id,
            week: 1,
            date: new Date('2024-08-01'),
            played: false,
          },
        ],
      };

      const advancement = advanceMatchweek(season, league, clubs, players);

      const updatedPlayer = advancement.updatedPlayers.find((p: Player) => p.id === players[0].id);
      expect(updatedPlayer).toBeDefined();
      expect(updatedPlayer?.status.fitness).toBeLessThan(initialFitness);
      expect(advancement.updatedClubs).toEqual(clubs);
      expect(advancement.transferOffers).toEqual([]);
    });

    it('should recover fitness for players who did not play', () => {
      const seedData = generateSeedData();
      const clubs = seedData.clubs.slice(0, 2);
      const players = seedData.players;

      // Reduce fitness of first player
      players[0].status.fitness = 50;

      const season: Season = {
        id: 'season-1',
        leagueId: 'league-1',
        currentWeek: 1,
        currentDate: new Date('2024-08-01'),
        transferWindowOpen: true,
        fixturesCalendar: [],
      };

      const league: League = {
        id: 'league-1',
        name: 'Test League',
        tier: 1,
        clubIds: clubs.map((c) => c.id),
        standings: { entries: [] },
        fixtures: [],
      };

      const advancement = advanceMatchweek(season, league, clubs, players);

      const updatedPlayer = advancement.updatedPlayers.find((p: Player) => p.id === players[0].id);
      expect(updatedPlayer).toBeDefined();
      expect(updatedPlayer?.status.fitness).toBeGreaterThan(50);
      expect(advancement.updatedClubs).toEqual(clubs);
      expect(advancement.transferOffers).toEqual([]);
    });
  });

  describe('Full-season integration test', () => {
    it('should advance an entire season to completion for 6 clubs', () => {
      const seedData = generateSeedData();
      const clubs = seedData.clubs.slice(0, 6);
      const players = seedData.players;

      // Create fixtures
      const clubIds = clubs.map((c) => c.id);
      const startDate = new Date('2024-08-01');
      const scheduledFixtures = generateFixtures(clubIds, startDate);
      const fixtures = scheduledFixturesToLeagueFixtures(scheduledFixtures);

      const season: Season = {
        id: 'season-1',
        leagueId: 'league-1',
        currentWeek: 1,
        currentDate: startDate,
        transferWindowOpen: true,
        fixturesCalendar: fixtures,
      };

      const league: League = {
        id: 'league-1',
        name: 'Test League',
        tier: 1,
        clubIds,
        standings: { entries: [] },
        fixtures,
      };

      // Advance through all matchweeks
      let currentSeason = season;
      let currentLeague = league;
      let currentPlayers = players;

      const totalMatchweeks = 2 * (clubs.length - 1);

      for (let week = 1; week <= totalMatchweeks; week++) {
        const advancement = advanceMatchweek(
          currentSeason,
          currentLeague,
          clubs,
          currentPlayers,
        );

        currentSeason = advancement.updatedSeason;
        currentLeague = advancement.updatedLeague;
        currentPlayers = advancement.updatedPlayers;
      }

      // Verify all fixtures are played
      const allPlayed = currentLeague.fixtures.every((f) => f.played);
      expect(allPlayed).toBe(true);

      // Verify final standings have correct played count
      currentLeague.standings.entries.forEach((entry) => {
        expect(entry.played).toBe(2 * (clubs.length - 1));
      });

      // Verify season is at correct week
      expect(currentSeason.currentWeek).toBe(totalMatchweeks + 1);
    });
  });

  describe('Player effects test', () => {
    it('should decrease fitness after playing and recover over non-playing weeks', () => {
      const seedData = generateSeedData();
      const clubs = seedData.clubs.slice(0, 2);
      const players = seedData.players;

      const initialFitness = players[0].status.fitness;

      const season: Season = {
        id: 'season-1',
        leagueId: 'league-1',
        currentWeek: 1,
        currentDate: new Date('2024-08-01'),
        transferWindowOpen: true,
        fixturesCalendar: [],
      };

      const league: League = {
        id: 'league-1',
        name: 'Test League',
        tier: 1,
        clubIds: clubs.map((c) => c.id),
        standings: { entries: [] },
        fixtures: [
          {
            id: 'fixture-1',
            homeClubId: clubs[0].id,
            awayClubId: clubs[1].id,
            week: 1,
            date: new Date('2024-08-01'),
            played: false,
          },
        ],
      };

      // Play week 1
      let advancement = advanceMatchweek(season, league, clubs, players);
      let updatedPlayer = advancement.updatedPlayers.find((p: Player) => p.id === players[0].id);
      const fitnessAfterPlaying = updatedPlayer?.status.fitness || 0;

      expect(fitnessAfterPlaying).toBeLessThan(initialFitness);

      // Play week 2 with no fixtures (player should recover)
      const season2 = advancement.updatedSeason;
      const league2 = {
        ...advancement.updatedLeague,
        fixtures: [],
      };

      advancement = advanceMatchweek(season2, league2, clubs, advancement.updatedPlayers);
      updatedPlayer = advancement.updatedPlayers.find((p: Player) => p.id === players[0].id);
      const fitnessAfterRecovery = updatedPlayer?.status.fitness || 0;

      expect(fitnessAfterRecovery).toBeGreaterThan(fitnessAfterPlaying);
      expect(advancement.updatedClubs).toEqual(clubs);
      expect(advancement.transferOffers).toEqual([]);
    });

    it('should handle injury recovery over time', () => {
      const seedData = generateSeedData();
      const clubs = seedData.clubs.slice(0, 2);
      const players = seedData.players;

      // Set an injury on first player
      players[0].status.injury = {
        type: 'Test injury',
        daysRemaining: 3,
        severity: 'minor',
      };

      const season: Season = {
        id: 'season-1',
        leagueId: 'league-1',
        currentWeek: 1,
        currentDate: new Date('2024-08-01'),
        transferWindowOpen: true,
        fixturesCalendar: [],
      };

      const league: League = {
        id: 'league-1',
        name: 'Test League',
        tier: 1,
        clubIds: clubs.map((c) => c.id),
        standings: { entries: [] },
        fixtures: [],
      };

      // Advance 3 weeks with no fixtures
      let currentSeason = season;
      let currentLeague = league;
      let currentPlayers = players;

      for (let i = 0; i < 3; i++) {
        const advancement = advanceMatchweek(
          currentSeason,
          currentLeague,
          clubs,
          currentPlayers,
        );
        currentSeason = advancement.updatedSeason;
        currentLeague = advancement.updatedLeague;
        currentPlayers = advancement.updatedPlayers;
      }

      const updatedPlayer = currentPlayers.find((p: Player) => p.id === players[0].id);
      expect(updatedPlayer?.status.injury).toBeNull();
    });

    it('should keep fitness clamped to 0-100 over 10 consecutive matchweeks', () => {
      const seedData = generateSeedData();
      const clubs = seedData.clubs.slice(0, 4);
      const players = seedData.players;

      // Generate fixtures for 4 clubs
      const clubIds = clubs.map((c) => c.id);
      const startDate = new Date('2024-08-01');
      const scheduledFixtures = generateFixtures(clubIds, startDate);
      const fixtures = scheduledFixturesToLeagueFixtures(scheduledFixtures);

      const season: Season = {
        id: 'season-1',
        leagueId: 'league-1',
        currentWeek: 1,
        currentDate: startDate,
        transferWindowOpen: true,
        fixturesCalendar: fixtures,
      };

      const league: League = {
        id: 'league-1',
        name: 'Test League',
        tier: 1,
        clubIds,
        standings: { entries: [] },
        fixtures,
      };

      // Advance 10 matchweeks
      let currentSeason = season;
      let currentLeague = league;
      let currentPlayers = players;

      for (let week = 1; week <= 10; week++) {
        const advancement = advanceMatchweek(
          currentSeason,
          currentLeague,
          clubs,
          currentPlayers,
        );

        // Check all players have fitness in valid range
        advancement.updatedPlayers.forEach((player: Player) => {
          expect(player.status.fitness).toBeGreaterThanOrEqual(0);
          expect(player.status.fitness).toBeLessThanOrEqual(100);
        });

        currentSeason = advancement.updatedSeason;
        currentLeague = advancement.updatedLeague;
        currentPlayers = advancement.updatedPlayers;
      }
    });
  });
});
