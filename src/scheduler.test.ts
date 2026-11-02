import type { Client } from 'discord.js';
import type Database from 'better-sqlite3';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { openDb } from './db/index.js';
import { applySchema } from './db/schema.js';
import { createEventsRepo } from './db/events.js';
import { createGroupsRepo } from './db/groups.js';
import { createUserSettingsRepo } from './db/userSettings.js';
import { runTick } from './scheduler.js';

const LEAD = 30 * 60;
let db: Database.Database;

beforeEach(() => {
  db = openDb(':memory:');
  applySchema(db);
});

const ev = (startsAt: number) =>
  createEventsRepo(db).create({ guildId: 'g', channelId: 'c', messageId: 'm', creatorId: 'u', title: 'Raid', startsAt, createdAt: 1 });

describe('event queries', () => {
  it('picks reminders just inside the window only', () => {
    const repo = createEventsRepo(db);
    const now = 10_000;
    const inside = ev(now + LEAD);
    ev(now + LEAD + 1);
    ev(now); // already started
    const reminded = ev(now + 60);
    repo.update(reminded.id, { remindedAt: now });
    const cancelled = ev(now + 60);
    repo.update(cancelled.id, { status: 'cancelled' });
    expect(repo.listDueForReminder(now, LEAD).map((e) => e.id)).toEqual([inside.id]);
  });

  it('picks events to start at or after their start time', () => {
    const repo = createEventsRepo(db);
    const now = 10_000;
    const due = ev(now);
    ev(now + 1);
    const cancelled = ev(now - 5);
    repo.update(cancelled.id, { status: 'cancelled' });
    expect(repo.listDueToStart(now).map((e) => e.id)).toEqual([due.id]);
  });

  it('can reset reminded_at to null', () => {
    const repo = createEventsRepo(db);
    const e = ev(5000);
    repo.update(e.id, { remindedAt: 1 });
    expect(repo.update(e.id, { remindedAt: null })!.remindedAt).toBeNull();
  });
});

describe('group expiry query', () => {
  it('uses start time when set and creation time otherwise', () => {
    const repo = createGroupsRepo(db);
    const base = { guildId: 'g', channelId: 'c', creatorId: 'u', title: 'G', slotsJson: '[]' };
    const now = 100_000;
    const startedLong = repo.create({ ...base, startsAt: now - 2 * 3600, createdAt: now });
    repo.create({ ...base, startsAt: now - 2 * 3600 + 1, createdAt: 1 });
    const oldNoStart = repo.create({ ...base, createdAt: now - 6 * 3600 });
    repo.create({ ...base, createdAt: now - 6 * 3600 + 1 });
    const closed = repo.create({ ...base, createdAt: 1, status: 'closed' });
    const ids = repo.listExpired(now, 2 * 3600, 6 * 3600).map((g) => g.id);
    expect(ids).toEqual([startedLong.id, oldNoStart.id]);
    expect(ids).not.toContain(closed.id);
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
    const edit = vi.fn().mockResolvedValue(undefined);
    const dm = vi.fn().mockResolvedValue(undefined);
    const channel = {
      isSendable: () => true,
      isTextBased: () => true,
      send,
      messages: { fetch: vi.fn().mockResolvedValue({ edit }) },
    };
    const client = {
      channels: { fetch: vi.fn().mockResolvedValue(channel) },
      users: { fetch: vi.fn().mockResolvedValue({ send: dm }) },
    } as unknown as Client;
    return { client, send, edit, dm };
  }

  it('reminds once, DMs only opted-in users, then ends the event', async () => {
    const { client, send, dm, edit } = fakeClient();
    const repo = createEventsRepo(db);
    const now = 10_000;
    const e = ev(now + 600);
    repo.addSignup(e.id, 'a', 'x');
    repo.addSignup(e.id, 'b', 'x');
    createUserSettingsRepo(db).setDmReminders('b', true);

    await runTick(client, db, now);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]![0].content).toContain('<@a> <@b>');
    expect(dm).toHaveBeenCalledTimes(1);
    expect(repo.get(e.id)!.remindedAt).toBe(now);

    await runTick(client, db, now + 60);
    expect(send).toHaveBeenCalledTimes(1);

    await runTick(client, db, now + 600);
    expect(repo.get(e.id)!.status).toBe('ended');
    expect(edit).toHaveBeenCalledTimes(1);
  });

  it('sets reminded_at without a message when nobody signed up', async () => {
    const { client, send } = fakeClient();
    const e = ev(10_600);
    await runTick(client, db, 10_000);
    expect(send).not.toHaveBeenCalled();
    expect(createEventsRepo(db).get(e.id)!.remindedAt).toBe(10_000);
  });

  it('closes overdue groups', async () => {
    const { client, edit } = fakeClient();
    const repo = createGroupsRepo(db);
    const g = repo.create({ guildId: 'g', channelId: 'c', messageId: 'm', creatorId: 'u', title: 'G', slotsJson: '[]', createdAt: 1 });
    await runTick(client, db, 1 + 6 * 3600);
    expect(repo.get(g.id)!.status).toBe('closed');
    expect(edit).toHaveBeenCalledTimes(1);
  });
});
