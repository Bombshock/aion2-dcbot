import type { ChatInputCommandInteraction, RESTPostAPIChatInputApplicationCommandsJSONBody } from 'discord.js';
import { ping } from './ping.js';

export interface Command {
  data: { name: string; toJSON(): RESTPostAPIChatInputApplicationCommandsJSONBody };
  execute(interaction: ChatInputCommandInteraction): Promise<void>;
}

/** Add new commands to this list. */
export const commands: Command[] = [ping];

export const commandMap = new Map(commands.map((c) => [c.data.name, c]));
