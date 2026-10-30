import type Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';

const schemaSql = readFileSync(new URL('./schema.sql', import.meta.url), 'utf8');

/** Applies the schema; safe to call on every startup. */
export function applySchema(db: Database.Database): void {
  db.exec(schemaSql);
}
