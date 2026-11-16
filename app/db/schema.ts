import {
  sqliteTable,
  text,
  integer,
  primaryKey,
} from 'drizzle-orm/sqlite-core';

export const players = sqliteTable('players', {
  id: text('id').primaryKey(),
  firstName: text('first_name').notNull(),
  lastName: text('last_name').notNull(),
  nationality: text('nationality').notNull(),
  age: integer('age').notNull(),
  preferredFoot: text('preferred_foot').notNull(),
  primaryPosition: text('primary_position').notNull(),
  secondaryPositions: text('secondary_positions').notNull(),
  // Technical attributes
  passing: integer('passing').notNull(),
  shooting: integer('shooting').notNull(),
  dribbling: integer('dribbling').notNull(),
  tackling: integer('tackling').notNull(),
  heading: integer('heading').notNull(),
  crossing: integer('crossing').notNull(),
  finishing: integer('finishing').notNull(),
  technique: integer('technique').notNull(),
  longShots: integer('long_shots').notNull(),
  freeKicks: integer('free_kicks').notNull(),
  firstTouch: integer('first_touch').notNull(),
  // Mental attributes
  vision: integer('vision').notNull(),
  decisions: integer('decisions').notNull(),
  composure: integer('composure').notNull(),
  anticipation: integer('anticipation').notNull(),
  positioning: integer('positioning').notNull(),
  workRate: integer('work_rate').notNull(),
  determination: integer('determination').notNull(),
  leadership: integer('leadership').notNull(),
  concentration: integer('concentration').notNull(),
  flair: integer('flair').notNull(),
  // Physical attributes
  pace: integer('pace').notNull(),
  acceleration: integer('acceleration').notNull(),
  stamina: integer('stamina').notNull(),
  strength: integer('strength').notNull(),
  agility: integer('agility').notNull(),
  balance: integer('balance').notNull(),
  jumping: integer('jumping').notNull(),
  naturalFitness: integer('natural_fitness').notNull(),
  // Development
  currentAbility: integer('current_ability').notNull(),
  potentialAbility: integer('potential_ability').notNull(),
  ageGrowthCurve: text('age_growth_curve').notNull(),
  // Status
  morale: integer('morale').notNull(),
  recentForm: text('recent_form').notNull(),
  fitness: integer('fitness').notNull(),
  injuryType: text('injury_type'),
  injuryDaysRemaining: integer('injury_days_remaining'),
  injurySeverity: text('injury_severity'),
  // Contract — nullable since migration v6: NULL marks a free agent
  // (contract.clubId === null), who belongs to no club squad.
  clubId: text('club_id'),
  wage: integer('wage').notNull(),
  contractExpiryDate: integer('contract_expiry_date').notNull(),
  marketValue: integer('market_value').notNull(),
});

export const clubs = sqliteTable('clubs', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  nickname: text('nickname').notNull(),
  foundedYear: integer('founded_year').notNull(),
  reputation: integer('reputation').notNull(),
  // Finances
  balance: integer('balance').notNull(),
  transferBudget: integer('transfer_budget').notNull(),
  wageBudget: integer('wage_budget').notNull(),
  weeklyIncome: integer('weekly_income').notNull(),
  debt: integer('debt').notNull().default(0),
  // Stadium
  stadiumName: text('stadium_name').notNull(),
  stadiumCapacity: integer('stadium_capacity').notNull(),
  // Tactics
  defaultFormation: text('default_formation').notNull(),
  mentality: text('mentality').notNull(),
  pressingIntensity: integer('pressing_intensity').notNull(),
  tempo: integer('tempo').notNull(),
  width: integer('width').notNull(),
});

export const leagues = sqliteTable('leagues', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  tier: integer('tier').notNull(),
  clubIds: text('club_ids').notNull(),
});

export const leagueStandings = sqliteTable('league_standings', {
  id: text('id').primaryKey(),
  leagueId: text('league_id').notNull(),
  clubId: text('club_id').notNull(),
  played: integer('played').notNull(),
  won: integer('won').notNull(),
  drawn: integer('drawn').notNull(),
  lost: integer('lost').notNull(),
  goalsFor: integer('goals_for').notNull(),
  goalsAgainst: integer('goals_against').notNull(),
  goalDifference: integer('goal_difference').notNull(),
  points: integer('points').notNull(),
});

