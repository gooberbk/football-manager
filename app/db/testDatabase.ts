import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema';
import { initializeDatabaseSchema } from './migrations';

let testDbInstance: any = null;
let sqliteInstance: Database.Database | null = null;

export function getTestDatabase() {
  if (!testDbInstance) {
    // Create an in-memory SQLite database for testing
    sqliteInstance = new Database(':memory:');
    testDbInstance = drizzle(sqliteInstance, { schema });

    // Initialize through the real migration framework so the test schema
    // always matches the current Drizzle definitions — no duplicated DDL.
    initializeDatabaseSchema(testDbInstance);
  }
  return testDbInstance;
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
    sqliteInstance.exec('DROP TABLE IF EXISTS transfer_offers');
    sqliteInstance.exec('DROP TABLE IF EXISTS schema_migrations');
    sqliteInstance.exec('DROP TABLE IF EXISTS career');
    sqliteInstance.exec('DROP TRIGGER IF EXISTS fail_delete_test');
    initializeDatabaseSchema(testDbInstance);
  }
}
