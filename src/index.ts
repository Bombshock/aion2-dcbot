import { Client, Events, GatewayIntentBits, MessageFlags, Partials } from 'discord.js';
import { loadConfig } from './config.js';
import { canUseCommand, commandMap, COMMAND_NOT_ALLOWED_MESSAGE } from './commands/index.js';
import { routeInteraction } from './interactions/router.js';
import './interactions/groupCreate.js';
import './interactions/groupManage.js';
import { closeGroupsOfDeletedPosts } from './interactions/groupJoin.js';
import { getDb } from './db/instance.js';
import { startScheduler } from './scheduler.js';
import { syncClassEmojis } from './classEmojis.js';

const config = loadConfig();
// GuildMessages and the Message partial deliver deletions of group posts, also of posts not in the cache.
const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages], partials: [Partials.Message] });

client.once(Events.ClientReady, async (c) => {
  console.log(`Logged in as ${c.user.tag}`);
  await syncClassEmojis(c).catch((err) => console.warn('Class emoji sync failed, using fallbacks', err));
  startScheduler(c, getDb());
});

client.on(Events.MessageDelete, (message) => closeGroupsOfDeletedPosts([message.id]));
client.on(Events.MessageBulkDelete, (messages) => closeGroupsOfDeletedPosts([...messages.keys()]));

client.on(Events.InteractionCreate, async (interaction) => {
  try {
    if (interaction.isChatInputCommand()) {
      const command = commandMap.get(interaction.commandName);
      if (!command) return;
      if (!canUseCommand(command, interaction)) {
        await interaction.reply({ content: COMMAND_NOT_ALLOWED_MESSAGE, flags: MessageFlags.Ephemeral });
        return;
      }
      await command.execute(interaction);
    } else if (interaction.isAutocomplete()) {
      const command = commandMap.get(interaction.commandName);
      if (!command) return;
      if (!canUseCommand(command, interaction)) {
        await interaction.respond([]);
        return;
      }
      await command.autocomplete?.(interaction);
    } else if (interaction.isMessageComponent() || interaction.isModalSubmit()) {
      await routeInteraction(interaction);
    }
  } catch (err) {
    console.error('Interaction failed', err);
    if (interaction.isRepliable()) {
      const reply = { content: 'Etwas ist schiefgelaufen.', flags: MessageFlags.Ephemeral } as const;
      if (interaction.replied || interaction.deferred) await interaction.followUp(reply).catch(() => {});
      else await interaction.reply(reply).catch(() => {});
    }
  }
});

await client.login(config.token);
