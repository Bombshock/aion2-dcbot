import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
  PermissionFlagsBits,
  StringSelectMenuBuilder,
  UserSelectMenuBuilder,
  type ButtonInteraction,
  type Client,
  type ModalSubmitInteraction,
} from 'discord.js';
import { formatLocalDateTime, parseFutureDateTime } from '../domain/datetime.js';
import { formatClass } from '../domain/classes.js';
import { SCHEDULE } from '../domain/schedule.js';
import { formatTimeChangeNotice } from '../domain/eventMessage.js';
import { createEventsRepo, type EventRecord } from '../db/events.js';
import { getDb } from '../db/instance.js';
import { getGuildSettings } from '../settings.js';
import { buildEventModal, EVENT_FIELD } from './eventModal.js';
import { EVENT_AREA } from './eventMessage.js';
import { refreshEventPost, registerEventAction, EVENT_GONE_MESSAGE } from './eventSignup.js';
import { buildCustomId, type ComponentInteraction } from './router.js';

const NOT_FOUND_MESSAGE = 'Dieses Event existiert nicht mehr.';
export const MANAGE_REFUSED_MESSAGE = 'Nur der Organisator kann dieses Event verwalten.';
const SELECT_LIMIT = 25;

const ephemeral = (content: string) => ({ content, flags: MessageFlags.Ephemeral }) as const;
const nowSeconds = () => Math.floor(Date.now() / 1000);

/** Why the user may not manage the event, or null: the creator and members with Manage Guild may, while it is open. */
export function manageRefusal(event: EventRecord | undefined, userId: string, canManageGuild: boolean): string | null {
  if (!event) return NOT_FOUND_MESSAGE;
  if (event.creatorId !== userId && !canManageGuild) return MANAGE_REFUSED_MESSAGE;
  if (event.status === 'cancelled') return 'Dieses Event wurde abgesagt.';
  if (event.status === 'ended') return 'Dieses Event ist bereits beendet.';
  return null;
}

/** Loads the event of a `evt:<action>:<id>` interaction; replies with the refusal and returns null when not allowed. */
async function loadManagedEvent(interaction: ComponentInteraction, id: string, reply: (content: string) => Promise<unknown>) {
  const repo = createEventsRepo(getDb());
  const event = repo.get(Number(id));
  const refusal = manageRefusal(event, interaction.user.id, !!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild));
  if (refusal || !event) {
    await reply(refusal ?? NOT_FOUND_MESSAGE);
    return null;
  }
  return { repo, event };
}

const replyEphemeral = (i: ButtonInteraction | ModalSubmitInteraction) => (content: string) => i.reply(ephemeral(content));
const updateMessage = (i: ComponentInteraction) => (content: string) =>
  i.isMessageComponent() ? i.update({ content, components: [] }) : i.reply(ephemeral(content));

registerEventAction('manage', async (interaction, parsed) => {
  if (!interaction.isButton()) return;
  const found = await loadManagedEvent(interaction, parsed.id, replyEphemeral(interaction));
  if (!found) return;
  const id = found.event.id;
  const button = (action: string, label: string, style: ButtonStyle) =>
    new ButtonBuilder().setCustomId(buildCustomId(EVENT_AREA, action, id)).setLabel(label).setStyle(style);
  await interaction.reply({
    content: `**${found.event.title}** verwalten`,
    flags: MessageFlags.Ephemeral,
    components: [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        button('edit', 'Bearbeiten', ButtonStyle.Primary),
        button('remove', 'Teilnehmer entfernen', ButtonStyle.Secondary),
        button('cancel', 'Event absagen', ButtonStyle.Danger),
      ),
    ],
  });
});

registerEventAction('edit', async (interaction, parsed) => {
  if (!interaction.isButton()) return;
  const found = await loadManagedEvent(interaction, parsed.id, replyEphemeral(interaction));
  if (!found) return;
  const { event } = found;
  const { timezone } = getGuildSettings(event.guildId);
  await interaction.showModal(
    buildEventModal(buildCustomId(EVENT_AREA, 'editsubmit', event.id), 'Event bearbeiten', {
      title: event.title,
      description: event.description,
      when: formatLocalDateTime(event.startsAt, timezone),
    }),
  );
});

/** Tells the signed-up users about a new start time in a reply to the event post. Failures are logged, not fatal. */
async function announceTimeChange(client: Client, event: EventRecord, userIds: string[]) {
  try {
    const channel = await client.channels.fetch(event.channelId);
    if (!channel?.isTextBased() || !('send' in channel)) return;
    await channel.send({
      content: formatTimeChangeNotice(userIds, event.startsAt),
      allowedMentions: { users: userIds },
      reply: event.messageId ? { messageReference: event.messageId, failIfNotExists: false } : undefined,
    });
  } catch (err) {
    console.error('Announcing the time change failed', err);
  }
}

