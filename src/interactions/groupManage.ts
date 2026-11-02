import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
  ModalBuilder,
  PermissionFlagsBits,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import { createGroupsRepo, type GroupRecord } from '../db/groups.js';
import { getDb } from '../db/instance.js';
import { formatClass } from '../domain/classes.js';
import { DATE_FORMAT_HINT, formatLocalDateTime, parseFutureDateTime } from '../domain/datetime.js';
import { getGuildSettings } from '../settings.js';
import { GROUP_AREA } from './groupMessage.js';
import { GROUP_GONE_MESSAGE, refreshGroupPost, registerGroupAction } from './groupJoin.js';
import { buildCustomId, type ComponentInteraction } from './router.js';

const NOT_FOUND_MESSAGE = 'This group no longer exists.';
export const GROUP_MANAGE_REFUSED_MESSAGE = 'Only the group creator can manage this group.';
const FIELD = { title: 'title', description: 'description', when: 'when' } as const;

const ephemeral = (content: string) => ({ content, flags: MessageFlags.Ephemeral }) as const;
const nowSeconds = () => Math.floor(Date.now() / 1000);

/** Why the user may not manage the group, or null: the creator and members with Manage Guild may, while it isn't closed. */
export function groupManageRefusal(group: GroupRecord | undefined, userId: string, canManageGuild: boolean): string | null {
  if (!group) return NOT_FOUND_MESSAGE;
  if (group.creatorId !== userId && !canManageGuild) return GROUP_MANAGE_REFUSED_MESSAGE;
  if (group.status === 'closed') return 'This group is closed.';
  return null;
}

/** Loads the group of a `grp:<action>:<id>` interaction; replies with the refusal and returns null when not allowed. */
async function loadManagedGroup(interaction: ComponentInteraction, id: string) {
  const repo = createGroupsRepo(getDb());
  const group = repo.get(Number(id));
  const refusal = groupManageRefusal(group, interaction.user.id, !!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild));
  if (refusal || !group) {
    const content = refusal ?? NOT_FOUND_MESSAGE;
    if (interaction.isMessageComponent() && interaction.message.flags.has(MessageFlags.Ephemeral)) await interaction.update({ content, components: [] });
    else await interaction.reply(ephemeral(content));
    return null;
  }
  return { repo, group };
}

const button = (action: string, label: string, style: ButtonStyle, id: number) =>
  new ButtonBuilder().setCustomId(buildCustomId(GROUP_AREA, action, id)).setLabel(label).setStyle(style);

registerGroupAction('manage', async (interaction, parsed) => {
  if (!interaction.isButton()) return;
  const found = await loadManagedGroup(interaction, parsed.id);
  if (!found) return;
  const id = found.group.id;
  await interaction.reply({
    content: `Manage **${found.group.title}**`,
    flags: MessageFlags.Ephemeral,
    components: [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        button('edit', 'Edit', ButtonStyle.Primary, id),
        button('kick', 'Kick member', ButtonStyle.Secondary, id),
        button('close', 'Close group', ButtonStyle.Danger, id),
      ),
    ],
  });
});

registerGroupAction('edit', async (interaction, parsed) => {
  if (!interaction.isButton()) return;
  const found = await loadManagedGroup(interaction, parsed.id);
  if (!found) return;
  const { group } = found;
  const { timezone } = getGuildSettings(group.guildId);
  const row = (input: TextInputBuilder) => new ActionRowBuilder<TextInputBuilder>().addComponents(input);
  const prefill = (input: TextInputBuilder, value: string) => (value ? input.setValue(value) : input);
  await interaction.showModal(
    new ModalBuilder()
      .setCustomId(buildCustomId(GROUP_AREA, 'editsubmit', group.id))
      .setTitle('Edit group')
      .addComponents(
        row(prefill(new TextInputBuilder().setCustomId(FIELD.title).setLabel('Title').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(100), group.title)),
        row(
          prefill(
            new TextInputBuilder().setCustomId(FIELD.description).setLabel('Description').setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(2000),
            group.description,
          ),
        ),
        row(
          prefill(
            new TextInputBuilder()
              .setCustomId(FIELD.when)
              .setLabel(`When (${DATE_FORMAT_HINT}, empty = now)`)
              .setStyle(TextInputStyle.Short)
              .setRequired(false)
              .setPlaceholder('2030-01-31 20:00')
              .setMaxLength(16),
            group.startsAt === null ? '' : formatLocalDateTime(group.startsAt, timezone),
          ),
        ),
      ),
  );
});

