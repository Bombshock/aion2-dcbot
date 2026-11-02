import type Database from 'better-sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';
import { openDb } from './index.js';
import { applySchema } from './schema.js';
import { createGuildSettingsRepo } from './guildSettings.js';
import { createEventsRepo } from './events.js';
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

describe('events', () => {
  const base = { guildId: 'g1', channelId: 'c1', creatorId: 'u1', title: 'Raid', startsAt: 1000, createdAt: 1 };

  it('creates, reads, updates and deletes', () => {
    const repo = createEventsRepo(db);
    const e = repo.create(base);
    expect(e).toMatchObject({ ...base, description: '', status: 'open', messageId: null });
    expect(repo.listByGuild('g1')).toHaveLength(1);
    const updated = repo.update(e.id, { title: 'Big Raid', status: 'cancelled', messageId: 'm1' });
    expect(updated).toMatchObject({ title: 'Big Raid', status: 'cancelled', messageId: 'm1' });
    expect(repo.listByGuild('g1', 'open')).toHaveLength(0);
    expect(repo.delete(e.id)).toBe(true);
    expect(repo.get(e.id)).toBeUndefined();
  });

  it('rejects invalid status', () => {
    const repo = createEventsRepo(db);
    const e = repo.create(base);
    expect(() => repo.update(e.id, { status: 'bogus' as never })).toThrow();
  });

  it('lists open events in a time range', () => {
    const repo = createEventsRepo(db);
    repo.create(base);
    repo.create({ ...base, startsAt: 5000 });
    expect(repo.listOpenStartingBetween(0, 2000)).toHaveLength(1);
  });

  it('manages signups and rejects a second signup by the same user', () => {
    const repo = createEventsRepo(db);
    const e = repo.create(base);
    repo.addSignup(e.id, 'u1', 'gladiator', 5);
    expect(() => repo.addSignup(e.id, 'u1', 'cleric', 6)).toThrow(/UNIQUE|PRIMARY KEY/);
    repo.addSignup(e.id, 'u2', 'cleric', 7);
    expect(repo.listSignups(e.id).map((s) => s.userId)).toEqual(['u1', 'u2']);
    expect(repo.updateSignupClass(e.id, 'u1', 'ranger')).toBe(true);
    expect(repo.getSignup(e.id, 'u1')?.classId).toBe('ranger');
    expect(repo.removeSignup(e.id, 'u1')).toBe(true);
    expect(repo.getSignup(e.id, 'u1')).toBeUndefined();
  });

  it('deletes signups with their event', () => {
    const repo = createEventsRepo(db);
    const e = repo.create(base);
    repo.addSignup(e.id, 'u1', 'gladiator');
    repo.delete(e.id);
    expect(repo.listSignups(e.id)).toEqual([]);
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
});

describe('groups', () => {
  const base = { guildId: 'g1', channelId: 'c1', creatorId: 'u1', title: 'Dungeon', createdAt: 1 };

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