registerEventAction('editsubmit', async (interaction, parsed) => {
  if (!interaction.isModalSubmit()) return;
  const found = await loadManagedEvent(interaction, parsed.id, replyEphemeral(interaction));
  if (!found) return;
  const { repo, event } = found;

  const title = interaction.fields.getTextInputValue(EVENT_FIELD.title).trim();
  const description = interaction.fields.getTextInputValue(EVENT_FIELD.description).trim();
  const when = interaction.fields.getTextInputValue(EVENT_FIELD.when).trim();
  const { timezone } = getGuildSettings(event.guildId);

  // An unchanged time stays valid even if it has passed; a new time must lie in the future.
  const unchanged = when === formatLocalDateTime(event.startsAt, timezone);
  const parsedTime = unchanged ? ({ ok: true, epochSeconds: event.startsAt } as const) : parseFutureDateTime(when, timezone, nowSeconds());
  if (!parsedTime.ok) {
    const text = [parsedTime.message, `Daten werden in ${timezone} gelesen.`, '', 'Deine Eingabe:', `Titel: ${title}`, `Datum & Uhrzeit: ${when}`, `Beschreibung:\n${description}`].join('\n');
    return void (await interaction.reply(ephemeral(text.slice(0, 2000))));
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  // A new start more than the reminder lead ahead gets its own reminder.
  const resetReminder = parsedTime.epochSeconds !== event.startsAt && parsedTime.epochSeconds - SCHEDULE.eventReminderLeadSeconds > nowSeconds();
  const updated = repo.update(event.id, { title, description, startsAt: parsedTime.epochSeconds, ...(resetReminder ? { remindedAt: null } : {}) });
  if (!updated) return void (await interaction.editReply(NOT_FOUND_MESSAGE));
  const ok = await refreshEventPost(interaction.client, repo, updated);
  if (!ok) return void (await interaction.editReply(EVENT_GONE_MESSAGE));
  const signedUp = repo.listSignups(event.id).map((s) => s.userId);
  if (updated.startsAt !== event.startsAt) await announceTimeChange(interaction.client, updated, signedUp);
  await interaction.editReply('Event aktualisiert.');
});

registerEventAction('remove', async (interaction, parsed) => {
  if (!interaction.isButton()) return;
  const found = await loadManagedEvent(interaction, parsed.id, updateMessage(interaction));
  if (!found) return;
  const signups = found.repo.listSignups(found.event.id);
  if (signups.length === 0) return void (await interaction.update({ content: 'Es hat sich noch niemand angemeldet.', components: [] }));

  const customId = buildCustomId(EVENT_AREA, 'removepick', found.event.id);
  // A string select can list at most 25 options; larger rosters fall back to a user select that is checked on submit.
  if (signups.length > SELECT_LIMIT) {
    const select = new UserSelectMenuBuilder().setCustomId(customId).setPlaceholder('Zu entfernender Teilnehmer');
    return void (await interaction.update({ content: 'Wähle den Teilnehmer, der entfernt werden soll.', components: [new ActionRowBuilder<UserSelectMenuBuilder>().addComponents(select)] }));
  }
  const names = new Map<string, string>();
  await Promise.all(
    signups.map(async (s) => {
      const member = await interaction.guild?.members.fetch(s.userId).catch(() => null);
      names.set(s.userId, member?.displayName ?? s.userId);
    }),
  );
  const select = new StringSelectMenuBuilder()
    .setCustomId(customId)
    .setPlaceholder('Zu entfernender Teilnehmer')
    .addOptions(signups.map((s) => ({ label: (names.get(s.userId) ?? s.userId).slice(0, 100), description: formatClass(s.classId).slice(0, 100), value: s.userId })));
  await interaction.update({ content: 'Wähle den Teilnehmer, der entfernt werden soll.', components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select)] });
});

registerEventAction('removepick', async (interaction, parsed) => {
  if (!interaction.isStringSelectMenu() && !interaction.isUserSelectMenu()) return;
  const found = await loadManagedEvent(interaction, parsed.id, updateMessage(interaction));
  if (!found) return;
  const { repo, event } = found;
  const userId = interaction.values[0];
  if (!userId || !repo.removeSignup(event.id, userId)) return void (await interaction.update({ content: 'Dieser Nutzer ist nicht angemeldet.', components: [] }));

  await interaction.deferUpdate();
  const ok = await refreshEventPost(interaction.client, repo, event);
  await interaction.editReply({ content: ok ? `<@${userId}> wurde aus dem Event entfernt.` : EVENT_GONE_MESSAGE, components: [] });
});

registerEventAction('cancel', async (interaction, parsed) => {
  if (!interaction.isButton()) return;
  const found = await loadManagedEvent(interaction, parsed.id, updateMessage(interaction));
  if (!found) return;
  const button = (action: string, label: string, style: ButtonStyle) =>
    new ButtonBuilder().setCustomId(buildCustomId(EVENT_AREA, action, found.event.id)).setLabel(label).setStyle(style);
  await interaction.update({
    content: `**${found.event.title}** absagen? Das kann nicht rückgängig gemacht werden.`,
    components: [new ActionRowBuilder<ButtonBuilder>().addComponents(button('cancelconfirm', 'Ja, Event absagen', ButtonStyle.Danger), button('cancelabort', 'Event behalten', ButtonStyle.Secondary))],
  });
});

registerEventAction('cancelabort', async (interaction) => {
  if (!interaction.isButton()) return;
  await interaction.update({ content: 'Das Event wurde behalten.', components: [] });
});

registerEventAction('cancelconfirm', async (interaction, parsed) => {
  if (!interaction.isButton()) return;
  const found = await loadManagedEvent(interaction, parsed.id, updateMessage(interaction));
  if (!found) return;
  const { repo } = found;
  await interaction.deferUpdate();
  const updated = repo.update(found.event.id, { status: 'cancelled' });
  const ok = updated ? await refreshEventPost(interaction.client, repo, updated) : false;
  await interaction.editReply({ content: ok ? 'Das Event wurde abgesagt.' : EVENT_GONE_MESSAGE, components: [] });
});
