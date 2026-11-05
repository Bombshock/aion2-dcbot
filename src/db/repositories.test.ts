import type Database from 'better-sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';
import { openDb } from './index.js';
import { applySchema } from './schema.js';
import { createGuildSettingsRepo } from './guildSettings.js';
import { createGroupsRepo, createGroupTemplatesRepo } from './groups.js';

let db: Database.Database;

beforeEach(() => {
  db = openDb(':memory:');
  applySchema(db);
});

describe('schema', () => {
  it('is idempotent', () => {
    expect(() => applySchema(db)).not.toThrow();
  });

  it('adds columns missing from databases created by older versions', () => {
    const old = openDb(':memory:');
    old.exec(`CREATE TABLE groups (
      id INTEGER PRIMARY KEY AUTOINCREMENT, guild_id TEXT NOT NULL, channel_id TEXT NOT NULL, message_id TEXT,
      creator_id TEXT NOT NULL, template_id INTEGER, title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
      starts_at INTEGER, status TEXT NOT NULL DEFAULT 'open', created_at INTEGER NOT NULL)`);
    applySchema(old);
    const columns = (table: string) => (old.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name);
    expect(columns('groups')).toEqual(expect.arrayContaining(['slots_json', 'kind', 'reminded_at']));
    old.prepare("INSERT INTO groups (guild_id, channel_id, creator_id, title, created_at) VALUES ('g', 'c', 'u', 't', 0)").run();
    expect(createGroupsRepo(old).listByGuild('g')[0]).toMatchObject({ kind: 'lfg', remindedAt: null });
  });

  it('once lets DPS / any slots stored before Gladiator (DPS) existed take it', () => {
    const old = openDb(':memory:');
    applySchema(old);
    old.pragma('user_version = 0');
    const oldDps = ['assassin', 'ranger', 'sorcerer', 'spiritmaster', 'chanter'];
    const slots = JSON.stringify([
      { label: 'Tank', allowed: ['gladiator', 'templar'] },
      { label: 'DPS', allowed: oldDps },
    ]);
    old.prepare("INSERT INTO group_templates (guild_id, name, slots_json) VALUES ('g', 'Old', ?)").run(slots);
    old.prepare("INSERT INTO groups (guild_id, channel_id, creator_id, title, slots_json, created_at) VALUES ('g', 'c', 'u', 't', ?, 0)").run(slots);
    applySchema(old);
    for (const table of ['group_templates', 'groups']) {
      const row = old.prepare(`SELECT slots_json FROM ${table}`).get() as { slots_json: string };
      expect(JSON.parse(row.slots_json).map((s: { allowed: string[] }) => s.allowed)).toEqual([['gladiator', 'templar'], ['gladiator_dps', ...oldDps]]);
    }
    const healer = JSON.stringify([{ label: 'Heal', allowed: ['cleric'] }]);
    old.prepare('UPDATE groups SET slots_json = ?').run(healer);
    old.pragma('user_version = 1');
    applySchema(old);
    expect(JSON.parse((old.prepare('SELECT slots_json FROM groups').get() as { slots_json: string }).slots_json)[0].allowed).toEqual(['cleric', 'chanter_healer']);
    // Already migrated: a later slot written without Gladiator (DPS) is left alone.
    old.prepare('UPDATE groups SET slots_json = ?').run(slots);
    applySchema(old);
    expect((old.prepare('SELECT slots_json FROM groups').get() as { slots_json: string }).slots_json).toBe(slots);
  });
});

describe('guild settings', () => {
  it('upserts, reads and deletes', () => {
    const repo = createGuildSettingsRepo(db);
    const s = { guildId: 'g1', eventsChannelId: 'c1', groupsChannelId: null, timezone: 'Europe/Berlin', organizerRoleId: null };
    repo.upsert(s);
    expect(repo.get('g1')).toEqual(s);
    repo.upsert({ ...s, groupsChannelId: 'c2', organizerRoleId: 'r1' });
    expect(repo.get('g1')).toMatchObject({ groupsChannelId: 'c2', organizerRoleId: 'r1' });
    expect(repo.delete('g1')).toBe(true);
    expect(repo.get('g1')).toBeUndefined();
  });
});

