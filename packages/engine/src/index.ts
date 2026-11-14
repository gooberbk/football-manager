import type {
  Club,
  PlayerMap,
  MatchResult,
} from '@club-director/shared-types';

export { generateSeedData } from './seed/generateSeedData';
export { simulateMatch } from './match/simulation';
export { generateFixtures, scheduledFixturesToLeagueFixtures } from './season/scheduling';
export { computeStandings } from './season/standings';
export { isSeasonComplete, getSeasonAnomalies } from './season/completion';
export type { SeasonAnomalies } from './season/completion';
export { buildNextSeason } from './season/rollover';
export type { BuildNextSeasonInput, NextSeasonState } from './season/rollover';
export { advanceMatchweek } from './season/advanceMatchweek';
export {
  calculateMarketValue,
  updatePlayerMarketValue,
} from './transfer/valuation';
export {
  makeOffer,
  resolveOffer,
  executeTransfer,
  processAITransferActivity,
  calculateWageBill,
} from './transfer/market';
export type { TransferMarketState, MakeOfferResult } from './transfer/market';
