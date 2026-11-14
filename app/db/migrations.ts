import { getTableColumns, getTableName } from 'drizzle-orm';
import * as schema from './schema';

/**
 * Database migration framework.
 *
 * Versioning model:
 * - BASELINE_SCHEMA_VERSION (1) is the schema created by the original
 *   CREATE TABLE statements below. Every database that existed before this
 *   framework — fresh or holding a saved career — already matches it.
 * - MIGRATIONS contains ordered upgrades; each entry migrates the database
 *   TO its `version`. The latest supported version is derived from the list.
 * - Applied versions are recorded in the `schema_migrations` table inside
 *   the same transaction as the migration itself, so a failed migration
 *   never marks itself applied and is retried on the next launch.
 *
 * This is intentionally separate from `career.schemaVersion`, which tracks
 * the career-save payload format, not the database schema.
 */

export const BASELINE_SCHEMA_VERSION = 1;

export interface Migration {
  /** Version this migration upgrades the database TO. Must be > baseline, unique, ascending. */
  version: number;
  name: string;
  /**
   * Synchronous upgrade routine. Receives the Drizzle transaction object;
   * use tx.run('...') for DDL/DML. Must NOT be async — the drivers are
   * synchronous and an async callback would escape the transaction.
   */
  up: (tx: any) => void;
}

/**
 * Ordered schema migrations. Add new entries here for future schema changes;
 * never modify an already-applied migration.
 */
export const MIGRATIONS: Migration[] = [
  {
    version: 2,
    name: 'create-transfer-offers-table',
    up: (tx) => {
      tx.run(`
        CREATE TABLE transfer_offers (
          id TEXT PRIMARY KEY,
          player_id TEXT NOT NULL,
          buying_club_id TEXT NOT NULL,
          selling_club_id TEXT NOT NULL,
          offer_amount INTEGER NOT NULL,
          status TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          resolved_at INTEGER
        )
      `);
    },
  },
  {
    version: 3,
    name: 'add-match-persistence-columns',
    up: (tx) => {
      // Lossless match persistence (Phase 2C). All columns are nullable:
      // ALTER TABLE cannot add NOT NULL columns to a non-empty table, and
      // pre-v3 rows have no recorded values — they must stay NULL rather
      // than receive invented stats, seeds, fixture ids or participant
      // lists. No UNIQUE constraint on fixture_id: fixture ids are only
      // unique within a league/season context, and matches.id (PK)
      // already encodes the (league, season, fixture) tuple.
      tx.run('ALTER TABLE matches ADD COLUMN fixture_id TEXT');
      tx.run('ALTER TABLE matches ADD COLUMN stats TEXT');
      tx.run('ALTER TABLE matches ADD COLUMN seed INTEGER');
      tx.run('ALTER TABLE matches ADD COLUMN participant_ids TEXT');
      tx.run('ALTER TABLE match_events ADD COLUMN secondary_player_id TEXT');
      // Join key used when loading events for a match.
      tx.run(
        'CREATE INDEX idx_match_events_match_id ON match_events(match_id)',
      );
      // Season-scoped fixture lookup is the real query pattern; a
      // composite index serves it without assuming fixture-id uniqueness.
      tx.run(
        'CREATE INDEX idx_matches_season_fixture ON matches(season_id, fixture_id)',
      );
    },
  },
  {
    version: 4,
    name: 'add-club-debt-column',
    up: (tx) => {
      // Weekly economy (Phase 2E.3a): clubs can carry outstanding debt.
      // NOT NULL DEFAULT 0 backfills every existing club with zero debt —
      // pre-economy careers never accumulated any.
      tx.run(
        'ALTER TABLE clubs ADD COLUMN debt INTEGER NOT NULL DEFAULT 0',
      );
    },
  },
  {
    version: 5,
    name: 'add-season-objectives',
    up: (tx) => {
      // Season objectives (Phase 2E.3d): one row per club per season.
      // target_position/reward_amount/ambition are fixed at season
      // creation; settlement columns stay NULL until end-of-season
      // settlement runs exactly once inside the rollover transaction.
      // sanction only records deferred consequences — no dismissal or
      // relegation is executed while those systems do not exist.
      // CHECK constraints enforce the domain invariants the Drizzle
      // schema cannot express; existing tables carry none, but the
      // objective values are closed enums and bounded integers where a
      // malformed row would corrupt financial settlement.
      tx.run(`
        CREATE TABLE season_objectives (
          season_id TEXT NOT NULL,
          club_id TEXT NOT NULL,
          target_position INTEGER NOT NULL CHECK (target_position > 0),
          reward_amount INTEGER NOT NULL CHECK (reward_amount >= 0),
          ambition TEXT NOT NULL CHECK (ambition IN (
            'title_favorite', 'title_contender', 'upper_table',
            'mid_table', 'progression', 'survival'
          )),
          objective_met INTEGER
            CHECK (objective_met IS NULL OR objective_met IN (0, 1)),
          reward_paid INTEGER NOT NULL DEFAULT 0 CHECK (reward_paid >= 0),
          debt_remaining INTEGER
            CHECK (debt_remaining IS NULL OR debt_remaining >= 0),
          settled_at INTEGER,
          sanction TEXT NOT NULL DEFAULT 'none' CHECK (sanction IN (
            'none', 'dismissal_relegation_pending'
          )),
          PRIMARY KEY (season_id, club_id)
        )
      `);
    },
  },
];