registerGroupAction('editsubmit', async (interaction, parsed) => {
  if (!interaction.isModalSubmit()) return;
  const found = await loadManagedGroup(interaction, parsed.id);
  if (!found) return;
  const { repo, group } = found;

  const title = interaction.fields.getTextInputValue(FIELD.title).trim();
  const description = interaction.fields.getTextInputValue(FIELD.description).trim();
  const when = interaction.fields.getTextInputValue(FIELD.when).trim();
  const { timezone } = getGuildSettings(group.guildId);

  // An unchanged time stays valid even if it has passed; a new time must lie in the future.
  let startsAt: number | null = null;
  if (when) {
    const unchanged = group.startsAt !== null && when === formatLocalDateTime(group.startsAt, timezone);
    const parsedTime = unchanged ? ({ ok: true, epochSeconds: group.startsAt! } as const) : parseFutureDateTime(when, timezone, nowSeconds());
    if (!parsedTime.ok) {
      const text = [parsedTime.message, `Dates are read in ${timezone}.`, '', 'Your input:', `Title: ${title}`, `When: ${when}`, `Description:\n${description}`].join('\n');
      return void (await interaction.reply(ephemeral(text.slice(0, 2000))));
    }
    startsAt = parsedTime.epochSeconds;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const updated = repo.update(group.id, { title, description, startsAt });
  if (!updated) return void (await interaction.editReply(NOT_FOUND_MESSAGE));
  const ok = await refreshGroupPost(interaction.client, repo, updated);
  await interaction.editReply(ok ? 'Group updated.' : GROUP_GONE_MESSAGE);
});

registerGroupAction('kick', async (interaction, parsed) => {
  if (!interaction.isButton()) return;
  const found = await loadManagedGroup(interaction, parsed.id);
  if (!found) return;
  const { repo, group } = found;
  const others = repo.listMembers(group.id).filter((m) => m.userId !== group.creatorId);
  if (others.length === 0) return void (await interaction.update({ content: 'There is nobody to kick.', components: [] }));

  const names = new Map<string, string>();
  await Promise.all(
    others.map(async (m) => {
      const member = await interaction.guild?.members.fetch(m.userId).catch(() => null);
      names.set(m.userId, member?.displayName ?? m.userId);
    }),
  );
  const select = new StringSelectMenuBuilder()
    .setCustomId(buildCustomId(GROUP_AREA, 'kickpick', group.id))
    .setPlaceholder('Member to kick')
    .addOptions(others.map((m) => ({ label: (names.get(m.userId) ?? m.userId).slice(0, 100), description: formatClass(m.classId).slice(0, 100), value: m.userId })));
  await interaction.update({ content: 'Pick the member to kick.', components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select)] });
});

registerGroupAction('kickpick', async (interaction, parsed) => {
  if (!interaction.isStringSelectMenu()) return;
  const found = await loadManagedGroup(interaction, parsed.id);
  if (!found) return;
  const { repo, group } = found;
  const userId = interaction.values[0] ?? '';
  const result = repo.kickMember(group.id, userId);
  if (!result.ok) {
    const message = {
      not_found: NOT_FOUND_MESSAGE,
      closed: 'This group is closed.',
      creator: "The creator can't be kicked. Close the group or leave it instead.",
      not_member: 'That user is not in the group.',
    }[result.reason];
    return void (await interaction.update({ content: message, components: [] }));
  }
  await interaction.deferUpdate();
  const ok = await refreshGroupPost(interaction.client, repo, result.group);
  await interaction.editReply({ content: ok ? `Removed <@${userId}> from the group.` : GROUP_GONE_MESSAGE, components: [] });
});

registerGroupAction('close', async (interaction, parsed) => {
  if (!interaction.isButton()) return;
  const found = await loadManagedGroup(interaction, parsed.id);
  if (!found) return;
  const id = found.group.id;
  await interaction.update({
    content: `Close **${found.group.title}**? This can't be undone.`,
    components: [
      new ActionRowBuilder<ButtonBuilder>().addComponents(button('closeconfirm', 'Yes, close group', ButtonStyle.Danger, id), button('closeabort', 'Keep group', ButtonStyle.Secondary, id)),
    ],
  });
});

registerGroupAction('closeabort', async (interaction) => {
  if (!interaction.isButton()) return;
  await interaction.update({ content: 'The group was kept.', components: [] });
});

registerGroupAction('closeconfirm', async (interaction, parsed) => {
  if (!interaction.isButton()) return;
  const found = await loadManagedGroup(interaction, parsed.id);
  if (!found) return;
  const { repo } = found;
  await interaction.deferUpdate();
  const updated = repo.update(found.group.id, { status: 'closed' });
  const ok = updated ? await refreshGroupPost(interaction.client, repo, updated) : false;
  await interaction.editReply({ content: ok ? 'The group was closed.' : GROUP_GONE_MESSAGE, components: [] });
});
