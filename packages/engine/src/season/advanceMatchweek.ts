import {
  Club,
  Fixture,
  League,
  MatchResult,
  Player,
  PlayerMap,
  Season,
  TransferOffer,
  TransferRecord,
} from '@club-director/shared-types';
import { simulateMatch, SeededRNG } from '../match/simulation';
import { computeStandings } from './standings';
import { isSeasonComplete } from './completion';
import { processAITransferActivity } from '../transfer/market';
import { applyWeeklyEconomy } from '../economy/weeklyEconomy';
import { applyWeeklyDevelopment } from '../players/development';
import {
  applyWeeklyMorale,
  buildMatchClubByPlayerId,
  collectClubsWithNewUnpaidWages,
  detectInjuryTransitions,
} from '../players/morale';
import { processContractExpiry } from './contracts';

export interface MatchweekResult {
  fixtureId: string;
  homeClubId: string;
  awayClubId: string;
  homeScore: number;
  awayScore: number;
  result: MatchResult;
}

export interface MatchweekAdvancement {
  results: MatchweekResult[];
  updatedLeague: League;
  updatedSeason: Season;
  updatedPlayers: Player[];
  updatedClubs: Club[];
  transferOffers: TransferOffer[];
  transferRecords: TransferRecord[];
  /**
   * `true` when the advancement was refused because the season is
   * already complete: no matchweek was simulated, `currentWeek` and
   * `currentDate` are unchanged, no effects or transfers were
   * generated, and every `updated*` field aliases its input unchanged.
   * `false` on every normal advancement.
   */
  seasonComplete: boolean;
}

export interface AdvanceMatchweekOptions {
  /** Club that must not participate as an AI buyer (the managed club). */
  managedClubId?: string;
}

/**
 * Deterministic 32-bit hash (FNV-1a) mapping a stable string key to a
 * non-negative seed for SeededRNG. Match seeds derive from league +
 * fixture identity so identical career states always replay identically,
 * while different fixtures get independent streams.
 */
