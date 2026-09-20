import {
  Club,
  Fixture,
  League,
  MatchResult,
  Player,
  PlayerMap,
  Season,
} from '@club-director/shared-types';
import { simulateMatch } from '../match/simulation';
import { computeStandings } from './standings';
import { processAITransferActivity } from '../transfer/market';

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
  transferOffers: any[];
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
): MatchweekAdvancement {
  const currentWeek = season.currentWeek;
  const weekFixtures = league.fixtures.filter((f) => f.week === currentWeek && !f.played);

  if (weekFixtures.length === 0) {
    // No fixtures to play this week, just advance the date
    const updatedSeason = advanceSeasonDate(season);
    return {
      results: [],
      updatedLeague: league,
      updatedSeason,
      updatedPlayers: applyNonPlayingEffects(players),
      updatedClubs: clubs,
      transferOffers: [],
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

    if (!homeClub || !awayClub) {
      return;
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

    // Simulate match
    const result = simulateMatch(
      homeClub,
      awayClub,
      homePlayerMap,
      awayPlayerMap,
      Date.now(),
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

  // Apply post-match effects to players
  const updatedPlayers = applyPostMatchEffects(players, results, clubs);

  // Process AI transfer activity
  const transferOffers = processAITransferActivity(
    clubs,
    updatedPlayers,
    [],
    season.transferWindowOpen,
  );

  // Advance season
  const updatedSeason = advanceSeasonDate(season);

  return {
    results,
    updatedLeague,
    updatedSeason,
    updatedPlayers,
    updatedClubs: clubs,
    transferOffers,
  };
}

/**
 * Apply post-match effects to players who participated in matches.
 */
function applyPostMatchEffects(
  players: Player[],
  results: MatchweekResult[],
  clubs: Club[],
): Player[] {
  const updatedPlayers = new Map<string, Player>();

  // Initialize with all players
  players.forEach((p) => {
    updatedPlayers.set(p.id, { ...p });
  });

  // Process each match result
  results.forEach((matchResult) => {
    const homeClub = clubs.find((c) => c.id === matchResult.homeClubId);
    const awayClub = clubs.find((c) => c.id === matchResult.awayClubId);

    if (!homeClub || !awayClub) return;

    const homePlayers = homeClub.squad;
    const awayPlayers = awayClub.squad;
    const allParticipants = [...homePlayers, ...awayPlayers];

    allParticipants.forEach((playerId) => {
      const player = updatedPlayers.get(playerId);
      if (!player) return;

      // Reduce fitness based on playing
      const fitnessReduction = 5 + Math.random() * 10; // 5-15% reduction
      player.status.fitness = Math.max(0, Math.min(100, player.status.fitness - fitnessReduction));

      // Check for injuries from match events
      const injuryEvent = matchResult.result.events.find(
        (e) => e.type === 'injury' && e.primaryPlayerId === playerId,
      );

      if (injuryEvent) {
        const injuryDays = Math.floor(7 + Math.random() * 21); // 7-28 days
        player.status.injury = {
          type: 'Match injury',
          daysRemaining: injuryDays,
          severity: injuryDays > 21 ? 'serious' : injuryDays > 14 ? 'moderate' : 'minor',
        };
        player.status.fitness = Math.max(0, Math.min(100, player.status.fitness - 20));
      }

      // Update recent form (implied match rating)
      const matchRating = calculateMatchRating(player, matchResult.result);
      player.status.recentForm = [
        matchRating,
        ...player.status.recentForm.slice(0, 4),
      ];

      updatedPlayers.set(playerId, player);
    });
  });

  // Apply recovery to non-playing players
  Array.from(updatedPlayers.values()).forEach((player) => {
    const playedInMatches = results.some((r) => {
      const homeClub = clubs.find((c) => c.id === r.homeClubId);
      const awayClub = clubs.find((c) => c.id === r.awayClubId);
      if (!homeClub || !awayClub) return false;
      return [...homeClub.squad, ...awayClub.squad].includes(player.id);
    });

    if (!playedInMatches) {
      // Fitness recovery for non-playing players
      player.status.fitness = Math.max(0, Math.min(100, player.status.fitness + 10));

      // Injury recovery
      if (player.status.injury) {
        player.status.injury.daysRemaining--;
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
    const updatedPlayer = { ...player };

    // Fitness recovery
    updatedPlayer.status.fitness = Math.min(100, updatedPlayer.status.fitness + 10);

    // Injury recovery
    if (updatedPlayer.status.injury) {
      updatedPlayer.status.injury.daysRemaining--;
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
function calculateMatchRating(player: Player, result: MatchResult): number {
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

  // Random variation
  const variation = (Math.random() - 0.5) * 2;

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
