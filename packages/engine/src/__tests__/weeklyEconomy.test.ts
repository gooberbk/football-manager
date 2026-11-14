import { applyWeeklyEconomy } from '../economy/weeklyEconomy';
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

function setFinances(
  club: Club,
  finances: Partial<Club['finances']>,
) {
  club.finances = { ...club.finances, ...finances };
}

function setAllWages(players: Player[], wage: number) {
  players.forEach((p) => {
    p.contract = { ...p.contract, wage };
  });
}

describe('applyWeeklyEconomy', () => {
  function scenario() {
    const world = buildWorld(2);
    return { clubs: world.clubs, players: world.players };
  }

  it('A. pays full wages and credits full income when cash is sufficient', () => {
    const { clubs, players } = scenario();
    setAllWages(players, 1_000);
    const club = clubs[0];
    const bill = calculateWageBill(club, players);
    setFinances(club, { balance: 10_000_000, weeklyIncome: 1_000_000, debt: 0 });

    const [out] = applyWeeklyEconomy([club], players);

    expect(out.finances.weeklyIncome).toBe(1_000_000);
    expect(out.finances.balance).toBe(10_000_000 + 1_000_000 - bill);
    expect(out.finances.debt).toBe(0);
  });

  it('B. leaves balance exactly zero when cash equals the wage bill', () => {
    const { clubs, players } = scenario();
    setAllWages(players, 1_000);
    const club = clubs[0];
    const bill = calculateWageBill(club, players);
    setFinances(club, {
      balance: bill - 500_000,
      weeklyIncome: 500_000,
      debt: 7,
    });

    const [out] = applyWeeklyEconomy([club], players);

    expect(out.finances.balance).toBe(0);
    expect(out.finances.debt).toBe(7);
  });

  it('C. floors balance at zero and adds only the unpaid part to debt', () => {
    const { clubs, players } = scenario();
    setAllWages(players, 1_000_000); // bill far exceeds any plausible cash
    const club = clubs[0];
    const bill = calculateWageBill(club, players);
    setFinances(club, { balance: 500_000, weeklyIncome: 1_000_000, debt: 0 });

    const [out] = applyWeeklyEconomy([club], players);

    expect(out.finances.balance).toBe(0);
    expect(out.finances.debt).toBe(bill - 1_500_000);
  });

  it('D. applies weekly income toward payroll from a zero balance', () => {
    const { clubs, players } = scenario();
    setAllWages(players, 1_000_000);
    const club = clubs[0];
    const bill = calculateWageBill(club, players);
    setFinances(club, { balance: 0, weeklyIncome: 100_000, debt: 0 });

    const [out] = applyWeeklyEconomy([club], players);

    expect(out.finances.balance).toBe(0);
    expect(out.finances.debt).toBe(bill - 100_000);
  });

  it('E. preserves existing debt and accumulates new unpaid wages', () => {
    const { clubs, players } = scenario();
    setAllWages(players, 1_000_000);
    const club = clubs[0];
    const bill = calculateWageBill(club, players);
    setFinances(club, { balance: 0, weeklyIncome: 0, debt: 250_000 });

    const [out] = applyWeeklyEconomy([club], players);

    expect(out.finances.balance).toBe(0);
    expect(out.finances.debt).toBe(250_000 + bill);
  });

  it('F. applies the economy independently per club', () => {
    const { clubs, players } = scenario();
    setAllWages(players, 1_000);
    const bill0 = calculateWageBill(clubs[0], players);
    const bill1 = calculateWageBill(clubs[1], players);
    setFinances(clubs[0], {
      balance: 10_000_000, weeklyIncome: 1_000_000, debt: 0,
    });
    setFinances(clubs[1], {
      balance: 0, weeklyIncome: 0, debt: 42,
    });

    const [out0, out1] = applyWeeklyEconomy(clubs, players);

    expect(out0.finances.balance).toBe(11_000_000 - bill0);
    expect(out0.finances.debt).toBe(0);
    expect(out1.finances.balance).toBe(0);
    expect(out1.finances.debt).toBe(42 + bill1);
  });

  it('does not mutate inputs and returns new club objects', () => {
    const { clubs, players } = scenario();
    const snapshot = JSON.stringify(clubs);
    const [out] = applyWeeklyEconomy(clubs, players);

    expect(JSON.stringify(clubs)).toBe(snapshot);
    expect(out).not.toBe(clubs[0]);
    expect(out.finances).not.toBe(clubs[0].finances);
  });

  it('is deterministic: identical inputs produce identical outputs', () => {
    const { clubs, players } = scenario();
    const a = applyWeeklyEconomy(clubs, players);
    const b = applyWeeklyEconomy(clubs, players);
    expect(a).toEqual(b);
  });

  it('preserves a pre-existing negative balance without erasing it', () => {
    const { clubs, players } = scenario();
    setAllWages(players, 1_000_000);
    const club = clubs[0];
    const bill = calculateWageBill(club, players);
    // Negative balance from a prior transfer fee: payroll pays nothing,
    // income is still credited, the deficit is not silently zeroed.
    setFinances(club, { balance: -2_000_000, weeklyIncome: 500_000, debt: 0 });

    const [out] = applyWeeklyEconomy([club], players);

    expect(out.finances.balance).toBe(-1_500_000);
    expect(out.finances.debt).toBe(bill);
  });
});

