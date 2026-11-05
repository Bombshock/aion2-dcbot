import { ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags, PermissionFlagsBits, StringSelectMenuBuilder, type Client } from 'discord.js';
import { createGroupsRepo, type GroupRecord } from '../db/groups.js';
import { getDb } from '../db/instance.js';
import { formatClass } from '../domain/classes.js';
import { formatDuration, formatLocalDateTime, parseDuration, parseFutureDateTime } from '../domain/datetime.js';
import { formatRepeat, formatTimeChangeNotice } from '../domain/groups.js';
import { SCHEDULE } from '../domain/schedule.js';
import { getGuildSettings } from '../settings.js';
import { GROUP_AREA } from './groupMessage.js';
import { buildGroupModal, GROUP_FIELD as FIELD } from './groupModal.js';
import { closeGroup, GROUP_GONE_MESSAGE, refreshGroupPost, registerGroupAction } from './groupJoin.js';
import { buildCustomId, dismissReply, type ComponentInteraction } from './router.js';

const NOT_FOUND_MESSAGE = 'Diese Gruppe existiert nicht mehr.';
export const GROUP_MANAGE_REFUSED_MESSAGE = 'Nur der Ersteller kann diese Gruppe verwalten.';

const ephemeral = (content: string) => ({ content, flags: MessageFlags.Ephemeral }) as const;
const nowSeconds = () => Math.floor(Date.now() / 1000);

/** Why the user may not manage the group, or null: the creator and members with Manage Guild may, while it isn't closed. */
export function groupManageRefusal(group: GroupRecord | undefined, userId: string, canManageGuild: boolean): string | null {
  if (!group) return NOT_FOUND_MESSAGE;
  if (group.creatorId !== userId && !canManageGuild) return GROUP_MANAGE_REFUSED_MESSAGE;
  if (group.status === 'closed') return 'Diese Gruppe ist geschlossen.';
  return null;
}

/** Loads the group of a `grp:<action>:<id>` interaction; replies with the refusal and returns null when not allowed. */
async function loadManagedGroup(interaction: ComponentInteraction, id: string) {
  const repo = createGroupsRepo(getDb());
  const group = repo.get(Number(id));
  const refusal = groupManageRefusal(group, interaction.user.id, !!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild));
  if (refusal || !group) {
    const content = refusal ?? NOT_FOUND_MESSAGE;
    if (interaction.isMessageComponent() && interaction.message.flags.has(MessageFlags.Ephemeral)) await interaction.update({ content, components: [] });
    else await interaction.reply(ephemeral(content));
    return null;
  }
  return { repo, group };
}

const button = (action: string, label: string, style: ButtonStyle, id: number) =>
  new ButtonBuilder().setCustomId(buildCustomId(GROUP_AREA, action, id)).setLabel(label).setStyle(style);

registerGroupAction('manage', async (interaction, parsed) => {
  if (!interaction.isButton()) return;
  const found = await loadManagedGroup(interaction, parsed.id);
  if (!found) return;
  const { group } = found;
  const id = group.id;
  // Only events with a start time can repeat; the label says what clicking does.
  const repeatButton =
    group.kind === 'event' && group.startsAt !== null
      ? [button('repeat', group.repeatDays ? 'Wiederholung beenden' : 'Wöchentlich wiederholen', ButtonStyle.Secondary, id)]
      : [];
  await interaction.reply({
    content: `**${group.title}** verwalten`,
    flags: MessageFlags.Ephemeral,
    components: [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        button('edit', 'Bearbeiten', ButtonStyle.Primary, id),
        button('kick', 'Mitglied entfernen', ButtonStyle.Secondary, id),
        ...repeatButton,
        button('close', 'Gruppe schließen', ButtonStyle.Danger, id),
      ),
    ],
  });
});

registerGroupAction('edit', async (interaction, parsed) => {
  if (!interaction.isButton()) return;
  const found = await loadManagedGroup(interaction, parsed.id);
  if (!found) return;
  const { group } = found;
  const { timezone } = getGuildSettings(group.guildId);
  await interaction.showModal(
    buildGroupModal(buildCustomId(GROUP_AREA, 'editsubmit', group.id), group.kind === 'event' ? 'Event bearbeiten' : 'Gruppe bearbeiten', {
      timeRequired: group.kind === 'event',
      withDuration: group.kind === 'event',
      values: {
        title: group.title,
        description: group.description,
        when: group.startsAt === null ? '' : formatLocalDateTime(group.startsAt, timezone),
        duration: formatDuration(group.durationSeconds ?? SCHEDULE.groupExpiryAfterStartSeconds),
      },
    }),
  );
});

