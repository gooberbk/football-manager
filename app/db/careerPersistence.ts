import * as schema from './schema';
import { eq } from 'drizzle-orm';
import {
  compareMatchEventRows,
  matchFromDbRows,
  toMatchDbRow,
  toMatchEventDbRows,
  type MatchDbRow,
  type MatchEventDbRow,
  type PersistedMatch,
} from './matchRecords';
import type {
  Club,
  Player,
  League,
  Season,
  TransferRecord,
  TransferOffer,
  TransferOfferStatus,
  StandingEntry,
  Fixture,
} from '@club-director/shared-types';

const SCHEMA_VERSION = 1;

export interface CareerState {
  career: {
    id: string;
    managerName: string;
    managedClubId: string;
    createdAt: Date;
    lastPlayedAt: Date;
    schemaVersion: number;
  };
  clubs: Club[];
  players: Player[];
  league: League;
  season: Season;
  transferHistory: TransferRecord[];
  /**
   * Transfer offers belonging to this career (pending and resolved,
   * human- and AI-managed). Required so callers must state the offer
   * collection explicitly. As a runtime safeguard, saveCareer treats an
   * omitted (undefined) value as "not provided" and leaves previously
   * persisted offers untouched rather than silently deleting them; pass []
   * to clear.
   */
  transferOffers: TransferOffer[];
  /**
   * Completed-match history (scores, stats, seeds, participants, events).
   * Same runtime safeguard as transferOffers: an omitted (undefined)
   * value means "not provided" and previously persisted match rows are
   * left untouched; pass [] to clear the history explicitly. Providing
   * an array replaces the whole history inside the save transaction.
   *
   * If the database contains match rows written before migration v3
   * (fixture_id/stats/seed/participant_ids NULL — incomplete records the
   * domain model cannot represent), replacing the history is REFUSED
   * with an explicit error rather than silently dropping them.
   */
  matches?: PersistedMatch[];
}

