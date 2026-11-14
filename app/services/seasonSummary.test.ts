import { buildRolloverAction, buildSeasonSummary } from './seasonSummary';
import type { Club, Fixture, League, Season, StandingEntry } from '@club-director/shared-types';

const makeClub = (id: string, name: string): Club =>
  ({
    id,
    name,
    nickname: name,
    foundedYear: 2000,
    reputation: 50,
    finances: { balance: 0, transferBudget: 0, wageBudget: 0, weeklyIncome: 0 },
    squad: [],
    stadium: { name: `${name} Stadium`, capacity: 1000 },
    tactics: {
      defaultFormation: '4-4-2',
      mentality: 'balanced',
      pressingIntensity: 5,
      tempo: 5,
      width: 5,
    },
  }) as Club;

const makeEntry = (
  clubId: string,
  overrides: Partial<StandingEntry> = {},
): StandingEntry => ({
  clubId,
  played: 0,
  won: 0,
  drawn: 0,
  lost: 0,
  goalsFor: 0,
  goalsAgainst: 0,
  goalDifference: 0,
  points: 0,
  ...overrides,
});

const playedFixture = (id: string, home: string, away: string): Fixture => ({
  id,
  homeClubId: home,
  awayClubId: away,
  week: 1,
  date: new Date('2024-08-01'),
  played: true,
  homeScore: 1,
  awayScore: 0,
});

const makeLeague = (
  fixtures: Fixture[],
  entries: StandingEntry[],
  clubIds: string[],
): League => ({
  id: 'league-1',
  name: 'Test League',
  tier: 1,
  clubIds,
  standings: { entries },
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

const clubs = [makeClub('club-1', 'Alpha FC'), makeClub('club-2', 'Beta FC')];

describe('buildSeasonSummary', () => {
  it('marks a fully played season complete and crowns the top entry', () => {
    const league = makeLeague(
      [playedFixture('f1', 'club-1', 'club-2')],
      [
        makeEntry('club-1', { played: 1, won: 1, goalsFor: 1, points: 3, goalDifference: 1 }),
        makeEntry('club-2', { played: 1, lost: 1, goalsAgainst: 1, goalDifference: -1 }),
      ],
      ['club-1', 'club-2'],
    );

    const summary = buildSeasonSummary(league, makeSeason(), clubs);

    expect(summary.complete).toBe(true);
    expect(summary.championClubId).toBe('club-1');
    expect(summary.championClubName).toBe('Alpha FC');
    expect(summary.standings).toHaveLength(2);
    expect(summary.standings[0]).toMatchObject({
      position: 1,
      clubId: 'club-1',
      clubName: 'Alpha FC',
      isChampion: true,
      played: 1,
      won: 1,
      points: 3,
    });
    expect(summary.standings[1]).toMatchObject({
      position: 2,
      clubId: 'club-2',
      clubName: 'Beta FC',
      isChampion: false,
    });
  });

  it('keeps an in-progress season incomplete with no champion flag', () => {
    const league = makeLeague(
      [
        playedFixture('f1', 'club-1', 'club-2'),
        {
          id: 'f2',
          homeClubId: 'club-2',
          awayClubId: 'club-1',
          week: 2,
          date: new Date('2024-08-08'),
          played: false,
        },
      ],
      [
        makeEntry('club-1', { played: 1, won: 1, points: 3 }),
        makeEntry('club-2', { played: 1, lost: 1 }),
      ],
      ['club-1', 'club-2'],
    );

    const summary = buildSeasonSummary(league, makeSeason(), clubs);

    expect(summary.complete).toBe(false);
    expect(summary.championClubId).toBeNull();
    expect(summary.championClubName).toBeNull();
    expect(summary.standings.every((row) => !row.isChampion)).toBe(true);
    // Positions still reflect standings order for the live table
    expect(summary.standings.map((r) => r.position)).toEqual([1, 2]);
  });

  it('does not treat an empty fixture list as a completed season', () => {
    const league = makeLeague([], [makeEntry('club-1'), makeEntry('club-2')], [
      'club-1',
      'club-2',
    ]);

    const summary = buildSeasonSummary(league, makeSeason(), clubs);

    expect(summary.complete).toBe(false);
    expect(summary.championClubId).toBeNull();
    expect(summary.standings.every((row) => !row.isChampion)).toBe(true);
  });

  it('preserves every standings stat field on the rows', () => {
    const league = makeLeague(
      [playedFixture('f1', 'club-1', 'club-2')],
      [
        makeEntry('club-1', {
          played: 4,
          won: 3,
          drawn: 1,
          lost: 0,
          goalsFor: 9,
          goalsAgainst: 4,
          goalDifference: 5,
          points: 10,
        }),
      ],
      ['club-1'],
    );

    const [row] = buildSeasonSummary(league, makeSeason(), [clubs[0]]).standings;

    expect(row).toMatchObject({
      played: 4,
      won: 3,
      drawn: 1,
      lost: 0,
      goalsFor: 9,
      goalsAgainst: 4,
      goalDifference: 5,
      points: 10,
    });
  });

  it('falls back to clubId when the club is unknown', () => {
    const league = makeLeague(
      [playedFixture('f1', 'club-x', 'club-2')],
      [makeEntry('club-x', { played: 1, won: 1, points: 3 })],
      ['club-x'],
    );

    const summary = buildSeasonSummary(league, makeSeason(), clubs);

    expect(summary.standings[0].clubName).toBe('club-x');
  });
});

describe('buildRolloverAction', () => {
  it('is only visible when the season is complete', () => {
    expect(buildRolloverAction(true, false).visible).toBe(true);
    expect(buildRolloverAction(false, false).visible).toBe(false);
    // Even mid-rollover of a completed season it stays visible but disabled.
    expect(buildRolloverAction(true, true)).toMatchObject({
      visible: true,
      disabled: true,
    });
  });

  it('disables and relabels the action while a rollover is in progress', () => {
    expect(buildRolloverAction(true, true)).toMatchObject({
      disabled: true,
      label: 'Starting next season…',
    });
    expect(buildRolloverAction(true, false)).toMatchObject({
      disabled: false,
      label: 'Start Next Season',
    });
  });

  it('stays hidden and enabled-looking when the season is incomplete', () => {
    const action = buildRolloverAction(false, false);
    expect(action.visible).toBe(false);
    expect(action.disabled).toBe(false);
  });
});