/** Latest schema version supported by this build of the app. */
export const SCHEMA_VERSION = Math.max(
  BASELINE_SCHEMA_VERSION,
  ...MIGRATIONS.map((m) => m.version),
);

const SCHEMA_MIGRATIONS_DDL = `
  CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    applied_at INTEGER NOT NULL
  )
`;

/**
 * Baseline (version 1) schema. Idempotent CREATE TABLE IF NOT EXISTS
 * statements, safe to run on both fresh and pre-existing databases.
 */
export const BASELINE_SCHEMA_STATEMENTS: string[] = [
  `
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
  `,
  `
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
  `,
  `
    CREATE TABLE IF NOT EXISTS leagues (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      tier INTEGER NOT NULL,
      club_ids TEXT NOT NULL
    )
  `,
  `
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
  `,
  `
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
  `,
  `
    CREATE TABLE IF NOT EXISTS seasons (
      id TEXT PRIMARY KEY,
      league_id TEXT NOT NULL,
      current_week INTEGER NOT NULL,
      current_date INTEGER NOT NULL,
      transfer_window_open INTEGER NOT NULL
    )
  `,
  `
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
  `,
  `
    CREATE TABLE IF NOT EXISTS match_events (
      id TEXT PRIMARY KEY,
      match_id TEXT NOT NULL,
      minute INTEGER NOT NULL,
      type TEXT NOT NULL,
      player_id TEXT,
      club_id TEXT NOT NULL,
      description TEXT NOT NULL
    )
  `,
  `
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
  `,
  `
    CREATE TABLE IF NOT EXISTS career (
      id TEXT PRIMARY KEY,
      manager_name TEXT NOT NULL,
      managed_club_id TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      last_played_at INTEGER NOT NULL,
      schema_version INTEGER NOT NULL
    )
  `,
];

/** Drizzle tables that make up the baseline (version 1) schema. */
const LEGACY_BASELINE_TABLES = [
  schema.players,
  schema.clubs,
  schema.leagues,
  schema.leagueStandings,
  schema.fixtures,
  schema.seasons,
  schema.matches,
  schema.matchEvents,
  schema.transfers,
  schema.career,
];

/**
 * Frozen snapshot of the column names each baseline table had at schema
 * version 1. This is deliberately NOT derived from schema.ts: schema.ts
 * describes the CURRENT schema, which gains columns via migrations (e.g.
 * v3 added columns to matches/match_events). A pre-framework legacy
 * database only ever had the v1 columns, so validating it against the
 * current Drizzle definitions would wrongly reject a compatible career
 * database. The baseline schema is immutable by definition, so this
 * snapshot is safe to hardcode; it must only change if a NEW baseline is
 * ever introduced (which would be a new framework, not an edit here).
 */