describe('advanceMatchweek weekly economy', () => {
  it('G. credits income and charges payroll for every club, managed included, regardless of match results', () => {
    const world = buildWorld(CLUB_COUNT, false);
    // Zero every wage: payroll is nil, so each club's balance delta is
    // exactly its weekly income — proving income is result-independent.
    setAllWages(world.players, 0);
    const incomes = new Map(
      world.clubs.map((c) => [c.id, c.finances.weeklyIncome]),
    );
    const balancesBefore = new Map(
      world.clubs.map((c) => [c.id, c.finances.balance]),
    );

    const adv = advance(world);

    expect(adv.updatedClubs).toHaveLength(world.clubs.length);
    adv.updatedClubs.forEach((club) => {
      expect(club.finances.balance).toBe(
        balancesBefore.get(club.id)! + incomes.get(club.id)!,
      );
      expect(club.finances.debt).toBe(0);
    });
    // Matches were actually played — income was not conditional on them.
    expect(adv.results.length).toBeGreaterThan(0);
  });

  it('G2. pays wages for a club that did not play a fixture this week', () => {
    // Odd club count produces a bye week for at least one club.
    const world = buildWorld(5, false);
    setAllWages(world.players, 1_000);
    const week1FixtureClubIds = new Set(
      world.league.fixtures
        .filter((f) => f.week === 1)
        .flatMap((f) => [f.homeClubId, f.awayClubId]),
    );
    const idleClub = world.clubs.find(
      (c) => !week1FixtureClubIds.has(c.id),
    );
    expect(idleClub).toBeDefined();

    const idleBefore = idleClub!.finances.balance;
    const idleIncome = idleClub!.finances.weeklyIncome;
    const idleBill = calculateWageBill(idleClub!, world.players);

    const adv = advance(world);
    const idleAfter = adv.updatedClubs.find((c) => c.id === idleClub!.id)!;

    expect(idleAfter.finances.balance).toBe(
      idleBefore + idleIncome - Math.min(idleBefore + idleIncome, idleBill),
    );
  });

  it('H. computes payroll on the post-transfer squads', () => {
    // Find a deterministic league/season variant where an AI transfer
    // actually executes in week 1 (window open, seeded streams).
    let world: World | null = null;
    let adv: ReturnType<typeof advance> | null = null;
    for (let i = 0; i < 60 && !adv?.transferRecords.length; i++) {
      const candidate = buildWorld(CLUB_COUNT, true);
      candidate.league = { ...candidate.league, id: `league-xfer-${i}` };
      const result = advanceMatchweek(
        candidate.season,
        candidate.league,
        candidate.clubs,
        candidate.players,
        { managedClubId: candidate.clubs[0].id },
      );
      if (result.transferRecords.length > 0) {
        world = candidate;
        adv = result;
      }
    }
    expect(adv).not.toBeNull();
    expect(adv!.transferRecords.length).toBeGreaterThan(0);

    // Reconstruct each club's finances as they were right before the
    // economy pass: input finances adjusted only by executed transfer
    // fees. Squads/contracts are the post-transfer ones.
    const balanceDelta = new Map<string, number>();
    adv!.transferRecords.forEach((rec) => {
      balanceDelta.set(
        rec.toClubId,
        (balanceDelta.get(rec.toClubId) ?? 0) - rec.fee,
      );
      balanceDelta.set(
        rec.fromClubId,
        (balanceDelta.get(rec.fromClubId) ?? 0) + rec.fee,
      );
    });
    const preEconomyClubs = world!.clubs.map((club) => ({
      ...club,
      finances: {
        ...club.finances,
        balance:
          club.finances.balance + (balanceDelta.get(club.id) ?? 0),
      },
    }));
    // Adopt post-transfer squads so the wage bill uses them.
    const postSquadByClub = new Map(
      adv!.updatedClubs.map((c) => [c.id, c.squad]),
    );
    const preEconomyWithSquads = preEconomyClubs.map((club) => ({
      ...club,
      squad: postSquadByClub.get(club.id) ?? club.squad,
    }));

    const expected = applyWeeklyEconomy(
      preEconomyWithSquads,
      adv!.updatedPlayers,
    );

    adv!.updatedClubs.forEach((club, i) => {
      expect(club.finances.balance).toBe(expected[i].finances.balance);
      expect(club.finances.debt).toBe(expected[i].finances.debt);
    });
  });

  it('I. leaves input state untouched and replays identically', () => {
    const worldA = buildWorld(CLUB_COUNT, false);
    const worldB = buildWorld(CLUB_COUNT, false);
    const clubsSnapshot = JSON.stringify(worldA.clubs);
    const playersSnapshot = JSON.stringify(worldA.players);

    const advA = advance(worldA);
    const advB = advance(worldB);

    expect(advB).toEqual(advA);
    expect(JSON.stringify(worldA.clubs)).toBe(clubsSnapshot);
    expect(JSON.stringify(worldA.players)).toBe(playersSnapshot);
  });

  it('J. applies income and payroll exactly once per matchweek across consecutive weeks', () => {
    const world = buildWorld(CLUB_COUNT, false);
    // Everyone is broke: balance 0, tiny income, real wages → debt grows.
    world.clubs.forEach((c) =>
      setFinances(c, { balance: 0, weeklyIncome: 10_000, debt: 0 }),
    );

    const club = world.clubs[0];
    const bill = calculateWageBill(club, world.players);
    expect(bill).toBeGreaterThan(10_000);

    advanceWorldInPlace(world);
    const afterWeek1 = world.clubs.find((c) => c.id === club.id)!;
    expect(afterWeek1.finances.balance).toBe(0);
    expect(afterWeek1.finances.debt).toBe(bill - 10_000);

    advanceWorldInPlace(world);
    const afterWeek2 = world.clubs.find((c) => c.id === club.id)!;
    expect(afterWeek2.finances.balance).toBe(0);
    // Squads are unchanged (window closed): same bill, debt accumulates.
    expect(afterWeek2.finances.debt).toBe(2 * (bill - 10_000));
  });
});