describe('group templates', () => {
  it('creates, reads, updates and deletes; lists built-ins with guild templates', () => {
    const repo = createGroupTemplatesRepo(db);
    const builtin = repo.create({ guildId: null, name: 'Party', slotsJson: '[]' });
    const own = repo.create({ guildId: 'g1', name: 'Mine', slotsJson: '["tank"]' });
    repo.create({ guildId: 'g2', name: 'Other', slotsJson: '[]' });
    expect(repo.listForGuild('g1').map((t) => t.id)).toEqual([builtin.id, own.id]);
    expect(repo.update(own.id, { name: 'Renamed' })).toMatchObject({ name: 'Renamed', slotsJson: '["tank"]' });
    expect(repo.delete(own.id)).toBe(true);
    expect(repo.get(own.id)).toBeUndefined();
  });

  it('finds visible templates by name, case-insensitive', () => {
    const repo = createGroupTemplatesRepo(db);
    const builtin = repo.create({ guildId: null, name: 'Duo (2)', slotsJson: '[]' });
    const own = repo.create({ guildId: 'g1', name: 'Mine', slotsJson: '[]' });
    expect(repo.findByName('g1', 'duo (2)')?.id).toBe(builtin.id);
    expect(repo.findByName('g1', 'MINE')?.id).toBe(own.id);
    expect(repo.findByName('g2', 'Mine')).toBeUndefined();
  });

  it('syncs built-ins: inserts missing ones and updates slots without duplicating', () => {
    const repo = createGroupTemplatesRepo(db);
    repo.syncBuiltins([{ name: 'Duo (2)', slotsJson: '[1]' }]);
    repo.syncBuiltins([
      { name: 'Duo (2)', slotsJson: '[2]' },
      { name: 'Open (5)', slotsJson: '[5]' },
    ]);
    expect(repo.listForGuild('g1').map((t) => [t.guildId, t.name, t.slotsJson])).toEqual([
      [null, 'Duo (2)', '[2]'],
      [null, 'Open (5)', '[5]'],
    ]);
  });

  it('deletes built-ins no longer listed but keeps server templates', () => {
    const repo = createGroupTemplatesRepo(db);
    repo.create({ guildId: 'g1', name: 'Duo (2)', slotsJson: '[0]' });
    repo.syncBuiltins([
      { name: 'Duo (2)', slotsJson: '[2]' },
      { name: 'Open (5)', slotsJson: '[5]' },
    ]);
    repo.syncBuiltins([{ name: 'Open (5)', slotsJson: '[5]' }]);
    expect(repo.listForGuild('g1').map((t) => [t.guildId, t.name])).toEqual([
      ['g1', 'Duo (2)'],
      [null, 'Open (5)'],
    ]);
  });
});

describe('groups', () => {
  const base = { guildId: 'g1', channelId: 'c1', creatorId: 'u1', title: 'Dungeon', slotsJson: '[]', createdAt: 1 };

  it('creates, reads, updates and deletes', () => {
    const repo = createGroupsRepo(db);
    const g = repo.create(base);
    expect(g).toMatchObject({ ...base, startsAt: null, templateId: null, status: 'open' });
    expect(repo.update(g.id, { status: 'full', startsAt: 99 })).toMatchObject({ status: 'full', startsAt: 99 });
    expect(repo.listByGuild('g1', 'full')).toHaveLength(1);
    expect(repo.delete(g.id)).toBe(true);
    expect(repo.get(g.id)).toBeUndefined();
  });

  it('keeps the group when its template is deleted', () => {
    const templates = createGroupTemplatesRepo(db);
    const repo = createGroupsRepo(db);
    const t = templates.create({ guildId: 'g1', name: 'T', slotsJson: '[]' });
    const g = repo.create({ ...base, templateId: t.id });
    templates.delete(t.id);
    expect(repo.get(g.id)?.templateId).toBeNull();
  });

  it('manages members and rejects duplicate users and double-booked slots', () => {
    const repo = createGroupsRepo(db);
    const g = repo.create(base);
    repo.addMember(g.id, 'u1', 'gladiator', 0, 5);
    expect(() => repo.addMember(g.id, 'u1', 'cleric', 1)).toThrow(/UNIQUE|PRIMARY KEY/);
    expect(() => repo.addMember(g.id, 'u2', 'cleric', 0)).toThrow(/UNIQUE/);
    repo.addMember(g.id, 'u2', 'cleric', 1, 6);
    expect(repo.listMembers(g.id).map((m) => m.userId)).toEqual(['u1', 'u2']);
    expect(repo.updateMember(g.id, 'u2', { classId: 'ranger', slotIndex: 3 })).toBe(true);
    expect(repo.getMember(g.id, 'u2')).toMatchObject({ classId: 'ranger', slotIndex: 3 });
    expect(repo.removeMember(g.id, 'u1')).toBe(true);
    expect(repo.getMember(g.id, 'u1')).toBeUndefined();
  });

  it('deletes members with their group', () => {
    const repo = createGroupsRepo(db);
    const g = repo.create(base);
    repo.addMember(g.id, 'u1', 'gladiator', 0);
    repo.delete(g.id);
    expect(repo.listMembers(g.id)).toEqual([]);
  });
});
