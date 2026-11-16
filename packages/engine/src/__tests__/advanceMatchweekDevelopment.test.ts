import { advanceMatchweek } from '../season/advanceMatchweek';
import { applyWeeklyDevelopment } from '../players/development';
import { generateSeedData } from '../seed/generateSeedData';
import {
  generateFixtures,
  scheduledFixturesToLeagueFixtures,
} from '../season/scheduling';
import type {
  Club,
  League,
  Player,
  Season,
  StandingEntry,
} from '@club-director/shared-types';

const CLUB_COUNT = 6;

interface World {
  season: Season;
  league: League;
  clubs: Club[];
  players: Player[];
}

function buildWorld(clubCount = CLUB_COUNT): World {
  const seedData = generateSeedData(12345);
  const clubs = seedData.clubs.slice(0, clubCount);
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

  return { season, league, clubs, players };
}

function advance(world: World) {
  return advanceMatchweek(world.season, world.league, world.clubs, world.players, {
    managedClubId: world.clubs[0].id,
  });
}

function advanceWorldInPlace(world: World) {
  const adv = advance(world);
  world.season = adv.updatedSeason;
  world.league = adv.updatedLeague;
  world.clubs = adv.updatedClubs;
  world.players = adv.updatedPlayers;
  return adv;
}

function weekOneFixtureFor(world: World, clubId: string) {
  return world.league.fixtures.find(
    (f) =>
      f.week === world.season.currentWeek &&
      (f.homeClubId === clubId || f.awayClubId === clubId),
  )!;
}

function matchResultFor(fixtureId: string, advancement: ReturnType<typeof advance>) {
  return advancement.results.find((r) => r.fixtureId === fixtureId)!.result;
}

/** Force a player into a high-upside youth development profile. */
function makeYouthProfile(player: Player) {
  player.age = 19;
  player.development.currentAbility = 110;
  player.development.potentialAbility = 200;
  player.development.ageGrowthCurve = 'normal';
}

