import { MessageFlags, SlashCommandBuilder, type ChatInputCommandInteraction } from 'discord.js';
import { getDb } from '../db/instance.js';
import { createUserSettingsRepo } from '../db/userSettings.js';
import type { Command } from './index.js';

export const reminders: Command = {
  data: new SlashCommandBuilder()
    .setName('reminders')
    .setDescription('Your reminder settings')
    .addSubcommand((sub) =>
      sub
        .setName('dm')
        .setDescription('Get a DM before events you signed up for')
        .addBooleanOption((o) => o.setName('enabled').setDescription('Send me DM reminders').setRequired(true)),
    ),
  async execute(interaction: ChatInputCommandInteraction) {
    const enabled = interaction.options.getBoolean('enabled', true);
    createUserSettingsRepo(getDb()).setDmReminders(interaction.user.id, enabled);
    await interaction.reply({ content: `DM reminders are now ${enabled ? 'on' : 'off'}.`, flags: MessageFlags.Ephemeral });
  },
};
