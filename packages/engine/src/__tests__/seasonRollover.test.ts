import { getSeasonAnomalies } from '../season/completion';
import { buildNextSeason } from '../season/rollover';
import { generateFixtures, scheduledFixturesToLeagueFixtures } from '../season/scheduling';
import { generateSeedData } from '../seed/generateSeedData';
import { Club, Fixture, League, Player, Season, StandingEntry } from '@club-director/shared-types';

const zeroEntry = (clubId: string): StandingEntry => ({
  clubId,
  played: 0,
  won: 0,
  drawn: 0,
  lost: 0,
  goalsFor: 0,
  goalsAgainst: 0,
  goalDifference: 0,
  points: 0,
});

/** A completed league: every generated fixture played with scores. */
const completedLeague = (clubIds: string[]): League => ({
  id: 'league-1',
  name: 'Old League',
  tier: 1,
  clubIds,
  standings: { entries: clubIds.map(zeroEntry) },
  fixtures: generateFixtures(clubIds, new Date('2024-08-01')).map((sf, i) => ({
    id: `old-fixture-${i}`,
    homeClubId: sf.homeClubId,
    awayClubId: sf.awayClubId,
    week: sf.matchweek,
    date: sf.date,
    played: true,
    homeScore: 1,
    awayScore: 0,
  })),
});

const completedSeason = (currentWeek = 99): Season => ({
  id: 'season-1',
  leagueId: 'league-1',
  currentWeek,
  currentDate: new Date('2025-05-01'),
  transferWindowOpen: true,
  fixturesCalendar: [],
});

const seedClubsPlayers = (n: number) => {
  const seedData = generateSeedData(12345);
  return {
    clubs: seedData.clubs.slice(0, n) as Club[],
    players: seedData.players as Player[],
  };
};

const baseInput = (n: number) => {
  const { clubs, players } = seedClubsPlayers(n);
  // league.clubIds must match the actual club ids (seed ids are
  // 'club-0'..'club-15'), since buildNextSeason validates the mapping.
  const clubIds = clubs.map((c) => c.id);
  return {
    league: completedLeague(clubIds),
    season: completedSeason(),
    clubs,
    players,
    newSeasonId: 'season-2',
    newStartDate: new Date('2025-08-01'),
  };
};

describe('getSeasonAnomalies', () => {
  const season = completedSeason(5);
  const leagueWith = (fixtures: Fixture[]): League => ({
    id: 'league-1',
    name: 'L',
    tier: 1,
    clubIds: ['club-1', 'club-2'],
    standings: { entries: [] },
    fixtures,
  });
  const fx = (overrides: Partial<Fixture>): Fixture => ({
    id: 'f',
    homeClubId: 'club-1',
    awayClubId: 'club-2',
    week: 6,
    date: new Date('2024-09-01'),
    played: true,
    homeScore: 1,
    awayScore: 0,
    ...overrides,
  });

  it('returns empty anomalies for a clean season', () => {
    const anomalies = getSeasonAnomalies(
      leagueWith([fx({})]),
      season,
    );
    expect(anomalies.malformedPlayedFixtures).toHaveLength(0);
    expect(anomalies.orphanedUnplayedFixtures).toHaveLength(0);
    expect(anomalies.invalidWeekFixtures).toHaveLength(0);
  });

  it('detects played fixtures with missing scores', () => {
    const anomalies = getSeasonAnomalies(
      leagueWith([
        fx({ id: 'f1', homeScore: undefined }),
        fx({ id: 'f2', awayScore: undefined }),
      ]),
      season,
    );
    expect(anomalies.malformedPlayedFixtures.map((f) => f.id)).toEqual([
      'f1',
      'f2',
    ]);
  });

  it('detects unplayed fixtures whose week is in the past', () => {
    const anomalies = getSeasonAnomalies(
      leagueWith([
        fx({ id: 'past', played: false, week: 4 }),
        fx({ id: 'future', played: false, week: 7 }),
      ]),
      season,
    );
    expect(anomalies.orphanedUnplayedFixtures.map((f) => f.id)).toEqual([
      'past',
    ]);
  });

  it('detects invalid fixture weeks', () => {
    const anomalies = getSeasonAnomalies(
      leagueWith([
        fx({ id: 'zero', week: 0 }),
        fx({ id: 'fraction', week: 1.5 }),
        fx({ id: 'nan', week: NaN }),
      ]),
      season,
    );
    expect(anomalies.invalidWeekFixtures.map((f) => f.id)).toEqual([
      'zero',
      'fraction',
      'nan',
    ]);
  });

  it('preserves fixture order and does not mutate inputs', () => {
    const fixtures = [
      fx({ id: 'b', homeScore: undefined }),
      fx({ id: 'a', played: false, week: 1 }),
      fx({ id: 'c', week: 0 }),
    ];
    const before = JSON.stringify(fixtures);
    const anomalies = getSeasonAnomalies(leagueWith(fixtures), season);
    expect(anomalies.malformedPlayedFixtures[0].id).toBe('b');
    expect(anomalies.orphanedUnplayedFixtures[0].id).toBe('a');
    expect(anomalies.invalidWeekFixtures[0].id).toBe('c');
    expect(JSON.stringify(fixtures)).toBe(before);
  });
});

