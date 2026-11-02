import { CLASSES, getClass } from './classes.js';
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
  slots: TemplateSlot[];
}

export interface GroupMemberView {
  userId: string;
  classId: string;
  slotIndex: number;
}

export interface GroupEmbedData {
  title: string;
  description: string;
  color: number;
  fields: { name: string; value: string; inline?: boolean }[];
  footer: { text: string };
}

const COLORS = { open: 0x57f287, full: 0x5865f2, closed: 0x99aab5 } as const;

/** Names of the classes any slot of the template accepts, in catalog order. */
export function fittingClasses(slots: readonly TemplateSlot[]): string[] {
  return CLASSES.filter((c) => slots.some((s) => s.allowed.includes(c.id))).map((c) => c.name);
}

/** Slot index the creator takes, or the message to show instead of creating the group. */
export function checkCreateGroup(slots: TemplateSlot[], classId: string, activeGroups: number): Result<number> {
  if (activeGroups >= MAX_ACTIVE_GROUPS_PER_CREATOR) {
    return { ok: false, message: `You already have ${MAX_ACTIVE_GROUPS_PER_CREATOR} open groups. Close one first.` };
  }
  const slot = assignSlot(slots, [], classId);
  if (slot === null) {
    return { ok: false, message: `Your class fits no slot in this template. Fitting classes: ${fittingClasses(slots).join(', ')}` };
  }
  return { ok: true, value: slot };
}

/** `full` when every slot is taken, otherwise `open`. */
export function statusForFill(slots: readonly TemplateSlot[], members: readonly unknown[]): 'open' | 'full' {
  return members.length >= slots.length ? 'full' : 'open';
}

function allowedText(slot: TemplateSlot): string {
  return slot.allowed.length === CLASSES.length ? 'any class' : slot.allowed.map((id) => getClass(id)?.name ?? id).join(', ');
}

/** `"1. Tank 🛡️ <@1> (Templar)"` for a taken slot, `"2. Healer — open (Cleric)"` for a free one. */
export function formatSlotLine(index: number, slot: TemplateSlot, member?: GroupMemberView): string {
  const n = `${index + 1}.`;
  if (!member) return `${n} ${slot.label} — open (${allowedText(slot)})`;
  const cls = getClass(member.classId);
  return `${n} ${slot.label} ${cls?.emoji ?? '❔'} <@${member.userId}> (${cls?.name ?? member.classId})`;
}

export function buildSlotLines(slots: readonly TemplateSlot[], members: readonly GroupMemberView[]): string[] {
  return slots.map((slot, i) => formatSlotLine(i, slot, members.find((m) => m.slotIndex === i)));
}

/** `"1/5 · open"`, `"5/5 · full ✅"` or `"3/5 · closed"`. */
export function buildFooter(slots: readonly TemplateSlot[], members: readonly GroupMemberView[], status: GroupStatusView): string {
  const total = slots.length;
  if (status === 'closed') return `${members.length}/${total} · closed`;
  return status === 'full' ? `${total}/${total} · full ✅` : `${members.length}/${total} · open`;
}

export function buildGroupEmbed(group: GroupView, members: readonly GroupMemberView[]): GroupEmbedData {
  const when = group.startsAt === null ? 'Now' : `<t:${group.startsAt}:F> (<t:${group.startsAt}:R>)`;
  return {
    title: group.title,
    description: group.description,
    color: COLORS[group.status],
    fields: [
      { name: 'When', value: when, inline: true },
      { name: 'Creator', value: `<@${group.creatorId}>`, inline: true },
      { name: 'Slots', value: buildSlotLines(group.slots, members).join('\n') },
    ],
    footer: { text: buildFooter(group.slots, members, group.status) },
  };
}
