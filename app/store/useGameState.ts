import { create } from 'zustand';
import type { League, Season, Club, Player, TransferOffer, TransferRecord } from '@club-director/shared-types';
import { saveCareer } from '../db';

interface GameState {
  league: League | null;
  season: Season | null;
  clubs: Club[];
  players: Player[];
  resultsHistory: string[];
  transferOffers: TransferOffer[];
  transferHistory: TransferRecord[];
  managedClubId: string | null;
  isLoading: boolean;
  setLeague: (league: League) => void;
  setSeason: (season: Season) => void;
  setClubs: (clubs: Club[]) => void;
  setPlayers: (players: Player[]) => void;
  setTransferHistory: (history: TransferRecord[]) => void;
  setManagedClubId: (id: string) => void;
  setIsLoading: (loading: boolean) => void;
  setTransferOffers: (offers: TransferOffer[]) => void;
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
  managedClubId: null,
  isLoading: true,
  setLeague: (league) => set({ league }),
  setSeason: (season) => set({ season }),
  setClubs: (clubs) => set({ clubs }),
  setPlayers: (players) => set({ players }),
  setTransferHistory: (history) => set({ transferHistory: history }),
  setManagedClubId: (id) => set({ managedClubId: id }),
  setIsLoading: (loading) => set({ isLoading: loading }),
  setTransferOffers: (offers) => set({ transferOffers: offers }),
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
    managedClubId: null,
    isLoading: true,
  }),
  saveState: async () => {
    const { league, season, clubs, players, transferHistory, managedClubId, isLoading } = get();
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
        };
        await saveCareer(careerState);
      } catch (error) {
        console.error('Failed to autosave career:', error);
      }
    }
  },
}));
