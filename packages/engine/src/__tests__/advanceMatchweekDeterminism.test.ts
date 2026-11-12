import { advanceMatchweek } from '../season/advanceMatchweek';
import { simulateMatch } from '../match/simulation';
import { generateSeedData } from '../seed/generateSeedData';
import {
  generateFixtures,
  scheduledFixturesToLeagueFixtures,
} from '../season/scheduling';
import type {
  Club,
  League,
  Player,
  PlayerMap,
  Position,
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

// Build an identical, deterministic world on every call (seeded engine
// data + fixed fixture calendar), so two worlds are deeply equal inputs.
function buildWorld(): World {
  const seedData = generateSeedData(12345);
  const clubs = seedData.clubs.slice(0, CLUB_COUNT);
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

function weekOneFixtureFor(world: World, clubId: string) {
  return world.league.fixtures.find(
    (f) =>
      f.week === 1 &&
      (f.homeClubId === clubId || f.awayClubId === clubId),
  )!;
}

function matchResultFor(fixtureId: string, advancement: ReturnType<typeof advance>) {
  return advancement.results.find((r) => r.fixtureId === fixtureId)!.result;
}

describe('advanceMatchweek determinism', () => {
  it('produces deeply equal outputs for identical inputs', () => {
    const worldA = buildWorld();
    const worldB = buildWorld();

    const advA = advance(worldA);
    const advB = advance(worldB);

    // Scores, events, stats, seeds, player status (injuries, ratings,
    // fitness, form), transfers, offers, clubs and season must all match.
    expect(advB).toEqual(advA);
  });

  it('is deterministic across the full multi-week horizon', () => {
    const worldA = buildWorld();
    const worldB = buildWorld();

    // Advance three matchweeks on each world, threading state forward.
    for (let week = 0; week < 3; week++) {
      const advA = advanceMatchweek(
        worldA.season,
        worldA.league,
        worldA.clubs,
        worldA.players,
      );
      const advB = advanceMatchweek(
        worldB.season,
        worldB.league,
        worldB.clubs,
        worldB.players,
      );
      expect(advB).toEqual(advA);
      worldA.season = advA.updatedSeason;
      worldA.league = advA.updatedLeague;
      worldA.clubs = advA.updatedClubs;
      worldA.players = advA.updatedPlayers;
      worldB.season = advB.updatedSeason;
      worldB.league = advB.updatedLeague;
      worldB.clubs = advB.updatedClubs;
      worldB.players = advB.updatedPlayers;
    }
  });

  it('derives independent seeds from fixture identity', () => {
    const worldA = buildWorld();
    const worldB = buildWorld();

    // Same season, same fixtures — only the fixture IDs differ.
    worldB.league = {
      ...worldB.league,
      fixtures: worldB.league.fixtures.map((f) => ({
        ...f,
        id: `${f.id}-alt`,
      })),
    };

    const advA = advance(worldA);
    const advB = advance(worldB);

    expect(advA.results.length).toBeGreaterThan(0);
    advA.results.forEach((rA, i) => {
      const rB = advB.results[i];
      // Different fixture identity must produce a different match seed.
      expect(rB.result.seed).not.toBe(rA.result.seed);
    });
  });

  it('derives match seeds from season identity as well', () => {
    const worldA = buildWorld();
    const worldB = buildWorld();

    // Identical league and fixture IDs — only the season ID differs.
    worldB.season = { ...worldB.season, id: 'season-2' };

    const advA = advance(worldA);
    const advB = advance(worldB);

    expect(advA.results.length).toBeGreaterThan(0);
    advA.results.forEach((rA, i) => {
      expect(advB.results[i].result.seed).not.toBe(rA.result.seed);
    });
  });
});

describe('injury-aware selection and participation', () => {
  it('excludes an injured starter from the next match participants', () => {
    const clean = buildWorld();
    const advClean = advance(clean);
    const fixture = weekOneFixtureFor(clean, clean.clubs[0].id);
    const cleanMatch = matchResultFor(fixture.id, advClean);

    // Pick a player who actually started for the managed club.
    const victimId = cleanMatch.participantIds.find((id) =>
      clean.clubs[0].squad.includes(id),
    )!;
    expect(victimId).toBeDefined();

    const injured = buildWorld();
    const victim = injured.players.find((p) => p.id === victimId)!;
    victim.status.injury = {
      type: 'Test injury',
      daysRemaining: 7,
      severity: 'minor',
    };

    const advInjured = advance(injured);
    const injuredMatch = matchResultFor(fixture.id, advInjured);

    // The injured player must not participate; the match still completes
    // with a full complement of participants.
    expect(injuredMatch.participantIds).not.toContain(victimId);
    expect(injuredMatch.participantIds).toHaveLength(
      cleanMatch.participantIds.length,
    );
  });

  it('fails safely when a club cannot field 11 eligible players', () => {
    const world = buildWorld();
    const club = world.clubs[0];
    world.players
      .filter((p) => club.squad.includes(p.id))
      .forEach((p) => {
        p.status.injury = {
          type: 'Test injury',
          daysRemaining: 7,
          severity: 'serious',
        };
      });

    expect(() => advance(world)).toThrow(/eligible players|starting XI/i);
  });

  it('does not apply match fatigue, ratings, or form to non-participants', () => {
    const world = buildWorld();
    const club = world.clubs[0];
    const fixture = weekOneFixtureFor(world, club.id);

    // Identify a reserve: squad member who will not be in the starting XIs.
    // First run a probe advancement to learn the participant list.
    const probe = advance(buildWorld());
    const probeFixture = weekOneFixtureFor(world, club.id);
    const probeMatch = matchResultFor(probeFixture.id, probe);
    const participantIds = new Set(probeMatch.participantIds);
    const reserveId = club.squad.find((id) => !participantIds.has(id))!;
    const participantId = club.squad.find((id) => participantIds.has(id))!;

    // Give both players a known fitness level so effects are measurable.
    const reserve = world.players.find((p) => p.id === reserveId)!;
    const starter = world.players.find((p) => p.id === participantId)!;
    reserve.status.fitness = 80;
    starter.status.fitness = 80;
    const reserveFormBefore = [...reserve.status.recentForm];

    const adv = advance(world);
    const match = matchResultFor(fixture.id, adv);
    expect(match.participantIds).toContain(participantId);
    expect(match.participantIds).not.toContain(reserveId);

    const outReserve = adv.updatedPlayers.find((p) => p.id === reserveId)!;
    const outStarter = adv.updatedPlayers.find((p) => p.id === participantId)!;

    // Non-participant: no fatigue (fitness recovers +10 instead of dropping),
    // no match rating, no match-derived recent-form entry.
    expect(outReserve.status.fitness).toBe(90);
    expect(outReserve.status.recentForm).toEqual(reserveFormBefore);

    // Participant: fitness drops (5-15 reduction, possibly more on injury)
    // and a new implied rating is prepended to recentForm — the previous
    // form entries shift down intact.
    expect(outStarter.status.fitness).toBeLessThan(80);
    expect(outStarter.status.recentForm.slice(1)).toEqual(
      starter.status.recentForm.slice(0, 4),
    );
  });
});

describe('missing-club integrity', () => {
  it('throws a descriptive error naming the fixture and missing club', () => {
    const world = buildWorld();
    const fixture = world.league.fixtures.find((f) => f.week === 1)!;
    world.league = {
      ...world.league,
      fixtures: world.league.fixtures.map((f) =>
        f.id === fixture.id ? { ...f, homeClubId: 'club-ghost' } : f,
      ),
    };

    expect(() => advance(world)).toThrow(
      new RegExp(`fixture ${fixture.id}.*missing home club club-ghost`),
    );
  });

  it('throws for a missing away club as well', () => {
    const world = buildWorld();
    const fixture = world.league.fixtures.find((f) => f.week === 1)!;
    world.league = {
      ...world.league,
      fixtures: world.league.fixtures.map((f) =>
        f.id === fixture.id ? { ...f, awayClubId: 'club-ghost' } : f,
      ),
    };

    expect(() => advance(world)).toThrow(/missing away club club-ghost/);
  });
});

describe('degenerate squad guards', () => {
  function playerMapOf(players: Player[]): PlayerMap {
    const map: PlayerMap = {};
    players.forEach((p) => {
      map[p.id] = p;
    });
    return map;
  }

  // Build a club whose entire 11-man squad shares one position, forcing
  // degenerate starting-XI position groups.
  function degenerateClub(
    template: Club,
    source: Player[],
    position: Position,
  ): { club: Club; players: Player[] } {
    const degPlayers = source.slice(0, 11).map((p, i) => ({
      ...p,
      id: `deg-${position}-${i}`,
      primaryPosition: position,
      secondaryPositions: [],
      contract: { ...p.contract, clubId: template.id },
    }));
    return {
      club: { ...template, squad: degPlayers.map((p) => p.id) },
      players: degPlayers,
    };
  }

  it('fails descriptively when the XI has no defenders', () => {
    const world = buildWorld();
    const { club: degClub, players: degPlayers } = degenerateClub(
      world.clubs[0],
      world.players,
      'ST',
    );

    const opponent = world.clubs[1];
    const opponentMap = playerMapOf(
      world.players.filter((p) => opponent.squad.includes(p.id)),
    );
    const degMap = playerMapOf(degPlayers);

    expect(() =>
      simulateMatch(degClub, opponent, degMap, opponentMap, 1),
    ).toThrow(/no eligible defenders/i);
  });

  it('fails descriptively when the XI has no attackers or midfielders', () => {
    const world = buildWorld();
    const { club: degClub, players: degPlayers } = degenerateClub(
      world.clubs[0],
      world.players,
      'CB',
    );

    const opponent = world.clubs[1];
    const opponentMap = playerMapOf(
      world.players.filter((p) => opponent.squad.includes(p.id)),
    );
    const degMap = playerMapOf(degPlayers);

    expect(() =>
      simulateMatch(degClub, opponent, degMap, opponentMap, 1),
    ).toThrow(/no eligible attackers or midfielders/i);
  });

  it('never produces uncontrolled TypeErrors for empty RNG groups', () => {
    const world = buildWorld();
    const { club: degClub, players: degPlayers } = degenerateClub(
      world.clubs[0],
      world.players,
      'ST',
    );
    const opponent = world.clubs[1];
    const opponentMap = playerMapOf(
      world.players.filter((p) => opponent.squad.includes(p.id)),
    );
    const degMap = playerMapOf(degPlayers);

    // Across many seeds, the only acceptable failure is the descriptive
    // guard error — never a TypeError from dereferencing undefined.
    for (let seed = 1; seed <= 10; seed++) {
      try {
        simulateMatch(degClub, opponent, degMap, opponentMap, seed);
      } catch (error) {
        expect(error).not.toBeInstanceOf(TypeError);
        expect((error as Error).message).toMatch(/eligible|starting XI/i);
      }
    }
  });
});

describe('injury recovery across matchweeks', () => {
  // Advance the world in place so multi-week scenarios can be chained.
  function advanceWorldInPlace(world: World) {
    const adv = advanceMatchweek(
      world.season,
      world.league,
      world.clubs,
      world.players,
      { managedClubId: world.clubs[0].id },
    );
    world.season = adv.updatedSeason;
    world.league = adv.updatedLeague;
    world.clubs = adv.updatedClubs;
    world.players = adv.updatedPlayers;
    return adv;
  }

  // Find a squad reserve of clubs[0]: a player who does not start in
  // week 1's match, so injury recovery applies to them every week.
  function reserveOf(world: World): Player {
    const probe = advance(buildWorld());
    const fixture = weekOneFixtureFor(world, world.clubs[0].id);
    const match = matchResultFor(fixture.id, probe);
    const participantIds = new Set(match.participantIds);
    const reserveId = world.clubs[0].squad.find((id) => !participantIds.has(id))!;
    return world.players.find((p) => p.id === reserveId)!;
  }

  function injure(player: Player, daysRemaining: number) {
    player.status.injury = {
      type: 'Test injury',
      daysRemaining,
      severity: 'moderate',
    };
  }

  function injuryOf(world: World, playerId: string) {
    return world.players.find((p) => p.id === playerId)!.status.injury;
  }

  it('heals a 7-day injury after one recovery week', () => {
    const world = buildWorld();
    const reserve = reserveOf(world);
    injure(reserve, 7);

    advanceWorldInPlace(world);

    // 7 days elapsed during the week → healed, injury object removed.
    expect(injuryOf(world, reserve.id)).toBeNull();
  });

  it('keeps a 14-day injury through one week, heals after the second', () => {
    const world = buildWorld();
    const reserve = reserveOf(world);
    injure(reserve, 14);

    advanceWorldInPlace(world);
    const afterWeek1 = injuryOf(world, reserve.id);
    expect(afterWeek1).not.toBeNull();
    expect(afterWeek1!.daysRemaining).toBe(7);

    advanceWorldInPlace(world);
    expect(injuryOf(world, reserve.id)).toBeNull();
  });

  it('decrements a 20-day injury by exactly 7 days per week', () => {
    const world = buildWorld();
    const reserve = reserveOf(world);
    injure(reserve, 20);

    advanceWorldInPlace(world);
    expect(injuryOf(world, reserve.id)!.daysRemaining).toBe(13);

    advanceWorldInPlace(world);
    expect(injuryOf(world, reserve.id)!.daysRemaining).toBe(6);

    advanceWorldInPlace(world);
    expect(injuryOf(world, reserve.id)).toBeNull();
  });

  it('never lets daysRemaining go negative and removes healed injuries', () => {
    const world = buildWorld();
    const reserve = reserveOf(world);
    injure(reserve, 3); // shorter than one simulated week

    advanceWorldInPlace(world);

    const injury = injuryOf(world, reserve.id);
    // 3 - 7 would be negative: the object must simply be removed.
    expect(injury).toBeNull();
  });

  it('does not decrement a newly inflicted injury during the same week, then recovers 7 days weekly', () => {
    // Find a deterministic world where a match produces an injury event
    // for a participant. Vary the league id to explore different seeds.
    let scenario: {
      world: World;
      injuredPlayerId: string;
      daysAfterWeek1: number;
    } | null = null;

    for (let i = 0; i < 80 && !scenario; i++) {
      const world = buildWorld();
      world.league = { ...world.league, id: `league-seed-${i}` };
      const adv = advanceMatchweek(
        world.season,
        world.league,
        world.clubs,
        world.players,
        { managedClubId: world.clubs[0].id },
      );

      for (const r of adv.results) {
        const event = r.result.events.find((e) => e.type === 'injury');
        if (!event) continue;
        const p = adv.updatedPlayers.find(
          (pl) => pl.id === event.primaryPlayerId,
        );
        if (p?.status.injury && p.status.injury.daysRemaining > 7) {
          scenario = {
            world,
            injuredPlayerId: p.id,
            daysAfterWeek1: p.status.injury.daysRemaining,
          };
          // Continue the scenario from the post-matchweek state.
          world.season = adv.updatedSeason;
          world.league = adv.updatedLeague;
          world.clubs = adv.updatedClubs;
          world.players = adv.updatedPlayers;
          break;
        }
      }
    }

    expect(scenario).not.toBeNull();
    const { world, injuredPlayerId, daysAfterWeek1 } = scenario!;

    // The injured player could not play in week 2 (still injured), so the
    // recovery loop is the only place their counter can move: exactly -7.
    const advWeek2 = advanceMatchweek(
      world.season,
      world.league,
      world.clubs,
      world.players,
      { managedClubId: world.clubs[0].id },
    );
    const p2 = advWeek2.updatedPlayers.find((p) => p.id === injuredPlayerId)!;

    expect(p2.status.injury).not.toBeNull();
    expect(p2.status.injury!.daysRemaining).toBe(daysAfterWeek1 - 7);
  });
});
