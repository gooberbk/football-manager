import type { Club, Player, Position } from '@club-director/shared-types';

/**
 * Pure view-model helpers for the Squad screen (Phase 3B-B).
 *
 * Read-only derivations over the store's `players`/`clubs` collections:
 * no business rule is duplicated here — squad membership comes from the
 * canonical `club.squad` id list (the same relation the engine uses for
 * match selection), and availability mirrors the engine's eligibility
 * rule (`status.injury` with `daysRemaining > 0` makes a player
 * unselectable). No mutation, no I/O, fully deterministic.
 */

export const SQUAD_POSITIONS: readonly Position[] = [
  'GK', 'CB', 'FB', 'DM', 'CM', 'AM', 'W', 'ST',
];

export type SquadSortKey = 'ability' | 'age' | 'morale' | 'fitness';

export interface SquadFilters {
  /** 'all' or a single primary position. */
  position: Position | 'all';
  /** When true, only currently available (non-injured) players. */
  availableOnly: boolean;
}

export const DEFAULT_SQUAD_FILTERS: SquadFilters = {
  position: 'all',
  availableOnly: false,
};

export const SQUAD_SORT_KEYS: readonly SquadSortKey[] = [
  'ability', 'age', 'morale', 'fitness',
];

export const SQUAD_SORT_LABELS: Record<SquadSortKey, string> = {
  ability: 'Ability',
  age: 'Age',
  morale: 'Morale',
  fitness: 'Fitness',
};

/** An injured player cannot be selected for matches. */
export function isPlayerInjured(player: Player): boolean {
  return player.status.injury !== null && player.status.injury.daysRemaining > 0;
}

/** Mirrors the engine's selection eligibility (simulation.ts). */
export function isPlayerAvailable(player: Player): boolean {
  return !isPlayerInjured(player);
}

/**
 * Players belonging to the managed club, resolved through the canonical
 * `club.squad` id list (composition relation — NOT `contract.clubId`,
 * which is the contract's club reference and mirrors squad membership
 * but is not the authoritative roster). Order follows `club.squad`.
 * Returns [] when the club is missing or a squad id has no player.
 */
export function getManagedSquadPlayers(
  clubs: readonly Club[],
  players: readonly Player[],
  managedClubId: string | null | undefined,
): Player[] {
  if (!managedClubId) return [];
  const club = clubs.find((c) => c.id === managedClubId);
  if (!club) return [];
  const byId = new Map(players.map((p) => [p.id, p]));
  const squad: Player[] = [];
  for (const id of club.squad) {
    const player = byId.get(id);
    if (player) squad.push(player);
  }
  return squad;
}

export function squadSummary(players: readonly Player[]): {
  total: number;
  injured: number;
  available: number;
} {
  let injured = 0;
  for (const player of players) {
    if (isPlayerInjured(player)) injured++;
  }
  return { total: players.length, injured, available: players.length - injured };
}

/**
 * Apply position and availability filters. Deterministic: preserves
 * the input order for equal outcomes.
 */
export function filterSquadPlayers(
  players: readonly Player[],
  filters: SquadFilters,
): Player[] {
  return players.filter((player) => {
    if (filters.position !== 'all' && player.primaryPosition !== filters.position) {
      return false;
    }
    if (filters.availableOnly && !isPlayerAvailable(player)) {
      return false;
    }
    return true;
  });
}

function sortMetric(player: Player, key: SquadSortKey): number {
  switch (key) {
    case 'ability':
      return player.development.currentAbility;
    case 'age':
      return player.age;
    case 'morale':
      return player.status.morale;
    case 'fitness':
      return player.status.fitness;
  }
}

/**
 * Sort players for display. Ability/morale/fitness sort descending;
 * age sorts ascending (youngest first). Ties break on player.id so the
 * order is fully deterministic regardless of input order.
 */
export function sortSquadPlayers(
  players: readonly Player[],
  sortKey: SquadSortKey,
): Player[] {
  const direction = sortKey === 'age' ? 1 : -1;
  return [...players].sort((a, b) => {
    const diff = (sortMetric(a, sortKey) - sortMetric(b, sortKey)) * direction;
    if (diff !== 0) return diff;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

/** Full pipeline used by the screen: squad → filter → sort. */
export function buildSquadView(
  clubs: readonly Club[],
  players: readonly Player[],
  managedClubId: string | null | undefined,
  filters: SquadFilters,
  sortKey: SquadSortKey,
): Player[] {
  return sortSquadPlayers(
    filterSquadPlayers(getManagedSquadPlayers(clubs, players, managedClubId), filters),
    sortKey,
  );
}
