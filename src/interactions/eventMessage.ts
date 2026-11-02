import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, type APIEmbed } from 'discord.js';
import { buildEventEmbed, isRosterCompact, type EventView, type SignupView } from '../domain/eventMessage.js';
import { buildCustomId } from './router.js';

export const EVENT_AREA = 'evt';

/** Message payload of an event post. All tickets that change an event or its roster re-render through this. */
export function renderEventMessage(event: EventView, signups: readonly SignupView[]) {
  const embed = new EmbedBuilder(buildEventEmbed(event, signups) as APIEmbed);
  const buttons =
    event.status === 'open'
      ? new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder().setCustomId(buildCustomId(EVENT_AREA, 'join', event.id)).setLabel('Sign up').setStyle(ButtonStyle.Success),
          new ButtonBuilder().setCustomId(buildCustomId(EVENT_AREA, 'leave', event.id)).setLabel('Leave').setStyle(ButtonStyle.Secondary),
          new ButtonBuilder().setCustomId(buildCustomId(EVENT_AREA, 'manage', event.id)).setLabel('Manage').setStyle(ButtonStyle.Primary),
        )
      : null;
  if (buttons && isRosterCompact(event, signups)) {
    buttons.addComponents(new ButtonBuilder().setCustomId(buildCustomId(EVENT_AREA, 'roster', event.id)).setLabel('Show full roster').setStyle(ButtonStyle.Secondary));
  }
  const closed =
    event.status !== 'open'
      ? new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder().setCustomId(buildCustomId(EVENT_AREA, 'join', event.id)).setLabel('Sign up').setStyle(ButtonStyle.Success).setDisabled(true),
          new ButtonBuilder().setCustomId(buildCustomId(EVENT_AREA, 'leave', event.id)).setLabel('Leave').setStyle(ButtonStyle.Secondary).setDisabled(true),
        )
      : null;
  const components = buttons ? [buttons] : closed ? [closed] : [];
  return { embeds: [embed], components };
}
