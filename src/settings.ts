import type { Guild, GuildBasedChannel } from 'discord.js';
import { createGuildSettingsRepo, type GuildSettings } from './db/guildSettings.js';
import { getDb } from './db/instance.js';
import { DEFAULT_SETTINGS } from './domain/settings.js';

export { SETUP_REQUIRED_MESSAGE } from './domain/settings.js';

export const guildSettingsRepo = () => createGuildSettingsRepo(getDb());

/** Settings of a guild; a guild without saved settings gets the defaults (timezone Europe/Berlin). */
export function getGuildSettings(guildId: string): GuildSettings {
  return guildSettingsRepo().get(guildId) ?? { guildId, ...DEFAULT_SETTINGS };
}

async function fetchChannel(guild: Guild, id: string | null): Promise<GuildBasedChannel | null> {
  if (!id) return null;
  return guild.channels.cache.get(id) ?? (await guild.channels.fetch(id).catch(() => null));
}

/** The configured events channel, or null when unset or deleted. */
export function getEventsChannel(guild: Guild): Promise<GuildBasedChannel | null> {
  return fetchChannel(guild, getGuildSettings(guild.id).eventsChannelId);
}

/** The configured group search channel, or null when unset or deleted. */
export function getGroupsChannel(guild: Guild): Promise<GuildBasedChannel | null> {
  return fetchChannel(guild, getGuildSettings(guild.id).groupsChannelId);
}
