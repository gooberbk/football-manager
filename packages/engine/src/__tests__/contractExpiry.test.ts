import { processContractExpiry } from '../season/contracts';
import { advanceMatchweek } from '../season/advanceMatchweek';
import { generateSeedData } from '../seed/generateSeedData';
import {
  generateFixtures,
  scheduledFixturesToLeagueFixtures,
} from '../season/scheduling';
import { calculateWageBill } from '../transfer/market';
import type {
  Club,
  League,
  Player,
  PlayerAttributes,
  Season,
  StandingEntry,
} from '@club-director/shared-types';

const NOW = new Date('2024-08-01T00:00:00Z');
const FUTURE = new Date('2030-01-01T00:00:00Z');
const PAST = new Date('2020-01-01T00:00:00Z');

function baseAttributes(value = 12): PlayerAttributes {
  return {
    technical: {
      passing: value, shooting: value, dribbling: value, tackling: value,
      heading: value, crossing: value, finishing: value, technique: value,
      longShots: value, freeKicks: value, firstTouch: value,
    },
    mental: {
      vision: value, decisions: value, composure: value, anticipation: value,
      positioning: value, workRate: value, determination: value,
      leadership: value, concentration: value, flair: value,
    },
    physical: {
      pace: value, acceleration: value, stamina: value, strength: value,
      agility: value, balance: value, jumping: value, naturalFitness: value,
    },
  };
}

interface PlayerOverrides {
  id?: string;
  clubId?: string | null;
  expiry?: Date;
  wage?: number;
}

function makePlayer(overrides: PlayerOverrides = {}): Player {
  return {
    id: overrides.id ?? 'player-1',
    firstName: 'Test',
    lastName: 'Player',
    nationality: 'Testland',
    age: 25,
    preferredFoot: 'right',
    primaryPosition: 'CM',
    secondaryPositions: [],
    attributes: baseAttributes(),
    development: {
      currentAbility: 120,
      potentialAbility: 180,
      ageGrowthCurve: 'normal',
    },
    status: {
      morale: 75,
      recentForm: [7, 7, 7, 7, 7],
      fitness: 90,
      injury: null,
    },
    contract: {
      clubId: overrides.clubId === undefined ? 'club-1' : overrides.clubId,
      wage: overrides.wage ?? 10000,
      contractExpiryDate: overrides.expiry ?? FUTURE,
      marketValue: 1000000,
    },
  };
}

function makeClub(id: string, squad: string[]): Club {
  return {
    id,
    name: id,
    nickname: id,
    foundedYear: 2000,
    reputation: 70,
    finances: {
      balance: 1000000,
      transferBudget: 1000000,
      wageBudget: 1000000,
      weeklyIncome: 100000,
      debt: 0,
    },
    squad,
    stadium: { name: 'Stadium', capacity: 30000 },
    tactics: {
      defaultFormation: '4-4-2',
      mentality: 'balanced',
      pressingIntensity: 10,
      tempo: 10,
      width: 10,
    },
  };
}

