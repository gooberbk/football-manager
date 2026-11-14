export interface Player {
  id: string;
  firstName: string;
  lastName: string;
  nationality: string;
  age: number;
  preferredFoot: PreferredFoot;
  primaryPosition: Position;
  secondaryPositions: Position[];
  attributes: PlayerAttributes;
  development: PlayerDevelopment;
  status: PlayerStatus;
  contract: PlayerContract;
}

export type PreferredFoot = 'left' | 'right' | 'both';

export type Position = 'GK' | 'CB' | 'FB' | 'DM' | 'CM' | 'AM' | 'W' | 'ST';

export interface PlayerAttributes {
  technical: TechnicalAttributes;
  mental: MentalAttributes;
  physical: PhysicalAttributes;
}

export interface TechnicalAttributes {
  passing: number;
  shooting: number;
  dribbling: number;
  tackling: number;
  heading: number;
  crossing: number;
  finishing: number;
  technique: number;
  longShots: number;
  freeKicks: number;
  firstTouch: number;
}

export interface MentalAttributes {
  vision: number;
  decisions: number;
  composure: number;
  anticipation: number;
  positioning: number;
  workRate: number;
  determination: number;
  leadership: number;
  concentration: number;
  flair: number;
}

export interface PhysicalAttributes {
  pace: number;
  acceleration: number;
  stamina: number;
  strength: number;
  agility: number;
  balance: number;
  jumping: number;
  naturalFitness: number;
}

export interface PlayerDevelopment {
  currentAbility: number;
  potentialAbility: number;
  ageGrowthCurve: AgeGrowthCurve;
}

export type AgeGrowthCurve = 'early-peak' | 'normal' | 'late-bloomer';

export interface PlayerStatus {
  morale: number;
  recentForm: number[];
  fitness: number;
  injury: Injury | null;
}

export interface Injury {
  type: string;
  daysRemaining: number;
  severity: InjurySeverity;
}

export type InjurySeverity = 'minor' | 'moderate' | 'serious' | 'severe';

export interface PlayerContract {
  clubId: string;
  wage: number;
  contractExpiryDate: Date;
  marketValue: number;
}

export interface Club {
  id: string;
  name: string;
  nickname: string;
  foundedYear: number;
  reputation: number;
  finances: ClubFinances;
  squad: string[];
  stadium: Stadium;
  tactics: ClubTactics;
}

export interface ClubFinances {
  balance: number;
  transferBudget: number;
  wageBudget: number;
  weeklyIncome: number;
  /** Outstanding debt owed by the club (settlement rules: Phase 2E.3d). */
  debt: number;
}

export interface Stadium {
  name: string;
  capacity: number;
}

export interface ClubTactics {
  defaultFormation: Formation;
  mentality: Mentality;
  pressingIntensity: number;
  tempo: number;
  width: number;
}

export type Formation =
  | '4-4-2'
  | '4-3-3'
  | '3-5-2'
  | '4-2-3-1'
  | '5-3-2'
  | '4-1-4-1'
  | '3-4-3'
  | '5-4-1';

export type Mentality = 'defensive' | 'balanced' | 'attacking';

export interface League {
  id: string;
  name: string;
  tier: number;
  clubIds: string[];
  standings: LeagueStandings;
  fixtures: Fixture[];
}

export interface LeagueStandings {
  entries: StandingEntry[];
}

export interface StandingEntry {
  clubId: string;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  goalsFor: number;
  goalsAgainst: number;
  goalDifference: number;
  points: number;
}

export interface Fixture {
  id: string;
  homeClubId: string;
  awayClubId: string;
  week: number;
  date: Date;
  played: boolean;
  homeScore?: number;
  awayScore?: number;
}

export interface Season {
  id: string;
  leagueId: string;
  currentWeek: number;
  currentDate: Date;
  transferWindowOpen: boolean;
  fixturesCalendar: Fixture[];
}

