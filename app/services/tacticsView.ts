import type {
  Club,
  ClubTactics,
  Formation,
  Mentality,
  Player,
  PlayerMap,
} from '@club-director/shared-types';
import {
  countEligiblePlayers,
  previewStartingXI,
  previewTeamStrength,
  type StartingXIPreview,
  type TeamStrength,
} from '@club-director/engine';

/**
 * Pure view/edit helpers for the Tactics screen (Phase 3B-D).
 *
 * Editing produces a NEW clubs array with only the managed club's
 * `tactics` replaced — every other club keeps its object reference and
 * every other club field is preserved. `width` is deliberately absent
 * from TacticsPatch: the field exists in the model but has no effect in
 * the engine, so the UI must not present it as a functional parameter.
 *
 * XI preview and strength ratings delegate to the engine's public
 * preview helpers (Phase 3B-C) — no selection logic is duplicated here.
 */

export const TACTIC_FORMATIONS: readonly Formation[] = [
  '4-4-2', '4-3-3', '3-5-2', '4-2-3-1', '5-3-2', '4-1-4-1', '3-4-3', '5-4-1',
];

export const TACTIC_MENTALITIES: readonly Mentality[] = [
  'defensive', 'balanced', 'attacking',
];

/**
 * Intensity/tempo domain. Seed generation uses 5–15 and the engine maps
 * values around 10 (`1 + (v - 10) * 0.01`); the UI clamps to the same
 * domain so persisted values stay inside the modeled range.
 */
export const TACTIC_INTENSITY_RANGE = { min: 5, max: 15 } as const;

export type TacticsPatch = Partial<
  Pick<ClubTactics, 'defaultFormation' | 'mentality' | 'pressingIntensity' | 'tempo'>
>;

export function clampTacticValue(value: number): number {
  return Math.min(
    TACTIC_INTENSITY_RANGE.max,
    Math.max(TACTIC_INTENSITY_RANGE.min, Math.round(value)),
  );
}

/**
 * Return a new clubs array where only `managedClubId`'s tactics are
 * merged with `patch`. Missing club → clubs returned unchanged (same
 * reference). Never mutates inputs.
 */
export function updateClubTactics(
  clubs: readonly Club[],
  managedClubId: string | null | undefined,
  patch: TacticsPatch,
): Club[] {
  if (!managedClubId) return [...clubs];
  let changed = false;
  const next = clubs.map((club) => {
    if (club.id !== managedClubId) return club;
    changed = true;
    const tactics: ClubTactics = {
      ...club.tactics,
      ...(patch.defaultFormation !== undefined
        ? { defaultFormation: patch.defaultFormation }
        : {}),
      ...(patch.mentality !== undefined ? { mentality: patch.mentality } : {}),
      ...(patch.pressingIntensity !== undefined
        ? { pressingIntensity: clampTacticValue(patch.pressingIntensity) }
        : {}),
      ...(patch.tempo !== undefined
        ? { tempo: clampTacticValue(patch.tempo) }
        : {}),
      // width intentionally untouched — not part of TacticsPatch.
    };
    return { ...club, tactics };
  });
  return changed ? next : [...clubs];
}

/** Build the PlayerMap the engine preview helpers expect. */
export function buildPlayerMap(players: readonly Player[]): PlayerMap {
  const map: PlayerMap = {};
  for (const p of players) map[p.id] = p;
  return map;
}

export function getManagedClub(
  clubs: readonly Club[],
  managedClubId: string | null | undefined,
): Club | null {
  if (!managedClubId) return null;
  return clubs.find((c) => c.id === managedClubId) ?? null;
}

export function previewManagedStartingXI(
  clubs: readonly Club[],
  players: readonly Player[],
  managedClubId: string | null | undefined,
): StartingXIPreview | null {
  const club = getManagedClub(clubs, managedClubId);
  if (!club) return null;
  return previewStartingXI(club, buildPlayerMap(players));
}

export function countManagedEligiblePlayers(
  clubs: readonly Club[],
  players: readonly Player[],
  managedClubId: string | null | undefined,
): number {
  const club = getManagedClub(clubs, managedClubId);
  if (!club) return 0;
  return countEligiblePlayers(club, buildPlayerMap(players));
}

/**
 * Squad-wide strength ratings (all squad players, tactical modifiers
 * applied, home advantage excluded) — NOT a rating of the previewed XI.
 */
export function previewManagedTeamStrength(
  clubs: readonly Club[],
  players: readonly Player[],
  managedClubId: string | null | undefined,
): TeamStrength | null {
  const club = getManagedClub(clubs, managedClubId);
  if (!club) return null;
  return previewTeamStrength(club, buildPlayerMap(players));
}