describe('processContractExpiry — unit', () => {
  it('expires a contract whose expiry date equals now (inclusive)', () => {
    const player = makePlayer({ id: 'p1', expiry: NOW });
    const club = makeClub('club-1', ['p1']);

    const result = processContractExpiry([player], [club], NOW);

    expect(result.expiredPlayerIds).toEqual(['p1']);
    expect(result.players[0].contract.clubId).toBeNull();
    expect(result.clubs[0].squad).toEqual([]);
  });

  it('expires a contract dated before now and keeps one dated after now', () => {
    const expired = makePlayer({ id: 'old', expiry: PAST });
    const valid = makePlayer({ id: 'new', expiry: FUTURE });
    const club = makeClub('club-1', ['old', 'new']);

    const result = processContractExpiry([expired, valid], [club], NOW);

    expect(result.expiredPlayerIds).toEqual(['old']);
    expect(result.players[0].contract.clubId).toBeNull();
    expect(result.players[1]).toBe(valid); // same reference
    expect(result.clubs[0].squad).toEqual(['new']);
  });

  it('keeps wage, expiry date and market value on the expired contract', () => {
    const player = makePlayer({ id: 'p1', expiry: PAST, wage: 42000 });
    player.contract.marketValue = 777000;

    const result = processContractExpiry([player], [makeClub('c', ['p1'])], NOW);
    const contract = result.players[0].contract;

    expect(contract.clubId).toBeNull();
    expect(contract.wage).toBe(42000);
    expect(contract.contractExpiryDate).toBe(PAST);
    expect(contract.marketValue).toBe(777000);
  });

  it('does not touch any sporting, status or development field', () => {
    const player = makePlayer({ id: 'p1', expiry: PAST });
    const snapshot = JSON.stringify({
      attributes: player.attributes,
      development: player.development,
      status: player.status,
      age: player.age,
    });

    const result = processContractExpiry([player], [makeClub('c', ['p1'])], NOW);

    expect(
      JSON.stringify({
        attributes: result.players[0].attributes,
        development: result.players[0].development,
        status: result.players[0].status,
        age: result.players[0].age,
      }),
    ).toBe(snapshot);
  });

  it('removes an expired player from EVERY squad containing them', () => {
    // Inconsistent state: player listed in two squads.
    const player = makePlayer({ id: 'p1', clubId: 'club-1', expiry: PAST });
    const c1 = makeClub('club-1', ['p1', 'a']);
    const c2 = makeClub('club-2', ['p1', 'b']);
    const untouched = makeClub('club-3', ['c']);

    const result = processContractExpiry([player], [c1, c2, untouched], NOW);

    expect(result.clubs[0].squad).toEqual(['a']);
    expect(result.clubs[1].squad).toEqual(['b']);
    expect(result.clubs[2]).toBe(untouched); // same reference
  });

  it('preserves references of unaffected players and clubs', () => {
    const expiring = makePlayer({ id: 'e', expiry: PAST });
    const staying = makePlayer({ id: 's', expiry: FUTURE });
    const freeAgent = makePlayer({ id: 'f', clubId: null, expiry: PAST });
    const clubA = makeClub('club-1', ['e', 's']);
    const clubB = makeClub('club-2', ['z']); // 'z' has no player — squad ids need not resolve here

    const result = processContractExpiry([expiring, staying, freeAgent], [clubA, clubB], NOW);

    expect(result.players[1]).toBe(staying);
    expect(result.players[2]).toBe(freeAgent);
    expect(result.clubs[1]).toBe(clubB);
    expect(result.expiredPlayerIds).toEqual(['e']);
  });

  it('defensively removes a free agent still present in a squad, without a new expiration', () => {
    const freeAgent = makePlayer({ id: 'f', clubId: null, expiry: FUTURE });
    const club = makeClub('club-1', ['f', 'x']);

    const result = processContractExpiry([freeAgent], [club], NOW);

    expect(result.expiredPlayerIds).toEqual([]);
    expect(result.players[0]).toBe(freeAgent); // untouched player object
    expect(result.clubs[0].squad).toEqual(['x']);
  });

  it('treats an invalid expiry date conservatively (never expires)', () => {
    const player = makePlayer({ id: 'p1' });
    player.contract.contractExpiryDate = new Date(NaN);
    const club = makeClub('club-1', ['p1']);

    const result = processContractExpiry([player], [club], NOW);

    expect(result.expiredPlayerIds).toEqual([]);
    expect(result.players[0]).toBe(player);
    expect(result.clubs[0]).toBe(club);
  });

  it('throws on an invalid `now`', () => {
    expect(() =>
      processContractExpiry([], [], new Date(NaN)),
    ).toThrow(/valid Date/);
    expect(() =>
      processContractExpiry([], [], 'not-a-date' as unknown as Date),
    ).toThrow(/valid Date/);
  });

  it('is idempotent: a second call produces no new transition', () => {
    const player = makePlayer({ id: 'p1', expiry: PAST });
    const club = makeClub('club-1', ['p1']);

    const first = processContractExpiry([player], [club], NOW);
    const second = processContractExpiry(first.players, first.clubs, NOW);

    expect(second.expiredPlayerIds).toEqual([]);
    expect(second.players[0]).toBe(first.players[0]);
    expect(second.clubs[0]).toBe(first.clubs[0]);
  });

  it('does not mutate its inputs', () => {
    const player = makePlayer({ id: 'p1', expiry: PAST });
    const club = makeClub('club-1', ['p1']);
    const playersSnapshot = JSON.stringify(player);
    const clubsSnapshot = JSON.stringify(club);

    processContractExpiry([player], [club], NOW);

    expect(JSON.stringify(player)).toBe(playersSnapshot);
    expect(JSON.stringify(club)).toBe(clubsSnapshot);
  });
});

// ---------------------------------------------------------------------------
// Integration: advanceMatchweek
// ---------------------------------------------------------------------------

const CLUB_COUNT = 6;

interface World {
  season: Season;
  league: League;
  clubs: Club[];
  players: Player[];
}

