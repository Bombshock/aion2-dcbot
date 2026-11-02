import type { Client } from 'discord.js';
import type Database from 'better-sqlite3';
import { createEventsRepo, type EventRecord } from './db/events.js';
import { createGroupsRepo } from './db/groups.js';
import { createUserSettingsRepo } from './db/userSettings.js';
import { buildReminderMessages, formatEventReminder, SCHEDULE } from './domain/schedule.js';
import { refreshEventPost } from './interactions/eventSignup.js';
import { closeGroup } from './interactions/groupJoin.js';

const nowSeconds = () => Math.floor(Date.now() / 1000);

/** Runs `job` for each item; an error in one item is logged and doesn't stop the others. */
async function each<T>(label: string, items: T[], job: (item: T) => Promise<void>): Promise<void> {
  for (const item of items) {
    try {
      await job(item);
    } catch (err) {
      console.error(`Scheduler: ${label} failed`, err);
    }
  }
}

async function remindEvent(client: Client, db: Database.Database, event: EventRecord, now: number): Promise<void> {
  const events = createEventsRepo(db);
  // Marked first, so a failing send is never retried every minute.
  events.update(event.id, { remindedAt: now });
  const userIds = events.listSignups(event.id).map((s) => s.userId);
  if (userIds.length === 0) return;

  const link = event.messageId ? `https://discord.com/channels/${event.guildId}/${event.channelId}/${event.messageId}` : '';
  const header = formatEventReminder(event.title, event.startsAt, link);
  try {
    const channel = await client.channels.fetch(event.channelId);
    if (!channel?.isSendable()) throw new Error('channel is not sendable');
    for (const content of buildReminderMessages(header, userIds)) {
      await channel.send({ content, allowedMentions: { users: userIds } });
    }
  } catch (err) {
    console.error(`Scheduler: reminder for event ${event.id} could not be posted`, err);
  }

  for (const userId of createUserSettingsRepo(db).filterDmEnabled(userIds)) {
    try {
      const user = await client.users.fetch(userId);
      await user.send({ content: header, allowedMentions: { parse: [] } });
    } catch (err) {
      console.error(`Scheduler: DM reminder for user ${userId} failed`, err);
    }
  }
}

/** One scheduler pass. Reads everything that is due from the DB at `now`, so a restart loses nothing. */
export async function runTick(client: Client, db: Database.Database, now: number): Promise<void> {
  const events = createEventsRepo(db);
  const groups = createGroupsRepo(db);

  await each('event reminder', events.listDueForReminder(now, SCHEDULE.eventReminderLeadSeconds), (e) => remindEvent(client, db, e, now));
  await each('event start', events.listDueToStart(now), async (event) => {
    const updated = events.update(event.id, { status: 'ended' });
    if (updated) await refreshEventPost(client, events, updated);
  });
  await each('group expiry', groups.listExpired(now, SCHEDULE.groupExpiryAfterStartSeconds, SCHEDULE.groupExpiryAfterCreateSeconds), async (group) => {
    await closeGroup(client, groups, group.id);
  });
}

/** Starts the minute tick; a tick is skipped while the previous one is still running. */
export function startScheduler(client: Client, db: Database.Database): NodeJS.Timeout {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await runTick(client, db, nowSeconds());
    } catch (err) {
      console.error('Scheduler tick failed', err);
    } finally {
      running = false;
    }
  };
  void tick();
  return setInterval(tick, SCHEDULE.tickSeconds * 1000);
}