export interface Match {
  id: string;
  homeClubId: string;
  awayClubId: string;
  seasonId: string;
  date: Date;
  status: MatchStatus;
  homeScore?: number;
  awayScore?: number;
  events: MatchEvent[];
  homeTactics: ClubTactics;
  awayTactics: ClubTactics;
  stats?: {
    home: MatchStats;
    away: MatchStats;
  };
}

export type MatchStatus = 'scheduled' | 'in-progress' | 'completed' | 'postponed';

export interface MatchEvent {
  id: string;
  minute: number;
  type: EventType;
  primaryPlayerId: string;
  secondaryPlayerId?: string;
  team: 'home' | 'away';
  description: string;
}

export type EventType =
  | 'goal'
  | 'own-goal'
  | 'yellow-card'
  | 'red-card'
  | 'substitution'
  | 'injury'
  | 'chance'
  | 'save'
  | 'miss'
  | 'corner'
  | 'foul';

export interface MatchStats {
  possession: number;
  shots: number;
  shotsOnTarget: number;
  corners: number;
  fouls: number;
  yellowCards: number;
  redCards: number;
}

export interface MatchResult {
  homeScore: number;
  awayScore: number;
  events: MatchEvent[];
  stats: {
    home: MatchStats;
    away: MatchStats;
  };
  seed: number;
  /**
   * IDs of the players who actually started the match (home XI then away
   * XI, in selection order). Post-match effects must be scoped to these
   * participants — squad members who did not play are non-participants.
   */
  participantIds: string[];
}



export interface TransferRecord {
  id: string;
  playerId: string;
  fromClubId: string;
  toClubId: string;
  fee: number;
  date: Date;
}

export interface TransferListing {
  id: string;
  playerId: string;
  sellingClubId: string;
  askingPrice: number;
  listedDate: Date;
}

export interface TransferOffer {
  id: string;
  playerId: string;
  buyingClubId: string;
  sellingClubId: string;
  offerAmount: number;
  status: TransferOfferStatus;
  createdAt: Date;
  resolvedAt?: Date;
}

export type TransferOfferStatus = 'pending' | 'accepted' | 'rejected' | 'withdrawn';

/**
 * Ambition category assigned to a club at the start of a season
 * (Phase 2E.3d). Determined once from relative squad strength and
 * persisted — never recomputed during the season.
 */
export type SeasonAmbition =
  | 'title_favorite'
  | 'title_contender'
  | 'upper_table'
  | 'mid_table'
  | 'progression'
  | 'survival';

/**
 * Deferred sanction recorded when a club ends the season with
 * unresolved debt (Phase 2E.3d). 'dismissal_relegation_pending' means
 * the sanction is recorded but NOT executed: the manager-career and
 * divisions systems do not exist yet, so nothing is actually applied.
 * Executed states ('dismissed', 'relegated') belong to future phases.
 */
export type SeasonObjectiveSanction =
  | 'none'
  | 'dismissal_relegation_pending';

/**
 * A club's season objective: target league position, ambition category
 * and the reward amount fixed at season start. `rewardAmount` is the
 * sporting reward and the reference financial threshold — it is NOT a
 * hard accounting cap: real debt is never truncated to respect it.
 *
 * Settlement fields stay null until the end-of-season settlement runs;
 * they are written exactly once, inside the rollover transaction.
 */
export interface SeasonObjective {
  seasonId: string;
  clubId: string;
  /** Target finishing position (1 = champion). Fixed at creation. */
  targetPosition: number;
  /** Reward amount fixed at creation. Never recomputed. */
  rewardAmount: number;
  ambition: SeasonAmbition;
  /** null until settlement evaluates the final standing. */
  objectiveMet: boolean | null;
  /** Amount actually paid out at settlement (0 when objective missed). */
  rewardPaid: number;
  /** Debt left after settlement; null until settlement runs. */
  debtRemaining: number | null;
  /** Settlement timestamp; null until settlement runs. */
  settledAt: Date | null;
  sanction: SeasonObjectiveSanction;
}

export interface PlayerMap {
  [playerId: string]: Player;
}
