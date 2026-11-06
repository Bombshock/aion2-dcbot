import { MessageFlags, PermissionFlagsBits, SlashCommandBuilder, type ChatInputCommandInteraction, type Client, type Guild, type Message, type SlashCommandBooleanOption } from 'discord.js';
import type { Command } from './index.js';
import { createGroupsRepo, type GroupKind, type GroupRecord, type GroupsRepo } from '../db/groups.js';
import { getDb } from '../db/instance.js';
import { isLeftover, notificationPostId, type BotMessageView, type CleanupGroupInfo, type CleanupLookup } from '../domain/cleanup.js';
import { closeVanishedGroups, refreshGroupPost } from '../interactions/groupJoin.js';
import { getGuildSettings } from '../settings.js';

/** How far back each channel is searched for leftover posts and reminders. */
const SCAN_LIMIT = 1000;
const PAGE_SIZE = 100;

const allOption = (description: string) => (o: SlashCommandBooleanOption) => o.setName('all').setDescription(description);

const data = new SlashCommandBuilder()
  .setName('cleanup')
  .setDescription('Alte Posts, Erinnerungen und Datenbankeinträge aufräumen')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .setDMPermission(false)
  .addSubcommand((s) =>
    s
      .setName('events')
      .setDescription('Beendete Events samt Erinnerungen und Benachrichtigungen aufräumen')
      .addBooleanOption(allOption('Auch laufende und wiederkehrende Events löschen (Standard: nein)')),
  )
  .addSubcommand((s) =>
    s
      .setName('lfg')
      .setDescription('Geschlossene Gruppensuchen samt Erinnerungen und Benachrichtigungen aufräumen')
      .addBooleanOption(allOption('Auch offene Gruppensuchen löschen (Standard: nein)')),
  );

const toView = (message: Message): BotMessageView => {
  const customIds: string[] = [];
  for (const row of message.components) {
    if (!('components' in row)) continue;
    for (const component of row.components as readonly { customId?: string | null }[]) {
      if (component.customId) customIds.push(component.customId);
    }
  }
  return { id: message.id, content: message.content, customIds, referenceId: message.reference?.messageId ?? null };
};

/** Deletes the group's post and tracked reminders (best effort), then its DB row and members. */
async function removeGroup(client: Client, repo: GroupsRepo, group: GroupRecord): Promise<void> {
  const closed = group.status === 'closed' ? group : repo.update(group.id, { status: 'closed' })!;
  await refreshGroupPost(client, repo, closed).catch((err) => console.error(`Cleanup: deleting the post of group ${group.id} failed`, err));
  repo.delete(group.id);
}

function buildLookup(repo: GroupsRepo, guildId: string): CleanupLookup {
  const byId = new Map<number, CleanupGroupInfo>();
  const byPost = new Map<string, CleanupGroupInfo>();
  const keep = new Set<string>();
  for (const g of repo.listByGuild(guildId)) {
    const info = { kind: g.kind, active: g.status !== 'closed' };
    byId.set(g.id, info);
    if (g.messageId) byPost.set(g.messageId, info);
    if (info.active) {
      if (g.messageId) keep.add(g.messageId);
      for (const id of g.reminderMessageIds) keep.add(id);
    }
  }
  return { group: (id) => byId.get(id), groupOfPost: (id) => byPost.get(id), keep };
}

/** Deletes the bot's leftover posts and notifications of the kind among the channel's latest messages. */
async function sweepChannel(client: Client, channelId: string, kind: GroupKind, lookup: CleanupLookup): Promise<{ posts: number; reminders: number; failed: boolean }> {
  const result = { posts: 0, reminders: 0, failed: false };
  const botId = client.user?.id;
  try {
    const channel = await client.channels.fetch(channelId);
    if (!channel?.isTextBased() || !botId) return result;
    let before: string | undefined;
    for (let scanned = 0; scanned < SCAN_LIMIT; scanned += PAGE_SIZE) {
      const page = await channel.messages.fetch({ limit: PAGE_SIZE, ...(before ? { before } : {}) });
      if (page.size === 0) break;
      for (const message of page.values()) {
        if (message.author.id !== botId) continue;
        const view = toView(message);
        if (!isLeftover(view, kind, lookup)) continue;
        const deleted = await message.delete().then(
          () => true,
          (err) => (console.error(`Cleanup: deleting message ${message.id} failed`, err), (result.failed = true), false),
        );
        if (deleted) notificationPostId(view) !== null ? result.reminders++ : result.posts++;
      }
      before = page.last()?.id;
      if (page.size < PAGE_SIZE) break;
    }
  } catch (err) {
    console.error(`Cleanup: scanning channel ${channelId} failed`, err);
    result.failed = true;
  }
  return result;
}

async function cleanup(i: ChatInputCommandInteraction, guild: Guild, kind: GroupKind) {
  const all = i.options.getBoolean('all') ?? false;
  await i.deferReply({ flags: MessageFlags.Ephemeral });
  const repo = createGroupsRepo(getDb());
  const ofKind = () => repo.listByGuild(guild.id).filter((g) => g.kind === kind);

  // Posts deleted by hand while the bot was offline still count as open in the DB.
  if (!all) await closeVanishedGroups(i.client, repo, ofKind().filter((g) => g.status !== 'closed'));
  const groups = ofKind();
  const targets = all ? groups : groups.filter((g) => g.status === 'closed');
  for (const group of targets) await removeGroup(i.client, repo, group);

  const settings = getGuildSettings(guild.id);
  const configured = kind === 'event' ? settings.eventsChannelId : settings.groupsChannelId;
  const channelIds = new Set([...(configured ? [configured] : []), ...groups.map((g) => g.channelId)]);
  const lookup = buildLookup(repo, guild.id);
  let posts = 0;
  let reminders = 0;
  let failed = false;
  for (const channelId of channelIds) {
    const r = await sweepChannel(i.client, channelId, kind, lookup);
    posts += r.posts;
    reminders += r.reminders;
    failed ||= r.failed;
  }

  const label = kind === 'event' ? 'Events' : 'Gruppensuchen';
  const lines = [
    `**${label} aufgeräumt.**`,
    `• ${targets.length} ${all ? '' : 'beendete '}${label} aus der Datenbank entfernt (samt Posts, Erinnerungen und Benachrichtigungen)`,
    `• ${posts} übrig gebliebene Posts und ${reminders} Erinnerungen/Benachrichtigungen in ${channelIds.size} Kanal/Kanälen gelöscht (je Kanal die letzten ${SCAN_LIMIT} Nachrichten)`,
  ];
  if (failed) lines.push('Manche Nachrichten konnte ich nicht lesen oder löschen. Prüfe meine Berechtigung „Nachrichtenverlauf lesen“ in den Kanälen.');
  return i.editReply(lines.join('\n'));
}

export const cleanupCommand: Command = {
  data,
  async execute(interaction) {
    const guild = interaction.guild;
    if (!guild) return interaction.reply({ content: 'Dieser Befehl funktioniert nur auf einem Server.', flags: MessageFlags.Ephemeral });
    return cleanup(interaction, guild, interaction.options.getSubcommand() === 'events' ? 'event' : 'lfg');
  },
};