describe('buildNextSeason', () => {
  it('refuses when the season is not complete', () => {
    const input = baseInput(4);
    // Unplayed fixture in a FUTURE week: incomplete but not anomalous,
    // so the refusal must come from the completion check itself.
    input.league.fixtures.push({
      id: 'future-unplayed',
      homeClubId: 'club-1',
      awayClubId: 'club-2',
      week: 100,
      date: new Date('2025-06-01'),
      played: false,
    });
    expect(() => buildNextSeason(input)).toThrow(/not complete/);
  });

  it('refuses on malformed played fixtures', () => {
    const input = baseInput(4);
    input.league.fixtures.push({
      id: 'bad',
      homeClubId: 'club-1',
      awayClubId: 'club-2',
      week: 99,
      date: new Date('2025-01-01'),
      played: true,
    });
    expect(() => buildNextSeason(input)).toThrow(/anomal/);
  });

  it('refuses on orphaned unplayed fixtures', () => {
    const input = baseInput(4);
    input.league.fixtures.push({
      id: 'orphan',
      homeClubId: 'club-1',
      awayClubId: 'club-2',
      week: 1,
      date: new Date('2024-08-01'),
      played: false,
    });
    expect(() => buildNextSeason(input)).toThrow(/anomal/);
  });

  it('refuses on invalid fixture weeks', () => {
    const input = baseInput(4);
    input.league.fixtures[0].week = 0;
    expect(() => buildNextSeason(input)).toThrow(/anomal/);
  });

  it('refuses on blank or duplicate newSeasonId', () => {
    expect(() =>
      buildNextSeason({ ...baseInput(4), newSeasonId: '  ' }),
    ).toThrow(/newSeasonId/);
    expect(() =>
      buildNextSeason({ ...baseInput(4), newSeasonId: 'season-1' }),
    ).toThrow(/identical/);
  });

  it('refuses on invalid newStartDate', () => {
    expect(() =>
      buildNextSeason({ ...baseInput(4), newStartDate: new Date('nope') }),
    ).toThrow(/newStartDate/);
  });

  it('accepts a newStartDate equal to the last fixture date', () => {
    const input = baseInput(4);
    const lastFixtureDate = input.league.fixtures.reduce(
      (max, f) => (f.date.getTime() > max.getTime() ? f.date : max),
      input.league.fixtures[0].date,
    );
    const next = buildNextSeason({
      ...input,
      newStartDate: new Date(lastFixtureDate.getTime()),
    });
    expect(next.season.currentDate.getTime()).toBe(lastFixtureDate.getTime());
  });

  it('refuses a newStartDate earlier than the last fixture date', () => {
    const input = baseInput(4);
    const lastFixtureDate = input.league.fixtures.reduce(
      (max, f) => (f.date.getTime() > max.getTime() ? f.date : max),
      input.league.fixtures[0].date,
    );
    const tooEarly = new Date(lastFixtureDate.getTime() - 7 * 24 * 60 * 60 * 1000);
    expect(() =>
      buildNextSeason({ ...input, newStartDate: tooEarly }),
    ).toThrow(/precedes the last fixture date/);
  });

  it('refuses on an invalid fixture date', () => {
    const input = baseInput(4);
    input.league = {
      ...input.league,
      fixtures: input.league.fixtures.map((f, i) =>
        i === 0 ? { ...f, date: new Date(NaN) } : f,
      ),
    };
    expect(() => buildNextSeason(input)).toThrow(/invalid date/);
  });

  it('refuses an empty fixture list as an incomplete season', () => {
    const input = baseInput(4);
    input.league = { ...input.league, fixtures: [] };
    expect(() => buildNextSeason(input)).toThrow(/not complete/);
  });

  it('refuses when season.leagueId does not match league.id', () => {
    const input = baseInput(4);
    input.season = { ...input.season, leagueId: 'other-league' };
    expect(() => buildNextSeason(input)).toThrow(/leagueId/);
  });

  it('refuses on duplicate or blank club ids', () => {
    const input = baseInput(4);
    input.league = { ...input.league, clubIds: ['club-1', 'club-1'] };
    expect(() => buildNextSeason(input)).toThrow(/clubIds/);
  });

  it('refuses when a league club id is absent from input.clubs', () => {
    const input = baseInput(4);
    const missingId = input.league.clubIds[0];
    input.clubs = input.clubs.filter((c) => c.id !== missingId);
    expect(() => buildNextSeason(input)).toThrow(
      new RegExp(`absent from input\\.clubs: ${missingId}`),
    );
  });

  it('refuses when input.clubs duplicates a referenced league club id', () => {
    const input = baseInput(4);
    const duplicatedId = input.league.clubIds[0];
    input.clubs = [...input.clubs, input.clubs.find((c) => c.id === duplicatedId)!];
    expect(() => buildNextSeason(input)).toThrow(
      new RegExp(`duplicate entries for league club id\\(s\\): ${duplicatedId}`),
    );
  });

  it('accepts extra clubs that belong to other leagues', () => {
    const input = baseInput(4);
    const otherLeagueClub = {
      ...input.clubs[0],
      id: 'other-league-club-1',
      name: 'Other League Club',
    };
    input.clubs = [...input.clubs, otherLeagueClub];
    const next = buildNextSeason(input);
    expect(next.league.clubIds).toEqual(input.league.clubIds);
    expect(next.league.fixtures).toHaveLength(4 * 3);
  });

  it.each([0, -1, 1.5, NaN, Infinity, -Infinity])(
    'refuses on invalid season.currentWeek %p',
    (currentWeek) => {
      const input = baseInput(4);
      input.season = { ...input.season, currentWeek };
      expect(() => buildNextSeason(input)).toThrow(/currentWeek/);
    },
  );

  it.each([2, 3, 5, 16])(
    'builds a complete double round-robin for %i clubs',
    (n) => {
      const input = baseInput(n);
      const next = buildNextSeason(input);
      const nClubs = n;
      const expected = nClubs * (nClubs - 1);

      expect(next.league.fixtures).toHaveLength(expected);
      // Unplayed, no scores
      next.league.fixtures.forEach((f) => {
        expect(f.played).toBe(false);
        expect(f.homeScore).toBeUndefined();
        expect(f.awayScore).toBeUndefined();
      });
      // Every pair twice, once at each venue
      const pairs = new Map<string, Fixture[]>();
      next.league.fixtures.forEach((f) => {
        const key = [f.homeClubId, f.awayClubId].sort().join('|');
        pairs.set(key, [...(pairs.get(key) ?? []), f]);
      });
      expect(pairs.size).toBe((nClubs * (nClubs - 1)) / 2);
      pairs.forEach((list, key) => {
        expect(list).toHaveLength(2);
        const [a, b] = key.split('|');
        expect(
          list.filter((f) => f.homeClubId === a && f.awayClubId === b),
        ).toHaveLength(1);
        expect(
          list.filter((f) => f.homeClubId === b && f.awayClubId === a),
        ).toHaveLength(1);
      });
      // At most one fixture per club per week
      const byWeek = new Map<number, Fixture[]>();
      next.league.fixtures.forEach((f) => {
        byWeek.set(f.week, [...(byWeek.get(f.week) ?? []), f]);
      });
      byWeek.forEach((weekFixtures) => {
        const appearances = new Map<string, number>();
        weekFixtures.forEach((f) => {
          appearances.set(f.homeClubId, (appearances.get(f.homeClubId) ?? 0) + 1);
          appearances.set(f.awayClubId, (appearances.get(f.awayClubId) ?? 0) + 1);
        });
        appearances.forEach((count) => expect(count).toBe(1));
      });
    },
  );

  it('produces contiguous weekly dates starting at newStartDate', () => {
    const input = baseInput(4);
    const next = buildNextSeason(input);
    const weeks = [...new Set(next.league.fixtures.map((f) => f.week))].sort(
      (a, b) => a - b,
    );
    expect(weeks[0]).toBe(1);
    const dateByWeek = new Map<number, Date>();
    next.league.fixtures.forEach((f) => dateByWeek.set(f.week, f.date));
    expect(dateByWeek.get(1)).toEqual(input.newStartDate);
    const weekMs = 7 * 24 * 60 * 60 * 1000;
    for (let i = 1; i < weeks.length; i++) {
      expect(weeks[i]).toBe(weeks[i - 1] + 1);
      expect(
        dateByWeek.get(weeks[i])!.getTime() - dateByWeek.get(weeks[i - 1])!.getTime(),
      ).toBe(weekMs);
    }
  });

  it('creates the new season with correct identity and defaults', () => {
    const input = baseInput(4);
    const next = buildNextSeason(input);

    expect(next.season.id).toBe('season-2');
    expect(next.season.leagueId).toBe('league-1');
    expect(next.season.currentWeek).toBe(1);
    expect(next.season.currentDate).toEqual(input.newStartDate);
    expect(next.season.currentDate).not.toBe(input.newStartDate); // detached copy
    expect(next.season.transferWindowOpen).toBe(true);
    expect(next.season.fixturesCalendar).toEqual([]);
  });

  it('preserves league metadata and resets standings to zero', () => {
    const input = baseInput(4);
    input.league.name = 'Premier Division';
    input.league.tier = 2;
    const next = buildNextSeason(input);

    expect(next.league.id).toBe('league-1');
    expect(next.league.name).toBe('Premier Division');
    expect(next.league.tier).toBe(2);
    expect(next.league.clubIds).toEqual(input.league.clubIds);
    expect(next.league.standings.entries).toHaveLength(4);
    next.league.standings.entries.forEach((entry) => {
      expect(entry).toMatchObject({
        played: 0,
        won: 0,
        drawn: 0,
        lost: 0,
        goalsFor: 0,
        goalsAgainst: 0,
        goalDifference: 0,
        points: 0,
      });
    });
  });

  it('returns clubs and players as the same untouched references', () => {
    const input = baseInput(4);
    const next = buildNextSeason(input);
    expect(next.clubs).toBe(input.clubs);
    expect(next.players).toBe(input.players);
  });

  it('does not mutate inputs', () => {
    const input = baseInput(4);
    const snapshot = JSON.stringify({
      league: input.league,
      season: input.season,
    });
    buildNextSeason(input);
    expect(
      JSON.stringify({ league: input.league, season: input.season }),
    ).toBe(snapshot);
  });

  it('is deterministic across repeated calls', () => {
    const a = buildNextSeason(baseInput(5));
    const b = buildNextSeason(baseInput(5));
    expect(a.league.fixtures).toEqual(b.league.fixtures);
    expect(a.season).toEqual(b.season);
  });
});
