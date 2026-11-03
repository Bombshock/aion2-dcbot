import type Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';

const schemaSql = readFileSync(new URL('./schema.sql', import.meta.url), 'utf8');

/**
 * Columns added to tables after they first shipped. `CREATE TABLE IF NOT EXISTS` leaves existing
 * tables untouched, so these are added to older databases on startup. Append new columns here
 * whenever schema.sql gains a column on an existing table.
 */
const ADDED_COLUMNS: { table: string; column: string; definition: string }[] = [
  // SQLite needs a default to add a NOT NULL column; it only fills rows that predate the column.
  { table: 'groups', column: 'slots_json', definition: "TEXT NOT NULL DEFAULT '[]'" },
  { table: 'events', column: 'reminded_at', definition: 'INTEGER' },
];

/** Applies the schema and adds missing columns to existing tables; safe to call on every startup. */
export function applySchema(db: Database.Database): void {
  db.exec(schemaSql);
  for (const { table, column, definition } of ADDED_COLUMNS) {
    const columns = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
    if (!columns.some((c) => c.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}
