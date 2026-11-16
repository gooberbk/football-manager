import type { Club, InjurySeverity, Player } from '@club-director/shared-types';

/**
 * Weekly morale engine (Phase 3A-E-B).
 *
 * Pure and deterministic: no RNG, no clock, no I/O, no mutation of the
 * inputs. Every player drifts toward NEUTRAL_MORALE each week while
 * bounded event deltas (match results, injuries, unpaid wages) push
 * morale up or down. The match engine already reads `status.morale`
 * as a squad average (simulation.ts: averageMorale / 75), so 75 is the
 * neutral point by construction.
 *
 * Scope: morale evolution only. Transfers, selection and individual
 * performance effects are handled by later phases.
 */

export const NEUTRAL_MORALE = 75;
export const MORALE_MIN = 0;
export const MORALE_MAX = 100;

/**
 * Tunable parameters for the weekly morale model. Event deltas are
 * summed per player, clamped to ±eventDeltaClamp, then combined with
 * the mean-reversion pull toward NEUTRAL_MORALE. The reversion is NOT
 * part of the eventDelta clamp.
 */
export interface WeeklyMoraleParams {
  /** Morale delta for a win of the player's club. */
  winDelta: number;
  /** Morale delta for a draw of the player's club. */
  drawDelta: number;
  /** Morale delta for a loss of the player's club. */
  lossDelta: number;
  /** Morale delta per newly contracted injury, keyed by severity. */
  injuryDeltas: Record<InjurySeverity, number>;
  /** Morale delta when an injury actually heals this week. */
  healedDelta: number;
  /**
   * Morale delta applied once per week to every player of a club that
   * recorded strictly positive NEW unpaid wages this week. Historical
   * debt alone never triggers it.
   */
  unpaidWagesDelta: number;
  /** Symmetric clamp applied to the summed event deltas only. */
  eventDeltaClamp: number;
  /** Weekly pull toward NEUTRAL_MORALE: reversion = rate * (75 - morale). */
  reversionRate: number;
}

export const DEFAULT_WEEKLY_MORALE_PARAMS: WeeklyMoraleParams = {
  winDelta: 4,
  drawDelta: 0,
  lossDelta: -4,
  injuryDeltas: { minor: -6, moderate: -8, serious: -10, severe: -10 },
  healedDelta: 4,
  unpaidWagesDelta: -2,
  eventDeltaClamp: 12,
  reversionRate: 0.15,
};

/**
 * One played fixture as seen by the morale engine. `participantIds`
 * mixes both starting XIs — the player's side is resolved through
 * `matchClubByPlayerId`, never assumed.
 */
export interface WeeklyMoraleMatch {
  homeClubId: string;
  awayClubId: string;
  homeScore: number;
  awayScore: number;
  participantIds: readonly string[];
}

/** A detected injury lifecycle transition for one player. */
export interface WeeklyMoraleInjuryEvent {
  playerId: string;
  kind: 'contracted' | 'healed';
  /** Present when kind === 'contracted'; absent/ignored for 'healed'. */
  severity?: InjurySeverity;
}

/**
 * Explicit, strictly typed input for `applyWeeklyMorale`. Everything
 * the engine needs is resolved by the caller — the function itself
 * performs no inference from final club/player states.
 */
