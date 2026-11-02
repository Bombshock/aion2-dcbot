import { classesByRole, getClass, ROLES, type AionClass, type Role } from './classes.js';

export interface EventView {
  id: number;
  creatorId: string;
  title: string;
  description: string;
  startsAt: number;
  status: 'open' | 'cancelled' | 'ended';
}

export interface SignupView {
  userId: string;
  classId: string;
}

export interface EventEmbedData {
  title: string;
  description: string;
  color: number;
  fields: { name: string; value: string; inline?: boolean }[];
}

export const EMPTY_ROSTER_TEXT = 'No sign-ups yet';
export const COMPACT_ROSTER_HINT = 'Roster is long: use "Show full roster" for names.';

const COLORS = { open: 0x5865f2, cancelled: 0x99aab5, ended: 0x99aab5 } as const;
const FIELD_LIMIT = 1024;
const EMBED_LIMIT = 5800; // Discord allows 6000 characters per embed; keep some slack
const MESSAGE_LIMIT = 2000;

interface RoleGroup {
  label: string;
  classes: { cls: AionClass | undefined; classId: string; userIds: string[] }[];
  count: number;
}

/** Sign-ups grouped by role (display order), then class (catalog order), keeping sign-up order inside a class. */
function groupByRole(signups: readonly SignupView[]): RoleGroup[] {
  const groups: RoleGroup[] = [];
  const labelled = [...ROLES.map((r) => ({ role: r.role as Role | undefined, label: r.label })), { role: undefined, label: 'Other' }];
  for (const { role, label } of labelled) {
    const classIds = role ? classesByRole(role).map((c) => c.id) : [...new Set(signups.map((s) => s.classId))].filter((id) => !getClass(id));
    const classes = classIds
      .map((classId) => ({ cls: getClass(classId), classId, userIds: signups.filter((s) => s.classId === classId).map((s) => s.userId) }))
      .filter((c) => c.userIds.length > 0);
    if (classes.length > 0) groups.push({ label, classes, count: classes.reduce((n, c) => n + c.userIds.length, 0) });
  }
  return groups;
}

const className = (c: RoleGroup['classes'][number]) => c.cls?.name ?? c.classId;
const classEmoji = (c: RoleGroup['classes'][number]) => c.cls?.emoji ?? '❔';

function detailedValue(g: RoleGroup): string {
  return g.classes.flatMap((c) => c.userIds.map((u) => `${classEmoji(c)} <@${u}> (${className(c)})`)).join(' · ');
}

function compactValue(g: RoleGroup): string {
  return g.classes.map((c) => `${classEmoji(c)} ${className(c)} ×${c.userIds.length}`).join(' · ');
}

type Field = EventEmbedData['fields'][number];

function embedLength(event: EventView, fields: readonly Field[]): number {
  return event.title.length + 16 + event.description.length + fields.reduce((n, f) => n + f.name.length + f.value.length, 0);
}

function baseFields(event: EventView): Field[] {
  return [
    { name: 'When', value: `<t:${event.startsAt}:F>
<t:${event.startsAt}:R>` },
    { name: 'Organizer', value: `<@${event.creatorId}>`, inline: true },
  ];
}

function rosterFields(groups: RoleGroup[], total: number, compact: boolean): Field[] {
  if (total === 0) return [{ name: 'Roster (0)', value: EMPTY_ROSTER_TEXT }];
  const fields: Field[] = groups.map((g) => ({ name: `${g.label} (${g.count})`, value: compact ? compactValue(g) : detailedValue(g) }));
  fields.push({ name: 'Total', value: String(total), inline: true });
  if (compact) fields.push({ name: 'Names', value: COMPACT_ROSTER_HINT });
  return fields;
}

/** True when the full roster does not fit into the embed, so the post shows counts per class instead. */
export function isRosterCompact(event: EventView, signups: readonly SignupView[]): boolean {
  const groups = groupByRole(signups);
  const fields = [...baseFields(event), ...rosterFields(groups, signups.length, false)];
  return fields.some((f) => f.value.length > FIELD_LIMIT) || embedLength(event, fields) > EMBED_LIMIT;
}

/** Complete roster as one or more messages of at most 2000 characters (for the ephemeral "Show full roster" reply). */
export function formatFullRoster(signups: readonly SignupView[]): string[] {
  if (signups.length === 0) return [EMPTY_ROSTER_TEXT];
  const lines: string[] = [];
  for (const g of groupByRole(signups)) {
    lines.push(`**${g.label} (${g.count})**`);
    for (const c of g.classes) for (const u of c.userIds) lines.push(`${classEmoji(c)} <@${u}> (${className(c)})`);
  }
  lines.push(`**Total: ${signups.length}**`);
  const chunks: string[] = [];
  let current = '';
  for (const line of lines) {
    if (current && current.length + 1 + line.length > MESSAGE_LIMIT) {
      chunks.push(current);
      current = line;
    } else {
      current = current ? `${current}
${line}` : line;
    }
  }
  chunks.push(current);
  return chunks;
}

/** Channel reply that tells signed-up users about a new start time (mentions are capped to fit one message). */
export function formatTimeChangeNotice(userIds: readonly string[], startsAt: number): string {
  const text = `Time changed to <t:${startsAt}:F>`;
  const mentions: string[] = [];
  let length = text.length;
  for (const id of userIds) {
    const mention = `<@${id}>`;
    if (length + 1 + mention.length > MESSAGE_LIMIT) break;
    mentions.push(mention);
    length += 1 + mention.length;
  }
  return mentions.length > 0 ? `${mentions.join(' ')} ${text}` : text;
}

/** Embed content of an event post; shared by every ticket that refreshes the post. */
export function buildEventEmbed(event: EventView, signups: readonly SignupView[]): EventEmbedData {
  const prefix = event.status === 'cancelled' ? '❌ Cancelled: ' : event.status === 'ended' ? '▶️ Started: ' : '';
  return {
    title: `${prefix}${event.title}`,
    description: event.description,
    color: COLORS[event.status],
    fields: [...baseFields(event), ...rosterFields(groupByRole(signups), signups.length, isRosterCompact(event, signups))],
  };
}
