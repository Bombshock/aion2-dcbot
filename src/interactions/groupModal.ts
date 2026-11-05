import { ActionRowBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } from 'discord.js';
import { DATE_FORMAT_HINT, DATE_PLACEHOLDER, DURATION_FORMAT_HINT } from '../domain/datetime.js';

export const GROUP_FIELD = { title: 'title', description: 'description', when: 'when', duration: 'duration' } as const;

export interface GroupModalValues {
  title: string;
  description: string;
  when: string;
  duration: string;
}

/**
 * Title / optional description / date modal shared by creating and editing LFG groups and events.
 * Events need a date and a duration; an LFG group without a date starts now.
 */
export function buildGroupModal(customId: string, modalTitle: string, opts: { timeRequired: boolean; withDuration?: boolean; values?: Partial<GroupModalValues> }) {
  const { timeRequired, withDuration, values } = opts;
  const row = (input: TextInputBuilder) => new ActionRowBuilder<TextInputBuilder>().addComponents(input);
  const prefill = (input: TextInputBuilder, value: string | undefined) => (value ? input.setValue(value) : input);
  const modal = new ModalBuilder()
    .setCustomId(customId)
    .setTitle(modalTitle)
    .addComponents(
      row(
        prefill(
          new TextInputBuilder().setCustomId(GROUP_FIELD.title).setLabel('Titel').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(100).setPlaceholder('Feuertempel-Run'),
          values?.title,
        ),
      ),
      row(
        prefill(
          new TextInputBuilder()
            .setCustomId(GROUP_FIELD.description)
            .setLabel('Beschreibung')
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(false)
            .setMaxLength(2000)
            .setPlaceholder('Ziel, Voraussetzungen, Voice-Chat…'),
          values?.description,
        ),
      ),
      row(
        prefill(
          new TextInputBuilder()
            .setCustomId(GROUP_FIELD.when)
            .setLabel(timeRequired ? `Datum & Uhrzeit (${DATE_FORMAT_HINT})` : `Wann (${DATE_FORMAT_HINT}, leer = jetzt)`)
            .setStyle(TextInputStyle.Short)
            .setRequired(timeRequired)
            .setPlaceholder(DATE_PLACEHOLDER)
            .setMaxLength(16),
          values?.when,
        ),
      ),
    );
  if (!withDuration) return modal;
  return modal.addComponents(
    row(
      prefill(
        new TextInputBuilder()
          .setCustomId(GROUP_FIELD.duration)
          .setLabel(`Dauer (${DURATION_FORMAT_HINT})`)
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setPlaceholder('2h')
          .setMaxLength(16),
        values?.duration,
      ),
    ),
  );
}
