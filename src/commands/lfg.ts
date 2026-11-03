import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
  ModalBuilder,
  SlashCommandBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
  type AutocompleteInteraction,
  type ChatInputCommandInteraction,
  type ModalSubmitInteraction,
} from 'discord.js';
import type { Command } from './index.js';
import { createGroupsRepo, createGroupTemplatesRepo, type GroupRecord } from '../db/groups.js';
import { getDb } from '../db/instance.js';
import { CLASSES, getClass } from '../domain/classes.js';
import { DATE_FORMAT_HINT, DATE_PLACEHOLDER, parseFutureDateTime } from '../domain/datetime.js';
import { checkCreateGroup, statusForFill } from '../domain/groups.js';
import { parseSlotsJson, type Result, type TemplateSlot } from '../domain/templates.js';
import { buildClassPicker } from '../interactions/classPicker.js';
import { GROUP_AREA, renderGroupMessage } from '../interactions/groupMessage.js';
import { registerGroupAction } from '../interactions/groupJoin.js';
import { buildCustomId } from '../interactions/router.js';
import { getGroupsChannel, getGuildSettings, SETUP_REQUIRED_MESSAGE } from '../settings.js';

const FIELD = { title: 'title', description: 'description', when: 'when' } as const;
const AUTOCOMPLETE_LIMIT = 25;
const SELECT_LIMIT = 25;
const GROUP_STATUS_LABEL = { open: 'offen', full: 'voll', closed: 'geschlossen' } as const;
const UNKNOWN_TEMPLATE_MESSAGE = 'Unbekannte Vorlage';
/** How long the ephemeral "posted" confirmation stays before it is removed. */
const CONFIRMATION_TTL_MS = 10_000;

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
          .addChoices(...CLASSES.map((c) => ({ name: c.name, value: c.id }))),
      ),
  )
  .addSubcommand((s) => s.setName('list').setDescription('Die offenen Gruppen dieses Servers anzeigen'));

const reply = (i: ChatInputCommandInteraction | ModalSubmitInteraction, content: string) =>
  i.reply({ content, flags: MessageFlags.Ephemeral });

interface Prepared {
  templateId: number;
  slots: TemplateSlot[];
  slotsJson: string;
  slotIndex: number;
}

/** Template and limit checks shared by the command and the modal submit (state may change while the modal is open). */
function prepare(guildId: string, userId: string, templateId: string, classId: string): Result<Prepared> {
  const id = Number(templateId);
  const template = Number.isInteger(id) ? createGroupTemplatesRepo(getDb()).get(id) : undefined;
  if (!template || (template.guildId !== null && template.guildId !== guildId)) return { ok: false, message: UNKNOWN_TEMPLATE_MESSAGE };
  if (!getClass(classId)) return { ok: false, message: 'Unbekannte Klasse' };
  const slots = parseSlotsJson(template.slotsJson);
  const active = createGroupsRepo(getDb()).countActiveByCreator(guildId, userId);
  const check = checkCreateGroup(slots, classId, active);
  if (!check.ok) return check;
  return { ok: true, value: { templateId: template.id, slots, slotsJson: template.slotsJson, slotIndex: check.value } };
}

function buildModal(templateId: string, classId: string) {
  const row = (input: TextInputBuilder) => new ActionRowBuilder<TextInputBuilder>().addComponents(input);
  return new ModalBuilder()
    .setCustomId(buildCustomId(GROUP_AREA, 'create', `${templateId}:${classId}`))
    .setTitle('Gruppe erstellen')
    .addComponents(
      row(new TextInputBuilder().setCustomId(FIELD.title).setLabel('Titel').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(100).setPlaceholder('Feuertempel-Run')),
      row(
        new TextInputBuilder()
          .setCustomId(FIELD.description)
          .setLabel('Beschreibung')
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(false)
          .setMaxLength(2000)
          .setPlaceholder('Ziel, Voraussetzungen, Voice-Chat…'),
      ),
      row(
        new TextInputBuilder()
          .setCustomId(FIELD.when)
          .setLabel(`Wann (${DATE_FORMAT_HINT}, leer = jetzt)`)
          .setStyle(TextInputStyle.Short)
          .setRequired(false)
          .setPlaceholder(DATE_PLACEHOLDER)
          .setMaxLength(16),
      ),
    );
}

async function submit(i: ModalSubmitInteraction, templateId: string, classId: string) {
  const guild = i.guild;
  if (!guild) return reply(i, 'Dieser Befehl funktioniert nur auf einem Server.');

  const title = i.fields.getTextInputValue(FIELD.title).trim();
  const description = i.fields.getTextInputValue(FIELD.description).trim();
  const when = i.fields.getTextInputValue(FIELD.when).trim();

  const channel = await getGroupsChannel(guild);
  if (!channel || !channel.isTextBased()) return reply(i, SETUP_REQUIRED_MESSAGE);

  const prepared = prepare(guild.id, i.user.id, templateId, classId);
  if (!prepared.ok) return reply(i, prepared.message);

  let startsAt: number | null = null;
  if (when) {
    const settings = getGuildSettings(guild.id);
    const parsed = parseFutureDateTime(when, settings.timezone, Math.floor(Date.now() / 1000));
    if (!parsed.ok) {
      // Echo the typed values so the user can copy them into a new attempt.
      const text = [parsed.message, `Daten werden in ${settings.timezone} gelesen.`, '', 'Deine Eingabe:', `Titel: ${title}`, `Wann: ${when}`, `Beschreibung:\n${description}`].join('\n');
      return reply(i, text.slice(0, 2000));
    }
    startsAt = parsed.epochSeconds;
  }

  const { slots, slotIndex } = prepared.value;
  const member = { userId: i.user.id, classId, slotIndex };
  // The checks above and this insert run without an await in between, so the limit can't be raced.
  const repo = createGroupsRepo(getDb());
  const group = repo.createWithMember(
    {
      guildId: guild.id,
      channelId: channel.id,
      creatorId: i.user.id,
      templateId: prepared.value.templateId,
      title,
      description,
      slotsJson: prepared.value.slotsJson,
      startsAt,
      status: statusForFill(slots, [member]),
    },
    member,
  );

  // From the panel flow the modal came from the ephemeral class picker: reuse that message instead of stacking a new one.
  if (i.isFromMessage()) await i.deferUpdate();
  else await i.deferReply({ flags: MessageFlags.Ephemeral });
  try {
    const message = await channel.send(renderGroupMessage({ ...toView(group), slots }, [member]));
    repo.update(group.id, { messageId: message.id });
    await i.editReply({ content: `Gruppe gepostet: ${message.url}`, components: [] });
    setTimeout(() => i.deleteReply().catch(() => {}), CONFIRMATION_TTL_MS);
  } catch (err) {
    repo.delete(group.id);
    console.error('Posting group failed', err);
    await i.editReply({ content: `Ich konnte nicht in <#${channel.id}> posten. Prüfe dort meine Berechtigungen.`, components: [] });
  }
}

