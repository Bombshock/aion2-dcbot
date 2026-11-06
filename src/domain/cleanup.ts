export type CleanupKind = 'lfg' | 'event';

/** What the cleanup needs to know about one of the bot's own channel messages. */
export interface BotMessageView {
  id: string;
  content: string;
  customIds: readonly string[];
  /** The message this one replies to, if any. Notifications reply to their group's post. */
  referenceId?: string | null;
}

export interface CleanupGroupInfo {
  kind: CleanupKind;
  /** Open or full. */
  active: boolean;
}

/** The groups still in the DB after the cleanup, looked up by group id and by post message id. */
export interface CleanupLookup {
  /** The group with this id, or undefined when it is no longer in the DB. */
  group(groupId: number): CleanupGroupInfo | undefined;
  /** The group whose post is this message, or undefined. */
  groupOfPost(messageId: string): CleanupGroupInfo | undefined;
  /** Message ids of the current posts and tracked notifications of active groups; never deleted. */
  keep: ReadonlySet<string>;
}

const POST_ACTIONS = new Set(['join', 'leave', 'manage']);
const REMINDER_LINK = /^⏰ \*\*[\s\S]*https:\/\/discord\.com\/channels\/\d+\/\d+\/(\d+)/;

/** The group id of a group post (its Join/Leave/Manage buttons), or null for any other message. */
export function postGroupId(message: BotMessageView): number | null {
  for (const customId of message.customIds) {
    // customIds are `<area>:<action>:<id>` (see interactions/router.ts).
    const [area, action, id = ''] = customId.split(':');
    if (area === 'grp' && action && POST_ACTIONS.has(action) && /^\d+$/.test(id)) return Number(id);
  }
  return null;
}

/**
 * Texts of the bot's channel notifications (start reminders, ready and handover pings, time changes, and the join pings of
 * older versions). Lets the cleanup recognise notifications that neither reply to nor link their group's post.
 */
const NOTIFICATION_TEXT = [/^⏰ \*\*/, /Die Gruppe ist bereit!$/, /ist jetzt Ersteller dieser Gruppe\.$/, /ist als .+ beigetreten\.$/, /^Zeit geändert auf <t:\d+:F>/];

/**
 * The post message id a notification belongs to (the post it replies to, or the post a start reminder links to), or null
 * when the message is no notification. Notifications that can't be tied to a post return ''.
 */
export function notificationPostId(message: BotMessageView): string | null {
  if (message.customIds.length > 0) return null;
  if (message.referenceId) return message.referenceId;
  if (!NOTIFICATION_TEXT.some((re) => re.test(message.content))) return null;
  return REMINDER_LINK.exec(message.content)?.[1] ?? '';
}

/**
 * Whether a message of the bot is a leftover of the given kind: a group post that isn't the current post of an active
 * group, or a notification (reminder, announcement) of a group that is closed or gone. Anything of the other kind and the
 * LFG panel are never leftovers. A leftover whose group is gone from the DB can't tell its kind; it is garbage either way,
 * so it counts.
 */
export function isLeftover(message: BotMessageView, kind: CleanupKind, lookup: CleanupLookup): boolean {
  if (lookup.keep.has(message.id)) return false;
  const groupId = postGroupId(message);
  if (groupId !== null) {
    const owner = lookup.group(groupId);
    return owner === undefined || owner.kind === kind;
  }
  const postId = notificationPostId(message);
  if (postId === null) return false;
  const owner = postId ? lookup.groupOfPost(postId) : undefined;
  return owner === undefined || (owner.kind === kind && !owner.active);
}
