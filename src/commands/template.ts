import {
  ActionRowBuilder,
  MessageFlags,
  ModalBuilder,
  SlashCommandBuilder,
  TextInputBuilder,
  TextInputStyle,
  type AutocompleteInteraction,
  type ChatInputCommandInteraction,
  type ModalSubmitInteraction,
} from 'discord.js';
import type { Command } from './index.js';
import { createGroupTemplatesRepo, type GroupTemplate } from '../db/groups.js';
import { getDb } from '../db/instance.js';
import { formatTemplate, formatTemplateList, MAX_SLOTS, MAX_TEMPLATE_NAME_LENGTH, parseSlotsJson, parseTemplateText, serializeSlots } from '../domain/templates.js';
import { buildCustomId, registerHandler } from '../interactions/router.js';

const CREATE_AREA = 'tplcreate';
const SLOTS_FIELD = 'slots';
const AUTOCOMPLETE_LIMIT = 25;
const SYNTAX_HELP =
  'Eine Zeile pro Platz als `Bezeichnung: Klassen`. Klassen sind Klassennamen, `tank`, `healer`, `dps` oder `any`, durch Kommas getrennt.';

const data = new SlashCommandBuilder()
  .setName('template')
  .setDescription('Gruppenvorlagen verwalten')
  .setDMPermission(false)
  .addSubcommand((s) =>
    s
      .setName('create')
      .setDescription('Eine Gruppenvorlage für diesen Server erstellen')
      .addStringOption((o) => o.setName('name').setDescription('Vorlagenname').setRequired(true).setMaxLength(MAX_TEMPLATE_NAME_LENGTH)),
  )
  .addSubcommand((s) => s.setName('list').setDescription('Eingebaute und eigene Vorlagen anzeigen'))
  .addSubcommand((s) =>
    s
      .setName('delete')
      .setDescription('Eine eigene Vorlage löschen')
      .addStringOption((o) => o.setName('name').setDescription('Vorlagenname').setRequired(true).setAutocomplete(true)),
  );

const reply = (i: ChatInputCommandInteraction | ModalSubmitInteraction, content: string) =>
  i.reply({ content, flags: MessageFlags.Ephemeral });

const templatesRepo = () => createGroupTemplatesRepo(getDb());

const toDefinition = (t: GroupTemplate) => ({ name: t.name, slots: parseSlotsJson(t.slotsJson) });

/** Error message when the name is empty or already used by a built-in or this guild's template. */
function nameProblem(guildId: string, name: string): string | null {
  if (!name) return 'Der Vorlagenname darf nicht leer sein.';
  const existing = templatesRepo().findByName(guildId, name);
  if (!existing) return null;
  return existing.guildId === null ? `**${existing.name}** ist eine eingebaute Vorlage. Wähle einen anderen Namen.` : `Eine Vorlage namens **${existing.name}** gibt es bereits.`;
}

function buildCreateModal(name: string) {
  return new ModalBuilder()
    .setCustomId(buildCustomId(CREATE_AREA, 'submit', name))
    .setTitle('Vorlage erstellen')
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId(SLOTS_FIELD)
          .setLabel(`Plätze (bis zu ${MAX_SLOTS}, einer pro Zeile)`)
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true)
          .setMaxLength(1000)
          .setPlaceholder('Tank: tank\nHeal: healer\nDPS: ranger, chanter\nFlex: any'),
      ),
    );
}

async function submit(i: ModalSubmitInteraction, name: string) {
  const guild = i.guild;
  if (!guild) return reply(i, 'Dieser Befehl funktioniert nur auf einem Server.');

  const text = i.fields.getTextInputValue(SLOTS_FIELD);
  const problem = nameProblem(guild.id, name);
  if (problem) return reply(i, problem);

  const parsed = parseTemplateText(text);
  if (!parsed.ok) {
    // Echo the typed text so the user can copy it into a new attempt.
    return reply(i, [parsed.message, SYNTAX_HELP, '', 'Deine Eingabe:', text].join('\n').slice(0, 2000));
  }
  templatesRepo().create({ guildId: guild.id, name, slotsJson: serializeSlots(parsed.value) });
  return reply(i, `Vorlage **${name}** gespeichert.\n${formatTemplate({ name, slots: parsed.value })}`);
}

registerHandler(CREATE_AREA, async (interaction, parsed) => {
  if (interaction.isModalSubmit()) await submit(interaction, parsed.id);
});

function list(i: ChatInputCommandInteraction, guildId: string) {
  const templates = templatesRepo().listForGuild(guildId);
  const builtins = templates.filter((t) => t.guildId === null).map(toDefinition);
  const custom = templates.filter((t) => t.guildId !== null).map(toDefinition);
  return reply(i, formatTemplateList(builtins, custom));
}

function remove(i: ChatInputCommandInteraction, guildId: string) {
  const name = i.options.getString('name', true).trim();
  const repo = templatesRepo();
  const template = repo.findByName(guildId, name);
  if (!template) return reply(i, `Es gibt keine Vorlage namens **${name}**.`);
  if (template.guildId === null) return reply(i, 'Eingebaute Vorlagen können nicht gelöscht werden.');
  repo.delete(template.id);
  return reply(i, `Vorlage **${template.name}** gelöscht.`);
}

export const template: Command = {
  data,
  async execute(interaction) {
    const guild = interaction.guild;
    if (!guild) return reply(interaction, 'Dieser Befehl funktioniert nur auf einem Server.');
    switch (interaction.options.getSubcommand()) {
      case 'create': {
        const name = interaction.options.getString('name', true).trim();
        const problem = nameProblem(guild.id, name);
        if (problem) return reply(interaction, problem);
        return interaction.showModal(buildCreateModal(name));
      }
      case 'list':
        return list(interaction, guild.id);
      case 'delete':
        return remove(interaction, guild.id);
    }
  },
  async autocomplete(interaction: AutocompleteInteraction) {
    if (!interaction.guildId) return interaction.respond([]);
    const typed = interaction.options.getFocused().toLowerCase();
    const choices = templatesRepo()
      .listForGuild(interaction.guildId)
      .filter((t) => t.guildId !== null && t.name.toLowerCase().includes(typed))
      .slice(0, AUTOCOMPLETE_LIMIT);
    await interaction.respond(choices.map((t) => ({ name: t.name, value: t.name })));
  },
};
