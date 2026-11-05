import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
  SlashCommandBuilder,
  StringSelectMenuBuilder,
  type ChatInputCommandInteraction,
} from 'discord.js';
import type { Command } from './index.js';
import { createGroupsRepo, createGroupTemplatesRepo, type GroupKind } from '../db/groups.js';
import { getDb } from '../db/instance.js';
import { CLASSES, classLabel } from '../domain/classes.js';
import { buildClassPicker } from '../interactions/classPicker.js';
import { DUNGEONS, formatItemLevel, getDungeon, PRESET_TEMPLATE_NAME } from '../domain/dungeons.js';
import { autocompleteCreateOptions, buildCreateModal, closeVanishedBeforeModal, prepareCreate, refusalReply } from '../interactions/groupCreate.js';
import { GROUP_AREA } from '../interactions/groupMessage.js';
import { registerGroupAction } from '../interactions/groupJoin.js';
import { buildCustomId } from '../interactions/router.js';
import { getGroupsChannel, SETUP_REQUIRED_MESSAGE } from '../settings.js';

const SELECT_LIMIT = 25;
const GROUP_STATUS_LABEL = { open: 'offen', full: 'voll', closed: 'geschlossen' } as const;
const data = new SlashCommandBuilder()
  .setName('lfg')
  .setDescription('Gruppensuche')
  .setDMPermission(false)
  .addSubcommand((s) =>
    s
      .setName('create')
      .setDescription('Eine Gruppensuche aus einer Vorlage posten')
      .addStringOption((o) => o.setName('template').setDescription('Gruppenvorlage').setRequired(true).setAutocomplete(true))
      .addStringOption((o) =>
        o
          .setName('class')
          .setDescription('Deine Klasse')
          .setRequired(true)
          .addChoices(...CLASSES.map((c) => ({ name: classLabel(c), value: c.id }))),
      )
      .addStringOption((o) => o.setName('dungeon').setDescription('Dungeon, füllt Titel und Beschreibung vor').setAutocomplete(true)),
  )
  .addSubcommand((s) => s.setName('list').setDescription('Die offenen Gruppen dieses Servers anzeigen'));

const reply = (i: ChatInputCommandInteraction, content: string) => i.reply({ content, flags: MessageFlags.Ephemeral });

/** Links to the guild's open or full posts of the kind with status and time, for `/lfg list` and `/event list`; null when there are none. */
export function formatPostList(guildId: string, kind: GroupKind): string | null {
  const groups = createGroupsRepo(getDb())
    .listByGuild(guildId)
    .filter((g) => g.kind === kind && g.status !== 'closed' && g.messageId);
  if (groups.length === 0) return null;
  const lines = groups.map((g) => {
    const when = g.startsAt === null ? 'jetzt' : `<t:${g.startsAt}:f>`;
    return `• [${g.title}](https://discord.com/channels/${g.guildId}/${g.channelId}/${g.messageId}) · ${GROUP_STATUS_LABEL[g.status]} · ${when}${g.repeatDays ? ' · 🔁' : ''}`;
  });
  return lines.join('\n').slice(0, 2000);
}

/** Explainer for the groups channel; its button starts the same flow as /lfg create (template, class, form). */
export function buildLfgPanel() {
  const embed = new EmbedBuilder()
    .setTitle('Suchst du eine Gruppe?')
    .setDescription(
      [
        'Starte deine eigene Gruppensuche in drei Schritten:',
        '1. Klicke unten auf **Gruppe erstellen** (oder nutze `/lfg create`).',
        '2. Wähle Dungeon und Modus (oder „Andere Gruppe“ mit eigener Vorlage) und deine Klasse.',
        '3. Gib einen Titel, eine Beschreibung und optional eine Startzeit ein.',
        '',
        'Deine Gruppe wird in diesem Kanal gepostet. Andere treten mit **Beitreten** bei, und mit **Verwalten** bearbeitest du sie, entfernst Mitglieder oder schließt sie.',
        'Mit `/lfg list` siehst du alle offenen Gruppen.',
      ].join('\n'),
    );
  const button = new ButtonBuilder().setCustomId(buildCustomId(GROUP_AREA, 'start')).setLabel('Gruppe erstellen').setStyle(ButtonStyle.Success);
  return { embeds: [embed], components: [new ActionRowBuilder<ButtonBuilder>().addComponents(button)] };
}

const ephemeral = (content: string) => ({ content, flags: MessageFlags.Ephemeral }) as const;

const OTHER_DUNGEON = 'other';
const selectRow = (menu: StringSelectMenuBuilder) => new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu);

/** Panel flow: dungeon, its mode, then class; "Andere Gruppe" goes through the template select instead of a mode. */
registerGroupAction('start', async (interaction) => {
  if (!interaction.isButton() || !interaction.guild) return;
  if (!(await getGroupsChannel(interaction.guild))) return void (await interaction.reply(ephemeral(SETUP_REQUIRED_MESSAGE)));
  const menu = new StringSelectMenuBuilder()
    .setCustomId(buildCustomId(GROUP_AREA, 'newdungeon'))
    .setPlaceholder('Wähle einen Dungeon')
    .addOptions([...DUNGEONS.map((d) => ({ label: d.name, value: d.id })), { label: 'Andere Gruppe', value: OTHER_DUNGEON, description: 'Eigener Titel und Gruppenvorlage' }]);
  await interaction.reply({ ...ephemeral('Wähle einen Dungeon:'), components: [selectRow(menu)] });
});

