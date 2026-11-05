import type { Client } from 'discord.js';
import type Database from 'better-sqlite3';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { openDb } from './db/index.js';
import { applySchema } from './db/schema.js';
import { createGroupsRepo } from './db/groups.js';
import { createUserSettingsRepo } from './db/userSettings.js';
import { runTick } from './scheduler.js';

const LEAD = 30 * 60;
let db: Database.Database;

beforeEach(() => {
  db = openDb(':memory:');
  applySchema(db);
});

const timed = (startsAt: number, kind: 'lfg' | 'event' = 'event') =>
  createGroupsRepo(db).create({ guildId: 'g', channelId: 'c', messageId: 'm', creatorId: 'u', title: 'Raid', slotsJson: '[]', startsAt, kind, createdAt: 1 });

describe('reminder query', () => {
  it('picks reminders just inside the window only', () => {
    const repo = createGroupsRepo(db);
    const now = 10_000;
    const inside = timed(now + LEAD);
    const lfg = timed(now + LEAD, 'lfg');
    timed(now + LEAD + 1);
    timed(now); // already started
    const reminded = timed(now + 60);
    repo.update(reminded.id, { remindedAt: now });
    const closed = timed(now + 60);
    repo.update(closed.id, { status: 'closed' });
    repo.create({ guildId: 'g', channelId: 'c', creatorId: 'u', title: 'Now', slotsJson: '[]', createdAt: 1 });
    expect(repo.listDueForReminder(now, LEAD).map((g) => g.id)).toEqual([inside.id, lfg.id]);
  });

  it('stores and clears the reminder message ids', () => {
    const repo = createGroupsRepo(db);
    const g = timed(5000);
    expect(g.reminderMessageIds).toEqual([]);
    expect(repo.update(g.id, { reminderMessageIds: ['r1', 'r2'] })!.reminderMessageIds).toEqual(['r1', 'r2']);
    expect(repo.update(g.id, { reminderMessageIds: [] })!.reminderMessageIds).toEqual([]);
  });

  it('can reset reminded_at to null', () => {
    const repo = createGroupsRepo(db);
    const g = timed(5000);
    repo.update(g.id, { remindedAt: 1 });
    expect(repo.update(g.id, { remindedAt: null })!.remindedAt).toBeNull();
  });
});

describe('group expiry query', () => {
  it('closes LFG groups one hour after their target time, or after creation for "now"', () => {
    const repo = createGroupsRepo(db);
    const base = { guildId: 'g', channelId: 'c', creatorId: 'u', title: 'G', slotsJson: '[]', kind: 'lfg' as const };
    const now = 100_000;
    const timed = repo.create({ ...base, startsAt: now - 3600, createdAt: 1 });
    repo.create({ ...base, startsAt: now - 3600 + 1, createdAt: 1 });
    const instant = repo.create({ ...base, createdAt: now - 3600 });
    repo.create({ ...base, createdAt: now - 3600 + 1 });
    repo.create({ ...base, createdAt: 1, status: 'closed' });
    expect(repo.listExpired(now, 2 * 3600, 6 * 3600, 3600).map((g) => g.id)).toEqual([timed.id, instant.id]);
  });

  it('uses start time when set and creation time otherwise for events', () => {
    const repo = createGroupsRepo(db);
    const base = { guildId: 'g', channelId: 'c', creatorId: 'u', title: 'G', slotsJson: '[]', kind: 'event' as const };
    const now = 100_000;
    const startedLong = repo.create({ ...base, startsAt: now - 2 * 3600, createdAt: now });
    repo.create({ ...base, startsAt: now - 2 * 3600 + 1, createdAt: 1 });
    const oldNoStart = repo.create({ ...base, createdAt: now - 6 * 3600 });
    repo.create({ ...base, createdAt: now - 6 * 3600 + 1 });
    const closed = repo.create({ ...base, createdAt: 1, status: 'closed' });
    const ids = repo.listExpired(now, 2 * 3600, 6 * 3600, 3600).map((g) => g.id);
    expect(ids).toEqual([startedLong.id, oldNoStart.id]);
    expect(ids).not.toContain(closed.id);
  });

  it('ends groups with a duration at start + duration instead', () => {
    const repo = createGroupsRepo(db);
    const base = { guildId: 'g', channelId: 'c', creatorId: 'u', title: 'G', slotsJson: '[]', createdAt: 1, kind: 'event' as const };
    const now = 100_000;
    const short = repo.create({ ...base, startsAt: now - 1800, durationSeconds: 1800 });
    repo.create({ ...base, startsAt: now - 3 * 3600, durationSeconds: 4 * 3600 });
    expect(repo.listExpired(now, 2 * 3600, 6 * 3600, 3600).map((g) => g.id)).toEqual([short.id]);
  });
});

