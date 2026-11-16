import type { Club, Player } from '@club-director/shared-types';

/**
 * Weekly contract expiry (Phase 3C-B).
 *
 * A contract expires when `contractExpiryDate <= now` — `now` is always
 * the season's `currentDate` at the matchweek being processed, never
 * wall-clock time. An expired player becomes a free agent:
 * `contract.clubId` is set to `null` and the player is removed from
 * every `Club.squad` that contains them, so they stop being selected
 * and stop generating a wage bill (payroll iterates `club.squad`).
 *
 * Pure and deterministic: no RNG, no clock, no I/O, inputs never
 * mutated. Players and clubs that are not affected keep their object
 * references.
 */

export interface ContractExpiryResult {
  players: Player[];
  clubs: Club[];
  /**
   * Ids of players that transitioned from an active contract to free
   * agent THIS call. Players already free agents that are only cleaned
   * out of squads defensively are NOT included.
   */
  expiredPlayerIds: string[];
}

/**
 * Process contract expirations at `now`.
 *
 * Expiration rule (conservative on corrupt data):
 * - `contract.clubId !== null`
 * - `contractExpiryDate` is a valid Date
 * - `contractExpiryDate.getTime() <= now.getTime()`
 *
 * An invalid `contractExpiryDate` (NaN) never expires — a corrupt row
 * must not trigger a mass expiry. An invalid `now` throws.
 *
 * Squad hygiene is handled in the same pass but reported separately:
 * a player with `clubId === null` who still sits in a `Club.squad`
 * (inconsistent in-memory state) is removed from every squad that
 * contains them. This is defensive cleanup, not a new expiration.
 *
 * For every expired player the contract keeps `wage`,
 * `contractExpiryDate` and `marketValue` — only `clubId` becomes null.
 * No sporting attribute, status, development or morale field is
 * touched. Squad order and player order are preserved.
 */
export function processContractExpiry(
  players: readonly Player[],
  clubs: readonly Club[],
  now: Date,
): ContractExpiryResult {
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) {
    throw new Error('processContractExpiry: `now` must be a valid Date');
  }
  const nowTime = now.getTime();

  // Pass 1 — real transitions: active contract whose expiry date is
  // reached. Iterating `players` keeps expiredPlayerIds in roster order.
  const expiringIds = new Set<string>();
  for (const player of players) {
    const { clubId, contractExpiryDate } = player.contract;
    if (clubId === null) continue;
    const expiryTime =
      contractExpiryDate instanceof Date ? contractExpiryDate.getTime() : NaN;
    if (!Number.isFinite(expiryTime)) continue;
    if (expiryTime <= nowTime) {
      expiringIds.add(player.id);
    }
  }

  // Squad-removal set = newly expired players + every player already
  // recorded as a free agent. The latter is defensive: a null clubId
  // means "member of no squad", so any squad still listing them is
  // inconsistent state that must not survive the weekly cycle.
  const squadRemovalIds = new Set<string>(expiringIds);
  for (const player of players) {
    if (player.contract.clubId === null) {
      squadRemovalIds.add(player.id);
    }
  }

  const nextPlayers = players.map((player) =>
    expiringIds.has(player.id)
      ? {
          ...player,
          contract: { ...player.contract, clubId: null },
        }
      : player,
  );

  const nextClubs = clubs.map((club) =>
    club.squad.some((id) => squadRemovalIds.has(id))
      ? { ...club, squad: club.squad.filter((id) => !squadRemovalIds.has(id)) }
      : club,
  );

  return {
    players: nextPlayers,
    clubs: nextClubs,
    expiredPlayerIds: [...expiringIds],
  };
}

/* ------------------------------------------------------------------ */
/* Contract renewal (Phase 3C-C)                                       */
/* ------------------------------------------------------------------ */

/**
 * 30-day month, matching the convention used by the valuation
 * penalties in `transfer/valuation.ts` so both systems measure
 * "months remaining" identically.
 */
const MONTH_MS = 30 * 24 * 60 * 60 * 1000;

/** A contract is renewable only during its last 12 months. */
const RENEWAL_WINDOW_MS = 12 * MONTH_MS;

const RENEWAL_YEARS = new Set([1, 2, 3]);

export interface ContractRenewalTerms {
  /** Proposed weekly wage — integer, finite, strictly positive. */
  wage: number;
  /** Contract length — exactly 1, 2 or 3 years. */
  years: number;
  /** Reference date — the season's currentDate, never wall-clock. */
  now: Date;
}

export type ContractRenewalFailureReason =
  | 'free_agent'
  | 'not_club_member'
  | 'contract_expired'
  | 'outside_renewal_window'
  | 'invalid_duration'
  | 'invalid_wage'
  | 'wage_below_demand';

export type ContractRenewalResult =
  | { success: true; player: Player; wageDemand: number }
  | {
      success: false;
      reason: ContractRenewalFailureReason;
      wageDemand: number | null;
    };

function assertValidNow(now: Date, caller: string): void {
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) {
    throw new Error(`${caller}: \`now\` must be a valid Date`);
  }
}

