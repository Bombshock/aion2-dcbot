import { MessageFlags, type Client } from 'discord.js';
import { createGroupsRepo, type GroupMember, type GroupRecord, type GroupsRepo } from '../db/groups.js';
import { getDb } from '../db/instance.js';
import { createUserSettingsRepo } from '../db/userSettings.js';
import { getClass } from '../domain/classes.js';
import { joinableClassIds } from '../domain/groups.js';
import { parseSlotsJson } from '../domain/templates.js';
import { buildClassPicker } from './classPicker.js';
import { GROUP_AREA, renderGroupMessage } from './groupMessage.js';
import { dismissReply, registerHandler, type ComponentInteraction, type ParsedCustomId } from './router.js';

const DISCORD_UNKNOWN_CHANNEL = 10003;
const DISCORD_UNKNOWN_MESSAGE = 10008;

const NOT_FOUND_MESSAGE = 'Diese Gruppe existiert nicht mehr.';
const CLOSED_MESSAGE = 'Diese Gruppe ist geschlossen.';
const FULL_MESSAGE = 'Diese Gruppe ist voll';
export const GROUP_GONE_MESSAGE = 'Der Gruppen-Post wurde gelöscht, daher ist die Gruppe jetzt geschlossen.';
const DM_TIP = 'Tipp: Mit `/reminders dm` bekommst du vor dem Start auch eine DM.';

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

/** The group's post, or null when it or its channel was deleted. Other errors (missing access, outages) are thrown. */
async function fetchGroupPost(client: Client, group: GroupRecord) {
  if (!group.messageId) return null;
  try {
    const channel = await client.channels.fetch(group.channelId);
    if (!channel?.isTextBased()) return null;
    return await channel.messages.fetch(group.messageId);
  } catch (err) {
    const code = (err as { code?: number }).code;
    if (code === DISCORD_UNKNOWN_MESSAGE || code === DISCORD_UNKNOWN_CHANNEL) return null;
    throw err;
  }
}

/** Deletes the channel notifications posted for the group (reminders, announcements) and forgets them. Best effort: failures are logged, already deleted ones skipped. */
async function deleteReminderMessages(client: Client, repo: GroupsRepo, group: GroupRecord): Promise<void> {
  if (group.reminderMessageIds.length === 0) return;
  repo.update(group.id, { reminderMessageIds: [] });
  try {
    const channel = await client.channels.fetch(group.channelId);
    if (!channel?.isTextBased()) return;
    for (const id of group.reminderMessageIds) {
      await channel.messages.delete(id).catch((err) => {
        if ((err as { code?: number }).code !== DISCORD_UNKNOWN_MESSAGE) throw err;
      });
    }
  } catch (err) {
    const code = (err as { code?: number }).code;
    if (code !== DISCORD_UNKNOWN_CHANNEL) console.error(`Deleting the reminder of group ${group.id} failed`, err);
  }
}

/**
 * Re-renders the group post, or deletes it (and its start reminder) once the group is closed. Returns false (and closes the
 * group) when the post is gone.
 */
export async function refreshGroupPost(client: Client, repo: GroupsRepo, group: GroupRecord): Promise<boolean> {
  if (group.status === 'closed') await deleteReminderMessages(client, repo, group);
  const message = await fetchGroupPost(client, group);
  const view = { ...group, slots: parseSlotsJson(group.slotsJson) };
  const write = message && (group.status === 'closed' ? message.delete() : message.edit(renderGroupMessage(view, toMemberViews(repo.listMembers(group.id)))));
  const edited = await write?.then(
    () => true,
    (err) => {
      // Deleted between fetch and edit.
      if ((err as { code?: number }).code === DISCORD_UNKNOWN_MESSAGE) return false;
      throw err;
    },
  );
  if (edited) return true;
  const closed = repo.update(group.id, { status: 'closed' });
  if (closed && group.status !== 'closed') await deleteReminderMessages(client, repo, closed);
  return false;
}

/**
 * Closes the given groups whose post was deleted, e.g. by a moderator while the bot was offline, and deletes their
 * notifications. A post that can't be checked counts as still there.
 */
export async function closeVanishedGroups(client: Client, repo: GroupsRepo, groups: readonly GroupRecord[]): Promise<void> {
  await Promise.all(
    groups.map(async (group) => {
      const gone = await fetchGroupPost(client, group).then(
        (message) => message === null,
        (err) => (console.error('Checking group post failed', err), false),
      );
      const closed = gone && repo.update(group.id, { status: 'closed' });
      if (closed) await deleteReminderMessages(client, repo, closed);
    }),
  );
}