/** Tells the members about a new start time in a reply to the post. Failures are logged, not fatal. */
async function announceTimeChange(client: Client, group: GroupRecord, startsAt: number, userIds: string[]) {
  try {
    const channel = await client.channels.fetch(group.channelId);
    if (!channel?.isSendable()) return;
    await channel.send({
      content: formatTimeChangeNotice(userIds, startsAt),
      allowedMentions: { users: userIds },
      reply: group.messageId ? { messageReference: group.messageId, failIfNotExists: false } : undefined,
    });
  } catch (err) {
    console.error('Announcing the time change failed', err);
  }
}

registerGroupAction('editsubmit', async (interaction, parsed) => {
  if (!interaction.isModalSubmit()) return;
  const found = await loadManagedGroup(interaction, parsed.id);
  if (!found) return;
  const { repo, group } = found;

  const title = interaction.fields.getTextInputValue(FIELD.title).trim();
  const description = interaction.fields.getTextInputValue(FIELD.description).trim();
  const when = interaction.fields.getTextInputValue(FIELD.when).trim();
  const duration = group.kind === 'event' ? interaction.fields.getTextInputValue(FIELD.duration).trim() : '';
  const { timezone } = getGuildSettings(group.guildId);
  const echo = async (message: string) => {
    const text = [message, `Daten werden in ${timezone} gelesen.`, '', 'Deine Eingabe:', `Titel: ${title}`, `Wann: ${when}`, ...(duration ? [`Dauer: ${duration}`] : []), `Beschreibung:\n${description}`].join('\n');
    await interaction.reply(ephemeral(text.slice(0, 2000)));
  };

  // An unchanged time stays valid even if it has passed; a new time must lie in the future.
  let startsAt: number | null = null;
  if (when) {
    const unchanged = group.startsAt !== null && when === formatLocalDateTime(group.startsAt, timezone);
    const parsedTime = unchanged ? ({ ok: true, epochSeconds: group.startsAt! } as const) : parseFutureDateTime(when, timezone, nowSeconds());
    if (!parsedTime.ok) return echo(parsedTime.message);
    startsAt = parsedTime.epochSeconds;
  }
  let durationSeconds: number | undefined;
  if (group.kind === 'event') {
    const parsedDuration = parseDuration(duration);
    if (!parsedDuration.ok) return echo(parsedDuration.message);
    durationSeconds = parsedDuration.seconds;
  }

  // The modal was opened from the ephemeral manage panel; that panel is replaced by errors or removed on success.
  await interaction.deferUpdate();
  // A new start more than the reminder lead ahead gets its own reminder.
  const resetReminder = startsAt !== group.startsAt && startsAt !== null && startsAt - SCHEDULE.reminderLeadSeconds > nowSeconds();
  const updated = repo.update(group.id, { title, description, startsAt, durationSeconds, ...(resetReminder ? { remindedAt: null } : {}) });
  if (!updated) return void (await interaction.editReply({ content: NOT_FOUND_MESSAGE, components: [] }));
  const ok = await refreshGroupPost(interaction.client, repo, updated);
  if (!ok) return void (await interaction.editReply({ content: GROUP_GONE_MESSAGE, components: [] }));
  if (startsAt !== null && startsAt !== group.startsAt) {
    const memberIds = repo.listMembers(group.id).map((m) => m.userId);
    await announceTimeChange(interaction.client, updated, startsAt, memberIds);
  }
  await dismissReply(interaction);
});

