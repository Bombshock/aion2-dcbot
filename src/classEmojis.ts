import { readFile } from 'node:fs/promises';
import type { Client } from 'discord.js';
import { CLASSES, ROLE_EMOJI } from './domain/classes.js';

// Class icons from the game client (via the A2Tools-DPS-Meter project, © NCSOFT), role icons cropped from the
// in-game role select (© NCSOFT); same depth from src/ and dist/.
const CLASS_ICON_DIR = new URL('../assets/classes/', import.meta.url);
const ROLE_ICON_DIR = new URL('../assets/roles/', import.meta.url);
const ICON_ROLES = ['any', 'tank', 'dps', 'healer'] as const;

/**
 * Uploads missing class and role icons as application emojis and points each class and role at its emoji. They
 * keep their Unicode fallback if an upload fails, so a missing permission or icon never stops the bot.
 */
export async function syncClassEmojis(client: Client<true>): Promise<void> {
  const existing = await client.application.emojis.fetch();
  const sync = async (name: string, file: URL, apply: (emoji: string) => void) => {
    try {
      const emoji =
        existing.find((e) => e.name === name) ?? (await client.application.emojis.create({ name, attachment: await readFile(file) }));
      apply(emoji.toString());
    } catch (err) {
      console.warn(`Emoji ${name} unavailable, using fallback`, err);
    }
  };
  for (const cls of CLASSES) await sync(`aion2_${cls.icon ?? cls.id}`, new URL(`${cls.icon ?? cls.id}.png`, CLASS_ICON_DIR), (e) => (cls.emoji = e));
  for (const role of ICON_ROLES) await sync(`aion2_role_${role}`, new URL(`${role}.png`, ROLE_ICON_DIR), (e) => (ROLE_EMOJI[role] = e));
}
