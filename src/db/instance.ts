import type Database from 'better-sqlite3';
import { loadConfig } from '../config.js';
import { openDb } from './index.js';
import { applySchema } from './schema.js';

let db: Database.Database | undefined;

/** Shared database, opened and migrated on first use. */
export function getDb(): Database.Database {
  if (!db) {
    db = openDb(loadConfig().dbPath);
    applySchema(db);
  }
  return db;
}