export const fixtures = sqliteTable('fixtures', {
  id: text('id').primaryKey(),
  leagueId: text('league_id').notNull(),
  homeClubId: text('home_club_id').notNull(),
  awayClubId: text('away_club_id').notNull(),
  week: integer('week').notNull(),
  date: integer('date').notNull(),
  played: integer('played').notNull(),
  homeScore: integer('home_score'),
  awayScore: integer('away_score'),
});

export const seasons = sqliteTable('seasons', {
  id: text('id').primaryKey(),
  leagueId: text('league_id').notNull(),
  currentWeek: integer('current_week').notNull(),
  currentDate: integer('current_date').notNull(),
  transferWindowOpen: integer('transfer_window_open').notNull(),
});

export const matches = sqliteTable('matches', {
  id: text('id').primaryKey(),
  homeClubId: text('home_club_id').notNull(),
  awayClubId: text('away_club_id').notNull(),
  seasonId: text('season_id').notNull(),
  date: integer('date').notNull(),
  status: text('status').notNull(),
  homeScore: integer('home_score'),
  awayScore: integer('away_score'),
  homeTactics: text('home_tactics').notNull(),
  awayTactics: text('away_tactics').notNull(),
  // Added by migration v3 — nullable: rows written before v3 have no
  // recorded values and must never be backfilled with invented data.
  fixtureId: text('fixture_id'),
  stats: text('stats'),
  seed: integer('seed'),
  participantIds: text('participant_ids'),
});

export const matchEvents = sqliteTable('match_events', {
  id: text('id').primaryKey(),
  matchId: text('match_id').notNull(),
  minute: integer('minute').notNull(),
  type: text('type').notNull(),
  playerId: text('player_id'),
  // Added by migration v3 — nullable for pre-v3 rows.
  secondaryPlayerId: text('secondary_player_id'),
  clubId: text('club_id').notNull(),
  description: text('description').notNull(),
});

export const transfers = sqliteTable('transfers', {
  id: text('id').primaryKey(),
  playerId: text('player_id').notNull(),
  fromClubId: text('from_club_id').notNull(),
  toClubId: text('to_club_id').notNull(),
  fee: integer('fee').notNull(),
  type: text('type').notNull(),
  date: integer('date').notNull(),
  status: text('status').notNull(),
});

export const transferOffers = sqliteTable('transfer_offers', {
  id: text('id').primaryKey(),
  playerId: text('player_id').notNull(),
  buyingClubId: text('buying_club_id').notNull(),
  sellingClubId: text('selling_club_id').notNull(),
  offerAmount: integer('offer_amount').notNull(),
  status: text('status').notNull(),
  createdAt: integer('created_at').notNull(),
  resolvedAt: integer('resolved_at'),
});

export const career = sqliteTable('career', {
  id: text('id').primaryKey(),
  managerName: text('manager_name').notNull(),
  managedClubId: text('managed_club_id').notNull(),
  createdAt: integer('created_at').notNull(),
  lastPlayedAt: integer('last_played_at').notNull(),
  schemaVersion: integer('schema_version').notNull(),
});

/**
 * Season objectives (Phase 2E.3d): one row per club per season.
 * target_position/reward_amount/ambition are fixed at season creation;
 * settlement columns stay NULL until the end-of-season settlement.
 * sanction records deferred consequences only — nothing is executed
 * while the manager-career and divisions systems do not exist.
 */
export const seasonObjectives = sqliteTable('season_objectives', {
  seasonId: text('season_id').notNull(),
  clubId: text('club_id').notNull(),
  targetPosition: integer('target_position').notNull(),
  rewardAmount: integer('reward_amount').notNull(),
  ambition: text('ambition').notNull(),
  objectiveMet: integer('objective_met'),
  rewardPaid: integer('reward_paid').notNull().default(0),
  debtRemaining: integer('debt_remaining'),
  settledAt: integer('settled_at'),
  sanction: text('sanction').notNull().default('none'),
}, (table) => ({
  pk: primaryKey({ columns: [table.seasonId, table.clubId] }),
}));

export const schemaMigrations = sqliteTable('schema_migrations', {
  version: integer('version').primaryKey(),
  name: text('name').notNull(),
  appliedAt: integer('applied_at').notNull(),
});
