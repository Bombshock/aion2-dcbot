import type { MessageComponentInteraction, ModalSubmitInteraction } from 'discord.js';

export type ComponentInteraction = MessageComponentInteraction | ModalSubmitInteraction;

export interface ParsedCustomId {
  area: string;
  action: string;
  id: string;
}

export interface InteractionHandler {
  (interaction: ComponentInteraction, parsed: ParsedCustomId): Promise<void>;
}

/** customIds look like `<area>:<action>:<id>`, e.g. `evt:join:42`. The id part may be empty or contain colons. */
export function parseCustomId(customId: string): ParsedCustomId | null {
  const [area, action, ...rest] = customId.split(':');
  if (!area || !action) return null;
  return { area, action, id: rest.join(':') };
}

export function buildCustomId(area: string, action: string, id: string | number = ''): string {
  return `${area}:${action}:${id}`;
}

const handlers = new Map<string, InteractionHandler>();

/** Register a handler for all customIds of an area. Handlers read their state from the DB by id. */
export function registerHandler(area: string, handler: InteractionHandler): void {
  handlers.set(area, handler);
}

export async function routeInteraction(interaction: ComponentInteraction): Promise<void> {
  const parsed = parseCustomId(interaction.customId);
  const handler = parsed && handlers.get(parsed.area);
  if (!parsed || !handler) return;
  await handler(interaction, parsed);
}
