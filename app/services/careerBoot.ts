import { initializeDatabase, loadCareer, saveCareer } from '../db';
import { ensureSeasonObjectives } from './seasonObjectiveInit';
import { useGameState } from '../store/useGameState';

/**
 * Outcome of the career boot:
 * - 'loaded': a saved career was found and restored into the store.
 * - 'empty':  the database is healthy but no career exists yet.
 * - 'error':  initialization or loading failed. This is NOT "no career" —
 *   callers must surface a recoverable error, never route to new-career.
 */
export type CareerBootResult = 'loaded' | 'empty' | 'error';

let bootPromise: Promise<CareerBootResult> | null = null;

/**
 * Initialize the database and load any saved career into the Zustand store.
 * Runs at most once per app session for a given outcome; resolves to
 * 'loaded' when a career was restored, 'empty' when none exists, and
 * 'error' when boot failed. A failed boot clears the cached promise so the
 * next call retries; concurrent callers always share the in-flight attempt.
 */
export function ensureCareerBoot(): Promise<CareerBootResult> {
  if (!bootPromise) {
    bootPromise = (async (): Promise<CareerBootResult> => {
      const store = useGameState.getState();
      store.setBootStatus('pending');
      store.setIsLoading(true);

      let result: CareerBootResult;
      try {
        await initializeDatabase();
        const careerState = await loadCareer();

        if (careerState) {
          // Recover season objectives only when the current season is
          // provably untouched; 'blocked'/'corrupt' careers boot normally
          // and the rollover still fails explicitly at settlement.
          // A 'recovered' state is persisted BEFORE any publication.
          const ensured = ensureSeasonObjectives(careerState);
          if (ensured.action === 'recovered') {
            await saveCareer(ensured.state);
          }
          const bootstrapped = ensured.state;
          store.setLeague(bootstrapped.league);
          store.setSeason(bootstrapped.season);
          store.setClubs(bootstrapped.clubs);
          store.setPlayers(bootstrapped.players);
          store.setTransferHistory(bootstrapped.transferHistory);
          store.setTransferOffers(bootstrapped.transferOffers ?? []);
          store.setMatches(bootstrapped.matches ?? []);
          store.setSeasonObjectives(bootstrapped.seasonObjectives ?? []);
          store.setManagedClubId(bootstrapped.career.managedClubId);
          result = 'loaded';
        } else {
          result = 'empty';
        }
      } catch (error) {
        console.error('Career boot failed:', error);
        result = 'error';
      } finally {
        useGameState.getState().setIsLoading(false);
      }
      useGameState.getState().setBootStatus(result);
      return result;
    })();

    // Only failures are retryable: a successful boot stays cached so the
    // layout effect and the index gate can never duplicate initialization.
    bootPromise.then((result) => {
      if (result === 'error') {
        bootPromise = null;
      }
    });
  }
  return bootPromise;
}