const BASELINE_V1_COLUMNS: Record<string, string[]> = {
  players: [
    'id', 'first_name', 'last_name', 'nationality', 'age',
    'preferred_foot', 'primary_position', 'secondary_positions',
    'passing', 'shooting', 'dribbling', 'tackling', 'heading', 'crossing',
    'finishing', 'technique', 'long_shots', 'free_kicks', 'first_touch',
    'vision', 'decisions', 'composure', 'anticipation', 'positioning',
    'work_rate', 'determination', 'leadership', 'concentration', 'flair',
    'pace', 'acceleration', 'stamina', 'strength', 'agility', 'balance',
    'jumping', 'natural_fitness', 'current_ability', 'potential_ability',
    'age_growth_curve', 'morale', 'recent_form', 'fitness', 'injury_type',
    'injury_days_remaining', 'injury_severity', 'club_id', 'wage',
    'contract_expiry_date', 'market_value',
  ],
  clubs: [
    'id', 'name', 'nickname', 'founded_year', 'reputation', 'balance',
    'transfer_budget', 'wage_budget', 'weekly_income', 'stadium_name',
    'stadium_capacity', 'default_formation', 'mentality',
    'pressing_intensity', 'tempo', 'width',
  ],
  leagues: ['id', 'name', 'tier', 'club_ids'],
  league_standings: [
    'id', 'league_id', 'club_id', 'played', 'won', 'drawn', 'lost',
    'goals_for', 'goals_against', 'goal_difference', 'points',
  ],
  fixtures: [
    'id', 'league_id', 'home_club_id', 'away_club_id', 'week', 'date',
    'played', 'home_score', 'away_score',
  ],
  seasons: [
    'id', 'league_id', 'current_week', 'current_date',
    'transfer_window_open',
  ],
  matches: [
    'id', 'home_club_id', 'away_club_id', 'season_id', 'date', 'status',
    'home_score', 'away_score', 'home_tactics', 'away_tactics',
  ],
  match_events: [
    'id', 'match_id', 'minute', 'type', 'player_id', 'club_id',
    'description',
  ],
  transfers: [
    'id', 'player_id', 'from_club_id', 'to_club_id', 'fee', 'type',
    'date', 'status',
  ],
  career: [
    'id', 'manager_name', 'managed_club_id', 'created_at', 'last_played_at',
    'schema_version',
  ],
};

function ensureSchemaMigrationsTable(dbInstance: any): void {
  dbInstance.run(SCHEMA_MIGRATIONS_DDL);
}

/** Names of all user tables, excluding SQLite internals and our metadata table. */
function getUserTableNames(dbInstance: any): string[] {
  const rows = dbInstance.all(
    "SELECT name FROM sqlite_master WHERE type = 'table' " +
      "AND name NOT LIKE 'sqlite_%' AND name != 'schema_migrations'",
  ) as any[];
  return rows.map((row) => row.name as string);
}

/** Read-only existence check against sqlite_master. */
function tableExists(dbInstance: any, tableName: string): boolean {
  const rows = dbInstance.all(
    `SELECT name FROM sqlite_master WHERE type = 'table' AND name = '${tableName}'`,
  ) as any[];
  return rows.length > 0;
}

/**
 * Validate the structure of an existing schema_migrations table before any
 * migration runs. A malformed metadata table must fail explicitly rather
 * than silently resetting migration state. Column names are derived from the
 * Drizzle schema so schema.ts remains the single source of truth.
 */
function validateSchemaMigrationsTable(dbInstance: any): void {
  const columnRows = dbInstance.all(
    "PRAGMA table_info('schema_migrations')",
  ) as any[];
  const actualColumns = new Set(columnRows.map((row) => row.name as string));
  const expectedColumns = Object.values(
    getTableColumns(schema.schemaMigrations),
  ).map((column) => column.name);
  const missingColumns = expectedColumns.filter(
    (name) => !actualColumns.has(name),
  );
  if (missingColumns.length > 0) {
    throw new Error(
      'Incompatible schema_migrations table — missing columns: ' +
        missingColumns.join(', '),
    );
  }
}

/**
 * Validate that a database with NO migration metadata is a compatible
 * version-1 legacy database before the baseline version is recorded.
 *
 * Every baseline table must exist and contain every column it had at
 * schema version 1 (see BASELINE_V1_COLUMNS — a frozen snapshot, NOT the
 * current Drizzle schema, so columns added by later migrations do not
 * make a valid legacy database look incompatible). Extra columns are
 * tolerated; missing tables or columns mean the database is partial or
 * incompatible — in that case we throw WITHOUT creating missing tables,
 * recording a version, or touching any existing data.
 */
function validateLegacySchema(dbInstance: any): void {
  const problems: string[] = [];

  for (const table of LEGACY_BASELINE_TABLES) {
    const tableName = getTableName(table);
    const tableRows = dbInstance.all(
      `SELECT name FROM sqlite_master WHERE type = 'table' AND name = '${tableName}'`,
    ) as any[];
    if (tableRows.length === 0) {
      problems.push(`missing table '${tableName}'`);
      continue;
    }

    const columnRows = dbInstance.all(
      `PRAGMA table_info('${tableName}')`,
    ) as any[];
    const actualColumns = new Set(columnRows.map((row) => row.name as string));
    const expectedColumns = BASELINE_V1_COLUMNS[tableName] ?? [];
    if (expectedColumns.length === 0) {
      problems.push(`no baseline column snapshot for table '${tableName}'`);
      continue;
    }
    const missingColumns = expectedColumns.filter(
      (name) => !actualColumns.has(name),
    );
    if (missingColumns.length > 0) {
      problems.push(
        `table '${tableName}' is missing columns: ${missingColumns.join(', ')}`,
      );
    }
  }

  if (problems.length > 0) {
    throw new Error(
      'Incompatible legacy database schema — refusing to mark it as ' +
        `version ${BASELINE_SCHEMA_VERSION}: ${problems.join('; ')}`,
    );
  }
}

