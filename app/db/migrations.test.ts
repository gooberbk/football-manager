import Database from 'better-sqlite3';
import { getTableColumns } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema';
import {
  initializeDatabaseSchema,
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

    // Baseline + migration v2 recorded exactly once each.
    expect(appliedVersions(db)).toEqual([1, 2]);
  });

  it('detects a compatible legacy database and preserves career data', async () => {
    const { db, sqlite } = createLegacyDb();

    // saveCareer() writes the v2 transfer_offers table, which a genuine v1
    // database does not have. Temporarily create it, populate the career
    // with the real save path, then drop it — leaving the database in the
    // exact historical v1 shape plus realistic career data.
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
    const careerState = buildCareerState('Legacy Manager', 'Legacy League', 12345);
    await saveCareer(careerState, db);
    db.run('DROP TABLE transfer_offers');

    const clubsBefore = sqlite.prepare('SELECT COUNT(*) AS c FROM clubs').get() as any;
    const playersBefore = sqlite.prepare('SELECT COUNT(*) AS c FROM players').get() as any;

    initializeDatabaseSchema(db);

    // Migration metadata established through v2; game data untouched.
    expect(appliedVersions(db)).toEqual([1, 2]);
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
    // Production head is v2; simulate a corrupted history claiming v3 and
    // v5 were applied while v4 never ran.
    const defs: Migration[] = [2, 3, 4, 5].map((v) => ({
      version: v,
      name: `migration-${v}`,
      up: (tx) => tx.run(`CREATE TABLE t${v} (id TEXT PRIMARY KEY)`),
    }));

    for (const v of [3, 5]) {
      db.insert(schema.schemaMigrations).values({
        version: v,
        name: `migration-${v}`,
        appliedAt: Date.now(),
      }).run();
    }

    expect(() => runMigrations(db, defs)).toThrow(
      /migration 4 .* is not recorded/,
    );
    // Nothing was applied and no versions were fabricated.
    expect(tableExists(sqlite, 't3')).toBe(false);
    expect(tableExists(sqlite, 't4')).toBe(false);
    expect(tableExists(sqlite, 't5')).toBe(false);
    expect(appliedVersions(db)).toEqual([1, 2, 3, 5]);
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

    expect(() => runMigrations(db, [m2, m3])).toThrow(
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
    expect(appliedVersions(db)).toEqual([1, 2]);
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
    expect(appliedVersions(db)).toEqual([1, 2]);
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
    expect(appliedVersions(db)).toEqual([1, 2]);
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
    expect(appliedVersions(db)).toEqual([1, 2]);
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
    expect(appliedVersions(db)).toEqual([1, 2]); // production migrations applied

    // Non-idempotent migration: would throw if executed twice. Version 3 —
    // version 2 is already taken by the production transfer_offers migration.
    const migration: Migration = {
      version: 3,
      name: 'create-widget-table',
      up: (tx) => {
        tx.run('CREATE TABLE widget (id TEXT PRIMARY KEY)');
      },
    };

    runMigrations(db, [
      // v2 must be present for contiguity; it is already applied and skipped.
      { version: 2, name: 'noop-v2', up: () => {} },
      migration,
    ]);
    expect(tableExists(sqlite, 'widget')).toBe(true);
    expect(appliedVersions(db)).toEqual([1, 2, 3]);

    // Second run: migration must not rerun (would throw on duplicate table).
    runMigrations(db, [
      { version: 2, name: 'noop-v2', up: () => {} },
      migration,
    ]);
    expect(appliedVersions(db)).toEqual([1, 2, 3]);
    const v3Records = (db.select().from(schema.schemaMigrations).all() as any[])
      .filter((r) => r.version === 3);
    expect(v3Records).toHaveLength(1);
  });

  it('rolls back a failed migration and does not advance the version', () => {
    const { db, sqlite } = createRawDb();
    initializeDatabaseSchema(db);

    const noopV2: Migration = { version: 2, name: 'noop-v2', up: () => {} };
    const badMigration: Migration = {
      version: 3,
      name: 'failing-migration',
      up: (tx) => {
        tx.run('CREATE TABLE partial_work (id TEXT PRIMARY KEY)');
        tx.run('INSERT INTO nonexistent_table VALUES (1)'); // throws
      },
    };

    expect(() => runMigrations(db, [noopV2, badMigration])).toThrow();

    // The partial table creation was rolled back.
    expect(tableExists(sqlite, 'partial_work')).toBe(false);
    // The version was not recorded — still at the production head (v2).
    expect(appliedVersions(db)).toEqual([1, 2]);

    // A corrected migration can still be applied afterwards.
    const goodMigration: Migration = {
      version: 3,
      name: 'create-widget-table',
      up: (tx) => {
        tx.run('CREATE TABLE widget (id TEXT PRIMARY KEY)');
      },
    };
    runMigrations(db, [noopV2, goodMigration]);
    expect(tableExists(sqlite, 'widget')).toBe(true);
    expect(appliedVersions(db)).toEqual([1, 2, 3]);
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
    const migration: Migration = {
      version: 3,
      name: 'add-career-notes',
      up: (tx) => {
        tx.run('ALTER TABLE career ADD COLUMN notes TEXT');
        tx.run("UPDATE career SET notes = 'migrated'");
      },
    };

    runMigrations(db, [noopV2, migration]);

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
    expect(appliedVersions(db)).toEqual([1, 2, 3]);
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
});
