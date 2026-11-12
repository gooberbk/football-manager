import * as SQLite from 'expo-sqlite';
import { drizzle } from 'drizzle-orm/expo-sqlite';
import * as schema from './schema';
import { initializeDatabaseSchema } from './migrations';

let expoDatabase: any = null;
let dbInstance: any = null;

export function getDatabase() {
  if (!dbInstance) {
    expoDatabase = SQLite.openDatabaseSync('club_director.db');
    dbInstance = drizzle(expoDatabase, { schema });
  }
  return dbInstance;
}

export const db = getDatabase();

export async function initializeDatabase() {
  try {
    // Baseline schema (idempotent) + ordered migrations with version tracking.
    initializeDatabaseSchema(db);
    console.log('Database initialized successfully');
  } catch (error) {
    console.error('Failed to initialize database:', error);
    throw error;
  }
}

// Export the save/load functions with the default db for convenience in the app
import { saveCareer as saveCareerImpl, loadCareer as loadCareerImpl, deleteCareer as deleteCareerImpl } from './careerPersistence';
import type { CareerState } from './careerPersistence';

export async function saveCareer(state: CareerState) {
  return saveCareerImpl(state, db);
}

export async function loadCareer() {
  return loadCareerImpl(db);
}

export async function deleteCareer() {
  return deleteCareerImpl(db);
}
