/** Timing of the background jobs; kept together so they can become /setup options later. */
export const SCHEDULE = {
  tickSeconds: 60,
  reminderLeadSeconds: 30 * 60,
  groupExpiryAfterStartSeconds: 2 * 60 * 60,
  groupExpiryAfterCreateSeconds: 6 * 60 * 60,
  /** Days between two occurrences of a repeating event. */
  eventRepeatDays: 7,
} as const;

const MESSAGE_LIMIT = 2000;

/** Reminder text for an event or LFG group; `link` points to its post. */
export function formatReminder(title: string, startsAt: number, link: string): string {
  return `⏰ **${title}** beginnt <t:${startsAt}:R> — ${link}`.slice(0, MESSAGE_LIMIT);
}

/** `header` followed by the mentions, split over as many messages of at most 2000 characters as needed. No users → no messages. */
export function buildReminderMessages(header: string, userIds: readonly string[]): string[] {
  if (userIds.length === 0) return [];
  const messages: string[] = [];
  let current = `${header}\n`;
  let empty = true;
  for (const id of userIds) {
    const mention = `<@${id}>`;
    const separator = empty ? '' : ' ';
    if (!empty && current.length + separator.length + mention.length > MESSAGE_LIMIT) {
      messages.push(current);
      current = mention;
    } else {
      current += separator + mention;
    }
    empty = false;
  }
  messages.push(current);
  return messages;
}
