import { REST, Routes } from 'discord.js';
import { loadConfig } from '../src/config.js';
import { commands } from '../src/commands/index.js';

const config = loadConfig();
const rest = new REST().setToken(config.token);
const body = commands.map((c) => c.data.toJSON());

const route = config.devGuildId
  ? Routes.applicationGuildCommands(config.clientId, config.devGuildId)
  : Routes.applicationCommands(config.clientId);

await rest.put(route, { body });
console.log(`Registered ${body.length} command(s) ${config.devGuildId ? `in guild ${config.devGuildId}` : 'globally'}`);
