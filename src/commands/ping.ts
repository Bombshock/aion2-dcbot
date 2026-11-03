import { SlashCommandBuilder, type ChatInputCommandInteraction } from 'discord.js';
import type { Command } from './index.js';

export const ping: Command = {
  data: new SlashCommandBuilder().setName('ping').setDescription('Prüft, ob der Bot läuft'),
  async execute(interaction: ChatInputCommandInteraction) {
    await interaction.reply({ content: 'Pong!', ephemeral: true });
  },
};