/** Closes the groups whose post was among the deleted messages and deletes their notifications. */
export async function closeGroupsOfDeletedPosts(client: Client, messageIds: readonly string[]): Promise<void> {
  const repo = createGroupsRepo(getDb());
  for (const group of repo.listActiveByMessageIds(messageIds)) {
    const closed = repo.update(group.id, { status: 'closed' });
    if (closed) await deleteReminderMessages(client, repo, closed);
  }
}

/** Closes the group and deletes its post; the one place to hook thread archiving into later. Returns false when the post is gone. */
export async function closeGroup(client: Client, repo: GroupsRepo, groupId: number): Promise<boolean> {
  const updated = repo.update(groupId, { status: 'closed' });
  return updated ? refreshGroupPost(client, repo, updated) : false;
}

/**
 * Posts a plain message in the group's channel as a reply to the group post, pinging only the given users, and remembers it
 * so it is deleted once the group closes. The reply also lets /cleanup tie it to its group. Failures are logged, not thrown.
 */
async function announce(client: Client, repo: GroupsRepo, group: GroupRecord, content: string, users: string[]): Promise<void> {
  try {
    const channel = await client.channels.fetch(group.channelId);
    if (!channel?.isSendable()) return;
    const reply = group.messageId ? { messageReference: group.messageId, failIfNotExists: false } : undefined;
    repo.addNotificationMessageIds(group.id, [(await channel.send({ content, allowedMentions: { users }, reply })).id]);
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
  if (!classId || !getClass(classId)) return void (await interaction.update({ content: 'Unbekannte Klasse.', components: [] }));

  const result = repo.joinMember(Number(parsed.id), interaction.user.id, classId);
  if (!result.ok) {
    if (result.reason === 'not_found') return void (await interaction.update({ content: NOT_FOUND_MESSAGE, components: [] }));
    if (result.reason === 'closed') return void (await interaction.update({ content: CLOSED_MESSAGE, components: [] }));
    // Someone took the slot between opening the picker and picking: offer a fresh picker.
    const group = repo.get(Number(parsed.id))!;
    const picker = pickerFor(repo, group, interaction.user.id);
    if (!picker) return void (await interaction.update({ content: FULL_MESSAGE, components: [] }));
    return void (await interaction.update({ ...picker, content: 'Der Platz wurde gerade vergeben. Wähle eine andere Klasse:' }));
  }

  await interaction.deferUpdate();
  const { group } = result;
  const ok = await refreshGroupPost(interaction.client, repo, group);
  if (!ok) return void (await interaction.editReply({ content: GROUP_GONE_MESSAGE, components: [] }));
  const userId = interaction.user.id;
  // The post shows the join; the picker only stays to carry the DM tip for a timed group when the user hasn't turned DMs on.
  if (group.startsAt === null || createUserSettingsRepo(getDb()).getDmReminders(userId)) await dismissReply(interaction);
  else await interaction.editReply({ content: DM_TIP, components: [] });

  if (result.becameFull) {
    const ids = result.members.map((m) => m.userId);
    await announce(interaction.client, repo, group, `${ids.map((id) => `<@${id}>`).join(' ')} Die Gruppe ist bereit!`, ids);
  }
});

registerGroupAction('leave', async (interaction, parsed) => {
  if (!interaction.isButton()) return;
  const repo = createGroupsRepo(getDb());
  const result = repo.leaveMember(Number(parsed.id), interaction.user.id);
  if (!result.ok) {
    const message = { not_found: NOT_FOUND_MESSAGE, closed: CLOSED_MESSAGE, not_member: 'Du bist nicht in dieser Gruppe.' }[result.reason];
    return void (await interaction.reply(ephemeral(message)));
  }
  // The button sits on the public post: acknowledge silently, the refreshed post shows the change.
  await interaction.deferUpdate();
  const ok = await refreshGroupPost(interaction.client, repo, result.group);
  if (!ok) return void (await interaction.followUp(ephemeral(GROUP_GONE_MESSAGE)));
  if (result.newCreatorId) {
    await announce(interaction.client, repo, result.group, `<@${result.newCreatorId}> ist jetzt Ersteller dieser Gruppe.`, [result.newCreatorId]);
  }
});
