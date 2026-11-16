import { create } from 'zustand';
import type { League, Season, Club, Player, SeasonObjective, TransferOffer, TransferRecord } from '@club-director/shared-types';
import type { PersistedMatch } from '../db/matchRecords';
import { saveCareer } from '../db';

interface GameState {
  league: League | null;
  season: Season | null;
  clubs: Club[];
  players: Player[];
  resultsHistory: string[];
  transferOffers: TransferOffer[];
  transferHistory: TransferRecord[];
  matches: PersistedMatch[];
  seasonObjectives: SeasonObjective[];
  managedClubId: string | null;
  isLoading: boolean;
  /**
   * Career boot lifecycle, written by services/careerBoot.ts:
   * 'pending' while boot runs, 'loaded'/'empty' on success, 'error' on
   * failure. 'error' must never be treated as "no career" — it is a
   * recoverable failure surfaced by the root gate and tab guard.
   */
  bootStatus: 'pending' | 'loaded' | 'empty' | 'error';
  setBootStatus: (status: 'pending' | 'loaded' | 'empty' | 'error') => void;
  setLeague: (league: League) => void;
  setSeason: (season: Season) => void;
  setClubs: (clubs: Club[]) => void;
  setPlayers: (players: Player[]) => void;
  setTransferHistory: (history: TransferRecord[]) => void;
  setMatches: (matches: PersistedMatch[]) => void;
  setManagedClubId: (id: string) => void;
  setIsLoading: (loading: boolean) => void;
  setTransferOffers: (offers: TransferOffer[]) => void;
  setSeasonObjectives: (objectives: SeasonObjective[]) => void;
  setResultsHistory: (results: string[]) => void;
  addResult: (result: string) => void;
  reset: () => void;
  saveState: () => Promise<void>;
}

export const useGameState = create<GameState>((set, get) => ({
  league: null,
  season: null,
  clubs: [],
  players: [],
  resultsHistory: [],
  transferOffers: [],
  transferHistory: [],
  matches: [],
  seasonObjectives: [],
  managedClubId: null,
  isLoading: true,
  bootStatus: 'pending',
  setBootStatus: (status) => set({ bootStatus: status }),
  setLeague: (league) => set({ league }),
  setSeason: (season) => set({ season }),
  setClubs: (clubs) => set({ clubs }),
  setPlayers: (players) => set({ players }),
  setTransferHistory: (history) => set({ transferHistory: history }),
  setMatches: (matches) => set({ matches }),
  setManagedClubId: (id) => set({ managedClubId: id }),
  setIsLoading: (loading) => set({ isLoading: loading }),
  setTransferOffers: (offers) => set({ transferOffers: offers }),
  setSeasonObjectives: (objectives) => set({ seasonObjectives: objectives }),
  setResultsHistory: (results) => set({ resultsHistory: results }),
  addResult: (result) => set((state) => ({ resultsHistory: [...state.resultsHistory, result] })),
  reset: () => set({
    league: null,
    season: null,
    clubs: [],
    players: [],
    resultsHistory: [],
    transferOffers: [],
    transferHistory: [],
    matches: [],
    seasonObjectives: [],
    managedClubId: null,
    isLoading: true,
  }),
  saveState: async () => {
    const { league, season, clubs, players, transferHistory, transferOffers, matches, seasonObjectives, managedClubId, isLoading } = get();
    if (league && season && clubs.length > 0 && players.length > 0 && managedClubId && !isLoading) {
      try {
        const careerState = {
          career: {
            id: 'active',
            managerName: 'Player',
            managedClubId,
            createdAt: new Date(),
            lastPlayedAt: new Date(),
            schemaVersion: 1,
          },
          clubs,
          players,
          league,
          season,
          transferHistory,
          transferOffers,
          matches,
          seasonObjectives,
        };
        await saveCareer(careerState);
      } catch (error) {
        console.error('Failed to autosave career:', error);
      }
    }
  },
}));