export async function saveCareer(state: CareerState, dbInstance: any): Promise<void> {
  const now = Date.now();

  // All writes run inside a single Drizzle transaction so a save either
  // commits completely or rolls back entirely, leaving the previous career
  // untouched.
  //
  // The expo-sqlite and better-sqlite3 drivers are synchronous: the
  // transaction callback MUST be synchronous and must not await anything.
  // An async callback would return a Promise, causing the transaction to
  // commit before the writes execute. Builders are executed with .run(),
  // which is synchronous on both drivers; any thrown error propagates and
  // triggers a rollback.
  dbInstance.transaction((tx: any) => {
    // Save career metadata
    tx.insert(schema.career).values({
      id: 'active',
      managerName: state.career.managerName,
      managedClubId: state.career.managedClubId,
      createdAt: state.career.createdAt.getTime(),
      lastPlayedAt: now,
      schemaVersion: SCHEMA_VERSION,
    }).onConflictDoUpdate({
      target: schema.career.id,
      set: {
        managerName: state.career.managerName,
        managedClubId: state.career.managedClubId,
        lastPlayedAt: now,
        schemaVersion: SCHEMA_VERSION,
      },
    }).run();

    // Clear existing data
    tx.delete(schema.players).run();
    tx.delete(schema.clubs).run();
    tx.delete(schema.leagues).run();
    tx.delete(schema.leagueStandings).run();
    tx.delete(schema.fixtures).run();
    tx.delete(schema.seasons).run();
    tx.delete(schema.transfers).run();

    // Save clubs
    for (const club of state.clubs) {
      tx.insert(schema.clubs).values({
        id: club.id,
        name: club.name,
        nickname: club.nickname,
        foundedYear: club.foundedYear,
        reputation: club.reputation,
        balance: club.finances.balance,
        transferBudget: club.finances.transferBudget,
        wageBudget: club.finances.wageBudget,
        weeklyIncome: club.finances.weeklyIncome,
        stadiumName: club.stadium.name,
        stadiumCapacity: club.stadium.capacity,
        defaultFormation: club.tactics.defaultFormation,
        mentality: club.tactics.mentality,
        pressingIntensity: club.tactics.pressingIntensity,
        tempo: club.tactics.tempo,
        width: club.tactics.width,
      }).run();
    }

    // Save players
    for (const player of state.players) {
      tx.insert(schema.players).values({
        id: player.id,
        firstName: player.firstName,
        lastName: player.lastName,
        nationality: player.nationality,
        age: player.age,
        preferredFoot: player.preferredFoot,
        primaryPosition: player.primaryPosition,
        secondaryPositions: JSON.stringify(player.secondaryPositions),
        passing: player.attributes.technical.passing,
        shooting: player.attributes.technical.shooting,
        dribbling: player.attributes.technical.dribbling,
        tackling: player.attributes.technical.tackling,
        heading: player.attributes.technical.heading,
        crossing: player.attributes.technical.crossing,
        finishing: player.attributes.technical.finishing,
        technique: player.attributes.technical.technique,
        longShots: player.attributes.technical.longShots,
        freeKicks: player.attributes.technical.freeKicks,
        firstTouch: player.attributes.technical.firstTouch,
        vision: player.attributes.mental.vision,
        decisions: player.attributes.mental.decisions,
        composure: player.attributes.mental.composure,
        anticipation: player.attributes.mental.anticipation,
        positioning: player.attributes.mental.positioning,
        workRate: player.attributes.mental.workRate,
        determination: player.attributes.mental.determination,
        leadership: player.attributes.mental.leadership,
        concentration: player.attributes.mental.concentration,
        flair: player.attributes.mental.flair,
        pace: player.attributes.physical.pace,
        acceleration: player.attributes.physical.acceleration,
        stamina: player.attributes.physical.stamina,
        strength: player.attributes.physical.strength,
        agility: player.attributes.physical.agility,
        balance: player.attributes.physical.balance,
        jumping: player.attributes.physical.jumping,
        naturalFitness: player.attributes.physical.naturalFitness,
        currentAbility: player.development.currentAbility,
        potentialAbility: player.development.potentialAbility,
        ageGrowthCurve: player.development.ageGrowthCurve,
        morale: player.status.morale,
        recentForm: JSON.stringify(player.status.recentForm),
        fitness: player.status.fitness,
        injuryType: player.status.injury?.type || null,
        injuryDaysRemaining: player.status.injury?.daysRemaining || null,
        injurySeverity: player.status.injury?.severity || null,
        clubId: player.contract.clubId,
        wage: player.contract.wage,
        contractExpiryDate: player.contract.contractExpiryDate.getTime(),
        marketValue: player.contract.marketValue,
      }).run();
    }

    // Save league
    tx.insert(schema.leagues).values({
      id: state.league.id,
      name: state.league.name,
      tier: state.league.tier,
      clubIds: JSON.stringify(state.league.clubIds),
    }).run();

    // Save league standings
    for (const entry of state.league.standings.entries) {
      tx.insert(schema.leagueStandings).values({
        id: `${state.league.id}-${entry.clubId}`,
        leagueId: state.league.id,
        clubId: entry.clubId,
        played: entry.played,
        won: entry.won,
        drawn: entry.drawn,
        lost: entry.lost,
        goalsFor: entry.goalsFor,
        goalsAgainst: entry.goalsAgainst,
        goalDifference: entry.goalDifference,
        points: entry.points,
      }).run();
    }

    // Save fixtures
    for (const fixture of state.league.fixtures) {
      tx.insert(schema.fixtures).values({
        id: fixture.id,
        leagueId: state.league.id,
        homeClubId: fixture.homeClubId,
        awayClubId: fixture.awayClubId,
        week: fixture.week,
        date: fixture.date.getTime(),
        played: fixture.played ? 1 : 0,
        homeScore: fixture.played ? (fixture.homeScore ?? 0) : null,
        awayScore: fixture.played ? (fixture.awayScore ?? 0) : null,
      }).run();
    }

    // Save season
    tx.insert(schema.seasons).values({
      id: state.season.id,
      leagueId: state.season.leagueId,
      currentWeek: state.season.currentWeek,
      currentDate: state.season.currentDate.getTime(),
      transferWindowOpen: state.season.transferWindowOpen ? 1 : 0,
    }).run();

    // Save transfer history
    for (const transfer of state.transferHistory) {
      tx.insert(schema.transfers).values({
        id: transfer.id,
        playerId: transfer.playerId,
        fromClubId: transfer.fromClubId,
        toClubId: transfer.toClubId,
        fee: transfer.fee,
        type: 'transfer',
        date: transfer.date.getTime(),
        status: 'completed',
      }).run();
    }

    // Save transfer offers (pending and resolved, human- and AI-managed).
    // Only rewrite the table when the caller actually provided the
    // collection: an omitted value means "not provided" and must not wipe
    // previously persisted offers. Pass [] to clear them explicitly.
    const transferOffers: TransferOffer[] | undefined = state.transferOffers;
    if (transferOffers !== undefined) {
      tx.delete(schema.transferOffers).run();
      for (const offer of transferOffers) {
        tx.insert(schema.transferOffers).values({
          id: offer.id,
          playerId: offer.playerId,
          buyingClubId: offer.buyingClubId,
          sellingClubId: offer.sellingClubId,
          offerAmount: offer.offerAmount,
          status: offer.status,
          createdAt: offer.createdAt.getTime(),
          resolvedAt: offer.resolvedAt ? offer.resolvedAt.getTime() : null,
        }).run();
      }
    }

    // Save match history (scores, stats, seeds, participants, events).
    // Same contract as transferOffers: only rewrite when the caller
    // provided the collection. Before replacing, refuse the operation if
    // pre-v3 rows exist that the domain model cannot represent — they
    // must never be silently dropped.
    const matches: PersistedMatch[] | undefined = state.matches;
    if (matches !== undefined) {
      const existingMatchRows = tx
        .select()
        .from(schema.matches)
        .all() as MatchDbRow[];
      const incompleteCount = existingMatchRows.filter(
        (row) =>
          row.fixtureId === null ||
          row.fixtureId === undefined ||
          row.stats === null ||
          row.stats === undefined ||
          row.seed === null ||
          row.seed === undefined ||
          row.participantIds === null ||
          row.participantIds === undefined,
      ).length;
      if (incompleteCount > 0) {
        throw new Error(
          `Cannot replace match history: ${incompleteCount} existing match ` +
            'row(s) predate migration v3 and lack fixture_id/stats/seed/' +
            'participant_ids. They cannot be represented by the domain ' +
            'model and would be silently dropped. Resolve them manually ' +
            'before saving match records.',
        );
      }

      tx.delete(schema.matchEvents).run();
      tx.delete(schema.matches).run();
      for (const match of matches) {
        tx.insert(schema.matches).values(toMatchDbRow(match)).run();
        for (const eventRow of toMatchEventDbRows(match)) {
          tx.insert(schema.matchEvents).values(eventRow).run();
        }
      }
    }
  });
}