registerGroupAction('newdungeon', async (interaction) => {
  if (!interaction.isStringSelectMenu() || !interaction.guildId) return;
  const choice = interaction.values[0] ?? '';
  if (choice === OTHER_DUNGEON) {
    const templates = createGroupTemplatesRepo(getDb()).listForGuild(interaction.guildId).slice(0, SELECT_LIMIT);
    if (templates.length === 0) return void (await interaction.update({ content: 'Es gibt noch keine Gruppenvorlagen.', components: [] }));
    const menu = new StringSelectMenuBuilder()
      .setCustomId(buildCustomId(GROUP_AREA, 'newtemplate'))
      .setPlaceholder('Wähle eine Vorlage')
      .addOptions(templates.map((t) => ({ label: t.name.slice(0, 100), value: String(t.id) })));
    return void (await interaction.update({ content: 'Wähle eine Gruppenvorlage:', components: [selectRow(menu)] }));
  }
  const dungeon = getDungeon(choice);
  if (!dungeon) return void (await interaction.update({ content: 'Unbekannter Dungeon', components: [] }));
  const menu = new StringSelectMenuBuilder()
    .setCustomId(buildCustomId(GROUP_AREA, 'newmode', dungeon.id))
    .setPlaceholder('Wähle den Modus')
    .addOptions(dungeon.modes.map((m) => ({ label: m.label, value: m.id, ...(m.itemLevel === null ? {} : { description: formatItemLevel(m.itemLevel) }) })));
  await interaction.update({ content: `**${dungeon.name}**: wähle den Modus:`, components: [selectRow(menu)] });
});

/** Dungeon groups use the built-in 5-player template, so the panel skips the template step for them. */
registerGroupAction('newmode', async (interaction, parsed) => {
  if (!interaction.isStringSelectMenu() || !interaction.guildId) return;
  const template = createGroupTemplatesRepo(getDb()).findByName(interaction.guildId, PRESET_TEMPLATE_NAME);
  if (!template) return void (await interaction.update({ content: `Die Vorlage „${PRESET_TEMPLATE_NAME}“ fehlt.`, components: [] }));
  const presetId = `${parsed.id}.${interaction.values[0] ?? ''}`;
  const { content, components } = buildClassPicker({ area: GROUP_AREA, action: 'newclass', id: `${template.id}:${presetId}` });
  await interaction.update({ content, components });
});

registerGroupAction('newtemplate', async (interaction) => {
  if (!interaction.isStringSelectMenu()) return;
  const { content, components } = buildClassPicker({ area: GROUP_AREA, action: 'newclass', id: interaction.values[0] ?? '' });
  await interaction.update({ content, components });
});

/** The id is `<template id>`, or `<template id>:<preset id>` after a dungeon pick. */
registerGroupAction('newclass', async (interaction, parsed) => {
  if (!interaction.isStringSelectMenu() || !interaction.guildId) return;
  const [templateId = '', presetId] = parsed.id.split(':');
  const req = { kind: 'lfg', templateId, classId: interaction.values[0] ?? '', presetId } as const;
  await closeVanishedBeforeModal(interaction.client, interaction.guildId, interaction.user.id, req);
  const prepared = prepareCreate(interaction.guildId, interaction.user.id, req);
  if (!prepared.ok) return void (await interaction.update(refusalReply(prepared)));
  await interaction.showModal(buildCreateModal(interaction.guildId, req));
});

export const lfg: Command = {
  data,
  async execute(interaction) {
    const guild = interaction.guild;
    if (!guild) return reply(interaction, 'Dieser Befehl funktioniert nur auf einem Server.');
    switch (interaction.options.getSubcommand()) {
      case 'list':
        return reply(interaction, formatPostList(guild.id, 'lfg') ?? 'Es gibt keine offenen Gruppen.');
      case 'create': {
        const channel = await getGroupsChannel(guild);
        if (!channel) return reply(interaction, SETUP_REQUIRED_MESSAGE);
        const req = {
          kind: 'lfg',
          templateId: interaction.options.getString('template', true),
          classId: interaction.options.getString('class', true),
          presetId: interaction.options.getString('dungeon') ?? undefined,
        } as const;
        await closeVanishedBeforeModal(interaction.client, guild.id, interaction.user.id, req);
        const prepared = prepareCreate(guild.id, interaction.user.id, req);
        if (!prepared.ok) return interaction.reply({ ...refusalReply(prepared), flags: MessageFlags.Ephemeral });
        return interaction.showModal(buildCreateModal(guild.id, req));
      }
    }
  },
  autocomplete: autocompleteCreateOptions,
};
