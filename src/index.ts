import { Client, Events, GatewayIntentBits, MessageFlags } from 'discord.js';
import { loadConfig } from './config.js';
import { commandMap } from './commands/index.js';
import { routeInteraction } from './interactions/router.js';

const config = loadConfig();
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once(Events.ClientReady, (c) => {
  console.log(`Logged in as ${c.user.tag}`);
});

client.on(Events.InteractionCreate, async (interaction) => {
  try {
    if (interaction.isChatInputCommand()) {
      await commandMap.get(interaction.commandName)?.execute(interaction);
    } else if (interaction.isMessageComponent() || interaction.isModalSubmit()) {
      await routeInteraction(interaction);
    }
  } catch (err) {
    console.error('Interaction failed', err);
    if (interaction.isRepliable()) {
      const reply = { content: 'Something went wrong.', flags: MessageFlags.Ephemeral } as const;
      if (interaction.replied || interaction.deferred) await interaction.followUp(reply).catch(() => {});
      else await interaction.reply(reply).catch(() => {});
    }
  }
});

await client.login(config.token);
