import type { ChatInputCommandInteraction, RESTPostAPIChatInputApplicationCommandsJSONBody } from 'discord.js';
import type { AutocompleteInteraction } from 'discord.js';
import { ping } from './ping.js';
import { event } from './event.js';
import { setup } from './setup.js';
import { template } from './template.js';
import { lfg } from './lfg.js';

export interface Command {
  data: { name: string; toJSON(): RESTPostAPIChatInputApplicationCommandsJSONBody };
  execute(interaction: ChatInputCommandInteraction): Promise<unknown>;
  autocomplete?(interaction: AutocompleteInteraction): Promise<void>;
}

/** Add new commands to this list. */
export const commands: Command[] = [ping, setup, event, template, lfg];

export const commandMap = new Map(commands.map((c) => [c.data.name, c]));