describe('advanceMatchweek — weekly development integration', () => {
  it('propagates development into the returned player collection', () => {
    const world = buildWorld();
    // Make every player a high-upside youth so development is guaranteed
    // to be observable within a few weeks.
    world.players.forEach(makeYouthProfile);

    let totalAbilityDelta = 0;
    for (let week = 0; week < 10; week++) {
      const before = new Map(world.players.map((p) => [p.id, p.development.currentAbility]));
      advanceWorldInPlace(world);
      for (const p of world.players) {
        totalAbilityDelta += p.development.currentAbility - (before.get(p.id) ?? 0);
      }
    }

    expect(totalAbilityDelta).toBeGreaterThan(0);
    // No player was lost and every output player is well-formed.
    expect(world.players.length).toBeGreaterThan(0);
    for (const p of world.players) {
      expect(Number.isFinite(p.development.currentAbility)).toBe(true);
      expect(p.development.currentAbility).toBeLessThanOrEqual(
        p.development.potentialAbility,
      );
    }
  });

  it('develops AI-club players with the same rules as the managed club', () => {
    // 16 clubs → full 30-week season so every advance is a real week.
    const world = buildWorld(16);
    const aiClub = world.clubs[1];

    // Find a week-1 participant of the AI club via a probe run.
    const probe = advance(buildWorld(16));
    const fixture = weekOneFixtureFor(world, aiClub.id);
    const match = matchResultFor(fixture.id, probe);
    const starterId = match.participantIds.find((id) =>
      aiClub.squad.includes(id),
    )!;
    const starter = world.players.find((p) => p.id === starterId)!;
    makeYouthProfile(starter);

    for (let week = 0; week < 30; week++) {
      advanceWorldInPlace(world);
    }

    const out = world.players.find((p) => p.id === starterId)!;
    expect(out.development.currentAbility - 110).toBeGreaterThan(0);
  });

  it('a regular starter gains more than a never-playing reserve over a season', () => {
    const world = buildWorld(16);
    const club = world.clubs[0];

    // Identify starter and reserve from a probe run on an identical world.
    const probe = advance(buildWorld(16));
    const fixture = weekOneFixtureFor(world, club.id);
    const match = matchResultFor(fixture.id, probe);
    const participantIds = new Set(match.participantIds);
    const starterId = club.squad.find((id) => participantIds.has(id))!;
    const reserveId = club.squad.find((id) => !participantIds.has(id))!;

    const starter = world.players.find((p) => p.id === starterId)!;
    const reserve = world.players.find((p) => p.id === reserveId)!;
    makeYouthProfile(starter);
    makeYouthProfile(reserve);

    for (let week = 0; week < 30; week++) {
      advanceWorldInPlace(world);
    }

    const outStarter = world.players.find((p) => p.id === starterId)!;
    const outReserve = world.players.find((p) => p.id === reserveId)!;
    const starterDelta =
      outStarter.development.currentAbility - 110;
    const reserveDelta =
      outReserve.development.currentAbility - 110;

    expect(starterDelta).toBeGreaterThan(reserveDelta);
  });

  it('a reserve who never plays follows the exact empty-participation trajectory', () => {
    const world = buildWorld(16);
    const club = world.clubs[0];

    const probe = advance(buildWorld(16));
    const fixture = weekOneFixtureFor(world, club.id);
    const match = matchResultFor(fixture.id, probe);
    const participantIds = new Set(match.participantIds);
    const reserveId = club.squad.find((id) => !participantIds.has(id))!;
    const reserve = world.players.find((p) => p.id === reserveId)!;
    makeYouthProfile(reserve);

    // Reference trajectory: pure development with an empty participation
    // set for the same season id and weeks. Post-match effects never
    // touch development/attributes, so the trajectories must match
    // exactly as long as the reserve truly never plays.
    let expected = reserve;
    for (let week = 1; week <= 30; week++) {
      [expected] = applyWeeklyDevelopment(
        [expected],
        new Set<string>(),
        world.season.id,
        week,
      );
    }

    for (let week = 0; week < 30; week++) {
      advanceWorldInPlace(world);
    }

    const outReserve = world.players.find((p) => p.id === reserveId)!;
    expect(outReserve.development.currentAbility).toBe(
      expected.development.currentAbility,
    );
    expect(outReserve.attributes).toEqual(expected.attributes);
  });

  it('counts every participant across all matches of the week exactly once', () => {
    const world = buildWorld();
    const adv = advance(world);

    // 6 clubs → 3 fixtures → 22 players per match, 66 participant slots.
    const allIds: string[] = [];
    adv.results.forEach((r) => {
      allIds.push(...r.result.participantIds);
    });
    // No duplicates inside a single match; across matches ids belong to
    // different clubs so the union is the full participant set.
    adv.results.forEach((r) => {
      expect(new Set(r.result.participantIds).size).toBe(
        r.result.participantIds.length,
      );
    });
    expect(allIds.length).toBe(adv.results.length * 22);
    // Every participant is a real player in the career.
    const playerIds = new Set(world.players.map((p) => p.id));
    allIds.forEach((id) => expect(playerIds.has(id)).toBe(true));
  });

  it('applies reduced-factor development on a week without fixtures', () => {
    const world = buildWorld();
    // Keep only a single unplayed fixture at week 3: weeks 1 and 2 have
    // no fixtures while the season stays incomplete.
    const futureFixture = world.league.fixtures.find((f) => f.week === 3)!;
    world.league = {
      ...world.league,
      fixtures: [{ ...futureFixture, played: false }],
    };
    world.season = { ...world.season, currentWeek: 1 };

    const probePlayer = world.players[0];
    const before = probePlayer.development.currentAbility;

    // Week 1: no fixtures → bye branch. Development must equal the pure
    // engine call with an empty participation set (post-match effects do
    // not touch development fields).
    const adv1 = advance(world);
    expect(adv1.results).toHaveLength(0);
    const [expected1] = applyWeeklyDevelopment(
      world.players,
      new Set<string>(),
      world.season.id,
      1,
    );
    const out1 = adv1.updatedPlayers.find((p) => p.id === probePlayer.id)!;
    expect(out1.development.currentAbility).toBe(
      expected1.development.currentAbility,
    );
    expect(out1.attributes).toEqual(expected1.attributes);
    expect(adv1.updatedSeason.currentWeek).toBe(2);

    // Week 2: still no fixtures → second bye week, week parameter = 2.
    const adv2 = advanceMatchweek(
      adv1.updatedSeason,
      adv1.updatedLeague,
      adv1.updatedClubs,
      adv1.updatedPlayers,
    );
    const [expected2] = applyWeeklyDevelopment(
      adv1.updatedPlayers,
      new Set<string>(),
      adv1.updatedSeason.id,
      2,
    );
    const out2 = adv2.updatedPlayers.find((p) => p.id === probePlayer.id)!;
    expect(out2.development.currentAbility).toBe(
      expected2.development.currentAbility,
    );

    // Sanity: ability may legitimately be unchanged on a single bye week,
    // but the trajectory must be the reserve-factor one, not the played one.
    void before;
  });

  it('does not apply development when the season is already complete', () => {
    const world = buildWorld();
    // Mark every fixture played with valid scores → season complete.
    world.league = {
      ...world.league,
      fixtures: world.league.fixtures.map((f) => ({
        ...f,
        played: true,
        homeScore: 1,
        awayScore: 0,
      })),
    };
    world.season = { ...world.season, currentWeek: 11 };

    const adv = advance(world);
    expect(adv.seasonComplete).toBe(true);
    // The refusal path aliases inputs: no development, no new objects.
    expect(adv.updatedPlayers).toBe(world.players);
    expect(adv.updatedSeason).toBe(world.season);
  });

  it('keeps match results, events and seeds identical across identical runs', () => {
    const worldA = buildWorld();
    const worldB = buildWorld();
    const advA = advance(worldA);
    const advB = advance(worldB);

    expect(advB.results).toEqual(advA.results);
    expect(advB.updatedPlayers).toEqual(advA.updatedPlayers);
  });

  it('does not double-apply development on repeated identical calls', () => {
    const worldA = buildWorld();
    const worldB = buildWorld();

    // Two independent calls on identical inputs must produce identical
    // output — development is recomputed from state, never accumulated.
    const advA = advance(worldA);
    const advB = advance(worldB);
    expect(advB.updatedPlayers).toEqual(advA.updatedPlayers);

    // Advancing the already-advanced state moves to the next week with
    // a new development stream — it does not re-apply week 1's
    // development.
    const advA2 = advanceMatchweek(
      advA.updatedSeason,
      advA.updatedLeague,
      advA.updatedClubs,
      advA.updatedPlayers,
    );
    expect(advA2.updatedSeason.currentWeek).toBe(
      advA.updatedSeason.currentWeek + 1,
    );
    const week1Players = new Map(advA.updatedPlayers.map((p) => [p.id, p]));
    for (const p of advA2.updatedPlayers) {
      const before = week1Players.get(p.id)!;
      // Attributes/development may change again, but identity fields are
      // untouched. Contracts may legitimately change: AI transfer
      // activity runs between the two weeks and can move players.
      expect(p.id).toBe(before.id);
      expect(p.age).toBe(before.age);
      expect(p.development.potentialAbility).toBe(
        before.development.potentialAbility,
      );
    }
  });

  it('never mutates the input state', () => {
    const world = buildWorld();
    const snapshot = JSON.stringify({
      season: world.season,
      league: world.league,
      clubs: world.clubs,
      players: world.players,
    });
    advance(world);
    expect(
      JSON.stringify({
        season: world.season,
        league: world.league,
        clubs: world.clubs,
        players: world.players,
      }),
    ).toBe(snapshot);
  });

  it('preserves post-match status effects alongside development', () => {
    const world = buildWorld();
    const club = world.clubs[0];

    const probe = advance(buildWorld());
    const fixture = weekOneFixtureFor(world, club.id);
    const match = matchResultFor(fixture.id, probe);
    const participantIds = new Set(match.participantIds);
    const reserveId = club.squad.find((id) => !participantIds.has(id))!;
    const reserve = world.players.find((p) => p.id === reserveId)!;
    reserve.status.fitness = 80;

    const adv = advance(world);
    const outReserve = adv.updatedPlayers.find((p) => p.id === reserveId)!;

    // Non-participant recovery (+10 fitness) still applies — development
    // runs in parallel and does not interfere with status effects.
    expect(outReserve.status.fitness).toBe(90);
    // And the reserve's development fields are still integers in range.
    expect(Number.isInteger(outReserve.development.currentAbility)).toBe(true);
  });
});
