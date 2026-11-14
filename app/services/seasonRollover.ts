import { buildNextSeason } from '@club-director/engine';
import { saveCareer } from '../db';
import type { CareerState } from '../db/careerPersistence';
import type { PersistedMatch } from '../db/matchRecords';
import type {
  Club,
  League,
  Player,
  Season,
  TransferOffer,
  TransferRecord,
} from '@club-director/shared-types';
import { useGameState } from '../store/useGameState';

export type SeasonRolloverResult =
  | { ok: true; season: Season }
  | { ok: false; error: string };

export interface SeasonRolloverDeps {
  /**
   * Persistence entry point. Defaults to the app's saveCareer wrapper;
   * tests inject a function backed by the real SQLite test database.
   */
  saveCareerFn?: (state: CareerState) => Promise<void>;
}

/**
 * Derive the next season id from the project's `season-N` convention by
 * incrementing the trailing number (`season-1` -> `season-2`). Ids
 * without a numeric suffix get a `-next` marker so the result is always
 * different from the current id — match ids embed the season id, so
 * uniqueness is what prevents history collisions.
 */
function nextSeasonId(currentId: string): string {
  const match = /^(.*?)(\d+)$/.exec(currentId.trim());
  if (match) {
    const next = Number(match[2]) + 1;
    if (Number.isSafeInteger(next)) {
      return `${match[1]}${next}`;
    }
  }
  return `${currentId}-next`;
}

interface CareerCollections {
  league: League;
  season: Season;
  clubs: Club[];
  players: Player[];
  transferHistory: TransferRecord[];
  transferOffers: TransferOffer[];
  matches: PersistedMatch[];
  managedClubId: string;
}

/**
 * Everything a rollover save or staleness check cares about, captured
 * by reference. resultsHistory is included even though it is never
 * persisted: the service itself resets it on publish, so a concurrent
 * change must not be silently cleared.
 */
interface CareerSnapshot extends CareerCollections {
  resultsHistory: string[];
}

/**
 * Capture the career collections from the store, or null unless the
 * store represents a fully loaded career — the same strict conditions
 * useGameState.saveState enforces before persisting, plus referential
 * sanity (managed club must exist in clubs, squads non-empty). Invalid
 * state is rejected, never repaired.
 */
function snapshotCareer(
  state: ReturnType<typeof useGameState.getState>,
): CareerSnapshot | null {
  const { league, season, managedClubId, clubs, players } = state;
  if (
    state.bootStatus !== 'loaded' ||
    state.isLoading ||
    !league ||
    !season ||
    !managedClubId ||
    clubs.length === 0 ||
    players.length === 0 ||
    !clubs.some((club) => club.id === managedClubId)
  ) {
    return null;
  }
  return {
    league,
    season,
    clubs,
    players,
    transferHistory: state.transferHistory,
    transferOffers: state.transferOffers,
    matches: state.matches,
    resultsHistory: state.resultsHistory,
    managedClubId,
  };
}

/**
 * Whether the store still holds exactly the snapshotted references.
 * The store replaces collections immutably, so reference equality is a
 * precise staleness check.
 */
function isSameSnapshot(snapshot: CareerSnapshot): boolean {
  const current = useGameState.getState();
  // A lifecycle transition invalidates the snapshot even when every
  // collection reference is unchanged — the career is no longer in a
  // persistable loaded state.
  if (current.bootStatus !== 'loaded' || current.isLoading) {
    return false;
  }
  return (
    current.league === snapshot.league &&
    current.season === snapshot.season &&
    current.clubs === snapshot.clubs &&
    current.players === snapshot.players &&
    current.transferHistory === snapshot.transferHistory &&
    current.transferOffers === snapshot.transferOffers &&
    current.matches === snapshot.matches &&
    current.resultsHistory === snapshot.resultsHistory &&
    current.managedClubId === snapshot.managedClubId
  );
}

/**
 * Assemble a complete CareerState from a set of career collections.
 * Career metadata follows the established convention shared by
 * careerCreation and useGameState.saveState: the store does not keep
 * the career record, so the active-career row is rewritten with the
 * managed club id.
 */
function buildCareerState(input: CareerCollections): CareerState {
  return {
    career: {
      id: 'active',
      managerName: 'Player',
      managedClubId: input.managedClubId,
      createdAt: new Date(),
      lastPlayedAt: new Date(),
      schemaVersion: 1,
    },
    clubs: input.clubs,
    players: input.players,
    league: input.league,
    season: input.season,
    transferHistory: input.transferHistory,
    transferOffers: input.transferOffers,
    matches: input.matches,
  };
}

let rolloverInFlight: Promise<SeasonRolloverResult> | null = null;

