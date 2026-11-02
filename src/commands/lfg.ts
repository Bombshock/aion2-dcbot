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
import { createGroupsRepo, createGroupTemplatesRepo, type GroupRecord } from '../db/groups.js';
import { getDb } from '../db/instance.js';
import { CLASSES, getClass } from '../domain/classes.js';
import { DATE_FORMAT_HINT, parseFutureDateTime } from '../domain/datetime.js';
import { checkCreateGroup, statusForFill } from '../domain/groups.js';
import { parseSlotsJson, type Result, type TemplateSlot } from '../domain/templates.js';
import { GROUP_AREA, renderGroupMessage } from '../interactions/groupMessage.js';
import { buildCustomId, registerHandler } from '../interactions/router.js';
import { getGroupsChannel, getGuildSettings, SETUP_REQUIRED_MESSAGE } from '../settings.js';

const FIELD = { title: 'title', description: 'description', when: 'when' } as const;
const AUTOCOMPLETE_LIMIT = 25;
const UNKNOWN_TEMPLATE_MESSAGE = 'Unknown template';

const data = new SlashCommandBuilder()
  .setName('lfg')
  .setDescription('Looking for group')
  .setDMPermission(false)
  .addSubcommand((s) =>
    s
      .setName('create')
      .setDescription('Post a group search from a template')
      .addStringOption((o) => o.setName('template').setDescription('Group template').setRequired(true).setAutocomplete(true))
      .addStringOption((o) =>
        o
          .setName('class')
          .setDescription('Your class')
          .setRequired(true)
          .addChoices(...CLASSES.map((c) => ({ name: c.name, value: c.id }))),
      ),
  );

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
  if (!getClass(classId)) return { ok: false, message: 'Unknown class' };
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
    .setTitle('Create group')
    .addComponents(
      row(new TextInputBuilder().setCustomId(FIELD.title).setLabel('Title').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(100).setPlaceholder('Fire Temple run')),
      row(
        new TextInputBuilder()
          .setCustomId(FIELD.description)
          .setLabel('Description')
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true)
          .setMaxLength(2000)
          .setPlaceholder('Goal, requirements, voice chat…'),
      ),
      row(
        new TextInputBuilder()
          .setCustomId(FIELD.when)
          .setLabel(`When (${DATE_FORMAT_HINT}, empty = now)`)
          .setStyle(TextInputStyle.Short)
          .setRequired(false)
          .setPlaceholder('2030-01-31 20:00')
          .setMaxLength(16),
      ),
    );
}

async function submit(i: ModalSubmitInteraction, templateId: string, classId: string) {
  const guild = i.guild;
  if (!guild) return reply(i, 'This command only works in a server.');

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
      const text = [parsed.message, `Dates are read in ${settings.timezone}.`, '', 'Your input:', `Title: ${title}`, `When: ${when}`, `Description:\n${description}`].join('\n');
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

  await i.deferReply({ flags: MessageFlags.Ephemeral });
  try {
    const message = await channel.send(renderGroupMessage({ ...toView(group), slots }, [member]));
    repo.update(group.id, { messageId: message.id });
    await i.editReply(`Group posted: ${message.url}`);
  } catch (err) {
    repo.delete(group.id);
    console.error('Posting group failed', err);
    await i.editReply(`I couldn't post in <#${channel.id}>. Check my permissions there.`);
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

registerHandler(GROUP_AREA, async (interaction, parsed) => {
  if (!interaction.isModalSubmit() || parsed.action !== 'create') return;
  const [templateId = '', classId = ''] = parsed.id.split(':');
  await submit(interaction, templateId, classId);
});

export const lfg: Command = {
  data,
  async execute(interaction) {
    const guild = interaction.guild;
    if (!guild) return reply(interaction, 'This command only works in a server.');
    switch (interaction.options.getSubcommand()) {
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
