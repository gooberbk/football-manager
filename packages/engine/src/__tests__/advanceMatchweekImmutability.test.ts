import { advanceMatchweek } from '../season/advanceMatchweek';
import { generateSeedData } from '../seed/generateSeedData';
import {
  generateFixtures,
  scheduledFixturesToLeagueFixtures,
} from '../season/scheduling';
import type { League, Season, StandingEntry } from '@club-director/shared-types';

describe('advanceMatchweek immutability', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('does not mutate input clubs/players while returning updated state', () => {
    // Force every club to attempt AI transfer activity (15% gate -> 0.1 passes)
    // so the run exercises both post-match effects and transfer execution.
    jest.spyOn(Math, 'random').mockReturnValue(0.1);

    const seedData = generateSeedData(12345);
    const clubs = seedData.clubs.slice(0, 6);
    const players = seedData.players.filter((p) =>
      clubs.some((c) => c.squad.includes(p.id)),
    );

    const league: League = {
      id: 'league-1',
      name: 'Test League',
      tier: 1,
      clubIds: clubs.map((c) => c.id),
      standings: {
        entries: clubs.map(
          (club): StandingEntry => ({
            clubId: club.id,
            played: 0,
            won: 0,
            drawn: 0,
            lost: 0,
            goalsFor: 0,
            goalsAgainst: 0,
            goalDifference: 0,
            points: 0,
          }),
        ),
      },
      fixtures: scheduledFixturesToLeagueFixtures(
        generateFixtures(clubs.map((c) => c.id), new Date('2024-08-01')),
      ),
    };

    const season: Season = {
      id: 'season-1',
      leagueId: 'league-1',
      currentWeek: 1,
      currentDate: new Date('2024-08-01'),
      transferWindowOpen: true,
      fixturesCalendar: [],
    };

    const clubsSnapshot = JSON.stringify(clubs);
    const playersSnapshot = JSON.stringify(players);
    const leagueSnapshot = JSON.stringify(league);
    const seasonSnapshot = JSON.stringify(season);

    const advancement = advanceMatchweek(season, league, clubs, players, {
      managedClubId: clubs[0].id,
    });

    // Inputs — including every nested property — are completely unchanged.
    expect(JSON.stringify(clubs)).toBe(clubsSnapshot);
    expect(JSON.stringify(players)).toBe(playersSnapshot);
    expect(JSON.stringify(league)).toBe(leagueSnapshot);
    expect(JSON.stringify(season)).toBe(seasonSnapshot);

    // Returned state reflects the simulated matchweek.
    const week1Fixtures = league.fixtures.filter((f) => f.week === 1);
    expect(week1Fixtures.length).toBeGreaterThan(0);
    expect(advancement.results).toHaveLength(week1Fixtures.length);

    week1Fixtures.forEach((fixture) => {
      const updated = advancement.updatedLeague.fixtures.find(
        (f) => f.id === fixture.id,
      )!;
      expect(updated.played).toBe(true);
      expect(updated.homeScore).toBeDefined();
      expect(updated.awayScore).toBeDefined();
    });

    expect(advancement.updatedSeason.currentWeek).toBe(
      season.currentWeek + 1,
    );

    const totalPlayed = advancement.updatedLeague.standings.entries.reduce(
      (sum, entry) => sum + entry.played,
      0,
    );
    expect(totalPlayed).toBe(week1Fixtures.length * 2);

    // Post-match effects actually changed player status in the returned data.
    expect(
      advancement.updatedPlayers.some(
        (p, i) => p.status.fitness !== players[i].status.fitness,
      ),
    ).toBe(true);

    // Squad/ownership consistency after any AI transfers that executed.
    const squadOwner = new Map<string, string>();
    advancement.updatedClubs.forEach((club) =>
      club.squad.forEach((pid) => squadOwner.set(pid, club.id)),
    );
    advancement.updatedPlayers.forEach((player) => {
      expect(squadOwner.get(player.id)).toBe(player.contract.clubId);
    });
    advancement.updatedClubs.forEach((club) => {
      club.squad.forEach((pid) => {
        expect(
          advancement.updatedPlayers.some((p) => p.id === pid),
        ).toBe(true);
      });
    });
  });
});
