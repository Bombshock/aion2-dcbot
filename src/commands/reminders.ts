import { MessageFlags, SlashCommandBuilder, type ChatInputCommandInteraction } from 'discord.js';
import { getDb } from '../db/instance.js';
import { createUserSettingsRepo } from '../db/userSettings.js';
import type { Command } from './index.js';

export const reminders: Command = {
  data: new SlashCommandBuilder()
    .setName('reminders')
    .setDescription('Deine Erinnerungseinstellungen')
    .addSubcommand((sub) =>
      sub
        .setName('dm')
        .setDescription('Eine DM vor Events bekommen, für die du angemeldet bist')
        .addBooleanOption((o) => o.setName('enabled').setDescription('DM-Erinnerungen senden').setRequired(true)),
    ),
  async execute(interaction: ChatInputCommandInteraction) {
    const enabled = interaction.options.getBoolean('enabled', true);
    createUserSettingsRepo(getDb()).setDmReminders(interaction.user.id, enabled);
    await interaction.reply({ content: `DM-Erinnerungen sind jetzt ${enabled ? 'an' : 'aus'}.`, flags: MessageFlags.Ephemeral });
  },
};
