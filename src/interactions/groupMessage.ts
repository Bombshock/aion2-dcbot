import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, type APIEmbed } from 'discord.js';
import { buildGroupEmbed, type GroupMemberView, type GroupView } from '../domain/groups.js';
import { buildCustomId } from './router.js';

export const GROUP_AREA = 'grp';

/** Message payload of a group post. All tickets that change a group or its members re-render through this. */
export function renderGroupMessage(group: GroupView, members: readonly GroupMemberView[]) {
  const embed = new EmbedBuilder(buildGroupEmbed(group, members) as APIEmbed);
  const closed = group.status === 'closed';
  const buttons = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(buildCustomId(GROUP_AREA, 'join', group.id))
      .setLabel('Join')
      .setStyle(ButtonStyle.Success)
      .setDisabled(group.status !== 'open'),
    new ButtonBuilder().setCustomId(buildCustomId(GROUP_AREA, 'leave', group.id)).setLabel('Leave').setStyle(ButtonStyle.Secondary).setDisabled(closed),
    new ButtonBuilder().setCustomId(buildCustomId(GROUP_AREA, 'manage', group.id)).setLabel('Manage').setStyle(ButtonStyle.Primary).setDisabled(closed),
  );
  return { embeds: [embed], components: [buttons] };
}