function buildWorld(transferWindowOpen = false): World {
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
          played: 0, won: 0, drawn: 0, lost: 0,
          goalsFor: 0, goalsAgainst: 0, goalDifference: 0, points: 0,
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

/** Make `playerId` the guaranteed GK of its club so it is always selected. */
function forceStartingGk(player: Player): Player {
  return {
    ...player,
    primaryPosition: 'GK',
    attributes: {
      ...player.attributes,
      mental: { ...player.attributes.mental, positioning: 20 },
    },
  };
}

function expirePlayer(world: World, playerId: string): void {
  const idx = world.players.findIndex((p) => p.id === playerId);
  world.players[idx] = {
    ...world.players[idx],
    contract: {
      ...world.players[idx].contract,
      contractExpiryDate: new Date(world.season.currentDate),
    },
  };
}

describe('advanceMatchweek — contract expiry integration', () => {
  it('expires a contract during a match week: free agent, out of squad, still played', () => {
    const world = buildWorld();
    const club = world.clubs[0];
    const victimId = club.squad[0];
    const victimIndex = world.players.findIndex((p) => p.id === victimId);
    // Force selection so we can prove the match used the PRE-expiry squad.
    world.players[victimIndex] = forceStartingGk(world.players[victimIndex]);
    expirePlayer(world, victimId);

    const adv = advance(world);

    expect(adv.seasonComplete).toBe(false);
    expect(adv.results.length).toBeGreaterThan(0);

    const after = adv.updatedPlayers.find((p) => p.id === victimId)!;
    expect(after.contract.clubId).toBeNull();
    expect(after.contract.wage).toBe(world.players[victimIndex].contract.wage);
    expect(after.contract.contractExpiryDate.getTime()).toBe(
      world.season.currentDate.getTime(),
    );

    const afterClub = adv.updatedClubs.find((c) => c.id === club.id)!;
    expect(afterClub.squad).not.toContain(victimId);
    expect(afterClub.squad.length).toBe(club.squad.length - 1);

    // The player still played this week's match: selection ran on the
    // pre-expiry squads (expiry is processed after matches).
    const match = adv.results.find(
      (r) => r.homeClubId === club.id || r.awayClubId === club.id,
    )!;
    expect(match.result.participantIds).toContain(victimId);

    // No other player became a free agent.
    adv.updatedPlayers.forEach((p) => {
      if (p.id !== victimId) {
        expect(p.contract.clubId).not.toBeNull();
      }
    });
  });

  it('generates no wage for the expiry week', () => {
    const world = buildWorld();
    const club = world.clubs[0];
    const victimId = club.squad[0];
    const victim = world.players.find((p) => p.id === victimId)!;
    expirePlayer(world, victimId);

    const adv = advance(world);
    const afterClub = adv.updatedClubs.find((c) => c.id === club.id)!;
    const afterPlayers = adv.updatedPlayers;

    // Expected payroll: every remaining squad member's wage.
    const expectedWageBill = afterClub.squad.reduce((sum, id) => {
      const p = afterPlayers.find((pl) => pl.id === id)!;
      return sum + p.contract.wage;
    }, 0);
    expect(expectedWageBill).toBe(
      calculateWageBill(afterClub, afterPlayers),
    );
    expect(expectedWageBill).toBeLessThan(
      club.squad.reduce((sum, id) => {
        const p = world.players.find((pl) => pl.id === id)!;
        return sum + p.contract.wage;
      }, 0),
    );

    // Balance follows the weekly economy formula on the post-expiry bill.
    const availableCash = club.finances.balance + club.finances.weeklyIncome;
    const paidWages = Math.min(Math.max(availableCash, 0), expectedWageBill);
    expect(afterClub.finances.balance).toBe(availableCash - paidWages);
  });

  it('expires contracts on a bye week too', () => {
    const world = buildWorld();
    // Mark every week-1 fixture as already played → no fixtures remain
    // for the current week, so the bye-week path runs.
    world.league = {
      ...world.league,
      fixtures: world.league.fixtures.map((f) =>
        f.week === world.season.currentWeek
          ? { ...f, played: true, homeScore: 0, awayScore: 0 }
          : f,
      ),
    };
    const victimId = world.clubs[0].squad[0];
    expirePlayer(world, victimId);

    const adv = advance(world);

    expect(adv.results).toEqual([]);
    expect(adv.seasonComplete).toBe(false);
    const after = adv.updatedPlayers.find((p) => p.id === victimId)!;
    expect(after.contract.clubId).toBeNull();
    const afterClub = adv.updatedClubs.find((c) => c.id === world.clubs[0].id)!;
    expect(afterClub.squad).not.toContain(victimId);
  });

  it('an expiring player is never sold by AI transfers in the same cycle', () => {
    const world = buildWorld(true); // transfer window open
    const victimId = world.clubs[1].squad[0]; // AI club (not managed)
    expirePlayer(world, victimId);

    const adv = advance(world);

    const after = adv.updatedPlayers.find((p) => p.id === victimId)!;
    expect(after.contract.clubId).toBeNull();

    // No offer or transfer record may reference the expired player.
    const involved = [
      ...adv.transferOffers.map((o) => o.playerId),
      ...adv.transferRecords.map((r) => r.playerId),
    ];
    expect(involved).not.toContain(victimId);
    // And the player is in no squad at all.
    adv.updatedClubs.forEach((c) => expect(c.squad).not.toContain(victimId));
  });

  it('is deterministic across identical runs', () => {
    const build = () => {
      const w = buildWorld(true);
      expirePlayer(w, w.clubs[0].squad[0]);
      expirePlayer(w, w.clubs[2].squad[1]);
      return w;
    };
    const a = advance(build());
    const b = advance(build());

    expect(a.updatedPlayers).toEqual(b.updatedPlayers);
    expect(a.updatedClubs).toEqual(b.updatedClubs);
    expect(a.results.length).toBe(b.results.length);
  });
});
