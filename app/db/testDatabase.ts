import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema';

let testDbInstance: any = null;
let sqliteInstance: Database.Database | null = null;

export function getTestDatabase() {
  if (!testDbInstance) {
    // Create an in-memory SQLite database for testing
    sqliteInstance = new Database(':memory:');
    testDbInstance = drizzle(sqliteInstance, { schema });

    // Initialize schema
    initializeTestSchema(sqliteInstance);
  }
  return testDbInstance;
}

function initializeTestSchema(sqlite: Database.Database) {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS players (
      id TEXT PRIMARY KEY,
      first_name TEXT NOT NULL,
      last_name TEXT NOT NULL,
      nationality TEXT NOT NULL,
      age INTEGER NOT NULL,
      preferred_foot TEXT NOT NULL,
      primary_position TEXT NOT NULL,
      secondary_positions TEXT NOT NULL,
      passing INTEGER NOT NULL,
      shooting INTEGER NOT NULL,
      dribbling INTEGER NOT NULL,
      tackling INTEGER NOT NULL,
      heading INTEGER NOT NULL,
      crossing INTEGER NOT NULL,
      finishing INTEGER NOT NULL,
      technique INTEGER NOT NULL,
      long_shots INTEGER NOT NULL,
      free_kicks INTEGER NOT NULL,
      first_touch INTEGER NOT NULL,
      vision INTEGER NOT NULL,
      decisions INTEGER NOT NULL,
      composure INTEGER NOT NULL,
      anticipation INTEGER NOT NULL,
      positioning INTEGER NOT NULL,
      work_rate INTEGER NOT NULL,
      determination INTEGER NOT NULL,
      leadership INTEGER NOT NULL,
      concentration INTEGER NOT NULL,
      flair INTEGER NOT NULL,
      pace INTEGER NOT NULL,
      acceleration INTEGER NOT NULL,
      stamina INTEGER NOT NULL,
      strength INTEGER NOT NULL,
      agility INTEGER NOT NULL,
      balance INTEGER NOT NULL,
      jumping INTEGER NOT NULL,
      natural_fitness INTEGER NOT NULL,
      current_ability INTEGER NOT NULL,
      potential_ability INTEGER NOT NULL,
      age_growth_curve TEXT NOT NULL,
      morale INTEGER NOT NULL,
      recent_form TEXT NOT NULL,
      fitness INTEGER NOT NULL,
      injury_type TEXT,
      injury_days_remaining INTEGER,
      injury_severity TEXT,
      club_id TEXT NOT NULL,
      wage INTEGER NOT NULL,
      contract_expiry_date INTEGER NOT NULL,
      market_value INTEGER NOT NULL
    )
  `);

  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS clubs (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      nickname TEXT NOT NULL,
      founded_year INTEGER NOT NULL,
      reputation INTEGER NOT NULL,
      balance INTEGER NOT NULL,
      transfer_budget INTEGER NOT NULL,
      wage_budget INTEGER NOT NULL,
      weekly_income INTEGER NOT NULL,
      stadium_name TEXT NOT NULL,
      stadium_capacity INTEGER NOT NULL,
      default_formation TEXT NOT NULL,
      mentality TEXT NOT NULL,
      pressing_intensity INTEGER NOT NULL,
      tempo INTEGER NOT NULL,
      width INTEGER NOT NULL
    )
  `);

  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS leagues (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      tier INTEGER NOT NULL,
      club_ids TEXT NOT NULL
    )
  `);

  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS league_standings (
      id TEXT PRIMARY KEY,
      league_id TEXT NOT NULL,
      club_id TEXT NOT NULL,
      played INTEGER NOT NULL,
      won INTEGER NOT NULL,
      drawn INTEGER NOT NULL,
      lost INTEGER NOT NULL,
      goals_for INTEGER NOT NULL,
      goals_against INTEGER NOT NULL,
      goal_difference INTEGER NOT NULL,
      points INTEGER NOT NULL
    )
  `);

  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS fixtures (
      id TEXT PRIMARY KEY,
      league_id TEXT NOT NULL,
      home_club_id TEXT NOT NULL,
      away_club_id TEXT NOT NULL,
      week INTEGER NOT NULL,
      date INTEGER NOT NULL,
      played INTEGER NOT NULL,
      home_score INTEGER,
      away_score INTEGER
    )
  `);

  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS seasons (
      id TEXT PRIMARY KEY,
      league_id TEXT NOT NULL,
      current_week INTEGER NOT NULL,
      current_date INTEGER NOT NULL,
      transfer_window_open INTEGER NOT NULL
    )
  `);

  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS matches (
      id TEXT PRIMARY KEY,
      home_club_id TEXT NOT NULL,
      away_club_id TEXT NOT NULL,
      season_id TEXT NOT NULL,
      date INTEGER NOT NULL,
      status TEXT NOT NULL,
      home_score INTEGER,
      away_score INTEGER,
      home_tactics TEXT NOT NULL,
      away_tactics TEXT NOT NULL
    )
  `);

  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS match_events (
      id TEXT PRIMARY KEY,
      match_id TEXT NOT NULL,
      minute INTEGER NOT NULL,
      type TEXT NOT NULL,
      player_id TEXT,
      club_id TEXT NOT NULL,
      description TEXT NOT NULL
    )
  `);

  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS transfers (
      id TEXT PRIMARY KEY,
      player_id TEXT NOT NULL,
      from_club_id TEXT NOT NULL,
      to_club_id TEXT NOT NULL,
      fee INTEGER NOT NULL,
      type TEXT NOT NULL,
      date INTEGER NOT NULL,
      status TEXT NOT NULL
    )
  `);

  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS career (
      id TEXT PRIMARY KEY,
      manager_name TEXT NOT NULL,
      managed_club_id TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      last_played_at INTEGER NOT NULL,
      schema_version INTEGER NOT NULL
    )
  `);
}

export function resetTestDatabase() {
  if (sqliteInstance) {
    sqliteInstance.exec('DROP TABLE IF EXISTS players');
    sqliteInstance.exec('DROP TABLE IF EXISTS clubs');
    sqliteInstance.exec('DROP TABLE IF EXISTS leagues');
    sqliteInstance.exec('DROP TABLE IF EXISTS league_standings');
    sqliteInstance.exec('DROP TABLE IF EXISTS fixtures');
    sqliteInstance.exec('DROP TABLE IF EXISTS seasons');
    sqliteInstance.exec('DROP TABLE IF EXISTS matches');
    sqliteInstance.exec('DROP TABLE IF EXISTS match_events');
    sqliteInstance.exec('DROP TABLE IF EXISTS transfers');
    sqliteInstance.exec('DROP TABLE IF EXISTS career');
    initializeTestSchema(sqliteInstance);
  }
}
