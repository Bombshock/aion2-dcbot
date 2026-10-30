import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, type APIEmbed } from 'discord.js';
import { buildEventEmbed, type EventView, type SignupView } from '../domain/eventMessage.js';
import { buildCustomId } from './router.js';

export const EVENT_AREA = 'evt';

/** Message payload of an event post. All tickets that change an event or its roster re-render through this. */
export function renderEventMessage(event: EventView, signups: readonly SignupView[]) {
  const embed = new EmbedBuilder(buildEventEmbed(event, signups) as APIEmbed);
  const components =
    event.status === 'open'
      ? [
          new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder().setCustomId(buildCustomId(EVENT_AREA, 'join', event.id)).setLabel('Sign up').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId(buildCustomId(EVENT_AREA, 'leave', event.id)).setLabel('Leave').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId(buildCustomId(EVENT_AREA, 'manage', event.id)).setLabel('Manage').setStyle(ButtonStyle.Primary),
          ),
        ]
      : [];
  return { embeds: [embed], components };
}
