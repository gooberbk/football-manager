import { initializeDatabase, loadCareer } from '../db';
import { useGameState } from '../store/useGameState';

let bootPromise: Promise<boolean> | null = null;

/**
 * Initialize the database and load any saved career into the Zustand store.
 * Runs at most once per app session; resolves to true when a career was
 * loaded, false when none exists or loading failed.
 */
export function ensureCareerBoot(): Promise<boolean> {
  if (!bootPromise) {
    bootPromise = (async () => {
      try {
        await initializeDatabase();
        const careerState = await loadCareer();

        if (careerState) {
          const store = useGameState.getState();
          store.setLeague(careerState.league);
          store.setSeason(careerState.season);
          store.setClubs(careerState.clubs);
          store.setPlayers(careerState.players);
          store.setTransferHistory(careerState.transferHistory);
          store.setTransferOffers([]);
          store.setManagedClubId(careerState.career.managedClubId);
          return true;
        }
        return false;
      } catch (error) {
        console.error('Failed to load career:', error);
        return false;
      } finally {
        useGameState.getState().setIsLoading(false);
      }
    })();
  }
  return bootPromise;
}