function getAppliedVersions(dbInstance: any): number[] {
  const rows = dbInstance.select().from(schema.schemaMigrations).all() as any[];
  return rows.map((row) => row.version as number);
}

function recordVersion(
  dbInstance: any,
  version: number,
  name: string,
): void {
  dbInstance.insert(schema.schemaMigrations).values({
    version,
    name,
    appliedAt: Date.now(),
  }).run();
}

/**
 * Throw if the database was written by a newer app version than this build
 * supports. Checked before any schema changes so a downgrade cannot touch
 * an unknown schema.
 */
function assertSupportedSchemaVersion(dbInstance: any): void {
  const applied = getAppliedVersions(dbInstance);
  if (applied.length === 0) {
    return; // Fresh or legacy database — handled by runMigrations.
  }
  const current = Math.max(...applied);
  if (current > SCHEMA_VERSION) {
    throw new Error(
      `Database schema version ${current} is newer than the latest supported ` +
        `version ${SCHEMA_VERSION}. Please upgrade the app.`,
    );
  }
}

/**
 * Validate that recorded migration history is consistent with the migration
 * definitions in this build. Rejects:
 * - duplicate recorded versions
 * - histories missing the baseline record
 * - recorded versions that are not defined migrations in this build
 *   (unknown lineage — distinct from simply being newer, which is handled
 *   by the future-version check)
 * - gaps: defined migrations at or below the recorded head version that were
 *   never applied (e.g. records [1, 3] with migration 2 defined but missing)
 */
function validateMigrationHistory(
  applied: number[],
  ordered: Migration[],
): void {
  const counts = new Map<number, number>();
  for (const version of applied) {
    counts.set(version, (counts.get(version) ?? 0) + 1);
  }
  const duplicates = [...counts.entries()]
    .filter(([, count]) => count > 1)
    .map(([version]) => version);
  if (duplicates.length > 0) {
    throw new Error(
      `Inconsistent migration history: duplicate recorded versions: ${duplicates.join(', ')}`,
    );
  }

  if (!applied.includes(BASELINE_SCHEMA_VERSION)) {
    throw new Error(
      'Inconsistent migration history: baseline version ' +
        `${BASELINE_SCHEMA_VERSION} is not recorded`,
    );
  }

  const currentVersion = Math.max(...applied);
  const definedVersions = new Set(ordered.map((m) => m.version));

  for (const version of applied) {
    if (version === BASELINE_SCHEMA_VERSION) continue;
    if (!definedVersions.has(version)) {
      throw new Error(
        `Inconsistent migration history: recorded version ${version} does ` +
          'not match any migration defined by this build',
      );
    }
  }

  for (const migration of ordered) {
    if (
      migration.version <= currentVersion &&
      !applied.includes(migration.version)
    ) {
      throw new Error(
        `Inconsistent migration history: migration ${migration.version} ` +
          `('${migration.name}') is not recorded but the database reports ` +
          `version ${currentVersion}`,
      );
    }
  }
}

/**
 * Validate migration definitions before they are allowed to touch a
 * database: every version must be an integer greater than the baseline,
 * versions must be unique, and they must be contiguous starting at
 * BASELINE_SCHEMA_VERSION + 1 (a gapped list like [2, 4] could let a
 * database legitimately report version 4 while version 3's changes were
 * silently skipped).
 *
 * Returns the definitions sorted ascending by version. Throws on any
 * invalid definition — callers must invoke this before performing writes.
 */
function validateMigrationDefinitions(migrations: Migration[]): Migration[] {
  const ordered = [...migrations].sort((a, b) => a.version - b.version);
  const seen = new Set<number>();
  for (const migration of ordered) {
    if (
      !Number.isInteger(migration.version) ||
      migration.version <= BASELINE_SCHEMA_VERSION
    ) {
      throw new Error(
        `Invalid migration '${migration.name}': version must be an integer ` +
          `greater than ${BASELINE_SCHEMA_VERSION}`,
      );
    }
    if (seen.has(migration.version)) {
      throw new Error(`Duplicate migration version ${migration.version}`);
    }
    seen.add(migration.version);
  }
  ordered.forEach((migration, index) => {
    const expected = BASELINE_SCHEMA_VERSION + 1 + index;
    if (migration.version !== expected) {
      throw new Error(
        'Invalid migration definitions: versions must be contiguous ' +
          `integers starting at ${BASELINE_SCHEMA_VERSION + 1}; expected ` +
          `version ${expected} but '${migration.name}' declares ` +
          `${migration.version}`,
      );
    }
  });
  return ordered;
}