/**
 * Orchestrate a next-season rollover for the loaded career.
 *
 * Flow (same ordering contract as careerCreation):
 * 1. Snapshot the store and hand it to the pure engine buildNextSeason,
 *    which enforces completion, anomaly-freedom and data validity.
 * 2. Persist the resulting complete CareerState through saveCareer's
 *    single transaction — clubs, players, match history, transfer
 *    history and offers are carried over; only season-scoped data
 *    (fixtures, standings, season identity) is replaced.
 * 3. Only after persistence resolves AND the store is verified
 *    unchanged since the snapshot, publish the new league/season.
 *
 * Concurrency: concurrent callers share the single in-flight attempt,
 * so a second trigger can never start another rollover. After it
 * settles the guard clears; a later call re-validates and is refused
 * by the engine because the new season is not complete.
 *
 * Stale-state protection: every collection the save carries is compared
 * by reference before saving and again after the await, so a store
 * mutation queued between persistence and publish rejects the
 * operation instead of being silently overwritten. Precision on what
 * that window actually is: saveCareer's Drizzle transaction callback
 * is fully synchronous on the expo-sqlite/better-sqlite3 drivers (no
 * await inside, every write via .run()), so the whole BEGIN→COMMIT
 * executes during the synchronous `save()` call itself — no JavaScript
 * can interleave mid-transaction. The only residual window is the
 * microtask gap between commit and this continuation, reachable solely
 * by store mutations already queued as promise continuations (UI
 * events and React effects are macrotasks and cannot interleave).
 * If that happens we report ok:false without publishing and immediately
 * persist a compensating save built from the LATEST in-memory career
 * state, so the database converges back to memory right away instead of
 * relying on a future autosave that may never run (e.g. the app is
 * killed first). The compensating save is verified the same way: each
 * attempt snapshots the latest in-memory state, saves it, then
 * re-checks the store after the await. A store that keeps mutating
 * triggers another bounded attempt (at most MAX_COMPENSATION_ATTEMPTS
 * compensating saves); if consistency still cannot be confirmed, the
 * result says so explicitly and never claims restoration. If any
 * compensating save throws, the error says so explicitly — consistency
 * is never claimed.
 */
export function rolloverSeason(
  deps: SeasonRolloverDeps = {},
): Promise<SeasonRolloverResult> {
  if (!rolloverInFlight) {
    const save = deps.saveCareerFn ?? saveCareer;
    rolloverInFlight = performRollover(save).finally(() => {
      rolloverInFlight = null;
    });
  }
  return rolloverInFlight;
}

const MAX_COMPENSATION_ATTEMPTS = 3;

async function performRollover(
  save: (state: CareerState) => Promise<void>,
): Promise<SeasonRolloverResult> {
  const initial = snapshotCareer(useGameState.getState());
  if (!initial) {
    return { ok: false, error: 'No active career is loaded.' };
  }
  const { league, season, clubs, players } = initial;
  const { transferHistory, transferOffers, matches, managedClubId } = initial;

  let next: ReturnType<typeof buildNextSeason>;
  try {
    next = buildNextSeason({
      league,
      season,
      clubs,
      players,
      newSeasonId: nextSeasonId(season.id),
      // advanceMatchweek already advanced currentDate one week past the
      // final fixture date, so the new calendar starts exactly there —
      // adding another week would leave a gap.
      newStartDate: new Date(season.currentDate),
    });
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }

  if (!isSameSnapshot(initial)) {
    return {
      ok: false,
      error: 'Career state changed before rollover could be persisted.',
    };
  }

  const careerState = buildCareerState({
    league: next.league,
    season: next.season,
    clubs: next.clubs,
    players: next.players,
    transferHistory,
    transferOffers,
    matches,
    managedClubId,
  });

  try {
    await save(careerState);
  } catch (error) {
    return {
      ok: false,
      error:
        'Failed to persist next season: ' +
        (error instanceof Error ? error.message : String(error)),
    };
  }

  if (!isSameSnapshot(initial)) {
    // The rollover transaction already committed the new season (it ran
    // synchronously inside `save()`), but a store mutation was queued
    // in the microtask gap before this continuation — publishing would
    // clobber it. Compensate: persist the LATEST in-memory career so
    // the database returns to the state memory actually holds, rather
    // than waiting for an autosave that may never fire. Each attempt
    // snapshots the newest state, saves it, then re-verifies the store
    // after the await — the same microtask window exists during a
    // compensating save, so a bounded retry loop confirms consistency
    // instead of assuming it.
    for (let attempt = 0; attempt < MAX_COMPENSATION_ATTEMPTS; attempt++) {
      const latest = snapshotCareer(useGameState.getState());
      if (!latest) {
        return {
          ok: false,
          error:
            'Career state changed while the next season was being saved ' +
            'and no valid career remains loaded to compensate; ' +
            'database/memory consistency cannot be guaranteed — the ' +
            'database may contain the next season while memory does not.',
        };
      }
      try {
        await save(buildCareerState(latest));
      } catch (compensationError) {
        return {
          ok: false,
          error:
            'Career state changed while the next season was being saved ' +
            'and the compensating save failed; the database may still ' +
            'contain the next season while memory holds a different ' +
            'state: ' +
            (compensationError instanceof Error
              ? compensationError.message
              : String(compensationError)),
        };
      }
      if (isSameSnapshot(latest)) {
        return {
          ok: false,
          error:
            'Career state changed while the next season was being saved; ' +
            'the concurrent modification was preserved and the database ' +
            'was restored to the latest in-memory career state.',
        };
      }
      // The store mutated again during this compensating save: the
      // database now holds `latest` while memory moved on. Loop and
      // compensate with the newest state, up to the attempt limit.
    }
    return {
      ok: false,
      error:
        `Career state kept changing during rollover compensation ` +
        `(${MAX_COMPENSATION_ATTEMPTS} attempts); consistency could not ` +
        'be confirmed — the database may differ from memory.',
    };
  }

  const store = useGameState.getState();
  store.setLeague(next.league);
  store.setSeason(next.season);
  // Ephemeral UI state from the finished season does not carry over.
  store.setResultsHistory([]);

  return { ok: true, season: next.season };
}
