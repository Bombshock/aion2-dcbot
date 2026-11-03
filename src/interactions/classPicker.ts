import { ActionRowBuilder, StringSelectMenuBuilder, StringSelectMenuOptionBuilder } from 'discord.js';
import { CLASSES } from '../domain/classes.js';
import { buildCustomId } from './router.js';

export interface ClassPickerOptions {
  area: 'evt' | 'grp';
  /** customId action; defaults to `pickclass`. */
  action?: string;
  id: string | number;
  /** Class ids to offer; defaults to all classes. Unknown ids are ignored. */
  classIds?: readonly string[];
  /** The user's current class; preselected if it is among the offered ones. */
  currentClassId?: string | null;
}

/** Builds an ephemeral reply with a class select menu. Throws if no class is left to offer. */
export function buildClassPicker(opts: ClassPickerOptions) {
  const { classIds } = opts;
  const offered = classIds ? CLASSES.filter((c) => classIds.includes(c.id)) : CLASSES;
  if (offered.length === 0) throw new Error('Class picker needs at least one class');

  const menu = new StringSelectMenuBuilder()
    .setCustomId(buildCustomId(opts.area, opts.action ?? 'pickclass', opts.id))
    .setPlaceholder('Wähle deine Klasse')
    .setMinValues(1)
    .setMaxValues(1)
    .addOptions(
      offered.map((c) =>
        new StringSelectMenuOptionBuilder()
          .setLabel(c.name)
          .setValue(c.id)
          .setEmoji(c.emoji)
          .setDefault(c.id === opts.currentClassId),
      ),
    );

  return {
    content: 'Wähle deine Klasse:',
    components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu)],
    ephemeral: true,
  };
}
