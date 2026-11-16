import { renewalWageDemand } from '@club-director/engine';
import type { ContractRenewalRejection } from './contractService';
import type { Player } from '@club-director/shared-types';

/**
 * Pure view helpers for the contract-renewal UI (Phase 3C-C-ui).
 *
 * These helpers decide ONLY what to display — every business rule
 * (window, membership, expiry, demand threshold) stays in the engine
 * via contractService.renewContract. Nothing here re-implements a
 * domain rule; the service remains the single authority.
 */

/** Contract lengths the engine accepts. */
export const RENEWAL_DURATION_OPTIONS = [1, 2, 3] as const;
export type RenewalDuration = (typeof RENEWAL_DURATION_OPTIONS)[number];

/**
 * Whether the renewal form is worth showing for this player.
 *
 * Display gate only: the player must be under contract with the
 * managed club. Squad membership already guarantees this for listed
 * players, but the check keeps the section honest if the detail card
 * is ever rendered for another player. Window/expiry eligibility is
 * deliberately NOT checked here — the service decides, and its
 * refusal message explains why.
 */
export function isRenewalOfferedFor(
  player: Player,
  managedClubId: string | null,
): boolean {
  return (
    managedClubId !== null && player.contract.clubId === managedClubId
  );
}

/**
 * The player's wage demand for display, or null when it cannot be
 * computed (corrupt contract data — the engine helper throws).
 * `now` must be the game date (season.currentDate).
 */
export function renewalDemandFor(player: Player, now: Date): number | null {
  try {
    return renewalWageDemand(player, now);
  } catch {
    return null;
  }
}

/**
 * Parse a wage text input into a candidate value, or null when the
 * text is not a plain positive integer. Local hygiene only — the
 * service re-validates everything.
 */
export function parseRenewalWageInput(text: string): number | null {
  const trimmed = text.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const value = Number(trimmed);
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

/**
 * User-facing message for a service rejection. Technical reason
 * constants are never shown verbatim.
 */
export function renewalRejectionMessage(
  reason: ContractRenewalRejection,
  wageDemand: number | null,
): string {
  const demandSuffix =
    wageDemand !== null ? ` (minimum £${wageDemand.toLocaleString()}/wk)` : '';
  switch (reason) {
    case 'wage_below_demand':
      return `The player refuses this wage${demandSuffix}.`;
    case 'free_agent':
      return 'This player is a free agent and cannot renew.';
    case 'not_club_member':
      return 'This player does not play for your club.';
    case 'contract_expired':
      return 'This contract has already expired or its date is invalid.';
    case 'outside_renewal_window':
      return 'This contract is not close enough to expiry to renew — only the final 12 months can be renewed.';
    case 'invalid_duration':
      return 'Choose a contract length of 1, 2 or 3 years.';
    case 'invalid_wage':
      return 'Enter a valid weekly wage.';
    case 'invalid_player_id':
    case 'player_not_found':
      return 'Player not found.';
    case 'managed_club_not_found':
      return 'No managed club is selected.';
    case 'season_unavailable':
      return 'The game date is unavailable.';
    case 'contract_data_invalid':
      return 'This contract contains invalid data.';
    default:
      return 'The renewal was refused.';
  }
}
