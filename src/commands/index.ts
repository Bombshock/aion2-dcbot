import { PermissionFlagsBits, type ChatInputCommandInteraction, type RESTPostAPIChatInputApplicationCommandsJSONBody } from 'discord.js';
import type { AutocompleteInteraction } from 'discord.js';
import { getGuildSettings } from '../settings.js';
import { ping } from './ping.js';
import { event } from './event.js';
import { setup } from './setup.js';
import { template } from './template.js';
import { lfg } from './lfg.js';
import { reminders } from './reminders.js';
import { cleanupCommand } from './cleanup.js';

export interface Command {
  data: { name: string; toJSON(): RESTPostAPIChatInputApplicationCommandsJSONBody };
  execute(interaction: ChatInputCommandInteraction): Promise<unknown>;
  autocomplete?(interaction: AutocompleteInteraction): Promise<void>;
  /** Usable by every member; all other commands are for admins (Manage Guild) and the organizer role. */
  public?: boolean;
}

/** Add new commands to this list. */
export const commands: Command[] = [ping, setup, event, template, lfg, reminders, cleanupCommand];

export const commandMap = new Map(commands.map((c) => [c.data.name, c]));

export const COMMAND_NOT_ALLOWED_MESSAGE = 'Nur Admins (Server verwalten) und die Organisator-Rolle können diesen Befehl nutzen.';

/** Whether the interaction's user may run the command: public commands always, others only on a server for admins and organizers. */
export function canUseCommand(command: Command, interaction: ChatInputCommandInteraction | AutocompleteInteraction): boolean {
  if (command.public) return true;
  if (!interaction.inGuild()) return false;
  if (interaction.memberPermissions.has(PermissionFlagsBits.ManageGuild)) return true;
  const roleId = getGuildSettings(interaction.guildId).organizerRoleId;
  if (!roleId) return false;
  const roles = interaction.member.roles;
  return Array.isArray(roles) ? roles.includes(roleId) : roles.cache.has(roleId);
}
