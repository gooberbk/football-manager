import { isSeasonComplete } from '../season/completion';
import { advanceMatchweek } from '../season/advanceMatchweek';
import { generateFixtures, scheduledFixturesToLeagueFixtures } from '../season/scheduling';
import { generateSeedData } from '../seed/generateSeedData';
import { League, Season, Fixture, Club, Player } from '@club-director/shared-types';

const makeFixture = (overrides: Partial<Fixture> = {}): Fixture => ({
  id: 'fixture-1',
  homeClubId: 'club-1',
  awayClubId: 'club-2',
  week: 1,
  date: new Date('2024-08-01'),
  played: false,
  ...overrides,
});

const makeLeague = (fixtures: Fixture[], clubIds = ['club-1', 'club-2']): League => ({
  id: 'league-1',
  name: 'Test League',
  tier: 1,
  clubIds,
  standings: { entries: [] },
  fixtures,
});

const makeSeason = (): Season => ({
  id: 'season-1',
  leagueId: 'league-1',
  currentWeek: 1,
  currentDate: new Date('2024-08-01'),
  transferWindowOpen: true,
  fixturesCalendar: [],
});

describe('isSeasonComplete', () => {
  it('returns false when fixtures remain unplayed', () => {
    const league = makeLeague([
      makeFixture({ played: true, homeScore: 1, awayScore: 0 }),
      makeFixture({ id: 'fixture-2', played: false }),
    ]);
    expect(isSeasonComplete(league, makeSeason())).toBe(false);
  });

  it('returns true when every fixture is played with scores', () => {
    const league = makeLeague([
      makeFixture({ played: true, homeScore: 2, awayScore: 1 }),
      makeFixture({
        id: 'fixture-2',
        homeClubId: 'club-2',
        awayClubId: 'club-1',
        played: true,
        homeScore: 0,
        awayScore: 0,
      }),
    ]);
    expect(isSeasonComplete(league, makeSeason())).toBe(true);
  });

  it('returns false for an empty fixture list', () => {
    expect(isSeasonComplete(makeLeague([]), makeSeason())).toBe(false);
  });

  it('returns false when a played fixture lacks scores (malformed)', () => {
    const league = makeLeague([
      makeFixture({ played: true, homeScore: 1, awayScore: 0 }),
      makeFixture({
        id: 'fixture-2',
        played: true,
        homeScore: undefined,
        awayScore: 0,
      }),
    ]);
    expect(isSeasonComplete(league, makeSeason())).toBe(false);
  });

  it('returns false when scores are non-numeric', () => {
    const league = makeLeague([
      makeFixture({
        played: true,
        homeScore: 'x' as unknown as number,
        awayScore: 0,
      }),
    ]);
    expect(isSeasonComplete(league, makeSeason())).toBe(false);
  });

  it('returns false when a played fixture has NaN scores', () => {
    const league = makeLeague([
      makeFixture({ played: true, homeScore: NaN, awayScore: 0 }),
    ]);
    expect(isSeasonComplete(league, makeSeason())).toBe(false);
  });

  it('returns false when a played fixture has an infinite away score', () => {
    const league = makeLeague([
      makeFixture({ played: true, homeScore: 1, awayScore: Infinity }),
    ]);
    expect(isSeasonComplete(league, makeSeason())).toBe(false);
  });

  it('returns false when a played fixture has a -Infinity home score', () => {
    const league = makeLeague([
      makeFixture({ played: true, homeScore: -Infinity, awayScore: 0 }),
    ]);
    expect(isSeasonComplete(league, makeSeason())).toBe(false);
  });

  it('is deterministic across repeated checks', () => {
    const league = makeLeague([
      makeFixture({ played: true, homeScore: 1, awayScore: 0 }),
      makeFixture({ id: 'fixture-2', played: false }),
    ]);
    const season = makeSeason();
    expect(isSeasonComplete(league, season)).toBe(
      isSeasonComplete(league, season),
    );
    expect(isSeasonComplete(league, season)).toBe(false);
  });
});

