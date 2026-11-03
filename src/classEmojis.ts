import { readFile } from 'node:fs/promises';
import type { Client } from 'discord.js';
import { CLASSES } from './domain/classes.js';

// Icons from the game client (via the A2Tools-DPS-Meter project, © NCSOFT); same depth from src/ and dist/.
const ICON_DIR = new URL('../assets/classes/', import.meta.url);
const emojiName = (classId: string) => `aion2_${classId}`;

/**
 * Uploads missing class icons as application emojis and points each class at its emoji. Classes keep their
 * Unicode fallback if an upload fails, so a missing permission or icon never stops the bot.
 */
export async function syncClassEmojis(client: Client<true>): Promise<void> {
  const existing = await client.application.emojis.fetch();
  for (const cls of CLASSES) {
    try {
      const name = emojiName(cls.id);
      const emoji =
        existing.find((e) => e.name === name) ??
        (await client.application.emojis.create({ name, attachment: await readFile(new URL(`${cls.id}.png`, ICON_DIR)) }));
      cls.emoji = emoji.toString();
    } catch (err) {
      console.warn(`Class emoji for ${cls.id} unavailable, using fallback`, err);
    }
  }
}
