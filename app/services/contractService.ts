import {
  proposeContractRenewal,
  renewalWageDemand,
  type ContractRenewalFailureReason,
} from '@club-director/engine';
import type { Player } from '@club-director/shared-types';
import { useGameState } from '../store/useGameState';

/**
 * Contract renewal service (Phase 3C-C-int).
 *
 * Store-coupled like simulateMatchweek/seasonRollover: reads the live
 * state once (single coherent snapshot — validation and renewal never
 * work on stale copies), delegates every business rule to the engine's
 * proposeContractRenewal (membership, expiry, 12-month window,
 * duration, wage floor), publishes only the renewed player through
 * setPlayers, then triggers the store's own saveState() — the same
 * autosave mechanism every other mutation uses, not a parallel
 * persistence path.
 *
 * Clock: the reference date is always `season.currentDate`. Date.now()
 * is never used.
 */

/**
 * Sanity ceiling for a proposed weekly wage — input hygiene, NOT a
 * negotiation rule. Seed wages span 5,000–100,000 and the ability
 * floor tops out near 200,000, so 1,000,000/week is ~10x the highest
 * legitimate wage in the game while still rejecting absurd entries.
 */
export const MAX_CONTRACT_RENEWAL_WAGE = 1_000_000;

export type ContractRenewalRejection =
  // Application-level input/state failures.
  | 'invalid_player_id'
  | 'invalid_wage'
  | 'invalid_duration'
  | 'player_not_found'
  | 'managed_club_not_found'
  | 'season_unavailable'
  | 'contract_data_invalid'
  // Engine business refusals, passed through unchanged.
  | ContractRenewalFailureReason;

export type RenewContractResult =
  | { status: 'renewed'; player: Player; wageDemand: number }
  | {
      status: 'rejected';
      reason: ContractRenewalRejection;
      wageDemand: number | null;
    };

function rejected(
  reason: ContractRenewalRejection,
  wageDemand: number | null = null,
): RenewContractResult {
  return { status: 'rejected', reason, wageDemand };
}

/** Demand when computable; null on corrupt contract data (never throws). */
function tryWageDemand(player: Player, now: Date): number | null {
  try {
    return renewalWageDemand(player, now);
  } catch {
    return null;
  }
}

/**
 * Attempt to renew the managed-club contract of `playerId`.
 *
 * On success the renewed player replaces only its own entry in
 * `players` (every other reference is preserved), no club data is
 * touched (a renewal never modifies wageBudget or squads), and
 * saveState() persists the new state through the standard path.
 *
 * Guarantees on failure: the store is left strictly untouched — no
 * setter runs before every validation and the engine call have
 * succeeded.
 *
 * Save semantics: `status: 'renewed'` means the renewal was applied
 * to the store AND the autosave was attempted. saveState() catches
 * and logs persistence errors internally (it never rejects), so a
 * 'renewed' result does NOT prove the write reached SQLite — it
 * carries exactly the same durability guarantee as every other
 * store mutation in the app.
 */
export async function renewContract(
  playerId: string,
  wage: number,
  years: number,
): Promise<RenewContractResult> {
  // --- Application-level input validation -------------------------
  if (typeof playerId !== 'string' || playerId.trim() === '') {
    return rejected('invalid_player_id');
  }
  if (
    typeof wage !== 'number' ||
    !Number.isInteger(wage) ||
    !Number.isFinite(wage) ||
    wage <= 0 ||
    wage > MAX_CONTRACT_RENEWAL_WAGE
  ) {
    return rejected('invalid_wage');
  }
  if (!Number.isInteger(years) || (years !== 1 && years !== 2 && years !== 3)) {
    return rejected('invalid_duration');
  }

  // --- Single coherent snapshot of the live state -----------------
  const state = useGameState.getState();
  const player = state.players.find((p) => p.id === playerId);
  if (!player) {
    return rejected('player_not_found');
  }

  const club = state.managedClubId
    ? state.clubs.find((c) => c.id === state.managedClubId)
    : undefined;
  if (!club) {
    return rejected('managed_club_not_found');
  }

  const now = state.season?.currentDate;
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) {
    return rejected('season_unavailable');
  }

  // --- Engine is the single source of business rules ---------------
  let engineResult;
  try {
    engineResult = proposeContractRenewal(player, club, { wage, years, now });
  } catch {
    // Corrupt contract data (non-finite wage/ability) surfaces as a
    // typed rejection instead of crashing the caller.
    return rejected('contract_data_invalid', tryWageDemand(player, now));
  }

  if (!engineResult.success) {
    return rejected(
      engineResult.reason,
      engineResult.wageDemand ?? tryWageDemand(player, now),
    );
  }

  // --- Publish: replace only the renewed player --------------------
  const players = state.players.map((p) =>
    p.id === player.id ? engineResult.player : p,
  );
  state.setPlayers(players);

  // Standard autosave path — same mechanism the screens' effects use.
  await state.saveState();

  return {
    status: 'renewed',
    player: engineResult.player,
    wageDemand: engineResult.wageDemand,
  };
}
