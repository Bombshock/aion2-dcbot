import { ActionRowBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } from 'discord.js';
import { DATE_FORMAT_HINT } from '../domain/datetime.js';

export const EVENT_FIELD = { title: 'title', description: 'description', when: 'when' } as const;

export interface EventModalValues {
  title: string;
  description: string;
  when: string;
}

/** Title / description / date modal shared by event creation and editing. */
export function buildEventModal(customId: string, modalTitle: string, values?: EventModalValues) {
  const row = (input: TextInputBuilder) => new ActionRowBuilder<TextInputBuilder>().addComponents(input);
  const prefill = (input: TextInputBuilder, value: string | undefined) => (value ? input.setValue(value) : input);
  return new ModalBuilder()
    .setCustomId(customId)
    .setTitle(modalTitle)
    .addComponents(
      row(prefill(new TextInputBuilder().setCustomId(EVENT_FIELD.title).setLabel('Title').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(100), values?.title)),
      row(
        prefill(
          new TextInputBuilder().setCustomId(EVENT_FIELD.description).setLabel('Description').setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(2000),
          values?.description,
        ),
      ),
      row(
        prefill(
          new TextInputBuilder()
            .setCustomId(EVENT_FIELD.when)
            .setLabel(`Date & time (${DATE_FORMAT_HINT})`)
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setPlaceholder('2030-01-31 20:00')
            .setMaxLength(16),
          values?.when,
        ),
      ),
    );
}