/**
 * The minimum weekly wage a player accepts for a renewal:
 * `max(current wage, currentAbility * 1000)`. A player never asks for
 * less than they already earn, and ability sets a floor so a
 * low-paid star still demands a raise.
 *
 * Pure and deterministic — no RNG, no clock. `now` is accepted for
 * API symmetry with the rest of the contract module and validated;
 * the current formula does not depend on it.
 *
 * Throws on structurally invalid input (invalid `now`, non-finite or
 * negative contract wage, non-finite or negative currentAbility)
 * rather than silently producing a wrong demand.
 */
export function renewalWageDemand(player: Player, now: Date): number {
  assertValidNow(now, 'renewalWageDemand');

  const { wage } = player.contract;
  if (typeof wage !== 'number' || !Number.isFinite(wage) || wage < 0) {
    throw new Error('renewalWageDemand: contract.wage must be a finite number >= 0');
  }

  const { currentAbility } = player.development;
  if (
    typeof currentAbility !== 'number' ||
    !Number.isFinite(currentAbility) ||
    currentAbility < 0
  ) {
    throw new Error(
      'renewalWageDemand: development.currentAbility must be a finite number >= 0',
    );
  }

  const demand = Math.max(wage, currentAbility * 1000);
  if (!Number.isFinite(demand)) {
    throw new Error('renewalWageDemand: computed demand is not finite');
  }
  return demand;
}

/**
 * Offer a contract renewal to a player.
 *
 * Business rules (all evaluated inside the engine — the UI is never
 * the only guard):
 * - Only an actively contracted player of `club` may renew
 *   (`clubId === club.id`); free agents and other clubs' players are
 *   rejected.
 * - The contract must be valid (`contractExpiryDate > now`) — an
 *   expired or corrupt-dated contract cannot be renewed, which also
 *   makes post-expiry renewal impossible by construction.
 * - The contract must be inside its last 12 months
 *   (`expiry - now <= 12 * 30-day months`, matching the valuation
 *   convention). Exactly 12 months out is eligible.
 * - `years` must be exactly 1, 2 or 3.
 * - `wage` must be a finite integer strictly greater than 0 and at
 *   least `renewalWageDemand(player, now)`; the player accepts at
 *   exactly the demand, refuses below it. No randomness, no
 *   counter-offer, no signing bonus.
 * - The new expiry is `oldExpiry + years` (calendar years via
 *   `setFullYear`, same convention as `executeTransfer`) — never
 *   anchored to `now`, so no time is lost or gained.
 * - `club.finances.wageBudget` is an envelope for new signings and
 *   is deliberately untouched: a renewal changes no squad membership
 *   and consumes no envelope.
 *
 * On success a NEW player object and a NEW contract object are
 * returned; only `contract.wage` and `contract.contractExpiryDate`
 * change. Inputs are never mutated. A successful renewal pushes the
 * expiry beyond the 12-month window, so an immediate second call is
 * rejected as `outside_renewal_window` — the operation is not
 * idempotent by design, only repeat-renewal-safe.
 *
 * Business refusals return `{ success: false, reason }` — they never
 * throw. Exceptions are reserved for structurally invalid inputs
 * (invalid `now`, corrupt wage/ability surfaced by the demand
 * computation).
 */
export function proposeContractRenewal(
  player: Player,
  club: Club,
  terms: ContractRenewalTerms,
): ContractRenewalResult {
  assertValidNow(terms.now, 'proposeContractRenewal');
  const nowTime = terms.now.getTime();

  const fail = (
    reason: ContractRenewalFailureReason,
    wageDemand: number | null = null,
  ): ContractRenewalResult => ({ success: false, reason, wageDemand });

  const { clubId, contractExpiryDate } = player.contract;
  if (clubId === null) {
    return fail('free_agent');
  }
  if (clubId !== club.id) {
    return fail('not_club_member');
  }

  const expiryTime =
    contractExpiryDate instanceof Date ? contractExpiryDate.getTime() : NaN;
  if (!Number.isFinite(expiryTime) || expiryTime <= nowTime) {
    // Invalid or already-expired contract: one conservative reason —
    // a corrupt date must never be renewable.
    return fail('contract_expired');
  }
  if (expiryTime - nowTime > RENEWAL_WINDOW_MS) {
    return fail('outside_renewal_window');
  }

  if (!Number.isInteger(terms.years) || !RENEWAL_YEARS.has(terms.years)) {
    return fail('invalid_duration');
  }

  if (
    typeof terms.wage !== 'number' ||
    !Number.isFinite(terms.wage) ||
    !Number.isInteger(terms.wage) ||
    terms.wage <= 0
  ) {
    return fail('invalid_wage');
  }

  const wageDemand = renewalWageDemand(player, terms.now);
  if (terms.wage < wageDemand) {
    return fail('wage_below_demand', wageDemand);
  }

  const newExpiry = new Date(expiryTime);
  newExpiry.setFullYear(newExpiry.getFullYear() + terms.years);

  return {
    success: true,
    wageDemand,
    player: {
      ...player,
      contract: {
        ...player.contract,
        wage: terms.wage,
        contractExpiryDate: newExpiry,
      },
    },
  };
}
