import type Database from 'better-sqlite3';
import { loadConfig } from '../config.js';
import { openDb } from './index.js';
import { applySchema } from './schema.js';
import { createGroupTemplatesRepo } from './groups.js';
import { BUILTIN_TEMPLATES, serializeSlots } from '../domain/templates.js';

let db: Database.Database | undefined;

/** Shared database, opened, migrated and seeded with the built-in group templates on first use. */
export function getDb(): Database.Database {
  if (!db) {
    db = openDb(loadConfig().dbPath);
    applySchema(db);
    createGroupTemplatesRepo(db).syncBuiltins(BUILTIN_TEMPLATES.map((t) => ({ name: t.name, slotsJson: serializeSlots(t.slots) })));
  }
  return db;
}
