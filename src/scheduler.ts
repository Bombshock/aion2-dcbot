import type { Client } from 'discord.js';
import type Database from 'better-sqlite3';
import { createGroupsRepo, type GroupRecord, type GroupsRepo } from './db/groups.js';
import { createGuildSettingsRepo } from './db/guildSettings.js';
import { createUserSettingsRepo } from './db/userSettings.js';
import { nextOccurrenceStart } from './domain/datetime.js';
import { buildReminderMessages, formatReminder, SCHEDULE } from './domain/schedule.js';
import { DEFAULT_SETTINGS } from './domain/settings.js';
import { parseSlotsJson } from './domain/templates.js';
import { closeGroup, refreshGroupPost } from './interactions/groupJoin.js';
import { renderGroupMessage } from './interactions/groupMessage.js';

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

async function remindGroup(client: Client, db: Database.Database, group: GroupRecord, now: number): Promise<void> {
  const groups = createGroupsRepo(db);
  // Marked first, so a failing send is never retried every minute.
  groups.update(group.id, { remindedAt: now });
  const userIds = groups.listMembers(group.id).map((m) => m.userId);
  if (userIds.length === 0 || group.startsAt === null) return;

  const link = group.messageId ? `https://discord.com/channels/${group.guildId}/${group.channelId}/${group.messageId}` : '';
  const header = formatReminder(group.title, group.startsAt, link);
  try {
    const channel = await client.channels.fetch(group.channelId);
    if (!channel?.isSendable()) throw new Error('channel is not sendable');
    const sent: string[] = [];
    try {
      for (const content of buildReminderMessages(header, userIds)) {
        sent.push((await channel.send({ content, allowedMentions: { users: userIds } })).id);
      }
    } finally {
      // Remembered so the reminder is deleted once the event is over or rolled over to its next occurrence.
      if (sent.length > 0) groups.update(group.id, { reminderMessageIds: sent });
    }
  } catch (err) {
    console.error(`Scheduler: reminder for group ${group.id} could not be posted`, err);
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

/**
 * A repeating event ended: closes it, deletes its post and posts the next occurrence (no sign-ups carried over) in the same channel.
 * The DB rollover happens first, so a failing Discord call never stops the repeat; a next occurrence whose post failed is
 * retried when it ends in turn.
 */
async function repostRepeatingEvent(client: Client, db: Database.Database, groups: GroupsRepo, group: GroupRecord, now: number): Promise<void> {
  const timezone = createGuildSettingsRepo(db).get(group.guildId)?.timezone ?? DEFAULT_SETTINGS.timezone;
  const startsAt = nextOccurrenceStart(group.startsAt!, group.repeatDays!, timezone, now);
  const rolled = groups.rollOver(group.id, startsAt, now);
  if (!rolled) return;
  await refreshGroupPost(client, groups, rolled.closed).catch((err) => console.error(`Scheduler: deleting the post of event ${group.id} failed`, err));

  const { next } = rolled;
  const channel = await client.channels.fetch(next.channelId);
  if (!channel?.isSendable()) throw new Error(`channel ${next.channelId} of repeating event ${next.id} is not sendable`);
  const message = await channel.send(renderGroupMessage({ ...next, slots: parseSlotsJson(next.slotsJson) }, []));
  groups.update(next.id, { messageId: message.id });
}

/** One scheduler pass. Reads everything that is due from the DB at `now`, so a restart loses nothing. */
export async function runTick(client: Client, db: Database.Database, now: number): Promise<void> {
  const groups = createGroupsRepo(db);

  await each('reminder', groups.listDueForReminder(now, SCHEDULE.reminderLeadSeconds), (g) => remindGroup(client, db, g, now));
  await each('group expiry', groups.listExpired(now, SCHEDULE.groupExpiryAfterStartSeconds, SCHEDULE.groupExpiryAfterCreateSeconds), async (group) => {
    if (group.kind === 'event' && group.repeatDays && group.startsAt !== null) await repostRepeatingEvent(client, db, groups, group, now);
    else await closeGroup(client, groups, group.id);
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