describe('advanceMatchweek — season completion guard', () => {
  const buildCompletedWorld = () => {
    const seedData = generateSeedData(12345);
    const clubs: Club[] = seedData.clubs.slice(0, 2);
    const players: Player[] = seedData.players;
    const playedFixture: Fixture = {
      id: 'fixture-1',
      homeClubId: clubs[0].id,
      awayClubId: clubs[1].id,
      week: 1,
      date: new Date('2024-08-01'),
      played: true,
      homeScore: 1,
      awayScore: 0,
    };
    const league = makeLeague([playedFixture], clubs.map((c) => c.id));
    const season = { ...makeSeason(), currentWeek: 2 };
    return { clubs, players, league, season };
  };

  it('refuses to advance a completed season', () => {
    const { clubs, players, league, season } = buildCompletedWorld();
    const advancement = advanceMatchweek(season, league, clubs, players);

    expect(advancement.seasonComplete).toBe(true);
    expect(advancement.results).toHaveLength(0);
  });

  it('does not increment currentWeek or change the date', () => {
    const { clubs, players, league, season } = buildCompletedWorld();
    const advancement = advanceMatchweek(season, league, clubs, players);

    expect(advancement.updatedSeason.currentWeek).toBe(season.currentWeek);
    expect(advancement.updatedSeason.currentDate).toEqual(
      season.currentDate,
    );
    expect(advancement.updatedSeason).toBe(season);
  });

  it('generates no transfers or weekly effects', () => {
    const { clubs, players, league, season } = buildCompletedWorld();
    const advancement = advanceMatchweek(season, league, clubs, players);

    expect(advancement.transferOffers).toHaveLength(0);
    expect(advancement.transferRecords).toHaveLength(0);
    expect(advancement.updatedPlayers).toBe(players);
    expect(advancement.updatedClubs).toBe(clubs);
    expect(advancement.updatedLeague).toBe(league);
  });

  it('does not mutate the input state', () => {
    const { clubs, players, league, season } = buildCompletedWorld();
    const snapshot = JSON.stringify({ league, season });
    advanceMatchweek(season, league, clubs, players);
    expect(JSON.stringify({ league, season })).toBe(snapshot);
  });

  it('still advances a season with an empty fixture list', () => {
    // Empty calendar is NOT a completed season (see isSeasonComplete).
    const seedData = generateSeedData(12345);
    const clubs = seedData.clubs.slice(0, 2);
    const players = seedData.players;
    const league = makeLeague([], clubs.map((c) => c.id));
    const season = makeSeason();

    const advancement = advanceMatchweek(season, league, clubs, players);
    expect(advancement.seasonComplete).toBe(false);
    expect(advancement.updatedSeason.currentWeek).toBe(2);
  });

  it('reports seasonComplete=false on normal advancements', () => {
    const seedData = generateSeedData(12345);
    const clubs = seedData.clubs.slice(0, 2);
    const players = seedData.players;
    const league = makeLeague(
      [makeFixture({ homeClubId: clubs[0].id, awayClubId: clubs[1].id })],
      clubs.map((c) => c.id),
    );
    const advancement = advanceMatchweek(makeSeason(), league, clubs, players);
    expect(advancement.seasonComplete).toBe(false);
  });
});

describe('full-season completion (odd club count with byes)', () => {
  it('detects completion after the last matchweek and refuses further advancement', () => {
    const seedData = generateSeedData(12345);
    const clubs = seedData.clubs.slice(0, 5); // odd → bye weeks
    const players = seedData.players;
    const clubIds = clubs.map((c) => c.id);
    const fixtures = scheduledFixturesToLeagueFixtures(
      generateFixtures(clubIds, new Date('2024-08-01')),
    );

    let season: Season = {
      ...makeSeason(),
      currentDate: new Date('2024-08-01'),
    };
    let league: League = { ...makeLeague(fixtures, clubIds) };
    let currentPlayers = players;
    let currentClubs = clubs;

    // Mid-season: not complete
    expect(isSeasonComplete(league, season)).toBe(false);

    // Advance until complete (5 clubs → 2N = 10 matchweeks)
    for (let i = 0; i < 10; i++) {
      const adv = advanceMatchweek(
        season,
        league,
        currentClubs,
        currentPlayers,
      );
      expect(adv.seasonComplete).toBe(false);
      season = adv.updatedSeason;
      league = adv.updatedLeague;
      currentPlayers = adv.updatedPlayers;
      currentClubs = adv.updatedClubs;
    }

    // All fixtures played → complete, repeatedly
    expect(league.fixtures.every((f) => f.played)).toBe(true);
    expect(isSeasonComplete(league, season)).toBe(true);
    expect(isSeasonComplete(league, season)).toBe(true);

    // Final standings account for every completed fixture:
    // each of 5 clubs played 2*(5-1) = 8 matches
    league.standings.entries.forEach((entry) => {
      expect(entry.played).toBe(8);
    });
    const totalPlayed = league.standings.entries.reduce(
      (sum, e) => sum + e.played,
      0,
    );
    expect(totalPlayed).toBe(league.fixtures.length * 2);

    // Further advancement is refused without side effects
    const weekBefore = season.currentWeek;
    const dateBefore = season.currentDate;
    const refused = advanceMatchweek(
      season,
      league,
      currentClubs,
      currentPlayers,
    );
    expect(refused.seasonComplete).toBe(true);
    expect(refused.results).toHaveLength(0);
    expect(refused.updatedSeason.currentWeek).toBe(weekBefore);
    expect(refused.updatedSeason.currentDate).toEqual(dateBefore);
    expect(refused.updatedLeague).toBe(league);
    expect(refused.updatedPlayers).toBe(currentPlayers);
    expect(refused.transferOffers).toHaveLength(0);
    expect(refused.transferRecords).toHaveLength(0);
  });
});
