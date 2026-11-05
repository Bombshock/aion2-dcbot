import { MessageFlags, SlashCommandBuilder, type ChatInputCommandInteraction, type GuildMember } from 'discord.js';
import type { Command } from './index.js';
import { formatPostList } from './lfg.js';
import { autocompleteCreateOptions, buildCreateModal, canCreateEvents, EVENT_NOT_ALLOWED_MESSAGE, prepareCreate } from '../interactions/groupCreate.js';
import { getGuildSettings, SETUP_REQUIRED_MESSAGE } from '../settings.js';

const data = new SlashCommandBuilder()
  .setName('event')
  .setDescription('Events')
  .setDMPermission(false)
  .addSubcommand((s) =>
    s
      .setName('create')
      .setDescription('Ein Event aus einer Vorlage planen')
      .addStringOption((o) => o.setName('template').setDescription('Gruppenvorlage').setRequired(true).setAutocomplete(true))
      .addBooleanOption((o) => o.setName('weekly').setDescription('Nach dem Ende jede Woche neu posten (Standard: nein)')),
  )
  .addSubcommand((s) => s.setName('list').setDescription('Die anstehenden Events dieses Servers anzeigen'));

const reply = (i: ChatInputCommandInteraction, content: string) => i.reply({ content, flags: MessageFlags.Ephemeral });

/** Events are LFG posts planned by organizers: same template, form and post, but in the events channel and without a slot for the creator. */
export const event: Command = {
  data,
  async execute(interaction) {
    const guild = interaction.guild;
    if (!guild) return reply(interaction, 'Dieser Befehl funktioniert nur auf einem Server.');
    switch (interaction.options.getSubcommand()) {
      case 'list':
        return reply(interaction, formatPostList(guild.id, 'event') ?? 'Es gibt keine anstehenden Events.');
      case 'create': {
        const settings = getGuildSettings(guild.id);
        if (!canCreateEvents(interaction.member as GuildMember | null, settings.organizerRoleId)) return reply(interaction, EVENT_NOT_ALLOWED_MESSAGE);
        if (!settings.eventsChannelId) return reply(interaction, SETUP_REQUIRED_MESSAGE);
        const req = {
          kind: 'event',
          templateId: interaction.options.getString('template', true),
          weekly: interaction.options.getBoolean('weekly') ?? false,
        } as const;
        const prepared = prepareCreate(guild.id, interaction.user.id, req);
        if (!prepared.ok) return reply(interaction, prepared.message);
        return interaction.showModal(buildCreateModal(guild.id, req));
      }
    }
  },
  autocomplete: autocompleteCreateOptions,
};
