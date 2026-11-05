import type Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { addClassToSlots, parseSlotsJson, type TemplateSlot, serializeSlots } from '../domain/templates.js';

const schemaSql = readFileSync(new URL('./schema.sql', import.meta.url), 'utf8');

/**
 * Columns added to tables after they first shipped. `CREATE TABLE IF NOT EXISTS` leaves existing
 * tables untouched, so these are added to older databases on startup. Append new columns here
 * whenever schema.sql gains a column on an existing table.
 */
const ADDED_COLUMNS: { table: string; column: string; definition: string }[] = [
  // SQLite needs a default to add a NOT NULL column; it only fills rows that predate the column.
  { table: 'groups', column: 'slots_json', definition: "TEXT NOT NULL DEFAULT '[]'" },
  { table: 'groups', column: 'kind', definition: "TEXT NOT NULL DEFAULT 'lfg' CHECK (kind IN ('lfg', 'event'))" },
  { table: 'groups', column: 'reminded_at', definition: 'INTEGER' },
  { table: 'groups', column: 'duration_seconds', definition: 'INTEGER' },
  { table: 'groups', column: 'repeat_days', definition: 'INTEGER' },
];

/**
 * One-time data migrations, run in order on databases whose `user_version` is below their index + 1. Append only;
 * never reorder or remove one.
 */
const DATA_MIGRATIONS: ((db: Database.Database) => void)[] = [
  // Gladiator (DPS) joined the class catalog: slots that took every DPS class of the time (`dps` / `any`) accept it.
  (db) => updateStoredSlots(db, (slots) => addClassToSlots(slots, 'gladiator_dps', ['assassin', 'ranger', 'sorcerer', 'spiritmaster', 'chanter'])),
  // Chanter (Heiler) joined the class catalog: slots that took the healer of the time (`healer` / `any`) accept it.
  (db) => updateStoredSlots(db, (slots) => addClassToSlots(slots, 'chanter_healer', ['cleric'])),
];

/** Rewrites the slots of every stored template and group. */
function updateStoredSlots(db: Database.Database, change: (slots: TemplateSlot[]) => TemplateSlot[]): void {
  for (const table of ['group_templates', 'groups']) {
    const rows = db.prepare(`SELECT id, slots_json FROM ${table}`).all() as { id: number; slots_json: string }[];
    const update = db.prepare(`UPDATE ${table} SET slots_json = ? WHERE id = ?`);
    for (const r of rows) {
      const json = serializeSlots(change(parseSlotsJson(r.slots_json)));
      if (json !== r.slots_json) update.run(json, r.id);
    }
  }
}

/** Applies the schema, adds missing columns and runs pending data migrations; safe to call on every startup. */
export function applySchema(db: Database.Database): void {
  db.exec(schemaSql);
  for (const { table, column, definition } of ADDED_COLUMNS) {
    const columns = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
    if (!columns.some((c) => c.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
  const version = db.pragma('user_version', { simple: true }) as number;
  for (const [i, migrate] of DATA_MIGRATIONS.entries()) {
    if (i < version) continue;
    db.transaction(() => {
      migrate(db);
      db.pragma(`user_version = ${i + 1}`);
    })();
  }
}
