import Database from 'better-sqlite3';
import { getTableColumns, getTableName } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema';
import {
  initializeDatabaseSchema,
  MIGRATIONS,
  runMigrations,
  type Migration,
} from './migrations';
import { saveCareer, loadCareer } from './careerPersistence';
import { generateSeedData } from '@club-director/engine';
import type { League, Season } from '@club-director/shared-types';

/**
 * Historical (pre-migration-framework) DDL, copied verbatim from the
 * initializeDatabase() implementation that shipped before migrations
 * existed. This fixture is intentionally INDEPENDENT of
 * BASELINE_SCHEMA_STATEMENTS so the legacy-compatibility tests validate
 * against the real historical schema, not the implementation under test.
 */
const LEGACY_SCHEMA_STATEMENTS: string[] = [
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

/** Fresh in-memory SQLite + Drizzle, without any preset schema. */
function createRawDb() {
  const sqlite = new Database(':memory:');
  const db = drizzle(sqlite, { schema });
  return { db, sqlite };
}

/** Database shaped like one created by the pre-migration app version. */
function createLegacyDb() {
  const raw = createRawDb();
  for (const statement of LEGACY_SCHEMA_STATEMENTS) {
    raw.db.run(statement);
  }
  return raw;
}

/**
 * season_objectives DDL identical to migration v5. saveCareer() targets
 * the current schema, so tests simulating a pre-v5 database create the
 * table temporarily, save through the real path, then drop it — exactly
 * like the transfer_offers/debt workaround in the legacy test below.
 */
const SEASON_OBJECTIVES_DDL = `
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
`;

function tableExists(sqlite: Database.Database, name: string): boolean {
  return !!sqlite
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?")
    .get(name);
}

function appliedVersions(db: any): number[] {
  return (db.select().from(schema.schemaMigrations).all() as any[])
    .map((r) => r.version)
    .sort((a: number, b: number) => a - b);
}

function buildCareerState(managerName: string, leagueName: string, seed: number) {
  const seedData = generateSeedData(seed);
  const clubs = seedData.clubs.slice(0, 2);
  const players = seedData.players.filter((p) =>
    clubs.some((c) => c.squad.includes(p.id)),
  );
  const league: League = {
    id: 'league-1',
    name: leagueName,
    tier: 1,
    clubIds: clubs.map((c) => c.id),
    standings: { entries: [] },
    fixtures: [],
  };
  const season: Season = {
    id: 'season-1',
    leagueId: 'league-1',
    currentWeek: 1,
    currentDate: new Date('2024-08-01'),
    transferWindowOpen: true,
    fixturesCalendar: [],
  };
  return {
    career: {
      id: 'active',
      managerName,
      managedClubId: clubs[0].id,
      createdAt: new Date('2024-08-01'),
      lastPlayedAt: new Date(),
      schemaVersion: 1,
    },
    clubs,
    players,
    league,
    season,
    transferHistory: [],
    transferOffers: [],
    seasonObjectives: [],
  };
}

describe('database migrations', () => {
  it('initializes a fresh database directly to the latest schema', () => {
    const { db, sqlite } = createRawDb();

    initializeDatabaseSchema(db);

    // All baseline tables exist, plus the v2 transfer_offers table.
    ['players', 'clubs', 'leagues', 'league_standings', 'fixtures',
     'seasons', 'matches', 'match_events', 'transfers', 'career',
     'transfer_offers', 'schema_migrations'].forEach((t) =>
      expect(tableExists(sqlite, t)).toBe(true));

    // Baseline + migrations v2 through v4 recorded exactly once each.
    expect(appliedVersions(db)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('detects a compatible legacy database and preserves career data', async () => {
    const { db, sqlite } = createLegacyDb();

    // saveCareer() writes the v2 transfer_offers table and the v4 clubs.debt
    // column, which a genuine v1 database has neither of. Temporarily create
    // them, populate the career with the real save path, then drop them —
    // leaving the database in the exact historical v1 shape plus realistic
    // career data.
    db.run(`
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
    db.run('ALTER TABLE clubs ADD COLUMN debt INTEGER NOT NULL DEFAULT 0');
    db.run(SEASON_OBJECTIVES_DDL);
    const careerState = buildCareerState('Legacy Manager', 'Legacy League', 12345);
    await saveCareer(careerState, db);
    db.run('DROP TABLE transfer_offers');
    db.run('DROP TABLE season_objectives');
    db.run('ALTER TABLE clubs DROP COLUMN debt');

    const clubsBefore = sqlite.prepare('SELECT COUNT(*) AS c FROM clubs').get() as any;
    const playersBefore = sqlite.prepare('SELECT COUNT(*) AS c FROM players').get() as any;

    initializeDatabaseSchema(db);

    // Migration metadata established through v4; game data untouched.
    expect(appliedVersions(db)).toEqual([1, 2, 3, 4, 5, 6]);

    // The v3 match-persistence columns exist after migrating the legacy DB.
    const matchCols = sqlite
      .prepare('PRAGMA table_info(matches)')
      .all() as any[];
    expect(matchCols.map((c) => c.name)).toEqual(
      expect.arrayContaining([
        'fixture_id', 'stats', 'seed', 'participant_ids',
      ]),
    );
    const eventCols = sqlite
      .prepare('PRAGMA table_info(match_events)')
      .all() as any[];
    expect(eventCols.map((c) => c.name)).toContain('secondary_player_id');
    const clubsAfter = sqlite.prepare('SELECT COUNT(*) AS c FROM clubs').get() as any;
    const playersAfter = sqlite.prepare('SELECT COUNT(*) AS c FROM players').get() as any;
    expect(clubsAfter.c).toBe(clubsBefore.c);
    expect(playersAfter.c).toBe(playersBefore.c);

    // The v1 career loads with an empty offer collection.
    const loaded = await loadCareer(db);
    expect(loaded!.career.managerName).toBe('Legacy Manager');
    expect(loaded!.players.length).toBe(careerState.players.length);
    expect(loaded!.transferOffers).toEqual([]);

    // And offers now persist on the formerly-legacy career.
    const offer = {
      id: 'offer-1',
      playerId: careerState.players[0].id,
      buyingClubId: careerState.clubs[1].id,
      sellingClubId: careerState.clubs[0].id,
      offerAmount: 1_000_000,
      status: 'pending' as const,
      createdAt: new Date('2024-08-15'),
    };
    await saveCareer({ ...careerState, transferOffers: [offer] }, db);
    const reloaded = await loadCareer(db);
    expect(reloaded!.transferOffers).toHaveLength(1);
    expect(reloaded!.transferOffers![0].id).toBe('offer-1');
  });

  it('rejects a partially initialized legacy database without marking v1', () => {
    const { db, sqlite } = createRawDb();

    // Only the first five historical tables exist — an interrupted init.
    LEGACY_SCHEMA_STATEMENTS.slice(0, 5).forEach((s) => db.run(s));
    // Seed a row so we can prove data is preserved.
    db.insert(schema.leagues).values({
      id: 'league-1',
      name: 'Partial League',
      tier: 1,
      clubIds: '[]',
    }).run();

    expect(() => initializeDatabaseSchema(db)).toThrow(
      /Incompatible legacy database schema/,
    );
    expect(() => initializeDatabaseSchema(db)).toThrow(/missing table/);

    // Database left completely unchanged: no version marker, no metadata
    // table, existing data untouched, missing tables not created.
    expect(tableExists(sqlite, 'schema_migrations')).toBe(false);
    const row = sqlite
      .prepare('SELECT name FROM leagues WHERE id = ?')
      .get('league-1') as any;
    expect(row.name).toBe('Partial League');
    expect(tableExists(sqlite, 'career')).toBe(false);
    expect(tableExists(sqlite, 'transfers')).toBe(false);
  });

  it('rejects a legacy database missing a required table', () => {
    const { db, sqlite } = createRawDb();

    // All historical tables except 'transfers'.
    LEGACY_SCHEMA_STATEMENTS.filter((s) => !s.includes('transfers')).forEach(
      (s) => db.run(s),
    );
    db.insert(schema.leagues).values({
      id: 'league-1',
      name: 'Almost Complete',
      tier: 1,
      clubIds: '[]',
    }).run();

    expect(() => initializeDatabaseSchema(db)).toThrow(
      /missing table 'transfers'/,
    );
    // No mutation at all: schema_migrations was never created.
    expect(tableExists(sqlite, 'schema_migrations')).toBe(false);
    expect(
      sqlite.prepare('SELECT name FROM leagues WHERE id = ?').get('league-1'),
    ).toBeTruthy();
  });

  it('rejects a legacy database with an incompatible column', () => {
    const { db, sqlite } = createLegacyDb();

    // Remove a column the application requires.
    db.run('ALTER TABLE clubs DROP COLUMN wage_budget');
    db.insert(schema.leagues).values({
      id: 'league-1',
      name: 'Broken Column',
      tier: 1,
      clubIds: '[]',
    }).run();

    expect(() => initializeDatabaseSchema(db)).toThrow(
      /missing columns: wage_budget/,
    );
    expect(tableExists(sqlite, 'schema_migrations')).toBe(false);
    expect(
      sqlite.prepare('SELECT name FROM leagues WHERE id = ?').get('league-1'),
    ).toBeTruthy();
  });

  it('rejects a migration history with a missing intermediate version', () => {
    const { db, sqlite } = createRawDb();
    initializeDatabaseSchema(db);
    // Production head is v6; simulate a corrupted history claiming v8 was
    // applied while v7 never ran.
    const defs: Migration[] = [2, 3, 4, 5, 6, 7, 8].map((v) => ({
      version: v,
      name: `migration-${v}`,
      up: (tx) => tx.run(`CREATE TABLE t${v} (id TEXT PRIMARY KEY)`),
    }));

    for (const v of [8]) {
      db.insert(schema.schemaMigrations).values({
        version: v,
        name: `migration-${v}`,
        appliedAt: Date.now(),
      }).run();
    }

    expect(() => runMigrations(db, defs)).toThrow(
      /migration 7 .* is not recorded/,
    );
    // Nothing was applied and no versions were fabricated.
    expect(tableExists(sqlite, 't7')).toBe(false);
    expect(tableExists(sqlite, 't8')).toBe(false);
    expect(appliedVersions(db)).toEqual([1, 2, 3, 4, 5, 6, 8]);
  });

  it('rejects a migration history containing an unknown version', () => {
    const { db } = createRawDb();
    initializeDatabaseSchema(db);

    // Record claims a version that is not baseline and not defined by this
    // build's contiguous migration list.
    db.insert(schema.schemaMigrations).values({
      version: 0,
      name: 'mystery-migration',
      appliedAt: Date.now(),
    }).run();

    const m2: Migration = {
      version: 2,
      name: 'migration-two',
      up: (tx) => tx.run('CREATE TABLE t2 (id TEXT PRIMARY KEY)'),
    };
    const m3: Migration = {
      version: 3,
      name: 'migration-three',
      up: (tx) => tx.run('CREATE TABLE t3 (id TEXT PRIMARY KEY)'),
    };
    // Versions 4 through 6 must be present so the provided list reaches
    // the current database head (v6) and the unknown-version check is
    // what fails.
    const m4: Migration = {
      version: 4,
      name: 'migration-four',
      up: () => {},
    };
    const m5: Migration = {
      version: 5,
      name: 'migration-five',
      up: () => {},
    };
    const m6: Migration = {
      version: 6,
      name: 'migration-six',
      up: () => {},
    };

    expect(() => runMigrations(db, [m2, m3, m4, m5, m6])).toThrow(
      /does not match any migration defined/,
    );
  });

  it('rejects gapped migration definitions [2, 4]', () => {
    const { db, sqlite } = createRawDb();
    initializeDatabaseSchema(db);

    let executed = 0;
    const m2: Migration = {
      version: 2,
      name: 'migration-two',
      up: (tx) => { executed++; tx.run('CREATE TABLE t2 (id TEXT PRIMARY KEY)'); },
    };
    const m4: Migration = {
      version: 4,
      name: 'migration-four',
      up: (tx) => { executed++; tx.run('CREATE TABLE t4 (id TEXT PRIMARY KEY)'); },
    };

    expect(() => runMigrations(db, [m2, m4])).toThrow(/contiguous/);
    expect(executed).toBe(0);
    expect(tableExists(sqlite, 't2')).toBe(false);
    expect(tableExists(sqlite, 't4')).toBe(false);
    expect(appliedVersions(db)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('rejects gapped migration definitions [2, 3, 5]', () => {
    const { db } = createRawDb();
    initializeDatabaseSchema(db);

    const defs: Migration[] = [2, 3, 5].map((v) => ({
      version: v,
      name: `migration-${v}`,
      up: () => {},
    }));

    expect(() => runMigrations(db, defs)).toThrow(/contiguous/);
    expect(appliedVersions(db)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('rejects duplicate migration versions', () => {
    const { db } = createRawDb();
    initializeDatabaseSchema(db);

    const dup: Migration = {
      version: 2,
      name: 'dup',
      up: () => {},
    };

    expect(() => runMigrations(db, [dup, { ...dup }])).toThrow(
      /Duplicate migration version/,
    );
    expect(appliedVersions(db)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('rejects duplicate migration definitions during initialization before any writes', () => {
    const { db, sqlite } = createRawDb();

    let executed = 0;
    const mk = (v: number): Migration => ({
      version: v,
      name: `migration-${v}`,
      up: () => { executed++; },
    });

    expect(() =>
      initializeDatabaseSchema(db, [mk(2), mk(2)]),
    ).toThrow(/Duplicate migration version 2/);

    // Zero database writes: no metadata table, no baseline tables, and no
    // migration callback ever ran.
    expect(executed).toBe(0);
    expect(tableExists(sqlite, 'schema_migrations')).toBe(false);
    expect(tableExists(sqlite, 'players')).toBe(false);
    expect(tableExists(sqlite, 'transfer_offers')).toBe(false);
    expect(tableExists(sqlite, 'career')).toBe(false);
  });

  it('rejects gapped migration definitions during initialization before any writes', () => {
    const { db, sqlite } = createRawDb();

    let executed = 0;
    const mk = (v: number): Migration => ({
      version: v,
      name: `migration-${v}`,
      up: () => { executed++; },
    });

    expect(() =>
      initializeDatabaseSchema(db, [mk(2), mk(4)]),
    ).toThrow(/contiguous/);

    expect(executed).toBe(0);
    expect(tableExists(sqlite, 'schema_migrations')).toBe(false);
    expect(tableExists(sqlite, 'players')).toBe(false);
    expect(tableExists(sqlite, 'transfer_offers')).toBe(false);
    expect(tableExists(sqlite, 'career')).toBe(false);
  });

  it('rejects invalid migration versions', () => {
    const { db } = createRawDb();
    initializeDatabaseSchema(db);

    for (const badVersion of [1, 0, -3, 2.5, Number.NaN]) {
      const bad: Migration = {
        version: badVersion,
        name: 'bad',
        up: () => {},
      };
      expect(() => runMigrations(db, [bad])).toThrow(/Invalid migration/);
    }
    expect(appliedVersions(db)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('rejects a malformed schema_migrations table before migrating', () => {
    const { db, sqlite } = createRawDb();

    // Metadata table exists but lacks a required column.
    db.run(
      'CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL)',
    );

    expect(() => initializeDatabaseSchema(db)).toThrow(
      /schema_migrations.*missing columns: applied_at/,
    );

    // Nothing was created or migrated: no baseline tables, metadata table
    // structure unchanged.
    expect(tableExists(sqlite, 'players')).toBe(false);
    const cols = sqlite.prepare('PRAGMA table_info(schema_migrations)').all() as any[];
    expect(cols.map((c) => c.name)).toEqual(['version', 'name']);
  });

  it('rejects a migration history missing the baseline record', () => {
    const { db } = createRawDb();
    initializeDatabaseSchema(db);

    // Wipe records, then leave only a non-baseline version.
    db.delete(schema.schemaMigrations).run();
    db.insert(schema.schemaMigrations).values({
      version: 2,
      name: 'migration-two',
      appliedAt: Date.now(),
    }).run();

    const m2: Migration = {
      version: 2,
      name: 'migration-two',
      up: (tx) => tx.run('CREATE TABLE t2 (id TEXT PRIMARY KEY)'),
    };

    expect(() => runMigrations(db, [m2])).toThrow(/baseline version 1/);
  });

  it('applies a migration exactly once and skips it when already at latest', () => {
    const { db, sqlite } = createRawDb();
    initializeDatabaseSchema(db);
    expect(appliedVersions(db)).toEqual([1, 2, 3, 4, 5, 6]); // production migrations applied

    // Non-idempotent migration: would throw if executed twice. Version 7 —
    // versions 2-6 are taken by production migrations.
    const migration: Migration = {
      version: 7,
      name: 'create-widget-table',
      up: (tx) => {
        tx.run('CREATE TABLE widget (id TEXT PRIMARY KEY)');
      },
    };
    const noopV2: Migration = { version: 2, name: 'noop-v2', up: () => {} };
    const noopV3: Migration = { version: 3, name: 'noop-v3', up: () => {} };
    const noopV4: Migration = { version: 4, name: 'noop-v4', up: () => {} };
    const noopV5: Migration = { version: 5, name: 'noop-v5', up: () => {} };
    const noopV6: Migration = { version: 6, name: 'noop-v6', up: () => {} };

    runMigrations(db, [noopV2, noopV3, noopV4, noopV5, noopV6, migration]);
    expect(tableExists(sqlite, 'widget')).toBe(true);
    expect(appliedVersions(db)).toEqual([1, 2, 3, 4, 5, 6, 7]);

    // Second run: migration must not rerun (would throw on duplicate table).
    runMigrations(db, [noopV2, noopV3, noopV4, noopV5, noopV6, migration]);
    expect(appliedVersions(db)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    const v7Records = (db.select().from(schema.schemaMigrations).all() as any[])
      .filter((r) => r.version === 7);
    expect(v7Records).toHaveLength(1);
  });

  it('rolls back a failed migration and does not advance the version', () => {
    const { db, sqlite } = createRawDb();
    initializeDatabaseSchema(db);

    const noopV2: Migration = { version: 2, name: 'noop-v2', up: () => {} };
    const noopV3: Migration = { version: 3, name: 'noop-v3', up: () => {} };
    const noopV4: Migration = { version: 4, name: 'noop-v4', up: () => {} };
    const noopV5: Migration = { version: 5, name: 'noop-v5', up: () => {} };
    const noopV6: Migration = { version: 6, name: 'noop-v6', up: () => {} };
    const badMigration: Migration = {
      version: 7,
      name: 'failing-migration',
      up: (tx) => {
        tx.run('CREATE TABLE partial_work (id TEXT PRIMARY KEY)');
        tx.run('INSERT INTO nonexistent_table VALUES (1)'); // throws
      },
    };

    expect(() =>
      runMigrations(db, [noopV2, noopV3, noopV4, noopV5, noopV6, badMigration]),
    ).toThrow();

    // The partial table creation was rolled back.
    expect(tableExists(sqlite, 'partial_work')).toBe(false);
    // The version was not recorded — still at the production head (v6).
    expect(appliedVersions(db)).toEqual([1, 2, 3, 4, 5, 6]);

    // A corrected migration can still be applied afterwards.
    const goodMigration: Migration = {
      version: 7,
      name: 'create-widget-table',
      up: (tx) => {
        tx.run('CREATE TABLE widget (id TEXT PRIMARY KEY)');
      },
    };
    runMigrations(db, [noopV2, noopV3, noopV4, noopV5, noopV6, goodMigration]);
    expect(tableExists(sqlite, 'widget')).toBe(true);
    expect(appliedVersions(db)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it('rejects a database from a newer app version', () => {
    const { db } = createRawDb();
    initializeDatabaseSchema(db);

    // Simulate a DB written by a newer build.
    db.insert(schema.schemaMigrations).values({
      version: 99,
      name: 'future-migration',
      appliedAt: Date.now(),
    }).run();

    expect(() => initializeDatabaseSchema(db)).toThrow(/newer than/);
    expect(() => runMigrations(db, [])).toThrow(/newer than/);
  });

  it('preserves career data across a real migration', async () => {
    const { db, sqlite } = createRawDb();
    initializeDatabaseSchema(db);

    const careerState = buildCareerState('Persistent Manager', 'Persistent League', 777);
    await saveCareer(careerState, db);

    const noopV2: Migration = { version: 2, name: 'noop-v2', up: () => {} };
    const noopV3: Migration = { version: 3, name: 'noop-v3', up: () => {} };
    const noopV4: Migration = { version: 4, name: 'noop-v4', up: () => {} };
    const noopV5: Migration = { version: 5, name: 'noop-v5', up: () => {} };
    const noopV6: Migration = { version: 6, name: 'noop-v6', up: () => {} };
    const migration: Migration = {
      version: 7,
      name: 'add-career-notes',
      up: (tx) => {
        tx.run('ALTER TABLE career ADD COLUMN notes TEXT');
        tx.run("UPDATE career SET notes = 'migrated'");
      },
    };

    runMigrations(db, [noopV2, noopV3, noopV4, noopV5, noopV6, migration]);

    // Career reloads identically after the schema change.
    const loaded = await loadCareer(db);
    expect(loaded).not.toBeNull();
    expect(loaded!.career.managerName).toBe('Persistent Manager');
    expect(loaded!.clubs.length).toBe(careerState.clubs.length);
    expect(loaded!.players.length).toBe(careerState.players.length);

    // And the migration's own write is visible.
    const careerRow = sqlite
      .prepare('SELECT notes FROM career WHERE id = ?')
      .get('active') as any;
    expect(careerRow.notes).toBe('migrated');
    expect(appliedVersions(db)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it('migration v2 transfer_offers schema matches the Drizzle definition', () => {
    const { db, sqlite } = createRawDb();
    initializeDatabaseSchema(db);

    // Compare the real SQLite table (created by migration v2) against the
    // Drizzle schema column-for-column: names and nullability.
    const pragmaCols = sqlite
      .prepare('PRAGMA table_info(transfer_offers)')
      .all() as any[];
    const drizzleCols = Object.values(
      getTableColumns(schema.transferOffers),
    );

    expect(pragmaCols.map((c) => c.name).sort()).toEqual(
      drizzleCols.map((c) => c.name).sort(),
    );
    // SQLite reports notnull=0 for TEXT PRIMARY KEY columns even though they
    // are effectively non-nullable; treat pk>0 as satisfying notNull, which
    // matches how Drizzle models primaryKey() columns.
    for (const col of drizzleCols) {
      const actual = pragmaCols.find((c) => c.name === col.name)!;
      const effectivelyNullable = actual.notnull === 0 && actual.pk === 0;
      expect(effectivelyNullable).toBe(!col.notNull);
    }
    // resolved_at is the only nullable column (pending offers).
    expect(
      pragmaCols
        .filter((c) => c.notnull === 0 && c.pk === 0)
        .map((c) => c.name),
    ).toEqual(['resolved_at']);
  });

describe('migration v3 — match persistence columns', () => {
  /** Database at schema version 2 (baseline + transfer_offers only). */
  function createV2Db() {
    const raw = createRawDb();
    initializeDatabaseSchema(raw.db, [MIGRATIONS[0]]);
    return raw;
  }

  function columnNames(sqlite: Database.Database, table: string): string[] {
    return (sqlite.prepare(`PRAGMA table_info(${table})`).all() as any[]).map(
      (c) => c.name,
    );
  }

  function indexNames(sqlite: Database.Database): string[] {
    return (
      sqlite
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'index' " +
            "AND name NOT LIKE 'sqlite_%'",
        )
        .all() as any[]
    ).map((r) => r.name as string);
  }

  function insertPreV3Match(sqlite: Database.Database) {
    sqlite
      .prepare(
        `INSERT INTO matches
          (id, home_club_id, away_club_id, season_id, date, status,
           home_score, away_score, home_tactics, away_tactics)
         VALUES ('match-1', 'club-h', 'club-a', 'season-1', 1723713600000,
                 'completed', 2, 1, '{}', '{}')`,
      )
      .run();
    sqlite
      .prepare(
        `INSERT INTO match_events
          (id, match_id, minute, type, player_id, club_id, description)
         VALUES ('ev-1', 'match-1', 12, 'goal', 'p9', 'club-h', 'GOAL!')`,
      )
      .run();
  }

  it('adds all five columns as nullable and creates the expected indexes', () => {
    const { db, sqlite } = createRawDb();
    initializeDatabaseSchema(db);

    const matchCols = sqlite
      .prepare('PRAGMA table_info(matches)')
      .all() as any[];
    for (const name of [
      'fixture_id',
      'stats',
      'seed',
      'participant_ids',
    ]) {
      const col = matchCols.find((c) => c.name === name)!;
      expect(col).toBeTruthy();
      expect(col.notnull).toBe(0); // nullable — no invented defaults
    }
    const eventCols = sqlite
      .prepare('PRAGMA table_info(match_events)')
      .all() as any[];
    const secondary = eventCols.find((c) => c.name === 'secondary_player_id')!;
    expect(secondary).toBeTruthy();
    expect(secondary.notnull).toBe(0);

    const indexes = indexNames(sqlite);
    expect(indexes).toContain('idx_match_events_match_id');
    expect(indexes).toContain('idx_matches_season_fixture');
    // No UNIQUE constraint was added on fixture_id.
    const matchSql = sqlite
      .prepare(
        "SELECT sql FROM sqlite_master WHERE type='table' AND name='matches'",
      )
      .get() as any;
    expect(matchSql.sql).not.toMatch(/fixture_id[^,]*UNIQUE/i);
  });

  it('preserves pre-existing match rows on a v2 database, leaving new columns NULL', () => {
    const { db, sqlite } = createV2Db();
    insertPreV3Match(sqlite);
    expect(columnNames(sqlite, 'matches')).not.toContain('fixture_id');

    initializeDatabaseSchema(db);

    expect(appliedVersions(db)).toEqual([1, 2, 3, 4, 5, 6]);
    const match = sqlite
      .prepare('SELECT * FROM matches WHERE id = ?')
      .get('match-1') as any;
    expect(match.home_score).toBe(2);
    expect(match.away_score).toBe(1);
    // New columns are NULL — nothing was invented for the old row.
    expect(match.fixture_id).toBeNull();
    expect(match.stats).toBeNull();
    expect(match.seed).toBeNull();
    expect(match.participant_ids).toBeNull();

    const event = sqlite
      .prepare('SELECT * FROM match_events WHERE id = ?')
      .get('ev-1') as any;
    expect(event.minute).toBe(12);
    expect(event.secondary_player_id).toBeNull();
  });

  it('preserves match rows on a pre-framework legacy database', () => {
    const { db, sqlite } = createLegacyDb();
    insertPreV3Match(sqlite);

    initializeDatabaseSchema(db);

    expect(appliedVersions(db)).toEqual([1, 2, 3, 4, 5, 6]);
    const match = sqlite
      .prepare('SELECT * FROM matches WHERE id = ?')
      .get('match-1') as any;
    expect(match.status).toBe('completed');
    expect(match.fixture_id).toBeNull();
    const event = sqlite
      .prepare('SELECT * FROM match_events WHERE id = ?')
      .get('ev-1') as any;
    expect(event.secondary_player_id).toBeNull();
  });

  it('rolls back a failed v3 migration: no columns added, version not recorded', () => {
    const { db, sqlite } = createV2Db();

    const noopV2: Migration = { version: 2, name: 'noop-v2', up: () => {} };
    const failingV3: Migration = {
      version: 3,
      name: 'failing-v3',
      up: (tx) => {
        tx.run('ALTER TABLE matches ADD COLUMN fixture_id TEXT');
        tx.run('ALTER TABLE matches ADD COLUMN stats TEXT');
        tx.run('INSERT INTO nonexistent_table VALUES (1)'); // throws
      },
    };

    expect(() => runMigrations(db, [noopV2, failingV3])).toThrow();

    // Transactional DDL: the ALTERs were rolled back with the failure.
    expect(columnNames(sqlite, 'matches')).not.toContain('fixture_id');
    expect(columnNames(sqlite, 'matches')).not.toContain('stats');
    expect(appliedVersions(db)).toEqual([1, 2]);
    expect(indexNames(sqlite)).not.toContain('idx_match_events_match_id');

    // The real v3 migration still applies cleanly afterwards.
    runMigrations(db, MIGRATIONS);
    expect(appliedVersions(db)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(columnNames(sqlite, 'matches')).toContain('participant_ids');
  });

  it('does not rerun v3 when the database is already at the latest version', () => {
    const { db, sqlite } = createRawDb();
    initializeDatabaseSchema(db);
    expect(appliedVersions(db)).toEqual([1, 2, 3, 4, 5, 6]);

    // A second run must be a no-op: the ALTERs would fail on duplicate
    // columns if v3 were executed again.
    initializeDatabaseSchema(db);
    runMigrations(db, MIGRATIONS);
    expect(appliedVersions(db)).toEqual([1, 2, 3, 4, 5, 6]);
    const v3Records = (
      db.select().from(schema.schemaMigrations).all() as any[]
    ).filter((r) => r.version === 3);
    expect(v3Records).toHaveLength(1);
    expect(v3Records[0].name).toBe('add-match-persistence-columns');
  });

  it('matches and match_events columns match the Drizzle definitions', () => {
    const { db, sqlite } = createRawDb();
    initializeDatabaseSchema(db);

    for (const table of [schema.matches, schema.matchEvents]) {
      const tableName = getTableName(table);
      const pragmaCols = sqlite
        .prepare(`PRAGMA table_info(${tableName})`)
        .all() as any[];
      const drizzleCols = Object.values(getTableColumns(table));

      expect(pragmaCols.map((c) => c.name).sort()).toEqual(
        drizzleCols.map((c) => c.name).sort(),
      );
      for (const col of drizzleCols) {
        const actual = pragmaCols.find((c) => c.name === col.name)!;
        const effectivelyNullable = actual.notnull === 0 && actual.pk === 0;
        expect(effectivelyNullable).toBe(!col.notNull);
      }
    }

    // v3 nullable columns on matches.
    const nullableMatchCols = (
      sqlite.prepare('PRAGMA table_info(matches)').all() as any[]
    )
      .filter((c) => c.notnull === 0 && c.pk === 0)
      .map((c) => c.name)
      .sort();
    expect(nullableMatchCols).toEqual([
      'away_score',
      'fixture_id',
      'home_score',
      'participant_ids',
      'seed',
      'stats',
    ]);
    const nullableEventCols = (
      sqlite.prepare('PRAGMA table_info(match_events)').all() as any[]
    )
      .filter((c) => c.notnull === 0 && c.pk === 0)
      .map((c) => c.name)
      .sort();
    expect(nullableEventCols).toEqual(['player_id', 'secondary_player_id']);
  });
});

describe('migration v4 — club debt', () => {
  /** Database at schema version 3 (before the debt column existed). */
  function createV3Db() {
    const raw = createRawDb();
    initializeDatabaseSchema(raw.db, MIGRATIONS.slice(0, 2));
    return raw;
  }

  function columnInfo(sqlite: Database.Database, table: string, column: string) {
    return (sqlite.prepare(`PRAGMA table_info(${table})`).all() as any[]).find(
      (c) => c.name === column,
    );
  }

  it('creates clubs.debt NOT NULL DEFAULT 0 on a fresh database', () => {
    const { db, sqlite } = createRawDb();
    initializeDatabaseSchema(db);

    const col = columnInfo(sqlite, 'clubs', 'debt');
    expect(col).toBeTruthy();
    expect(col.notnull).toBe(1);
    expect(col.dflt_value).toBe('0');
    expect(appliedVersions(db)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('backfills debt = 0 on clubs of a pre-v4 database without touching data', () => {
    const { db, sqlite } = createV3Db();
    expect(columnInfo(sqlite, 'clubs', 'debt')).toBeUndefined();

    // Clubs as a pre-economy career would have them: every v3 column,
    // no debt. saveCareer() cannot be used here — it writes the current
    // schema which already includes debt.
    const insertClub = sqlite.prepare(`
      INSERT INTO clubs
        (id, name, nickname, founded_year, reputation, balance,
         transfer_budget, wage_budget, weekly_income, stadium_name,
         stadium_capacity, default_formation, mentality,
         pressing_intensity, tempo, width)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const id of ['club-a', 'club-b']) {
      insertClub.run(
        id, `Club ${id}`, `FC${id}`, 2000, 70,
        50_000_000, 20_000_000, 500_000, 1_000_000,
        `${id} Stadium`, 40_000, '4-4-2', 'balanced',
        10, 10, 10,
      );
    }
    const balanceBefore = sqlite
      .prepare('SELECT id, balance FROM clubs ORDER BY id')
      .all() as any[];

    initializeDatabaseSchema(db);

    expect(appliedVersions(db)).toEqual([1, 2, 3, 4, 5, 6]);
    const rows = sqlite
      .prepare('SELECT id, balance, debt FROM clubs ORDER BY id')
      .all() as any[];
    expect(rows.length).toBe(2);
    for (const row of rows) {
      expect(row.debt).toBe(0);
    }
    // Existing financial data untouched — only the new column was added.
    expect(rows.map((r) => r.balance)).toEqual(
      balanceBefore.map((r) => r.balance),
    );
  });
});

describe('migration v5 — season objectives', () => {
  function columnInfo(sqlite: Database.Database, table: string, column: string) {
    return (sqlite.prepare(`PRAGMA table_info(${table})`).all() as any[]).find(
      (c) => c.name === column,
    );
  }

  it('creates season_objectives on a fresh database with the expected shape', () => {
    const { db, sqlite } = createRawDb();
    initializeDatabaseSchema(db);

    expect(appliedVersions(db)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(tableExists(sqlite, 'season_objectives')).toBe(true);

    const cols = sqlite
      .prepare('PRAGMA table_info(season_objectives)')
      .all() as any[];
    const names = cols.map((c) => c.name);
    expect(names).toEqual([
      'season_id', 'club_id', 'target_position', 'reward_amount',
      'ambition', 'objective_met', 'reward_paid', 'debt_remaining',
      'settled_at', 'sanction',
    ]);

    // Settlement fields are nullable before the end-of-season settlement.
    expect(columnInfo(sqlite, 'season_objectives', 'objective_met')!.notnull).toBe(0);
    expect(columnInfo(sqlite, 'season_objectives', 'debt_remaining')!.notnull).toBe(0);
    expect(columnInfo(sqlite, 'season_objectives', 'settled_at')!.notnull).toBe(0);
    // reward_paid defaults to 0 for rows that never received a reward.
    expect(columnInfo(sqlite, 'season_objectives', 'reward_paid')!.dflt_value).toBe('0');
    expect(columnInfo(sqlite, 'season_objectives', 'sanction')!.dflt_value).toBe("'none'");
  });

  it('enforces the composite primary key and domain CHECK constraints', () => {
    const { db, sqlite } = createRawDb();
    initializeDatabaseSchema(db);

    const pkCols = (sqlite
      .prepare('PRAGMA table_info(season_objectives)')
      .all() as any[]).filter((c) => c.pk > 0);
    expect(pkCols.map((c) => c.name).sort()).toEqual(['club_id', 'season_id']);

    const insert = (overrides: Record<string, unknown> = {}) => {
      const row = {
        season_id: 'season-1', club_id: 'club-a',
        target_position: 3, reward_amount: 15_000_000,
        ambition: 'upper_table', sanction: 'none',
        ...overrides,
      };
      sqlite.prepare(`
        INSERT INTO season_objectives
          (season_id, club_id, target_position, reward_amount, ambition,
           sanction)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(
        row.season_id, row.club_id, row.target_position,
        row.reward_amount, row.ambition, row.sanction,
      );
    };

    insert();
    // Same (season_id, club_id) pair is rejected — one objective per club
    // per season.
    expect(() => insert({ club_id: 'club-a' })).toThrow(/UNIQUE/);
    // A different club in the same season is fine.
    insert({ club_id: 'club-b' });

    // CHECK constraints reject out-of-domain values.
    expect(() => insert({ club_id: 'c1', target_position: 0 })).toThrow(/CHECK/);
    expect(() => insert({ club_id: 'c2', reward_amount: -1 })).toThrow(/CHECK/);
    expect(() => insert({ club_id: 'c3', ambition: 'world_beater' })).toThrow(/CHECK/);
    expect(() => insert({ club_id: 'c4', sanction: 'dismissed' })).toThrow(/CHECK/);
    // The deferred-sanction value is part of the domain and accepted.
    insert({ club_id: 'c5', sanction: 'dismissal_relegation_pending' });

    // Settlement columns stay NULL before settlement but are constrained
    // once written: objective_met ∈ {NULL, 0, 1}, debt_remaining ≥ 0.
    const insertSettled = (
      clubId: string,
      objectiveMet: number | null,
      debtRemaining: number | null,
    ) => {
      sqlite.prepare(`
        INSERT INTO season_objectives
          (season_id, club_id, target_position, reward_amount, ambition,
           objective_met, debt_remaining)
        VALUES ('season-1', ?, 3, 15000000, 'upper_table', ?, ?)
      `).run(clubId, objectiveMet, debtRemaining);
    };

    // NULL (pre-settlement) and valid settled values are accepted.
    insertSettled('s-null', null, null);
    insertSettled('s-met-0', 0, null);
    insertSettled('s-met-1', 1, 0);
    insertSettled('s-debt', 0, 5_000_000);

    // Out-of-domain settlement values are rejected.
    expect(() => insertSettled('s-bad-met-2', 2, null)).toThrow(/CHECK/);
    expect(() => insertSettled('s-bad-met-neg', -1, null)).toThrow(/CHECK/);
    expect(() => insertSettled('s-bad-debt', 0, -1)).toThrow(/CHECK/);
  });

  it('backfills nothing: a pre-v5 career migrates with zero objectives', () => {
    const raw = createRawDb();
    initializeDatabaseSchema(raw.db, MIGRATIONS.slice(0, 3));
    const { db, sqlite } = raw;
    expect(tableExists(sqlite, 'season_objectives')).toBe(false);

    // A real career saved through the real path at the v4 shape.
    // saveCareer() targets the current schema, so the v5 table is
    // created temporarily and dropped again before migrating — the
    // migration then recreates it, still empty.
    db.run(SEASON_OBJECTIVES_DDL);
    const careerState = buildCareerState('Objective Manager', 'Objective League', 999);
    return saveCareer(careerState, db).then(() => {
      sqlite.exec('DROP TABLE season_objectives');
      initializeDatabaseSchema(db);

      expect(appliedVersions(db)).toEqual([1, 2, 3, 4, 5, 6]);
      expect(tableExists(sqlite, 'season_objectives')).toBe(true);
      const rows = sqlite
        .prepare('SELECT COUNT(*) AS c FROM season_objectives')
        .get() as any;
      // Existing seasons get NO artificial objectives — the table starts
      // empty and only future season creation will populate it.
      expect(rows.c).toBe(0);
    });
  });
});

describe('migration v6 — players.club_id nullable', () => {
  function clubIdColumn(sqlite: Database.Database) {
    return (sqlite
      .prepare('PRAGMA table_info(players)')
      .all() as any[]).find((c) => c.name === 'club_id');
  }

  it('creates players.club_id as nullable on a fresh database', () => {
    const { db, sqlite } = createRawDb();
    initializeDatabaseSchema(db);

    expect(appliedVersions(db)).toEqual([1, 2, 3, 4, 5, 6]);
    // notnull = 0 → NULL club_id (free agent) is storable.
    expect(clubIdColumn(sqlite)!.notnull).toBe(0);
    // Baseline column set is unchanged — only nullability differs.
    const names = (sqlite
      .prepare('PRAGMA table_info(players)')
      .all() as any[]).map((c) => c.name);
    expect(names).toEqual(
      Object.values(getTableColumns(schema.players)).map((c) => c.name),
    );
  });

  it('rebuilds a real v5 database preserving every player row verbatim', async () => {
    // Head at v5: baseline + migrations 2..5.
    const raw = createRawDb();
    initializeDatabaseSchema(raw.db, MIGRATIONS.slice(0, 4));
    const { db, sqlite } = raw;
    expect(appliedVersions(db)).toEqual([1, 2, 3, 4, 5]);
    expect(clubIdColumn(sqlite)!.notnull).toBe(1);

    // Save a real career through the real path — every player has a
    // non-null club_id, so the NOT NULL constraint is satisfied.
    const careerState = buildCareerState('Contract Manager', 'Contract League', 4242);
    await saveCareer(careerState, db);

    const before = sqlite
      .prepare('SELECT * FROM players ORDER BY id')
      .all() as any[];
    expect(before.length).toBeGreaterThan(0);
    expect(before.every((r) => r.club_id !== null)).toBe(true);

    // Apply v6.
    initializeDatabaseSchema(db);

    expect(appliedVersions(db)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(clubIdColumn(sqlite)!.notnull).toBe(0);
    expect(tableExists(sqlite, 'players_pre_v6')).toBe(false);

    // Every row survives the rebuild byte-for-byte.
    const after = sqlite
      .prepare('SELECT * FROM players ORDER BY id')
      .all() as any[];
    expect(after).toEqual(before);

    // NULL club_id is now accepted (free agent representation).
    const sample = before[0];
    sqlite.prepare('UPDATE players SET club_id = NULL WHERE id = ?')
      .run(sample.id);
    const row = sqlite
      .prepare('SELECT club_id FROM players WHERE id = ?')
      .get(sample.id) as any;
    expect(row.club_id).toBeNull();
  });

  it('migrates a legacy v1 database through the full chain to v6', () => {
    const { db, sqlite } = createLegacyDb();
    // v1 shape: club_id NOT NULL.
    expect(clubIdColumn(sqlite)!.notnull).toBe(1);

    initializeDatabaseSchema(db);

    expect(appliedVersions(db)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(clubIdColumn(sqlite)!.notnull).toBe(0);
    const names = (sqlite
      .prepare('PRAGMA table_info(players)')
      .all() as any[]).map((c) => c.name);
    expect(names).toEqual(
      Object.values(getTableColumns(schema.players)).map((c) => c.name),
    );
  });

  it('preserves an already-expired contract timestamp across the rebuild', async () => {
    const raw = createRawDb();
    initializeDatabaseSchema(raw.db, MIGRATIONS.slice(0, 4));
    const { db, sqlite } = raw;

    const careerState = buildCareerState('Veteran Manager', 'Veteran League', 777);
    const expiredAt = new Date('2020-06-30T00:00:00Z');
    const target = careerState.players[0];
    target.contract.contractExpiryDate = expiredAt;
    await saveCareer(careerState, db);

    initializeDatabaseSchema(db);

    const loaded = await loadCareer(db);
    const reloaded = loaded!.players.find((p) => p.id === target.id)!;
    // The expired date survives verbatim — expiry itself is the engine's
    // job at the next matchweek, not the migration's.
    expect(reloaded.contract.contractExpiryDate.getTime())
      .toBe(expiredAt.getTime());
    expect(reloaded.contract.clubId).toBe(target.contract.clubId);
  });
});

});