export interface WeeklyMoraleContext {
  /**
   * Squad membership AT MATCH TIME: playerId → clubId, snapshotted
   * from club squads BEFORE transfer processing. This is what lets a
   * player who played for club A and was transferred to club B in the
   * same week receive A's result. Players absent from the map get no
   * match-result delta.
   */
  matchClubByPlayerId: ReadonlyMap<string, string>;
  /** Matches played this week (empty on bye weeks). */
  matches: readonly WeeklyMoraleMatch[];
  /** Injury transitions detected between pre- and post-match states. */
  injuries: readonly WeeklyMoraleInjuryEvent[];
  /**
   * Ids of clubs whose NEW unpaid wages this week are strictly
   * positive (debt delta across applyWeeklyEconomy — never cumulative
   * debt). A player's club is read from `contract.clubId`, which is
   * the post-transfer club actually charged by the economy.
   */
  clubsWithUnpaidWages: ReadonlySet<string>;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * Build the match-time playerId → clubId map from club squads. Must be
 * called BEFORE transfer processing mutates squads; club objects in the
 * input array are never mutated by the transfer step (it replaces
 * entries in a copied array), so squads read here are the match-time
 * ones.
 */
export function buildMatchClubByPlayerId(
  clubs: readonly Club[],
): Map<string, string> {
  const map = new Map<string, string>();
  for (const club of clubs) {
    for (const playerId of club.squad) {
      map.set(playerId, club.id);
    }
  }
  return map;
}

/**
 * Detect injury lifecycle transitions between two player collections
 * describing the same players before and after post-match (or
 * non-playing) effects:
 *   null → object : newly contracted injury (severity preserved)
 *   object → null : healed
 *   object → object : pre-existing, no morale event
 * Players are matched by id; order and missing entries are tolerated.
 */
export function detectInjuryTransitions(
  before: readonly Player[],
  after: readonly Player[],
): WeeklyMoraleInjuryEvent[] {
  const beforeById = new Map(before.map((p) => [p.id, p]));
  const events: WeeklyMoraleInjuryEvent[] = [];

  for (const player of after) {
    const previous = beforeById.get(player.id);
    if (!previous) continue;
    const hadInjury = previous.status.injury !== null;
    const hasInjury = player.status.injury !== null;

    if (!hadInjury && hasInjury) {
      events.push({
        playerId: player.id,
        kind: 'contracted',
        severity: player.status.injury!.severity,
      });
    } else if (hadInjury && !hasInjury) {
      events.push({ playerId: player.id, kind: 'healed' });
    }
  }
  return events;
}

/**
 * Clubs whose debt grew across applyWeeklyEconomy — i.e. clubs with
 * strictly positive NEW unpaid wages this week. Clubs are matched by
 * id, never by array position. Historical debt is irrelevant: only the
 * delta counts. A club missing on either side is skipped.
 */
export function collectClubsWithNewUnpaidWages(
  clubsBefore: readonly Club[],
  clubsAfter: readonly Club[],
): Set<string> {
  const beforeById = new Map(clubsBefore.map((c) => [c.id, c]));
  const unpaid = new Set<string>();
  for (const after of clubsAfter) {
    const before = beforeById.get(after.id);
    if (!before) continue;
    if (after.finances.debt - before.finances.debt > 0) {
      unpaid.add(after.id);
    }
  }
  return unpaid;
}

/**
 * Apply one week of morale evolution to every player.
 *
 * Per player:
 *   clampedMorale = clamp(status.morale, 0, 100)   (non-finite → 75)
 *   eventDelta    = clamp(sum of applicable deltas, -eventDeltaClamp, +eventDeltaClamp)
 *   reversion     = reversionRate * (75 - clampedMorale)
 *   morale'       = clamp(clampedMorale + eventDelta + reversion, 0, 100)
 *
 * Match-result deltas apply only to participants whose match-time club
 * (from `matchClubByPlayerId`) is unambiguously the home or away side
 * of a played fixture. Non-participants receive no result delta.
 * Unpaid-wage deltas apply once per player whose CURRENT club
 * (`contract.clubId`, post-transfer) is in `clubsWithUnpaidWages`.
 *
 * Returns a new array; players whose morale is unchanged keep their
 * original object reference. Inputs are never mutated.
 */
export function applyWeeklyMorale(
  players: readonly Player[],
  context: WeeklyMoraleContext,
  params: WeeklyMoraleParams = DEFAULT_WEEKLY_MORALE_PARAMS,
): Player[] {
  // Sum raw event deltas per player id.
  const eventDeltaByPlayer = new Map<string, number>();
  const addDelta = (playerId: string, delta: number) => {
    if (delta === 0) return;
    eventDeltaByPlayer.set(
      playerId,
      (eventDeltaByPlayer.get(playerId) ?? 0) + delta,
    );
  };

  // Match results — resolved through the match-time club snapshot.
  for (const match of context.matches) {
    for (const playerId of match.participantIds) {
      const clubId = context.matchClubByPlayerId.get(playerId);
      let delta: number;
      if (clubId === match.homeClubId) {
        delta =
          match.homeScore > match.awayScore
            ? params.winDelta
            : match.homeScore < match.awayScore
              ? params.lossDelta
              : params.drawDelta;
      } else if (clubId === match.awayClubId) {
        delta =
          match.awayScore > match.homeScore
            ? params.winDelta
            : match.awayScore < match.homeScore
              ? params.lossDelta
              : params.drawDelta;
      } else {
        // Not attributable to either side — never guess.
        continue;
      }
      addDelta(playerId, delta);
    }
  }

  // Injury transitions.
  for (const event of context.injuries) {
    if (event.kind === 'contracted') {
      const severity = event.severity ?? 'moderate';
      addDelta(
        event.playerId,
        params.injuryDeltas[severity] ?? params.injuryDeltas.moderate,
      );
    } else {
      addDelta(event.playerId, params.healedDelta);
    }
  }

  // New unpaid wages — once per player of each flagged club. The
  // player's club is contract.clubId: post-transfer, which is the club
  // the economy actually charged.
  if (context.clubsWithUnpaidWages.size > 0) {
    for (const player of players) {
      // Free agents (clubId null) belong to no club and can never be
      // charged unpaid wages — they are skipped, not penalized.
      if (
        player.contract.clubId !== null &&
        context.clubsWithUnpaidWages.has(player.contract.clubId)
      ) {
        addDelta(player.id, params.unpaidWagesDelta);
      }
    }
  }

  return players.map((player) => {
    const raw = player.status.morale;
    const base = Number.isFinite(raw)
      ? clamp(raw, MORALE_MIN, MORALE_MAX)
      : NEUTRAL_MORALE;

    const rawDelta = eventDeltaByPlayer.get(player.id) ?? 0;
    const eventDelta = clamp(rawDelta, -params.eventDeltaClamp, params.eventDeltaClamp);
    const reversion = params.reversionRate * (NEUTRAL_MORALE - base);
    const next = clamp(base + eventDelta + reversion, MORALE_MIN, MORALE_MAX);

    if (next === player.status.morale) return player;

    return {
      ...player,
      status: { ...player.status, morale: next },
    };
  });
}
