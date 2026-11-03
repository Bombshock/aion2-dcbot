import {
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  type GuildMember,
  type ModalSubmitInteraction,
} from 'discord.js';
import type { Command } from './index.js';
import { formatLocalDateTime, parseFutureDateTime } from '../domain/datetime.js';
import { createEventsRepo } from '../db/events.js';
import { getDb } from '../db/instance.js';
import { buildEventModal, EVENT_FIELD as FIELD } from '../interactions/eventModal.js';
import { renderEventMessage } from '../interactions/eventMessage.js';
import { buildCustomId, registerHandler } from '../interactions/router.js';
import { getEventsChannel, getGuildSettings, SETUP_REQUIRED_MESSAGE } from '../settings.js';

const CREATE_AREA = 'evtcreate';

const data = new SlashCommandBuilder()
  .setName('event')
  .setDescription('Events')
  .setDMPermission(false)
  .addSubcommand((s) => s.setName('create').setDescription('Ein Event erstellen'));

const reply = (i: ChatInputCommandInteraction | ModalSubmitInteraction, content: string) =>
  i.reply({ content, flags: MessageFlags.Ephemeral });

/** Manage Guild or the organizer role from /setup. */
function canCreateEvents(member: GuildMember | null, organizerRoleId: string | null): boolean {
  if (!member) return false;
  if (member.permissions.has(PermissionFlagsBits.ManageGuild)) return true;
  return !!organizerRoleId && member.roles.cache.has(organizerRoleId);
}

const NOT_ALLOWED = 'Du brauchst die Berechtigung „Server verwalten“ oder die Organisator-Rolle, um Events zu erstellen.';

async function submit(i: ModalSubmitInteraction) {
  const guild = i.guild;
  if (!guild) return reply(i, 'Dieser Befehl funktioniert nur auf einem Server.');

  const title = i.fields.getTextInputValue(FIELD.title).trim();
  const description = i.fields.getTextInputValue(FIELD.description).trim();
  const when = i.fields.getTextInputValue(FIELD.when).trim();

  const settings = getGuildSettings(guild.id);
  if (!canCreateEvents(i.member as GuildMember | null, settings.organizerRoleId)) return reply(i, NOT_ALLOWED);

  const channel = await getEventsChannel(guild);
  if (!channel || !channel.isTextBased()) return reply(i, SETUP_REQUIRED_MESSAGE);

  const parsed = parseFutureDateTime(when, settings.timezone, Math.floor(Date.now() / 1000));
  if (!parsed.ok) {
    // Echo the typed values so the user can copy them into a new attempt.
    const text = [
      parsed.message,
      `Daten werden in ${settings.timezone} gelesen.`,
      '',
      'Deine Eingabe:',
      `Titel: ${title}`,
      `Datum & Uhrzeit: ${when}`,
      `Beschreibung:\n${description}`,
    ].join('\n');
    return reply(i, text.slice(0, 2000));
  }

  await i.deferReply({ flags: MessageFlags.Ephemeral });
  const repo = createEventsRepo(getDb());
  const event = repo.create({
    guildId: guild.id,
    channelId: channel.id,
    creatorId: i.user.id,
    title,
    description,
    startsAt: parsed.epochSeconds,
  });
  try {
    const message = await channel.send(renderEventMessage(event, []));
    repo.update(event.id, { messageId: message.id });
  } catch (err) {
    repo.delete(event.id);
    console.error('Posting event failed', err);
    await i.editReply(`Ich konnte nicht in <#${channel.id}> posten. Prüfe dort meine Berechtigungen.`);
    return;
  }
  await i.editReply(`Event in <#${channel.id}> erstellt.`);
}

registerHandler(CREATE_AREA, async (interaction) => {
  if (interaction.isModalSubmit()) await submit(interaction);
});

export const event: Command = {
  data,
  async execute(interaction) {
    const guild = interaction.guild;
    if (!guild) return reply(interaction, 'Dieser Befehl funktioniert nur auf einem Server.');
    switch (interaction.options.getSubcommand()) {
      case 'create': {
        const settings = getGuildSettings(guild.id);
        if (!canCreateEvents(interaction.member as GuildMember | null, settings.organizerRoleId)) return reply(interaction, NOT_ALLOWED);
        if (!settings.eventsChannelId) return reply(interaction, SETUP_REQUIRED_MESSAGE);
        // Prefill today's date (guild timezone) with the next full hour so only the time usually needs adjusting.
        const nextHour = Math.ceil(Date.now() / 3_600_000) * 3600;
        const when = formatLocalDateTime(nextHour, settings.timezone);
        return interaction.showModal(buildEventModal(buildCustomId(CREATE_AREA, 'submit'), 'Event erstellen', { when }));
      }
    }
  },
};