const toView = (g: GroupRecord) => ({
  id: g.id,
  creatorId: g.creatorId,
  title: g.title,
  description: g.description,
  startsAt: g.startsAt,
  status: g.status,
});

registerGroupAction('create', async (interaction, parsed) => {
  if (!interaction.isModalSubmit()) return;
  const [templateId = '', classId = ''] = parsed.id.split(':');
  await submit(interaction, templateId, classId);
});

/** Explainer for the groups channel; its button starts the same flow as /lfg create (template, class, form). */
export function buildLfgPanel() {
  const embed = new EmbedBuilder()
    .setTitle('Suchst du eine Gruppe?')
    .setDescription(
      [
        'Starte deine eigene Gruppensuche in drei Schritten:',
        '1. Klicke unten auf **Gruppe erstellen** (oder nutze `/lfg create`).',
        '2. Wähle eine Gruppenvorlage und deine Klasse.',
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

registerGroupAction('start', async (interaction) => {
  if (!interaction.isButton() || !interaction.guild) return;
  if (!(await getGroupsChannel(interaction.guild))) return void (await interaction.reply(ephemeral(SETUP_REQUIRED_MESSAGE)));
  const templates = createGroupTemplatesRepo(getDb()).listForGuild(interaction.guild.id).slice(0, SELECT_LIMIT);
  if (templates.length === 0) return void (await interaction.reply(ephemeral('Es gibt noch keine Gruppenvorlagen.')));
  const menu = new StringSelectMenuBuilder()
    .setCustomId(buildCustomId(GROUP_AREA, 'newtemplate'))
    .setPlaceholder('Wähle eine Vorlage')
    .addOptions(templates.map((t) => ({ label: t.name.slice(0, 100), value: String(t.id) })));
  await interaction.reply({ ...ephemeral('Wähle eine Gruppenvorlage:'), components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu)] });
});

registerGroupAction('newtemplate', async (interaction) => {
  if (!interaction.isStringSelectMenu()) return;
  const { content, components } = buildClassPicker({ area: GROUP_AREA, action: 'newclass', id: interaction.values[0] ?? '' });
  await interaction.update({ content, components });
});

registerGroupAction('newclass', async (interaction, parsed) => {
  if (!interaction.isStringSelectMenu() || !interaction.guildId) return;
  const classId = interaction.values[0] ?? '';
  const prepared = prepare(interaction.guildId, interaction.user.id, parsed.id, classId);
  if (!prepared.ok) return void (await interaction.update({ content: prepared.message, components: [] }));
  await interaction.showModal(buildModal(parsed.id, classId));
});

export const lfg: Command = {
  data,
  async execute(interaction) {
    const guild = interaction.guild;
    if (!guild) return reply(interaction, 'Dieser Befehl funktioniert nur auf einem Server.');
    switch (interaction.options.getSubcommand()) {
      case 'list': {
        const groups = createGroupsRepo(getDb())
          .listByGuild(guild.id)
          .filter((g) => g.status !== 'closed' && g.messageId);
        if (groups.length === 0) return reply(interaction, 'Es gibt keine offenen Gruppen.');
        const lines = groups.map((g) => {
          const when = g.startsAt === null ? 'jetzt' : `<t:${g.startsAt}:f>`;
          return `• [${g.title}](https://discord.com/channels/${g.guildId}/${g.channelId}/${g.messageId}) · ${GROUP_STATUS_LABEL[g.status]} · ${when}`;
        });
        return reply(interaction, lines.join('\n').slice(0, 2000));
      }
      case 'create': {
        const channel = await getGroupsChannel(guild);
        if (!channel) return reply(interaction, SETUP_REQUIRED_MESSAGE);
        const templateId = interaction.options.getString('template', true);
        const classId = interaction.options.getString('class', true);
        const prepared = prepare(guild.id, interaction.user.id, templateId, classId);
        if (!prepared.ok) return reply(interaction, prepared.message);
        return interaction.showModal(buildModal(templateId, classId));
      }
    }
  },
  async autocomplete(interaction: AutocompleteInteraction) {
    if (!interaction.guildId) return interaction.respond([]);
    const typed = interaction.options.getFocused().toLowerCase();
    const choices = createGroupTemplatesRepo(getDb())
      .listForGuild(interaction.guildId)
      .filter((t) => t.name.toLowerCase().includes(typed))
      .slice(0, AUTOCOMPLETE_LIMIT);
    await interaction.respond(choices.map((t) => ({ name: t.name, value: String(t.id) })));
  },
};
