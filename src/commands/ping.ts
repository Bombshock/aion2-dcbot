import { SlashCommandBuilder, type ChatInputCommandInteraction } from 'discord.js';
import type { Command } from './index.js';

export const ping: Command = {
  data: new SlashCommandBuilder().setName('ping').setDescription('Check that the bot is alive'),
  async execute(interaction: ChatInputCommandInteraction) {
    await interaction.reply({ content: 'Pong!', ephemeral: true });
  },
};