describe('user settings', () => {
  it('is off by default and toggles per user', () => {
    const repo = createUserSettingsRepo(db);
    expect(repo.getDmReminders('a')).toBe(false);
    repo.setDmReminders('a', true);
    expect(repo.filterDmEnabled(['a', 'b'])).toEqual(['a']);
    repo.setDmReminders('a', false);
    expect(repo.getDmReminders('a')).toBe(false);
  });
});

describe('runTick', () => {
  function fakeClient() {
    const send = vi.fn().mockResolvedValue(undefined);
    const del = vi.fn().mockResolvedValue(undefined);
    const dm = vi.fn().mockResolvedValue(undefined);
    const channel = {
      isSendable: () => true,
      isTextBased: () => true,
      send,
      messages: { fetch: vi.fn().mockResolvedValue({ delete: del }) },
    };
    const client = {
      channels: { fetch: vi.fn().mockResolvedValue(channel) },
      users: { fetch: vi.fn().mockResolvedValue({ send: dm }) },
    } as unknown as Client;
    return { client, send, del, dm };
  }

  it('reminds members once, DMs only opted-in users, then closes the event after its start', async () => {
    const { client, send, dm, del } = fakeClient();
    const repo = createGroupsRepo(db);
    const now = 10_000;
    const g = timed(now + 600);
    repo.addMember(g.id, 'a', 'x', 0);
    repo.addMember(g.id, 'b', 'x', 1);
    createUserSettingsRepo(db).setDmReminders('b', true);

    await runTick(client, db, now);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]![0].content).toContain('<@a> <@b>');
    expect(dm).toHaveBeenCalledTimes(1);
    expect(repo.get(g.id)!.remindedAt).toBe(now);

    await runTick(client, db, now + 60);
    expect(send).toHaveBeenCalledTimes(1);

    await runTick(client, db, now + 600 + 2 * 3600);
    expect(repo.get(g.id)!.status).toBe('closed');
    expect(del).toHaveBeenCalledTimes(1);
  });

  it('sets reminded_at without a message when nobody joined', async () => {
    const { client, send } = fakeClient();
    const g = timed(10_600);
    await runTick(client, db, 10_000);
    expect(send).not.toHaveBeenCalled();
    expect(createGroupsRepo(db).get(g.id)!.remindedAt).toBe(10_000);
  });

  it('reposts a weekly event after it ends, without its sign-ups', async () => {
    const { client, send, del } = fakeClient();
    send.mockResolvedValue({ id: 'm2' });
    const repo = createGroupsRepo(db);
    const start = 1_000_000;
    const slotsJson = JSON.stringify([{ label: 'A', allowed: ['x'] }, { label: 'B', allowed: ['x'] }]);
    const g = repo.create({ guildId: 'g', channelId: 'c', messageId: 'm', creatorId: 'u', title: 'Raid', slotsJson, startsAt: start, kind: 'event', createdAt: 1, durationSeconds: 3600, repeatDays: 7 });
    repo.addMember(g.id, 'a', 'x', 0);
    repo.update(g.id, { remindedAt: start - 600 });

    await runTick(client, db, start + 3600 - 60);
    expect(repo.get(g.id)!.status).toBe('open');

    await runTick(client, db, start + 3600);
    expect(repo.get(g.id)!.status).toBe('closed');
    expect(del).toHaveBeenCalledTimes(1);
    const next = repo.listByGuild('g').find((x) => x.id !== g.id)!;
    expect(next).toMatchObject({ status: 'open', startsAt: start + 7 * 86_400, messageId: 'm2', remindedAt: null, durationSeconds: 3600, repeatDays: 7, channelId: 'c', creatorId: 'u' });
    expect(repo.listMembers(next.id)).toEqual([]);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('does not repost a weekly event that was closed', async () => {
    const { client, send } = fakeClient();
    const repo = createGroupsRepo(db);
    const g = repo.create({ guildId: 'g', channelId: 'c', messageId: 'm', creatorId: 'u', title: 'Raid', slotsJson: '[]', startsAt: 1000, kind: 'event', createdAt: 1, repeatDays: 7 });
    repo.update(g.id, { status: 'closed' });
    await runTick(client, db, 1000 + 7 * 86_400);
    expect(repo.listByGuild('g')).toHaveLength(1);
    expect(send).not.toHaveBeenCalled();
  });

  it('closes overdue groups', async () => {
    const { client, del } = fakeClient();
    const repo = createGroupsRepo(db);
    const g = repo.create({ guildId: 'g', channelId: 'c', messageId: 'm', creatorId: 'u', title: 'G', slotsJson: '[]', createdAt: 1 });
    await runTick(client, db, 1 + 6 * 3600);
    expect(repo.get(g.id)!.status).toBe('closed');
    expect(del).toHaveBeenCalledTimes(1);
  });
});
