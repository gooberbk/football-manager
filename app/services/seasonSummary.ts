import { isSeasonComplete } from '@club-director/engine';
import type {
  Club,
  League,
  Season,
  StandingEntry,
} from '@club-director/shared-types';

export interface SeasonStandingRow extends StandingEntry {
  /** Final position in the table (1 = champion when season complete). */
  position: number;
  clubName: string;
  /** True only for the top entry of a completed season. */
  isChampion: boolean;
}

export interface SeasonSummary {
  /** Mirrors engine isSeasonComplete — single source of truth. */
  complete: boolean;
  championClubId: string | null;
  championClubName: string | null;
  /** Entries in standings order with position/champion annotations. */
  standings: SeasonStandingRow[];
}

/**
 * Build the view model for the League screen's season-end state.
 * Completion is delegated to the engine's isSeasonComplete so the UI
 * never duplicates the rule; champion highlighting is only meaningful
 * once the season is complete.
 */
export function buildSeasonSummary(
  league: League,
  season: Season,
  clubs: Club[],
): SeasonSummary {
  const complete = isSeasonComplete(league, season);
  const entries = league.standings.entries;
  const clubName = (clubId: string) =>
    clubs.find((c) => c.id === clubId)?.name ?? clubId;

  const champion = complete ? entries[0] ?? null : null;

  return {
    complete,
    championClubId: champion?.clubId ?? null,
    championClubName: champion ? clubName(champion.clubId) : null,
    standings: entries.map((entry, index) => ({
      ...entry,
      position: index + 1,
      clubName: clubName(entry.clubId),
      isChampion: complete && index === 0,
    })),
  };
}

export interface SeasonRolloverAction {
  /** The "Start Next Season" action is only offered on a completed season. */
  visible: boolean;
  /** Disabled while a rollover is in flight — prevents repeated taps. */
  disabled: boolean;
  label: string;
}

/**
 * View-model for the season-end "Start Next Season" action. The action
 * exists only when the season is complete; while a rollover runs it is
 * disabled and relabelled so the user sees progress and cannot
 * double-trigger (the service additionally guards in-flight calls).
 */
export function buildRolloverAction(
  complete: boolean,
  inProgress: boolean,
): SeasonRolloverAction {
  return {
    visible: complete,
    disabled: inProgress,
    label: inProgress ? 'Starting next season…' : 'Start Next Season',
  };
}
