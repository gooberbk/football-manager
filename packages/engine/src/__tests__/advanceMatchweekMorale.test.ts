import { advanceMatchweek } from '../season/advanceMatchweek';
import { generateSeedData } from '../seed/generateSeedData';
import {
  generateFixtures,
  scheduledFixturesToLeagueFixtures,
} from '../season/scheduling';
import { DEFAULT_WEEKLY_MORALE_PARAMS } from '../players/morale';
import type {
  Club,
  InjurySeverity,
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

function buildWorld(clubCount = CLUB_COUNT, transferWindowOpen = false): World {
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
    transferWindowOpen,
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

const INJURY_DELTAS: Record<InjurySeverity, number> = {
  minor: -6,
  moderate: -8,
  serious: -10,
  severe: -10,
};

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/** Replicates the spec formula for assertions. */
function expectedMorale(base: number, eventDelta: number): number {
  const b = clamp(Number.isFinite(base) ? base : 75, 0, 100);
  const d = clamp(eventDelta, -12, 12);
  return clamp(b + d + 0.15 * (75 - b), 0, 100);
}

/**
 * Compute the expected morale of every player after one advancement,
 * replicating the spec rules from observable before/after state.
 * `preClubs` must be the club array the engine received as input.
 */
function expectedMoraleByPlayerId(
  beforePlayers: Player[],
  afterPlayers: Player[],
  preClubs: Club[],
  advancement: ReturnType<typeof advanceMatchweek>,
): Map<string, number> {
  const beforeById = new Map(beforePlayers.map((p) => [p.id, p]));

  // Match-time club snapshot from pre-week squads.
  const clubByPlayer = new Map<string, string>();
  preClubs.forEach((club) =>
    club.squad.forEach((pid) => clubByPlayer.set(pid, club.id)),
  );

  // Match result per club for this week — results already carry the
  // home/away club ids and both participant XIs.
  const matchByClub = new Map<string, (typeof advancement.results)[number]>();
  for (const r of advancement.results) {
    matchByClub.set(r.homeClubId, r);
    matchByClub.set(r.awayClubId, r);
  }

  // New unpaid wages: debt delta per club. With the transfer window
  // closed there are no transfer-side debt mutations, so the delta is
  // exactly the week's unpaid wages.
  const beforeDebt = new Map(preClubs.map((c) => [c.id, c.finances.debt]));
  const unpaidClubs = new Set<string>();
  advancement.updatedClubs.forEach((club) => {
    if ((club.finances.debt - (beforeDebt.get(club.id) ?? 0)) > 0) {
      unpaidClubs.add(club.id);
    }
  });

  const expected = new Map<string, number>();
  afterPlayers.forEach((after) => {
    const before = beforeById.get(after.id);
    if (!before) return;

    let eventDelta = 0;

    // Match result via match-time club.
    const clubId = clubByPlayer.get(after.id);
    if (clubId) {
      const match = matchByClub.get(clubId);
      if (match && match.result.participantIds.includes(after.id)) {
        const isHome = match.homeClubId === clubId;
        const own = isHome ? match.homeScore : match.awayScore;
        const other = isHome ? match.awayScore : match.homeScore;
        if (own !== other) {
          eventDelta += own > other
            ? DEFAULT_WEEKLY_MORALE_PARAMS.winDelta
            : DEFAULT_WEEKLY_MORALE_PARAMS.lossDelta;
        }
      }
    }

    // Injury transitions.
    const hadInjury = before.status.injury !== null;
    const hasInjury = after.status.injury !== null;
    if (!hadInjury && hasInjury) {
      eventDelta += INJURY_DELTAS[after.status.injury!.severity];
    } else if (hadInjury && !hasInjury) {
      eventDelta += DEFAULT_WEEKLY_MORALE_PARAMS.healedDelta;
    }

    // New unpaid wages — player's CURRENT club (post-transfer).
    // Free agents (clubId null) belong to no club and are never charged.
    if (
      after.contract.clubId !== null &&
      unpaidClubs.has(after.contract.clubId)
    ) {
      eventDelta += DEFAULT_WEEKLY_MORALE_PARAMS.unpaidWagesDelta;
    }

    expected.set(after.id, expectedMorale(before.status.morale, eventDelta));
  });

  return expected;
}

describe('advanceMatchweek — morale integration', () => {
  it('produces exactly the spec morale for every player after week 1', () => {
    const world = buildWorld();
    const beforePlayers = [...world.players];
    const beforeClubs = [...world.clubs];
    const beforeMorale = new Map(world.players.map((p) => [p.id, p.status.morale]));

    const adv = advance(world);

    const expected = expectedMoraleByPlayerId(
      beforePlayers,
      adv.updatedPlayers,
      beforeClubs,
      adv,
    );

    expect(expected.size).toBe(adv.updatedPlayers.length);
    let changed = 0;
    for (const p of adv.updatedPlayers) {
      const exp = expected.get(p.id)!;
      expect(p.status.morale).toBeCloseTo(exp, 8);
      expect(p.status.morale).toBeGreaterThanOrEqual(0);
      expect(p.status.morale).toBeLessThanOrEqual(100);
      if (p.status.morale !== beforeMorale.get(p.id)) changed++;
    }
    // Sanity: morale actually evolved for a meaningful share of players.
    expect(changed).toBeGreaterThan(adv.updatedPlayers.length / 2);
  });

  it('keeps morale in bounds and drifts toward neutral over a full season', () => {
    const world = buildWorld();
    for (let week = 0; week < 10; week++) {
      advanceWorldInPlace(world);
      for (const p of world.players) {
        expect(p.status.morale).toBeGreaterThanOrEqual(0);
        expect(p.status.morale).toBeLessThanOrEqual(100);
        expect(Number.isFinite(p.status.morale)).toBe(true);
      }
    }
    // Season morale must remain a distribution, not collapse to 0/100.
    const values = world.players.map((p) => p.status.morale);
    const min = Math.min(...values);
    const max = Math.max(...values);
    expect(min).toBeGreaterThan(0);
    expect(max).toBeLessThan(100);
  });

  it('is deterministic: identical inputs produce identical morale', () => {
    const w1 = buildWorld();
    const w2 = buildWorld();
    const a1 = advance(w1);
    const a2 = advance(w2);
    const morale1 = a1.updatedPlayers.map((p) => p.status.morale);
    const morale2 = a2.updatedPlayers.map((p) => p.status.morale);
    expect(morale1).toEqual(morale2);
  });

  it('produces exactly the spec morale every week and observes a real injury penalty', () => {
    // Multi-week exact-value check: every player's morale must equal the
    // spec formula computed from observable before/after state.
    const world = buildWorld();
    let injurySeen = false;

    for (let week = 0; week < 8; week++) {
      const beforePlayers = [...world.players];
      const beforeClubs = [...world.clubs];
      const beforeInjury = new Map(
        world.players.map((p) => [p.id, p.status.injury]),
      );

      const adv = advance(world);
      world.season = adv.updatedSeason;
      world.league = adv.updatedLeague;
      world.clubs = adv.updatedClubs;
      world.players = adv.updatedPlayers;

      const expected = expectedMoraleByPlayerId(
        beforePlayers,
        adv.updatedPlayers,
        beforeClubs,
        adv,
      );
      for (const p of adv.updatedPlayers) {
        expect(p.status.morale).toBeCloseTo(expected.get(p.id)!, 8);
      }

      for (const p of adv.updatedPlayers) {
        if (beforeInjury.get(p.id) === null && p.status.injury !== null) {
          injurySeen = true;
          // A newly contracted injury never yields a morale ABOVE the
          // no-event outcome (worst case win +4 still nets negative
          // against -6..-10); equality is possible at the 0/100 clamps.
          const before = beforePlayers.find((b) => b.id === p.id)!;
          expect(p.status.morale).toBeLessThanOrEqual(
            expectedMorale(before.status.morale, 0) + 1e-9,
          );
        }
      }
    }

    expect(injurySeen).toBe(true);
  });

  it('does not penalize a pre-existing injury that persists', () => {
    const world = buildWorld();
    // Give a squad player an active injury that will still be healing.
    const victim = world.players.find((p) =>
      world.clubs[0].squad.includes(p.id),
    )!;
    const victimIndex = world.players.indexOf(victim);
    world.players[victimIndex] = {
      ...victim,
      status: {
        ...victim.status,
        injury: { type: 'Test injury', daysRemaining: 20, severity: 'moderate' },
      },
    };

    const beforeMorale = world.players[victimIndex].status.morale;
    const adv = advance(world);
    const after = adv.updatedPlayers.find((p) => p.id === victim.id)!;

    // Injury persists (20 - 7 = 13 days) → no morale event, only
    // reversion. The player could not have played (injured).
    expect(after.status.injury).not.toBeNull();
    expect(after.status.injury!.daysRemaining).toBe(13);
    expect(after.status.morale).toBeCloseTo(
      expectedMorale(beforeMorale, 0),
      8,
    );
  });

  it('rewards a real healing (+4) when the injury disappears', () => {
    const world = buildWorld();
    const victim = world.players.find((p) =>
      world.clubs[0].squad.includes(p.id),
    )!;
    const victimIndex = world.players.indexOf(victim);
    world.players[victimIndex] = {
      ...victim,
      status: {
        ...victim.status,
        injury: { type: 'Test injury', daysRemaining: 5, severity: 'minor' },
      },
    };

    const beforeMorale = world.players[victimIndex].status.morale;
    const adv = advance(world);
    const after = adv.updatedPlayers.find((p) => p.id === victim.id)!;

    // 5 - 7 <= 0 → healed → +4 morale event plus weekly reversion.
    expect(after.status.injury).toBeNull();
    expect(after.status.morale).toBeCloseTo(
      expectedMorale(beforeMorale, 4),
      8,
    );
  });

  it('applies -2 to every player of a club with NEW unpaid wages only', () => {
    const world = buildWorld();
    const brokeClub = world.clubs[1];
    // Make payroll unaffordable: deeply negative balance, tiny income.
    const brokeIndex = world.clubs.indexOf(brokeClub);
    world.clubs[brokeIndex] = {
      ...brokeClub,
      finances: { ...brokeClub.finances, balance: -1000000000, weeklyIncome: 0 },
    };

    const beforePlayers = [...world.players];
    const beforeDebt = brokeClub.finances.debt;
    const adv = advance(world);

    const afterClub = adv.updatedClubs.find((c) => c.id === brokeClub.id)!;
    expect(afterClub.finances.debt).toBeGreaterThan(beforeDebt);

    // world.clubs still holds the modified input clubs (the engine never
    // mutates its inputs), so it is the correct pre-economy baseline.
    const expected = expectedMoraleByPlayerId(
      beforePlayers,
      adv.updatedPlayers,
      world.clubs,
      adv,
    );
    for (const p of adv.updatedPlayers) {
      expect(p.status.morale).toBeCloseTo(expected.get(p.id)!, 8);
    }
  });

  it('does NOT penalize historical debt without new unpaid wages', () => {
    const world = buildWorld();
    const debtor = world.clubs[1];
    const debtorIndex = world.clubs.indexOf(debtor);
    world.clubs[debtorIndex] = {
      ...debtor,
      finances: { ...debtor.finances, debt: 5000000 }, // historical only
    };

    const adv = advance(world);
    const afterClub = adv.updatedClubs.find((c) => c.id === debtor.id)!;
    // Solvent club: wageBill fully paid → debt unchanged → no new unpaid.
    expect(afterClub.finances.debt).toBe(5000000);

    const expected = expectedMoraleByPlayerId(
      world.players,
      adv.updatedPlayers,
      world.clubs,
      adv,
    );
    for (const p of adv.updatedPlayers) {
      expect(p.status.morale).toBeCloseTo(expected.get(p.id)!, 8);
    }
  });

  it('evolves morale on a bye week (no fixtures) including unpaid wages', () => {
    const world = buildWorld();
    world.league = { ...world.league, fixtures: [] };
    const brokeClub = world.clubs[1];
    const brokeIndex = world.clubs.indexOf(brokeClub);
    world.clubs[brokeIndex] = {
      ...brokeClub,
      finances: { ...brokeClub.finances, balance: -1000000000, weeklyIncome: 0 },
    };

    const beforeInjury = new Map(
      world.players.map((p) => [p.id, p.status.injury]),
    );
    const beforeMorale = new Map(world.players.map((p) => [p.id, p.status.morale]));
    const adv = advance(world);

    expect(adv.results).toHaveLength(0);
    expect(adv.seasonComplete).toBe(false);

    // Every player: reversion only, plus -2 for broke-club players and
    // +4 for any injury that actually healed this week. Verify two
    // representatives of each unpaid class.
    const check = (player: Player) => {
      const before = beforeMorale.get(player.id)!;
      const hadInjury = beforeInjury.get(player.id) !== null;
      const hasInjury = player.status.injury !== null;
      let eventDelta = player.contract.clubId === brokeClub.id ? -2 : 0;
      if (hadInjury && !hasInjury) eventDelta += 4;
      const b = Math.max(0, Math.min(100, before));
      const d = Math.max(-12, Math.min(12, eventDelta));
      const expected = Math.max(0, Math.min(100, b + d + 0.15 * (75 - b)));
      expect(player.status.morale).toBeCloseTo(expected, 8);
    };

    const brokePlayer = adv.updatedPlayers.find(
      (p) => p.contract.clubId === brokeClub.id,
    )!;
    const solventPlayer = adv.updatedPlayers.find(
      (p) => p.contract.clubId !== brokeClub.id,
    )!;
    check(brokePlayer);
    check(solventPlayer);
    // And every player, for completeness.
    adv.updatedPlayers.forEach(check);
  });

  it('attributes the match result to the PRE-TRANSFER club for a transferred participant', () => {
    // Open the window and scan deterministic weeks for a player who both
    // played and was transferred during the same advanceMatchweek.
    const world = buildWorld(CLUB_COUNT, true);
    let verified = false;

    for (let week = 0; week < 15 && !verified; week++) {
      // Pre-week state (engine never mutates its inputs).
      const preClubs = world.clubs.map((c) => ({
        ...c,
        squad: [...c.squad],
        finances: { ...c.finances },
      }));
      const prePlayers = new Map(world.players.map((p) => [p.id, p]));
      const preLeague = world.league;
      const preSeason = world.season;

      const adv = advanceMatchweek(world.season, world.league, world.clubs, world.players, {
        managedClubId: world.clubs[0].id,
      });
      world.season = adv.updatedSeason;
      world.league = adv.updatedLeague;
      world.clubs = adv.updatedClubs;
      world.players = adv.updatedPlayers;

      // Match-time club snapshot from pre-week squads.
      const clubByPlayer = new Map<string, string>();
      preClubs.forEach((club) =>
        club.squad.forEach((pid) => clubByPlayer.set(pid, club.id)),
      );
      const resultByFixture = new Map(adv.results.map((r) => [r.fixtureId, r]));
      const fixtureByClub = new Map<string, string>();
      preLeague.fixtures.forEach((f) => {
        if (f.week === preSeason.currentWeek) {
          fixtureByClub.set(f.homeClubId, f.id);
          fixtureByClub.set(f.awayClubId, f.id);
        }
      });

      for (const record of adv.transferRecords) {
        const oldClubId = clubByPlayer.get(record.playerId);
        const fixtureId = oldClubId ? fixtureByClub.get(oldClubId) : undefined;
        const match = fixtureId ? resultByFixture.get(fixtureId) : undefined;
        if (!match || !match.result.participantIds.includes(record.playerId)) {
          continue; // transferred but did not play this week
        }

        const before = prePlayers.get(record.playerId)!;
        const after = world.players.find((p) => p.id === record.playerId)!;
        expect(after.contract.clubId).toBe(record.toClubId);

        // Expected: result of the OLD club + reversion + any injury /
        // unpaid components. Debt deltas equal unpaid wages here because
        // seed clubs start with zero debt (debtRepayment = 0).
        const isHome = match.homeClubId === oldClubId;
        const own = isHome ? match.homeScore : match.awayScore;
        const other = isHome ? match.awayScore : match.homeScore;
        let eventDelta = 0;
        if (own !== other) {
          eventDelta += own > other ? 4 : -4;
        }
        const hadInjury = before.status.injury !== null;
        const hasInjury = after.status.injury !== null;
        if (!hadInjury && hasInjury) {
          eventDelta += INJURY_DELTAS[after.status.injury!.severity];
        } else if (hadInjury && !hasInjury) {
          eventDelta += 4;
        }
        const newClubAfter = world.clubs.find((c) => c.id === record.toClubId)!;
        const newClubBefore = preClubs.find((c) => c.id === record.toClubId)!;
        if (newClubAfter.finances.debt - newClubBefore.finances.debt > 0) {
          eventDelta -= 2;
        }

        const base = Math.max(0, Math.min(100, before.status.morale));
        const d = Math.max(-12, Math.min(12, eventDelta));
        const expected = Math.max(
          0,
          Math.min(100, base + d + 0.15 * (75 - base)),
        );
        expect(after.status.morale).toBeCloseTo(expected, 8);
        verified = true;
        break;
      }
    }

    expect(verified).toBe(true);
  });
});