/** Turns the weekly repeat of an event on or off and re-renders the post; the panel confirms the new state. */
registerGroupAction('repeat', async (interaction, parsed) => {
  if (!interaction.isButton()) return;
  const found = await loadManagedGroup(interaction, parsed.id);
  if (!found) return;
  const { repo, group } = found;
  if (group.kind !== 'event' || group.startsAt === null) {
    return void (await interaction.update({ content: 'Nur Events mit Startzeit können sich wiederholen.', components: [] }));
  }
  await interaction.deferUpdate();
  const updated = repo.update(group.id, { repeatDays: group.repeatDays ? null : SCHEDULE.eventRepeatDays });
  if (!updated) return void (await interaction.editReply({ content: NOT_FOUND_MESSAGE, components: [] }));
  const ok = await refreshGroupPost(interaction.client, repo, updated);
  if (!ok) return void (await interaction.editReply({ content: GROUP_GONE_MESSAGE, components: [] }));
  const state = updated.repeatDays ? `🔁 ${formatRepeat(updated.repeatDays)}: nach dem Ende wird ein neuer Termin gepostet.` : 'Die Wiederholung ist beendet.';
  await interaction.editReply({ content: state, components: [] });
});

registerGroupAction('kick', async (interaction, parsed) => {
  if (!interaction.isButton()) return;
  const found = await loadManagedGroup(interaction, parsed.id);
  if (!found) return;
  const { repo, group } = found;
  const others = repo.listMembers(group.id).filter((m) => m.userId !== group.creatorId);
  if (others.length === 0) return void (await interaction.update({ content: 'Es gibt niemanden zum Entfernen.', components: [] }));

  const names = new Map<string, string>();
  await Promise.all(
    others.map(async (m) => {
      const member = await interaction.guild?.members.fetch(m.userId).catch(() => null);
      names.set(m.userId, member?.displayName ?? m.userId);
    }),
  );
  const select = new StringSelectMenuBuilder()
    .setCustomId(buildCustomId(GROUP_AREA, 'kickpick', group.id))
    .setPlaceholder('Zu entfernendes Mitglied')
    .addOptions(others.map((m) => ({ label: (names.get(m.userId) ?? m.userId).slice(0, 100), description: formatClass(m.classId).slice(0, 100), value: m.userId })));
  await interaction.update({ content: 'Wähle das Mitglied, das entfernt werden soll.', components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select)] });
});

registerGroupAction('kickpick', async (interaction, parsed) => {
  if (!interaction.isStringSelectMenu()) return;
  const found = await loadManagedGroup(interaction, parsed.id);
  if (!found) return;
  const { repo, group } = found;
  const userId = interaction.values[0] ?? '';
  const result = repo.kickMember(group.id, userId);
  if (!result.ok) {
    const message = {
      not_found: NOT_FOUND_MESSAGE,
      closed: 'Diese Gruppe ist geschlossen.',
      creator: 'Der Ersteller kann nicht entfernt werden. Schließe oder verlasse die Gruppe stattdessen.',
      not_member: 'Dieser Nutzer ist nicht in der Gruppe.',
    }[result.reason];
    return void (await interaction.update({ content: message, components: [] }));
  }
  await interaction.deferUpdate();
  const ok = await refreshGroupPost(interaction.client, repo, result.group);
  if (!ok) return void (await interaction.editReply({ content: GROUP_GONE_MESSAGE, components: [] }));
  await dismissReply(interaction);
});

registerGroupAction('close', async (interaction, parsed) => {
  if (!interaction.isButton()) return;
  const found = await loadManagedGroup(interaction, parsed.id);
  if (!found) return;
  const id = found.group.id;
  await interaction.update({
    content: [
      `**${found.group.title}** schließen? Das kann nicht rückgängig gemacht werden.`,
      ...(found.group.repeatDays ? ['Die Wiederholung endet damit, es wird kein neuer Termin gepostet.'] : []),
    ].join('\n'),
    components: [
      new ActionRowBuilder<ButtonBuilder>().addComponents(button('closeconfirm', 'Ja, Gruppe schließen', ButtonStyle.Danger, id), button('closeabort', 'Gruppe behalten', ButtonStyle.Secondary, id)),
    ],
  });
});

registerGroupAction('closeabort', async (interaction) => {
  if (!interaction.isButton()) return;
  await interaction.deferUpdate();
  await dismissReply(interaction);
});

registerGroupAction('closeconfirm', async (interaction, parsed) => {
  if (!interaction.isButton()) return;
  const found = await loadManagedGroup(interaction, parsed.id);
  if (!found) return;
  const { repo } = found;
  await interaction.deferUpdate();
  const ok = await closeGroup(interaction.client, repo, found.group.id);
  if (!ok) return void (await interaction.editReply({ content: GROUP_GONE_MESSAGE, components: [] }));
  await dismissReply(interaction);
});
