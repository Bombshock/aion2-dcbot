import {
  ChannelType,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
  type AutocompleteInteraction,
  type ChatInputCommandInteraction,
  type Guild,
} from 'discord.js';
import type { Command } from './index.js';
import {
  formatMissingPermissions,
  isValidTimezone,
  missingPermissions,
  resolveChannels,
  TIMEZONE_SUGGESTIONS,
} from '../domain/settings.js';
import { getEventsChannel, getGroupsChannel, getGuildSettings, guildSettingsRepo } from '../settings.js';

const CHANNEL_TYPES = [ChannelType.GuildText, ChannelType.GuildAnnouncement] as const;

const data = new SlashCommandBuilder()
  .setName('setup')
  .setDescription('Configure the bot for this server')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .setDMPermission(false)
  .addSubcommand((s) =>
    s
      .setName('channels')
      .setDescription('Set the channels for events and group search')
      .addChannelOption((o) => o.setName('events').setDescription('Channel for events').addChannelTypes(...CHANNEL_TYPES))
      .addChannelOption((o) => o.setName('groups').setDescription('Channel for group search').addChannelTypes(...CHANNEL_TYPES)),
  )
  .addSubcommand((s) =>
    s
      .setName('timezone')
      .setDescription('Set the timezone used for dates in forms')
      .addStringOption((o) =>
        o.setName('tz').setDescription('IANA timezone, e.g. Europe/Berlin').setRequired(true).setAutocomplete(true),
      ),
  )
  .addSubcommand((s) =>
    s
      .setName('organizer-role')
      .setDescription('Set the role allowed to create events (omit to clear)')
      .addRoleOption((o) => o.setName('role').setDescription('Organizer role')),
  )
  .addSubcommand((s) => s.setName('show').setDescription('Show the current configuration'));

const reply = (i: ChatInputCommandInteraction, content: string) => i.reply({ content, flags: MessageFlags.Ephemeral });

/** Checks the bot's permissions in each channel; returns an error message or null. */
async function checkBotPermissions(guild: Guild, channelIds: string[]): Promise<string | null> {
  const me = guild.members.me ?? (await guild.members.fetchMe());
  for (const id of new Set(channelIds)) {
    const channel = guild.channels.cache.get(id) ?? (await guild.channels.fetch(id).catch(() => null));
    if (!channel) return `<#${id}> doesn't exist.`;
    const perms = channel.permissionsFor(me);
    const missing = missingPermissions((p) => perms.has(PermissionFlagsBits[p]));
    if (missing.length > 0) return formatMissingPermissions(id, missing);
  }
  return null;
}

async function channels(i: ChatInputCommandInteraction, guild: Guild) {
  const repo = guildSettingsRepo();
  const current = getGuildSettings(guild.id);
  const result = resolveChannels(current, !!repo.get(guild.id), {
    events: i.options.getChannel('events')?.id,
    groups: i.options.getChannel('groups')?.id,
  });
  if (!result.ok) return reply(i, result.message);

  const problem = await checkBotPermissions(
    guild,
    [result.eventsChannelId, result.groupsChannelId].filter((c): c is string => !!c),
  );
  if (problem) return reply(i, problem);

  repo.upsert({ ...current, eventsChannelId: result.eventsChannelId, groupsChannelId: result.groupsChannelId });
  return reply(i, `Saved. Events: <#${result.eventsChannelId}>, groups: <#${result.groupsChannelId}>.`);
}

async function timezone(i: ChatInputCommandInteraction, guild: Guild) {
  const tz = i.options.getString('tz', true).trim();
  if (!isValidTimezone(tz)) return reply(i, `Unknown timezone: ${tz}`);
  guildSettingsRepo().upsert({ ...getGuildSettings(guild.id), timezone: tz });
  return reply(i, `Timezone set to ${tz}.`);
}

async function organizerRole(i: ChatInputCommandInteraction, guild: Guild) {
  const role = i.options.getRole('role');
  guildSettingsRepo().upsert({ ...getGuildSettings(guild.id), organizerRoleId: role?.id ?? null });
  return reply(i, role ? `Organizer role set to <@&${role.id}>.` : 'Organizer role cleared.');
}

async function show(i: ChatInputCommandInteraction, guild: Guild) {
  const s = getGuildSettings(guild.id);
  const [events, groups] = await Promise.all([getEventsChannel(guild), getGroupsChannel(guild)]);
  return reply(
    i,
    [
      `Events channel: ${events ? `<#${events.id}>` : 'not set'}`,
      `Groups channel: ${groups ? `<#${groups.id}>` : 'not set'}`,
      `Timezone: ${s.timezone}`,
      `Organizer role: ${s.organizerRoleId ? `<@&${s.organizerRoleId}>` : 'none'}`,
    ].join('\n'),
  );
}

export const setup: Command = {
  data,
  async execute(interaction) {
    const guild = interaction.guild;
    if (!guild) return reply(interaction, 'This command only works in a server.');
    switch (interaction.options.getSubcommand()) {
      case 'channels':
        return channels(interaction, guild);
      case 'timezone':
        return timezone(interaction, guild);
      case 'organizer-role':
        return organizerRole(interaction, guild);
      case 'show':
        return show(interaction, guild);
    }
  },
  async autocomplete(interaction: AutocompleteInteraction) {
    const typed = interaction.options.getFocused().toLowerCase();
    const choices = TIMEZONE_SUGGESTIONS.filter((t) => t.toLowerCase().includes(typed));
    await interaction.respond(choices.map((t) => ({ name: t, value: t })));
  },
};
