import { CLASSES, classLabel, getClass, ROLE_EMOJI, ROLES, UNKNOWN_ROLE_EMOJI, type Role } from './classes.js';
import { assignSlot, type Result, type TemplateSlot } from './templates.js';

/** Open or full groups one creator may have at the same time in a guild. */
export const MAX_ACTIVE_GROUPS_PER_CREATOR = 3;

export type GroupStatusView = 'open' | 'full' | 'closed';

export interface GroupView {
  id: number;
  creatorId: string;
  title: string;
  description: string;
  startsAt: number | null;
  status: GroupStatusView;
  kind: 'lfg' | 'event';
  slots: TemplateSlot[];
  durationSeconds?: number | null;
  repeatDays?: number | null;
}

export interface GroupMemberView {
  userId: string;
  classId: string;
  slotIndex: number;
}

export interface GroupEmbedData {
  title: string;
  /** Omitted when the group has no description: Discord rejects empty embed descriptions. */
  description?: string;
  color: number;
  fields: { name: string; value: string; inline?: boolean }[];
  footer: { text: string };
}

const COLORS = { open: 0x57f287, full: 0x5865f2, closed: 0x99aab5 } as const;
const MESSAGE_LIMIT = 2000;

/** Names of the classes any slot of the template accepts, in catalog order. */
export function fittingClasses(slots: readonly TemplateSlot[]): string[] {
  return CLASSES.filter((c) => slots.some((s) => s.allowed.includes(c.id))).map(classLabel);
}

/** Slot index the creator takes, or the message to show instead of creating the group. */
export function checkCreateGroup(slots: TemplateSlot[], classId: string, activeGroups: number): Result<number> {
  if (activeGroups >= MAX_ACTIVE_GROUPS_PER_CREATOR) {
    return { ok: false, message: `Du hast bereits ${MAX_ACTIVE_GROUPS_PER_CREATOR} offene Gruppen. Schließe zuerst eine.` };
  }
  const slot = assignSlot(slots, [], classId);
  if (slot === null) {
    return { ok: false, message: `Deine Klasse passt auf keinen Platz dieser Vorlage. Passende Klassen: ${fittingClasses(slots).join(', ')}` };
  }
  return { ok: true, value: slot };
}

/** Ids of the classes that fit a free slot, ignoring the slot the user already holds (so they can switch). */
export function joinableClassIds(slots: TemplateSlot[], members: readonly (GroupMemberView)[], userId: string): string[] {
  const others = members.filter((m) => m.userId !== userId);
  return CLASSES.filter((c) => assignSlot(slots, others, c.id) !== null).map((c) => c.id);
}

/** `full` when every slot is taken, otherwise `open`. */
export function statusForFill(slots: readonly TemplateSlot[], members: readonly unknown[]): 'open' | 'full' {
  return members.length >= slots.length ? 'full' : 'open';
}

/** The one role all of the slot's classes share, or null for slots open to several roles (e.g. "Any"). */
function slotRole(slot: TemplateSlot): Role | null {
  const roles = new Set(CLASSES.filter((c) => slot.allowed.includes(c.id)).map((c) => c.role));
  const [role] = roles;
  return roles.size === 1 && role ? role : null;
}

/** `"🛡️ <@1>"` for a taken slot (class icon and player), `"frei"` for a free one. */
export function formatSlotLine(member?: GroupMemberView): string {
  return member ? `${getClass(member.classId)?.emoji ?? UNKNOWN_ROLE_EMOJI} <@${member.userId}>` : 'frei';
}

export interface SlotColumn {
  name: string;
  lines: string[];
}

/** Slots grouped by role (tanks, healers, DPS, then mixed "Any" slots), headed by icon, label and fill. */
export function buildSlotColumns(slots: readonly TemplateSlot[], members: readonly GroupMemberView[]): SlotColumn[] {
  const columns = [...ROLES.map((r) => ({ role: r.role as Role | null, label: r.label, emoji: ROLE_EMOJI[r.role] })), { role: null, label: 'Beliebig', emoji: ROLE_EMOJI.any }];
  return columns.flatMap(({ role, label, emoji }) => {
    const taken = slots.map((slot, i) => ({ slot, member: members.find((m) => m.slotIndex === i) })).filter(({ slot }) => slotRole(slot) === role);
    if (taken.length === 0) return [];
    const filled = taken.filter((t) => t.member).length;
    return [{ name: `${emoji} ${label} (${filled}/${taken.length})`, lines: taken.map((t) => formatSlotLine(t.member)) }];
  });
}

/** `"1/5 · offen"`, `"5/5 · voll ✅"` or `"3/5 · 🔒 Geschlossen"`. */
export function buildFooter(slots: readonly TemplateSlot[], members: readonly GroupMemberView[], status: GroupStatusView): string {
  const total = slots.length;
  if (status === 'closed') return `${members.length}/${total} · 🔒 Geschlossen`;
  return status === 'full' ? `${total}/${total} · voll ✅` : `${members.length}/${total} · offen`;
}

/** Channel reply that tells the members about a new start time (mentions are capped to fit one message). */
export function formatTimeChangeNotice(userIds: readonly string[], startsAt: number): string {
  const text = `Zeit geändert auf <t:${startsAt}:F>`;
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

/** `"Jede Woche"` for 7 days, `"Alle 3 Tage"` otherwise. */
export function formatRepeat(days: number): string {
  return days === 7 ? 'Jede Woche' : `Alle ${days} Tage`;
}

/** Start, then the end when the group has a duration, then the repeat on its own line. */
function formatWhen(group: GroupView): string {
  if (group.startsAt === null) return 'Jetzt';
  const lines = [`<t:${group.startsAt}:F> (<t:${group.startsAt}:R>)`];
  if (group.durationSeconds) lines.push(`bis <t:${group.startsAt + group.durationSeconds}:t>`);
  if (group.repeatDays) lines.push(`🔁 ${formatRepeat(group.repeatDays)}`);
  return lines.join('\n');
}

export function buildGroupEmbed(group: GroupView, members: readonly GroupMemberView[]): GroupEmbedData {
  const when = formatWhen(group);
  return {
    title: group.title,
    ...(group.description ? { description: group.description } : {}),
    color: COLORS[group.status],
    fields: [
      { name: 'Wann', value: when, inline: true },
      { name: group.kind === 'event' ? 'Organisator' : 'Ersteller', value: `<@${group.creatorId}>`, inline: true },
      // Empty full-width field ends the row above, so the role columns start on a row of their own.
      { name: '\u200b', value: '\u200b' },
      ...buildSlotColumns(group.slots, members).map((c) => ({ name: c.name, value: c.lines.join('\n'), inline: true })),
    ],
    footer: { text: buildFooter(group.slots, members, group.status) },
  };
}
