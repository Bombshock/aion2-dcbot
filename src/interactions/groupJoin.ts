import { MessageFlags, type Client } from 'discord.js';
import { createGroupsRepo, type GroupMember, type GroupRecord, type GroupsRepo } from '../db/groups.js';
import { getDb } from '../db/instance.js';
import { formatClass, getClass } from '../domain/classes.js';
import { joinableClassIds } from '../domain/groups.js';
import { parseSlotsJson } from '../domain/templates.js';
import { buildClassPicker } from './classPicker.js';
import { GROUP_AREA, renderGroupMessage } from './groupMessage.js';
import { registerHandler, type ComponentInteraction, type ParsedCustomId } from './router.js';

const DISCORD_UNKNOWN_CHANNEL = 10003;
const DISCORD_UNKNOWN_MESSAGE = 10008;

const NOT_FOUND_MESSAGE = 'This group no longer exists.';
const CLOSED_MESSAGE = 'This group is closed.';
const FULL_MESSAGE = 'This group is full';
export const GROUP_GONE_MESSAGE = 'The group post was deleted, so the group is now closed.';

type GroupAction = (interaction: ComponentInteraction, parsed: ParsedCustomId) => Promise<void>;
const actions = new Map<string, GroupAction>();

/** Registers a handler for `grp:<action>:<id>`; other tickets (create, manage, ...) add their actions here. */
export function registerGroupAction(action: string, handler: GroupAction): void {
  actions.set(action, handler);
}

registerHandler(GROUP_AREA, async (interaction, parsed) => {
  await actions.get(parsed.action)?.(interaction, parsed);
});

const ephemeral = (content: string) => ({ content, flags: MessageFlags.Ephemeral }) as const;

const toMemberViews = (members: GroupMember[]) => members.map((m) => ({ userId: m.userId, classId: m.classId, slotIndex: m.slotIndex }));

/** Re-renders the group post. Returns false (and closes the group) when the post is gone. */
export async function refreshGroupPost(client: Client, repo: GroupsRepo, group: GroupRecord): Promise<boolean> {
  try {
    if (!group.messageId) throw Object.assign(new Error('no message'), { code: DISCORD_UNKNOWN_MESSAGE });
    const channel = await client.channels.fetch(group.channelId);
    if (!channel?.isTextBased()) throw Object.assign(new Error('no channel'), { code: DISCORD_UNKNOWN_CHANNEL });
    const message = await channel.messages.fetch(group.messageId);
    const view = { ...group, slots: parseSlotsJson(group.slotsJson) };
    await message.edit(renderGroupMessage(view, toMemberViews(repo.listMembers(group.id))));
    return true;
  } catch (err) {
    const code = (err as { code?: number }).code;
    if (code !== DISCORD_UNKNOWN_MESSAGE && code !== DISCORD_UNKNOWN_CHANNEL) throw err;
    repo.update(group.id, { status: 'closed' });
    return false;
  }
}

/** Closes the group and re-renders its post; the one place to hook thread archiving into later. Returns false when the post is gone. */
export async function closeGroup(client: Client, repo: GroupsRepo, groupId: number): Promise<boolean> {
  const updated = repo.update(groupId, { status: 'closed' });
  return updated ? refreshGroupPost(client, repo, updated) : false;
}

/** Posts a plain message in the group's channel, pinging only the given users. Failures are logged, not thrown. */
async function announce(client: Client, group: GroupRecord, content: string, users: string[]): Promise<void> {
  try {
    const channel = await client.channels.fetch(group.channelId);
    if (channel?.isSendable()) await channel.send({ content, allowedMentions: { users } });
  } catch (err) {
    console.error('Group announcement failed', err);
  }
}

/** The class picker for the group, limited to classes that still fit; null when none does. */
function pickerFor(repo: GroupsRepo, group: GroupRecord, userId: string) {
  const members = repo.listMembers(group.id);
  const classIds = joinableClassIds(parseSlotsJson(group.slotsJson), members, userId);
  if (classIds.length === 0) return null;
  const current = members.find((m) => m.userId === userId);
  return buildClassPicker({ area: 'grp', id: group.id, classIds, currentClassId: current?.classId });
}

registerGroupAction('join', async (interaction, parsed) => {
  if (!interaction.isButton()) return;
  const repo = createGroupsRepo(getDb());
  const group = repo.get(Number(parsed.id));
  if (!group) return void (await interaction.reply(ephemeral(NOT_FOUND_MESSAGE)));
  if (group.status === 'closed') return void (await interaction.reply(ephemeral(CLOSED_MESSAGE)));
  const picker = pickerFor(repo, group, interaction.user.id);
  await interaction.reply(picker ?? ephemeral(FULL_MESSAGE));
});

registerGroupAction('pickclass', async (interaction, parsed) => {
  if (!interaction.isStringSelectMenu()) return;
  const repo = createGroupsRepo(getDb());
  const classId = interaction.values[0];
  if (!classId || !getClass(classId)) return void (await interaction.update({ content: 'Unknown class.', components: [] }));

  const result = repo.joinMember(Number(parsed.id), interaction.user.id, classId);
  if (!result.ok) {
    if (result.reason === 'not_found') return void (await interaction.update({ content: NOT_FOUND_MESSAGE, components: [] }));
    if (result.reason === 'closed') return void (await interaction.update({ content: CLOSED_MESSAGE, components: [] }));
    // Someone took the slot between opening the picker and picking: offer a fresh picker.
    const group = repo.get(Number(parsed.id))!;
    const picker = pickerFor(repo, group, interaction.user.id);
    if (!picker) return void (await interaction.update({ content: FULL_MESSAGE, components: [] }));
    return void (await interaction.update({ ...picker, content: 'Slot was just taken. Pick another class:' }));
  }

  await interaction.deferUpdate();
  const { group, slotIndex } = result;
  const ok = await refreshGroupPost(interaction.client, repo, group);
  const slotLabel = parseSlotsJson(group.slotsJson)[slotIndex]?.label ?? 'slot';
  await interaction.editReply({
    content: ok ? `You ${result.switched ? 'switched to' : 'joined as'} ${formatClass(classId)} (${slotLabel} slot)` : GROUP_GONE_MESSAGE,
    components: [],
  });
  if (!ok) return;

  const userId = interaction.user.id;
  if (!result.switched && group.creatorId !== userId) {
    await announce(interaction.client, group, `<@${group.creatorId}> <@${userId}> joined as ${formatClass(classId)} (${slotLabel}).`, [group.creatorId]);
  }
  if (result.becameFull) {
    const ids = result.members.map((m) => m.userId);
    await announce(interaction.client, group, `${ids.map((id) => `<@${id}>`).join(' ')} Group is ready!`, ids);
  }
});

registerGroupAction('leave', async (interaction, parsed) => {
  if (!interaction.isButton()) return;
  const repo = createGroupsRepo(getDb());
  const result = repo.leaveMember(Number(parsed.id), interaction.user.id);
  if (!result.ok) {
    const message = { not_found: NOT_FOUND_MESSAGE, closed: CLOSED_MESSAGE, not_member: "You're not in this group." }[result.reason];
    return void (await interaction.reply(ephemeral(message)));
  }
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const ok = await refreshGroupPost(interaction.client, repo, result.group);
  await interaction.editReply(ok ? 'You left the group.' : GROUP_GONE_MESSAGE);
  if (ok && result.newCreatorId) {
    await announce(interaction.client, result.group, `<@${result.newCreatorId}> is now the creator of this group.`, [result.newCreatorId]);
  }
});
