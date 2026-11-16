import type {
  Club,
  PlayerMap,
  MatchResult,
} from '@club-director/shared-types';

export { generateSeedData } from './seed/generateSeedData';
export { simulateMatch } from './match/simulation';
export {
  previewStartingXI,
  previewTeamStrength,
  countEligiblePlayers,
} from './match/simulation';
export type { StartingXIPreview, TeamStrength } from './match/simulation';
export { generateFixtures, scheduledFixturesToLeagueFixtures } from './season/scheduling';
export { computeStandings } from './season/standings';
export { isSeasonComplete, getSeasonAnomalies } from './season/completion';
export type { SeasonAnomalies } from './season/completion';
export { buildNextSeason } from './season/rollover';
export type { BuildNextSeasonInput, NextSeasonState } from './season/rollover';
export { advanceMatchweek } from './season/advanceMatchweek';
export { processContractExpiry } from './season/contracts';
export type { ContractExpiryResult } from './season/contracts';
export { renewalWageDemand, proposeContractRenewal } from './season/contracts';
export type {
  ContractRenewalTerms,
  ContractRenewalResult,
  ContractRenewalFailureReason,
} from './season/contracts';
export { assignSeasonObjectives } from './season/objectives';
export type { AssignSeasonObjectivesInput } from './season/objectives';
export { settleSeasonObjectives } from './season/settlement';
export type {
  SettleSeasonObjectivesInput,
  SeasonSettlementResult,
} from './season/settlement';
export { applyWeeklyEconomy } from './economy/weeklyEconomy';
export {
  applyWeeklyDevelopment,
  DEFAULT_WEEKLY_DEVELOPMENT_PARAMS,
} from './players/development';
export type {
  WeeklyDevelopmentParams,
} from './players/development';
export {
  applyWeeklyMorale,
  buildMatchClubByPlayerId,
  collectClubsWithNewUnpaidWages,
  detectInjuryTransitions,
  DEFAULT_WEEKLY_MORALE_PARAMS,
  NEUTRAL_MORALE,
} from './players/morale';
export type {
  WeeklyMoraleContext,
  WeeklyMoraleInjuryEvent,
  WeeklyMoraleMatch,
  WeeklyMoraleParams,
} from './players/morale';
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