/**
 * Apply pending migrations in ascending version order.
 *
 * - Databases with no migration metadata (fresh after baseline DDL, or legacy
 *   careers from before this framework) are recorded at BASELINE_SCHEMA_VERSION
 *   without touching game data — the baseline schema is identical.
 * - Each migration runs in its own transaction together with its version
 *   record, so it is applied exactly once and a failure rolls back cleanly.
 * - `migrations` defaults to the production MIGRATIONS list; it is a parameter
 *   so tests can exercise the runner with controlled migrations.
 */
export function runMigrations(
  dbInstance: any,
  migrations: Migration[] = MIGRATIONS,
): void {
  const ordered = validateMigrationDefinitions(migrations);
  const latestVersion = Math.max(
    BASELINE_SCHEMA_VERSION,
    ...ordered.map((m) => m.version),
  );

  ensureSchemaMigrationsTable(dbInstance);
  const applied = getAppliedVersions(dbInstance);
  const currentVersion =
    applied.length > 0 ? Math.max(...applied) : BASELINE_SCHEMA_VERSION;

  if (currentVersion > latestVersion) {
    throw new Error(
      `Database schema version ${currentVersion} is newer than the latest ` +
        `supported version ${latestVersion}. Please upgrade the app.`,
    );
  }

  if (applied.length > 0) {
    // Reject gapped, duplicated, or unknown migration histories instead of
    // silently treating Math.max(applied) as the current version.
    validateMigrationHistory(applied, ordered);
  }

  if (applied.length === 0) {
    // No migration metadata: either a fresh database (baseline DDL was applied
    // by initializeDatabaseSchema) or a legacy database created before this
    // framework existed. Both already match the baseline schema, so record
    // version 1 without modifying any game data.
    recordVersion(dbInstance, BASELINE_SCHEMA_VERSION, 'baseline-schema');
  }

  for (const migration of ordered) {
    if (migration.version <= currentVersion) {
      continue; // Already applied — never rerun.
    }
    dbInstance.transaction((tx: any) => {
      migration.up(tx);
      tx.insert(schema.schemaMigrations).values({
        version: migration.version,
        name: migration.name,
        appliedAt: Date.now(),
      }).run();
    });
  }
}

/**
 * Full database initialization.
 *
 * Ordering guarantee: every inspection below is READ-ONLY (sqlite_master /
 * PRAGMA queries). No table is created and no data is touched until the
 * database has been classified and — for legacy databases — fully validated.
 * A rejected database is left byte-for-byte unchanged, including the absence
 * of the schema_migrations table.
 *
 * Classification:
 * - No schema_migrations, no user tables      → fresh database.
 * - No schema_migrations, user tables present → legacy database: validate the
 *   complete baseline schema BEFORE creating schema_migrations; on failure
 *   throw without mutating anything.
 * - schema_migrations present                → migrated database: validate the
 *   metadata table structure, then the future-version check, then migrations.
 */
export function initializeDatabaseSchema(
  dbInstance: any,
  migrations: Migration[] = MIGRATIONS,
): void {
  // Reject invalid migration definitions before ANY database access —
  // no metadata table, no baseline DDL, no version records, no migration
  // SQL may run for a build with a broken migration list.
  validateMigrationDefinitions(migrations);

  const hasMigrationsTable = tableExists(dbInstance, 'schema_migrations');
  const userTableNames = getUserTableNames(dbInstance);

  if (!hasMigrationsTable) {
    if (userTableNames.length > 0) {
      // Legacy (or partial/incompatible) database. CREATE TABLE IF NOT EXISTS
      // does not validate existing tables, so an incompatible schema must
      // fail here — before schema_migrations or anything else is created.
      validateLegacySchema(dbInstance);
    }
    // Fresh database, or a validated legacy one: now safe to create the
    // migration metadata table.
    ensureSchemaMigrationsTable(dbInstance);
  } else {
    validateSchemaMigrationsTable(dbInstance);
  }

  assertSupportedSchemaVersion(dbInstance);

  // Baseline schema in one transaction. All statements are idempotent
  // CREATE TABLE IF NOT EXISTS; on a validated legacy database they are
  // no-ops, on a fresh database they create the version-1 schema.
  dbInstance.transaction((tx: any) => {
    for (const statement of BASELINE_SCHEMA_STATEMENTS) {
      tx.run(statement);
    }
  });

  runMigrations(dbInstance, migrations);
}
