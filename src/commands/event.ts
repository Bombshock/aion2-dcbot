import {
  ActionRowBuilder,
  MessageFlags,
  ModalBuilder,
  PermissionFlagsBits,
  SlashCommandBuilder,
  TextInputBuilder,
  TextInputStyle,
  type ChatInputCommandInteraction,
  type GuildMember,
  type ModalSubmitInteraction,
} from 'discord.js';
import type { Command } from './index.js';
import { DATE_FORMAT_HINT, parseFutureDateTime } from '../domain/datetime.js';
import { createEventsRepo } from '../db/events.js';
import { getDb } from '../db/instance.js';
import { renderEventMessage } from '../interactions/eventMessage.js';
import { buildCustomId, registerHandler } from '../interactions/router.js';
import { getEventsChannel, getGuildSettings, SETUP_REQUIRED_MESSAGE } from '../settings.js';

const CREATE_AREA = 'evtcreate';
const FIELD = { title: 'title', description: 'description', when: 'when' } as const;

const data = new SlashCommandBuilder()
  .setName('event')
  .setDescription('Events')
  .setDMPermission(false)
  .addSubcommand((s) => s.setName('create').setDescription('Create an event'));

const reply = (i: ChatInputCommandInteraction | ModalSubmitInteraction, content: string) =>
  i.reply({ content, flags: MessageFlags.Ephemeral });

/** Manage Guild or the organizer role from /setup. */
function canCreateEvents(member: GuildMember | null, organizerRoleId: string | null): boolean {
  if (!member) return false;
  if (member.permissions.has(PermissionFlagsBits.ManageGuild)) return true;
  return !!organizerRoleId && member.roles.cache.has(organizerRoleId);
}

const NOT_ALLOWED = 'You need the Manage Server permission or the organizer role to create events.';

function buildModal() {
  const row = (input: TextInputBuilder) => new ActionRowBuilder<TextInputBuilder>().addComponents(input);
  return new ModalBuilder()
    .setCustomId(buildCustomId(CREATE_AREA, 'submit'))
    .setTitle('Create event')
    .addComponents(
      row(new TextInputBuilder().setCustomId(FIELD.title).setLabel('Title').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(100)),
      row(
        new TextInputBuilder().setCustomId(FIELD.description).setLabel('Description').setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(2000),
      ),
      row(
        new TextInputBuilder()
          .setCustomId(FIELD.when)
          .setLabel(`Date & time (${DATE_FORMAT_HINT})`)
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setPlaceholder('2030-01-31 20:00')
          .setMaxLength(16),
      ),
    );
}

async function submit(i: ModalSubmitInteraction) {
  const guild = i.guild;
  if (!guild) return reply(i, 'This command only works in a server.');

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
      `Dates are read in ${settings.timezone}.`,
      '',
      'Your input:',
      `Title: ${title}`,
      `Date & time: ${when}`,
      `Description:\n${description}`,
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
    await i.editReply(`I couldn't post in <#${channel.id}>. Check my permissions there.`);
    return;
  }
  await i.editReply(`Event created in <#${channel.id}>.`);
}

registerHandler(CREATE_AREA, async (interaction) => {
  if (interaction.isModalSubmit()) await submit(interaction);
});

export const event: Command = {
  data,
  async execute(interaction) {
    const guild = interaction.guild;
    if (!guild) return reply(interaction, 'This command only works in a server.');
    switch (interaction.options.getSubcommand()) {
      case 'create': {
        const settings = getGuildSettings(guild.id);
        if (!canCreateEvents(interaction.member as GuildMember | null, settings.organizerRoleId)) return reply(interaction, NOT_ALLOWED);
        if (!settings.eventsChannelId) return reply(interaction, SETUP_REQUIRED_MESSAGE);
        return interaction.showModal(buildModal());
      }
    }
  },
};