function hashSeed(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/**
 * Advance the season by one matchweek.
 * Simulates all fixtures for the current matchweek, updates standings,
 * applies player effects, and advances the week counter.
 */
export function advanceMatchweek(
  season: Season,
  league: League,
  clubs: Club[],
  players: Player[],
  options?: AdvanceMatchweekOptions,
): MatchweekAdvancement {
  // A completed season must never advance: refuse before touching
  // anything and return the inputs unchanged so callers can detect the
  // refusal via `seasonComplete` without risking partial state.
  if (isSeasonComplete(league, season)) {
    return {
      results: [],
      updatedLeague: league,
      updatedSeason: season,
      updatedPlayers: players,
      updatedClubs: clubs,
      transferOffers: [],
      transferRecords: [],
      seasonComplete: true,
    };
  }

  const currentWeek = season.currentWeek;
  const weekFixtures = league.fixtures.filter((f) => f.week === currentWeek && !f.played);

  if (weekFixtures.length === 0) {
    // No fixtures to play this week, but the matchweek still advances:
    // every club receives its income and pays its wage bill (unpaid
    // wages accumulate as debt), the date moves forward, and players
    // still undergo a week of development at the reduced reserve
    // factor (nobody participated in a match).
    const postEffects = applyNonPlayingEffects(players);
    const developedPlayers = applyWeeklyDevelopment(
      postEffects,
      new Set<string>(),
      season.id,
      currentWeek,
    );
    // Contract expiry runs before the economy so an expired player is
    // already out of every squad and generates no wage this week — the
    // same rule as the match path. Reference date: season.currentDate.
    const contractExpiry = processContractExpiry(
      developedPlayers,
      clubs,
      season.currentDate,
    );
    const economyClubs = applyWeeklyEconomy(contractExpiry.clubs, contractExpiry.players);
    // Morale runs once per week on the final state: no matches were
    // played, but injuries may have healed and new unpaid wages still
    // apply. The unpaid-wage baseline is the post-expiry clubs (no
    // transfer processing happens on bye weeks; expiry does not touch
    // finances, so debt values are identical to the input clubs).
    const moralePlayers = applyWeeklyMorale(contractExpiry.players, {
      matchClubByPlayerId: buildMatchClubByPlayerId(clubs),
      matches: [],
      injuries: detectInjuryTransitions(players, postEffects),
      clubsWithUnpaidWages: collectClubsWithNewUnpaidWages(
        contractExpiry.clubs,
        economyClubs,
      ),
    });
    const updatedSeason = advanceSeasonDate(season);
    return {
      results: [],
      updatedLeague: league,
      updatedSeason,
      updatedPlayers: moralePlayers,
      updatedClubs: economyClubs,
      transferOffers: [],
      transferRecords: [],
      seasonComplete: false,
    };
  }

  // Create player map for match simulation
  const playerMap: PlayerMap = {};
  players.forEach((p) => {
    playerMap[p.id] = p;
  });

  // Simulate all fixtures
  const results: MatchweekResult[] = [];
  const updatedFixtures = [...league.fixtures];

  weekFixtures.forEach((fixture) => {
    const homeClub = clubs.find((c) => c.id === fixture.homeClubId);
    const awayClub = clubs.find((c) => c.id === fixture.awayClubId);

    // A fixture referencing a missing club must fail loudly: silently
    // skipping it would orphan the fixture (its week is never revisited)
    // and corrupt the standings without any visible error.
    if (!homeClub) {
      throw new Error(
        `Cannot simulate fixture ${fixture.id}: missing home club ${fixture.homeClubId}`,
      );
    }
    if (!awayClub) {
      throw new Error(
        `Cannot simulate fixture ${fixture.id}: missing away club ${fixture.awayClubId}`,
      );
    }

    const homePlayerMap: PlayerMap = {};
    const awayPlayerMap: PlayerMap = {};

    homeClub.squad.forEach((playerId) => {
      if (playerMap[playerId]) {
        homePlayerMap[playerId] = playerMap[playerId];
      }
    });

    awayClub.squad.forEach((playerId) => {
      if (playerMap[playerId]) {
        awayPlayerMap[playerId] = playerMap[playerId];
      }
    });

    // Simulate match — the seed derives from stable fixture identity, so
    // the same career state always replays the same match.
    const matchSeed = hashSeed(`${season.id}|${league.id}|${fixture.id}`);
    const result = simulateMatch(
      homeClub,
      awayClub,
      homePlayerMap,
      awayPlayerMap,
      matchSeed,
    );

    // Record result
    results.push({
      fixtureId: fixture.id,
      homeClubId: fixture.homeClubId,
      awayClubId: fixture.awayClubId,
      homeScore: result.homeScore,
      awayScore: result.awayScore,
      result,
    });

    // Update fixture with result
    const fixtureIndex = updatedFixtures.findIndex((f) => f.id === fixture.id);
    if (fixtureIndex !== -1) {
      updatedFixtures[fixtureIndex] = {
        ...fixture,
        played: true,
        homeScore: result.homeScore,
        awayScore: result.awayScore,
      };
    }
  });

  // Update league with new fixtures and standings
  const updatedLeague: League = {
    ...league,
    fixtures: updatedFixtures,
    standings: computeStandings({
      ...league,
      fixtures: updatedFixtures,
    }),
  };

  // Deterministic randomness for everything downstream of the matches:
  // post-match effects and AI transfer decisions each get their own
  // seeded stream derived from stable season/week identity. `transferNow`
  // pins offer/record/contract timestamps to the season date so identical
  // inputs produce deeply equal outputs.
  const effectsRng = new SeededRNG(hashSeed(`${season.id}|${currentWeek}|effects`));
  const transferRng = new SeededRNG(hashSeed(`${season.id}|${currentWeek}|transfers`));
  const transferNow = new Date(season.currentDate);

  // Apply post-match effects to players — scoped to actual participants.
  const postMatchPlayers = applyPostMatchEffects(players, results, effectsRng);

  // Morale context captured BEFORE transfer processing: the
  // player→club snapshot reflects match-time squads, so a player who
  // played for club A and is transferred to club B this same week still
  // receives A's result. Injury transitions are detected between the
  // input players and the post-match state.
  const matchClubByPlayerId = buildMatchClubByPlayerId(clubs);
  const injuryEvents = detectInjuryTransitions(players, postMatchPlayers);

  // Weekly development runs after post-match effects (it sees the final
  // fitness/injury state) and before AI transfers/economy so downstream
  // systems observe developed players. Participation is the union of
  // every simulated match's participantIds — a Set, so a player can
  // never be counted twice.
  const participantIds = new Set<string>();
  results.forEach((matchResult) => {
    matchResult.result.participantIds.forEach((id) => participantIds.add(id));
  });
  const updatedPlayers = applyWeeklyDevelopment(
    postMatchPlayers,
    participantIds,
    season.id,
    currentWeek,
  );

  // Contract expiry runs after development and before AI transfers and
  // the economy: an expiring player is already a free agent (clubId
  // null, removed from every squad), so AI transfers cannot sell them
  // this week and the wage bill excludes them — reference date is
  // season.currentDate, the same date transfers and valuations use.
  const contractExpiry = processContractExpiry(
    updatedPlayers,
    clubs,
    season.currentDate,
  );

  // Process AI transfer activity on a copy of the clubs array (the engine
  // mutates it in place for accepted transfers), so callers' arrays are not
  // modified outside of the returned state.
  const transferClubs = [...contractExpiry.clubs];
  const transferRecords: TransferRecord[] = [];
  const transferOffers = processAITransferActivity(
    transferClubs,
    contractExpiry.players,
    [],
    season.transferWindowOpen,
    options?.managedClubId ? [options.managedClubId] : [],
    transferRecords,
    { rng: transferRng, now: transferNow },
  );

  // Weekly economy runs after AI transfer activity so payroll reflects
  // the post-transfer squads, and before the date advance. Every club —
  // managed and AI — receives its fixed income and pays its wage bill;
  // unpaid wages accumulate as debt. No RNG is consumed.
  const economyClubs = applyWeeklyEconomy(transferClubs, contractExpiry.players);

  // Morale runs once, after transfers and economy, so it sees the final
  // weekly events: match results (via the pre-transfer snapshot), injury
  // transitions, and NEW unpaid wages only (debt delta across the
  // economy — historical debt never retriggers the penalty).
  const moralePlayers = applyWeeklyMorale(contractExpiry.players, {
    matchClubByPlayerId,
    matches: results.map((matchResult) => ({
      homeClubId: matchResult.homeClubId,
      awayClubId: matchResult.awayClubId,
      homeScore: matchResult.result.homeScore,
      awayScore: matchResult.result.awayScore,
      participantIds: matchResult.result.participantIds,
    })),
    injuries: injuryEvents,
    clubsWithUnpaidWages: collectClubsWithNewUnpaidWages(
      transferClubs,
      economyClubs,
    ),
  });

  // Advance season
  const updatedSeason = advanceSeasonDate(season);

  return {
    results,
    updatedLeague,
    updatedSeason,
    updatedPlayers: moralePlayers,
    updatedClubs: economyClubs,
    transferOffers,
    transferRecords,
    seasonComplete: false,
  };
}

/**
 * Apply post-match effects to players who actually participated in matches.
 * Participation comes from each MatchResult's explicit participantIds (the
 * starting XIs chosen by simulateMatch) — squad members who did not play
 * receive no fatigue, no match rating, and no match-derived form entry;
 * they only get the standard non-participant recovery below.
 */
function applyPostMatchEffects(
  players: Player[],
  results: MatchweekResult[],
  rng: SeededRNG,
): Player[] {
  const updatedPlayers = new Map<string, Player>();

  // Initialize with all players (deep-copy status so post-match effects
  // never mutate the caller's player objects)
  players.forEach((p) => {
    updatedPlayers.set(p.id, {
      ...p,
      status: {
        ...p.status,
        recentForm: [...p.status.recentForm],
        injury: p.status.injury ? { ...p.status.injury } : null,
      },
    });
  });

  // Every player who took part in any simulated match this week.
  const allParticipantIds = new Set<string>();
  results.forEach((matchResult) => {
    matchResult.result.participantIds.forEach((id) => allParticipantIds.add(id));
  });

  // Process each match result — effects apply only to that match's
  // participants, never to the rest of the squad.
  results.forEach((matchResult) => {
    const participantIds = new Set(matchResult.result.participantIds);

    participantIds.forEach((playerId) => {
      const player = updatedPlayers.get(playerId);
      if (!player) return;

      // Reduce fitness based on playing
      const fitnessReduction = 5 + rng.next() * 10; // 5-15% reduction
      player.status.fitness = Math.max(0, Math.min(100, player.status.fitness - fitnessReduction));

      // Check for injuries from match events
      const injuryEvent = matchResult.result.events.find(
        (e) => e.type === 'injury' && e.primaryPlayerId === playerId,
      );

      if (injuryEvent) {
        const injuryDays = Math.floor(7 + rng.next() * 21); // 7-28 days
        player.status.injury = {
          type: 'Match injury',
          daysRemaining: injuryDays,
          severity: injuryDays > 21 ? 'serious' : injuryDays > 14 ? 'moderate' : 'minor',
        };
        player.status.fitness = Math.max(0, Math.min(100, player.status.fitness - 20));
      } else if (player.status.injury && player.status.injury.daysRemaining <= 0) {
        // A participant cannot carry an active injury into selection, so
        // any injury object left here is stale (already healed) — clear it.
        // A NEW injury set above is never decremented during the week it
        // was inflicted.
        player.status.injury = null;
      }

      // Update recent form (implied match rating)
      const matchRating = calculateMatchRating(player, matchResult.result, rng);
      player.status.recentForm = [
        matchRating,
        ...player.status.recentForm.slice(0, 4),
      ];

      updatedPlayers.set(playerId, player);
    });
  });

  // Apply recovery to non-participants (players who did not play any match
  // this week, including all reserves).
  Array.from(updatedPlayers.values()).forEach((player) => {
    if (!allParticipantIds.has(player.id)) {
      // Fitness recovery for non-playing players
      player.status.fitness = Math.max(0, Math.min(100, player.status.fitness + 10));

      // Injury recovery: one simulated week = 7 days. The counter is
      // clamped at zero and the injury object is removed once healed.
      if (player.status.injury) {
        player.status.injury.daysRemaining = Math.max(
          0,
          player.status.injury.daysRemaining - 7,
        );
        if (player.status.injury.daysRemaining <= 0) {
          player.status.injury = null;
        }
      }
    }
  });

  return Array.from(updatedPlayers.values());
}

/**
 * Apply effects to players who didn't play this week.
 */
function applyNonPlayingEffects(players: Player[]): Player[] {
  return players.map((player) => {
    const updatedPlayer: Player = {
      ...player,
      status: {
        ...player.status,
        recentForm: [...player.status.recentForm],
        injury: player.status.injury ? { ...player.status.injury } : null,
      },
    };

    // Fitness recovery
    updatedPlayer.status.fitness = Math.min(100, updatedPlayer.status.fitness + 10);

    // Injury recovery: one simulated week = 7 days, clamped at zero.
    if (updatedPlayer.status.injury) {
      updatedPlayer.status.injury.daysRemaining = Math.max(
        0,
        updatedPlayer.status.injury.daysRemaining - 7,
      );
      if (updatedPlayer.status.injury.daysRemaining <= 0) {
        updatedPlayer.status.injury = null;
      }
    }

    return updatedPlayer;
  });
}

/**
 * Calculate an implied match rating for a player based on their role in the match.
 */
function calculateMatchRating(player: Player, result: MatchResult, rng: SeededRNG): number {
  // Count goals and assists for this player
  const goals = result.events.filter(
    (e) => e.type === 'goal' && e.primaryPlayerId === player.id,
  ).length;

  const assists = result.events.filter(
    (e) => e.type === 'goal' && e.secondaryPlayerId === player.id,
  ).length;

  // Base rating from player ability
  const baseRating = player.development.currentAbility / 20; // Normalize to 1-10

  // Adjust for match performance
  const performanceBonus = goals * 1.5 + assists * 1.0;

  // Random variation (seeded — deterministic per matchweek)
  const variation = (rng.next() - 0.5) * 2;

  const finalRating = Math.max(1, Math.min(10, baseRating + performanceBonus + variation));

  return Math.round(finalRating * 10) / 10; // Round to 1 decimal
}

/**
 * Advance the season date and week counter.
 */
function advanceSeasonDate(season: Season): Season {
  const newDate = new Date(season.currentDate);
  newDate.setDate(newDate.getDate() + 7); // Advance by 1 week

  return {
    ...season,
    currentWeek: season.currentWeek + 1,
    currentDate: newDate,
  };
}
