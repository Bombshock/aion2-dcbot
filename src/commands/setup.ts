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
import { buildLfgPanel } from './lfg.js';
import {
  formatMissingPermissions,
  isValidTimezone,
  missingPermissions,
  resolveChannels,
  TIMEZONE_SUGGESTIONS,
} from '../domain/settings.js';
import { getEventsChannel, getGroupsChannel, getGuildSettings, guildSettingsRepo, SETUP_REQUIRED_MESSAGE } from '../settings.js';

const CHANNEL_TYPES = [ChannelType.GuildText, ChannelType.GuildAnnouncement] as const;

const data = new SlashCommandBuilder()
  .setName('setup')
  .setDescription('Den Bot für diesen Server einrichten')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .setDMPermission(false)
  .addSubcommand((s) =>
    s
      .setName('channels')
      .setDescription('Die Kanäle für Events und Gruppensuche festlegen')
      .addChannelOption((o) => o.setName('events').setDescription('Kanal für Events').addChannelTypes(...CHANNEL_TYPES))
      .addChannelOption((o) => o.setName('groups').setDescription('Kanal für die Gruppensuche').addChannelTypes(...CHANNEL_TYPES)),
  )
  .addSubcommand((s) =>
    s
      .setName('timezone')
      .setDescription('Die Zeitzone für Datumsangaben in Formularen festlegen')
      .addStringOption((o) =>
        o.setName('tz').setDescription('IANA-Zeitzone, z. B. Europe/Berlin').setRequired(true).setAutocomplete(true),
      ),
  )
  .addSubcommand((s) =>
    s
      .setName('organizer-role')
      .setDescription('Die Rolle festlegen, die Events erstellen darf (leer lassen zum Entfernen)')
      .addRoleOption((o) => o.setName('role').setDescription('Organisator-Rolle')),
  )
  .addSubcommand((s) => s.setName('lfg-panel').setDescription('Die Gruppensuche-Erklärung mit Erstellen-Button im Gruppenkanal posten'))
  .addSubcommand((s) => s.setName('show').setDescription('Die aktuelle Konfiguration anzeigen'));

const reply = (i: ChatInputCommandInteraction, content: string) => i.reply({ content, flags: MessageFlags.Ephemeral });

/** Checks the bot's permissions in each channel; returns an error message or null. */
async function checkBotPermissions(guild: Guild, channelIds: string[]): Promise<string | null> {
  const me = guild.members.me ?? (await guild.members.fetchMe());
  for (const id of new Set(channelIds)) {
    const channel = guild.channels.cache.get(id) ?? (await guild.channels.fetch(id).catch(() => null));
    if (!channel) return `<#${id}> existiert nicht.`;
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
  return reply(
    i,
    `Gespeichert. Events: <#${result.eventsChannelId}>, Gruppen: <#${result.groupsChannelId}>.\nMit \`/setup lfg-panel\` postest du einen „Gruppe erstellen“-Button im Gruppenkanal.`,
  );
}

async function timezone(i: ChatInputCommandInteraction, guild: Guild) {
  const tz = i.options.getString('tz', true).trim();
  if (!isValidTimezone(tz)) return reply(i, `Unbekannte Zeitzone: ${tz}`);
  guildSettingsRepo().upsert({ ...getGuildSettings(guild.id), timezone: tz });
  return reply(i, `Zeitzone auf ${tz} gesetzt.`);
}

async function organizerRole(i: ChatInputCommandInteraction, guild: Guild) {
  const role = i.options.getRole('role');
  guildSettingsRepo().upsert({ ...getGuildSettings(guild.id), organizerRoleId: role?.id ?? null });
  return reply(i, role ? `Organisator-Rolle auf <@&${role.id}> gesetzt.` : 'Organisator-Rolle entfernt.');
}

async function lfgPanel(i: ChatInputCommandInteraction, guild: Guild) {
  const channel = await getGroupsChannel(guild);
  if (!channel || !channel.isTextBased()) return reply(i, SETUP_REQUIRED_MESSAGE);
  let message;
  try {
    message = await channel.send(buildLfgPanel());
  } catch (err) {
    console.error('Posting LFG panel failed', err);
    return reply(i, `Ich konnte nicht in <#${channel.id}> posten. Prüfe dort meine Berechtigungen.`);
  }
  // Pinning keeps the panel findable once group posts push it up; it needs Manage Messages, so it's optional.
  const pinned = await message.pin().then(
    () => true,
    () => false,
  );
  return reply(i, pinned ? `Gepostet und angepinnt: ${message.url}` : `Gepostet: ${message.url}\nIch konnte es nicht anpinnen. Pinne es selbst an oder gib mir die Berechtigung „Nachrichten verwalten“.`);
}

async function show(i: ChatInputCommandInteraction, guild: Guild) {
  const s = getGuildSettings(guild.id);
  const [events, groups] = await Promise.all([getEventsChannel(guild), getGroupsChannel(guild)]);
  return reply(
    i,
    [
      `Event-Kanal: ${events ? `<#${events.id}>` : 'nicht gesetzt'}`,
      `Gruppen-Kanal: ${groups ? `<#${groups.id}>` : 'nicht gesetzt'}`,
      `Zeitzone: ${s.timezone}`,
      `Organisator-Rolle: ${s.organizerRoleId ? `<@&${s.organizerRoleId}>` : 'keine'}`,
    ].join('\n'),
  );
}

export const setup: Command = {
  data,
  async execute(interaction) {
    const guild = interaction.guild;
    if (!guild) return reply(interaction, 'Dieser Befehl funktioniert nur auf einem Server.');
    switch (interaction.options.getSubcommand()) {
      case 'channels':
        return channels(interaction, guild);
      case 'timezone':
        return timezone(interaction, guild);
      case 'organizer-role':
        return organizerRole(interaction, guild);
      case 'lfg-panel':
        return lfgPanel(interaction, guild);
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