export async function loadCareer(dbInstance: any): Promise<CareerState | null> {
  try {
    // Load career metadata
    const careerRecords = await dbInstance.select().from(schema.career).where(eq(schema.career.id, 'active')).limit(1);
    const careerRecord = careerRecords[0];

    if (!careerRecord) {
      return null;
    }

    // Load clubs
    const clubRecords = await dbInstance.select().from(schema.clubs);
    const clubs: Club[] = clubRecords.map((record: any) => ({
      id: record.id,
      name: record.name,
      nickname: record.nickname,
      foundedYear: record.foundedYear,
      reputation: record.reputation,
      finances: {
        balance: record.balance,
        transferBudget: record.transferBudget,
        wageBudget: record.wageBudget,
        weeklyIncome: record.weeklyIncome,
      },
      squad: [], // Will be populated from players
      stadium: {
        name: record.stadiumName,
        capacity: record.stadiumCapacity,
      },
      tactics: {
        defaultFormation: record.defaultFormation as any,
        mentality: record.mentality as any,
        pressingIntensity: record.pressingIntensity,
        tempo: record.tempo,
        width: record.width,
      },
    }));

    // Load players
    const playerRecords = await dbInstance.select().from(schema.players);
    const players: Player[] = playerRecords.map((record: any) => ({
      id: record.id,
      firstName: record.firstName,
      lastName: record.lastName,
      nationality: record.nationality,
      age: record.age,
      preferredFoot: record.preferredFoot as any,
      primaryPosition: record.primaryPosition as any,
      secondaryPositions: JSON.parse(record.secondaryPositions),
      attributes: {
        technical: {
          passing: record.passing,
          shooting: record.shooting,
          dribbling: record.dribbling,
          tackling: record.tackling,
          heading: record.heading,
          crossing: record.crossing,
          finishing: record.finishing,
          technique: record.technique,
          longShots: record.longShots,
          freeKicks: record.freeKicks,
          firstTouch: record.firstTouch,
        },
        mental: {
          vision: record.vision,
          decisions: record.decisions,
          composure: record.composure,
          anticipation: record.anticipation,
          positioning: record.positioning,
          workRate: record.workRate,
          determination: record.determination,
          leadership: record.leadership,
          concentration: record.concentration,
          flair: record.flair,
        },
        physical: {
          pace: record.pace,
          acceleration: record.acceleration,
          stamina: record.stamina,
          strength: record.strength,
          agility: record.agility,
          balance: record.balance,
          jumping: record.jumping,
          naturalFitness: record.naturalFitness,
        },
      },
      development: {
        currentAbility: record.currentAbility,
        potentialAbility: record.potentialAbility,
        ageGrowthCurve: record.ageGrowthCurve as any,
      },
      status: {
        morale: record.morale,
        recentForm: JSON.parse(record.recentForm),
        fitness: record.fitness,
        injury: record.injuryType
          ? {
              type: record.injuryType as any,
              daysRemaining: record.injuryDaysRemaining || 0,
              severity: record.injurySeverity as any,
            }
          : null,
      },
      contract: {
        clubId: record.clubId,
        wage: record.wage,
        contractExpiryDate: new Date(record.contractExpiryDate),
        marketValue: record.marketValue,
      },
    }));

    // Populate club squads
    for (const player of players) {
      const club = clubs.find((c) => c.id === player.contract.clubId);
      if (club) {
        club.squad.push(player.id);
      }
    }

    // Load league
    const leagueRecords = await dbInstance.select().from(schema.leagues);
    const leagueRecord = leagueRecords[0];
    const league: League = {
      id: leagueRecord.id,
      name: leagueRecord.name,
      tier: leagueRecord.tier,
      clubIds: JSON.parse(leagueRecord.clubIds),
      standings: { entries: [] },
      fixtures: [],
    };

    // Load league standings
    const standingsRecords = await dbInstance.select().from(schema.leagueStandings);
    const standingsEntries: StandingEntry[] = standingsRecords.map((record: any) => ({
      clubId: record.clubId,
      played: record.played,
      won: record.won,
      drawn: record.drawn,
      lost: record.lost,
      goalsFor: record.goalsFor,
      goalsAgainst: record.goalsAgainst,
      goalDifference: record.goalDifference,
      points: record.points,
    }));
    league.standings.entries = standingsEntries;

    // Load fixtures
    const fixtureRecords = await dbInstance.select().from(schema.fixtures);
    const fixtures: Fixture[] = fixtureRecords.map((record: any) => ({
      id: record.id,
      leagueId: record.leagueId,
      homeClubId: record.homeClubId,
      awayClubId: record.awayClubId,
      week: record.week,
      date: new Date(record.date),
      played: record.played === 1,
      homeScore: record.homeScore !== null ? record.homeScore : undefined,
      awayScore: record.awayScore !== null ? record.awayScore : undefined,
    }));
    league.fixtures = fixtures;

    // Load season
    const seasonRecords = await dbInstance.select().from(schema.seasons);
    const seasonRecord = seasonRecords[0];
    const season: Season = {
      id: seasonRecord.id,
      leagueId: seasonRecord.leagueId,
      currentWeek: seasonRecord.currentWeek,
      currentDate: new Date(seasonRecord.currentDate),
      transferWindowOpen: seasonRecord.transferWindowOpen === 1,
      fixturesCalendar: [],
    };

    // Load transfer history
    const transferRecords = await dbInstance.select().from(schema.transfers);
    const transferHistory: TransferRecord[] = transferRecords.map((record: any) => ({
      id: record.id,
      playerId: record.playerId,
      fromClubId: record.fromClubId,
      toClubId: record.toClubId,
      fee: record.fee,
      date: new Date(record.date),
    }));

    // Load transfer offers
    const offerRecords = await dbInstance.select().from(schema.transferOffers);
    const transferOffers: TransferOffer[] = offerRecords.map((record: any) => ({
      id: record.id,
      playerId: record.playerId,
      buyingClubId: record.buyingClubId,
      sellingClubId: record.sellingClubId,
      offerAmount: record.offerAmount,
      status: record.status as TransferOfferStatus,
      createdAt: new Date(record.createdAt),
      resolvedAt:
        record.resolvedAt !== null && record.resolvedAt !== undefined
          ? new Date(record.resolvedAt)
          : undefined,
    }));

    // Load match history. Rows written before migration v3 (NULL
    // fixture_id/stats/seed/participant_ids) cannot be represented by
    // PersistedMatch and are filtered out — never backfilled. Matches are
    // ordered by date then id; events by minute, then event type, then
    // the NUMERIC occurrence suffix of their deterministic id — a plain
    // lexicographic id sort would order occurrences 0, 1, 10, 11, 2, ...
    // (per-type occurrence order is preserved; the engine's exact
    // cross-type intra-minute order is not persisted and is not restored).
    const matchRecords = (await dbInstance.select().from(schema.matches)) as MatchDbRow[];
    const eventRecords = (await dbInstance
      .select()
      .from(schema.matchEvents)) as MatchEventDbRow[];

    const eventsByMatchId = new Map<string, MatchEventDbRow[]>();
    const sortedEventRecords = [...eventRecords].sort(compareMatchEventRows);
    for (const eventRow of sortedEventRecords) {
      const list = eventsByMatchId.get(eventRow.matchId) ?? [];
      list.push(eventRow);
      eventsByMatchId.set(eventRow.matchId, list);
    }

    const matches: PersistedMatch[] = matchRecords
      .map((row) => matchFromDbRows(row, eventsByMatchId.get(row.id) ?? []))
      .filter((m): m is PersistedMatch => m !== null)
      .sort((a, b) => {
        const timeDiff = a.date.getTime() - b.date.getTime();
        if (timeDiff !== 0) return timeDiff;
        return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
      });

    return {
      career: {
        id: careerRecord.id,
        managerName: careerRecord.managerName,
        managedClubId: careerRecord.managedClubId,
        createdAt: new Date(careerRecord.createdAt),
        lastPlayedAt: new Date(careerRecord.lastPlayedAt),
        schemaVersion: careerRecord.schemaVersion,
      },
      clubs,
      players,
      league,
      season,
      transferHistory,
      transferOffers,
      matches,
    };
  } catch (error) {
    // Only a missing career row returns null (handled above). Any other
    // failure — SQL errors, malformed rows, schema incompatibility — is an
    // unexpected error and must propagate so callers can distinguish "no
    // career" from "database is broken". The original error is preserved
    // as `cause`.
    const message = error instanceof Error ? error.message : String(error);
    const wrapped = new Error(`Failed to load career: ${message}`);
    (wrapped as { cause?: unknown }).cause = error;
    throw wrapped;
  }
}

/**
 * Delete the active career and every career-owned record, atomically.
 *
 * All deletes run inside one synchronous Drizzle transaction: a failure at
 * any point rolls back the entire deletion. `schema_migrations` is database
 * infrastructure, not career data, and is intentionally preserved.
 */
export async function deleteCareer(dbInstance: any): Promise<void> {
  dbInstance.transaction((tx: any) => {
    tx.delete(schema.transferOffers).run();
    tx.delete(schema.matchEvents).run();
    tx.delete(schema.matches).run();
    tx.delete(schema.fixtures).run();
    tx.delete(schema.leagueStandings).run();
    tx.delete(schema.transfers).run();
    tx.delete(schema.seasons).run();
    tx.delete(schema.leagues).run();
    tx.delete(schema.players).run();
    tx.delete(schema.clubs).run();
    tx.delete(schema.career).run();
  });
}
