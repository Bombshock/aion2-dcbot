import {
  ActionRowBuilder,
  MessageFlags,
  ModalBuilder,
  PermissionFlagsBits,
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
  'One line per slot as `Label: classes`. Classes are class names, `tank`, `healer`, `dps`, `support` or `any`, separated by commas.';

const data = new SlashCommandBuilder()
  .setName('template')
  .setDescription('Manage group templates')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .setDMPermission(false)
  .addSubcommand((s) =>
    s
      .setName('create')
      .setDescription('Create a group template for this server')
      .addStringOption((o) => o.setName('name').setDescription('Template name').setRequired(true).setMaxLength(MAX_TEMPLATE_NAME_LENGTH)),
  )
  .addSubcommand((s) => s.setName('list').setDescription('Show built-in and custom templates'))
  .addSubcommand((s) =>
    s
      .setName('delete')
      .setDescription('Delete a custom template')
      .addStringOption((o) => o.setName('name').setDescription('Template name').setRequired(true).setAutocomplete(true)),
  );

const reply = (i: ChatInputCommandInteraction | ModalSubmitInteraction, content: string) =>
  i.reply({ content, flags: MessageFlags.Ephemeral });

const templatesRepo = () => createGroupTemplatesRepo(getDb());

const toDefinition = (t: GroupTemplate) => ({ name: t.name, slots: parseSlotsJson(t.slotsJson) });

/** Error message when the name is empty or already used by a built-in or this guild's template. */
function nameProblem(guildId: string, name: string): string | null {
  if (!name) return 'The template name must not be empty.';
  const existing = templatesRepo().findByName(guildId, name);
  if (!existing) return null;
  return existing.guildId === null ? `**${existing.name}** is a built-in template. Pick another name.` : `A template named **${existing.name}** already exists.`;
}

function buildCreateModal(name: string) {
  return new ModalBuilder()
    .setCustomId(buildCustomId(CREATE_AREA, 'submit', name))
    .setTitle('Create template')
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId(SLOTS_FIELD)
          .setLabel(`Slots (up to ${MAX_SLOTS}, one per line)`)
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true)
          .setMaxLength(1000)
          .setPlaceholder('Tank: tank\nHeal: cleric, chanter\nFlex: any'),
      ),
    );
}

async function submit(i: ModalSubmitInteraction, name: string) {
  const guild = i.guild;
  if (!guild) return reply(i, 'This command only works in a server.');

  const text = i.fields.getTextInputValue(SLOTS_FIELD);
  const problem = nameProblem(guild.id, name);
  if (problem) return reply(i, problem);

  const parsed = parseTemplateText(text);
  if (!parsed.ok) {
    // Echo the typed text so the user can copy it into a new attempt.
    return reply(i, [parsed.message, SYNTAX_HELP, '', 'Your input:', text].join('\n').slice(0, 2000));
  }
  templatesRepo().create({ guildId: guild.id, name, slotsJson: serializeSlots(parsed.value) });
  return reply(i, `Template **${name}** saved.\n${formatTemplate({ name, slots: parsed.value })}`);
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
  if (!template) return reply(i, `There is no template named **${name}**.`);
  if (template.guildId === null) return reply(i, 'Built-in templates can’t be deleted.');
  repo.delete(template.id);
  return reply(i, `Template **${template.name}** deleted.`);
}

export const template: Command = {
  data,
  async execute(interaction) {
    const guild = interaction.guild;
    if (!guild) return reply(interaction, 'This command only works in a server.');
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
