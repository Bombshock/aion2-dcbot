import { MessageFlags, type Client } from 'discord.js';
import { formatClass, getClass } from '../domain/classes.js';
import { formatFullRoster } from '../domain/eventMessage.js';
import { createEventsRepo, type EventRecord, type EventsRepo } from '../db/events.js';
import { getDb } from '../db/instance.js';
import { buildClassPicker } from './classPicker.js';
import { renderEventMessage, EVENT_AREA } from './eventMessage.js';
import { registerHandler, type ComponentInteraction, type ParsedCustomId } from './router.js';

const DISCORD_UNKNOWN_CHANNEL = 10003;
const DISCORD_UNKNOWN_MESSAGE = 10008;

export const EVENT_GONE_MESSAGE = 'The event post was deleted, so the event is now marked as ended.';
const NOT_FOUND_MESSAGE = 'This event no longer exists.';

/** Why a sign-up is refused, or null when the event accepts changes. */
export function signupRefusal(event: EventRecord | undefined, now: number): string | null {
  if (!event) return NOT_FOUND_MESSAGE;
  if (event.status === 'cancelled') return 'This event was cancelled.';
  if (event.status === 'ended' || event.startsAt <= now) return 'This event has already started.';
  return null;
}

/** Saves or updates a sign-up. Two simultaneous inserts end as one row: the loser becomes an update. */
export function saveSignup(repo: EventsRepo, eventId: number, userId: string, classId: string): void {
  if (repo.getSignup(eventId, userId)) {
    repo.updateSignupClass(eventId, userId, classId);
    return;
  }
  try {
    repo.addSignup(eventId, userId, classId);
  } catch {
    repo.updateSignupClass(eventId, userId, classId);
  }
}

/** Re-renders the event post. Returns false (and marks the event ended) when the post is gone. */
export async function refreshEventPost(client: Client, repo: EventsRepo, event: EventRecord): Promise<boolean> {
  try {
    if (!event.messageId) throw Object.assign(new Error('no message'), { code: DISCORD_UNKNOWN_MESSAGE });
    const channel = await client.channels.fetch(event.channelId);
    if (!channel?.isTextBased()) throw Object.assign(new Error('no channel'), { code: DISCORD_UNKNOWN_CHANNEL });
    const message = await channel.messages.fetch(event.messageId);
    await message.edit(renderEventMessage(event, repo.listSignups(event.id)));
    return true;
  } catch (err) {
    const code = (err as { code?: number }).code;
    if (code !== DISCORD_UNKNOWN_MESSAGE && code !== DISCORD_UNKNOWN_CHANNEL) throw err;
    repo.update(event.id, { status: 'ended' });
    return false;
  }
}

type EventAction = (interaction: ComponentInteraction, parsed: ParsedCustomId) => Promise<void>;
const actions = new Map<string, EventAction>();

/** Registers a handler for `evt:<action>:<id>`; other tickets (manage, ...) add their actions here. */
export function registerEventAction(action: string, handler: EventAction): void {
  actions.set(action, handler);
}

registerHandler(EVENT_AREA, async (interaction, parsed) => {
  await actions.get(parsed.action)?.(interaction, parsed);
});

const ephemeral = (content: string) => ({ content, flags: MessageFlags.Ephemeral }) as const;
const nowSeconds = () => Math.floor(Date.now() / 1000);

registerEventAction('join', async (interaction, parsed) => {
  if (!interaction.isButton()) return;
  const repo = createEventsRepo(getDb());
  const event = repo.get(Number(parsed.id));
  const refusal = signupRefusal(event, nowSeconds());
  if (refusal || !event) return void (await interaction.reply(ephemeral(refusal ?? NOT_FOUND_MESSAGE)));
  const current = repo.getSignup(event.id, interaction.user.id);
  await interaction.reply(buildClassPicker({ area: 'evt', id: event.id, currentClassId: current?.classId }));
});

registerEventAction('pickclass', async (interaction, parsed) => {
  if (!interaction.isStringSelectMenu()) return;
  const repo = createEventsRepo(getDb());
  const event = repo.get(Number(parsed.id));
  const classId = interaction.values[0];
  if (!classId || !getClass(classId)) return void (await interaction.update({ content: 'Unknown class.', components: [] }));
  const refusal = signupRefusal(event, nowSeconds());
  if (refusal || !event) return void (await interaction.update({ content: refusal ?? NOT_FOUND_MESSAGE, components: [] }));

  await interaction.deferUpdate();
  saveSignup(repo, event.id, interaction.user.id, classId);
  const ok = await refreshEventPost(interaction.client, repo, event);
  await interaction.editReply({ content: ok ? `Signed up as ${formatClass(classId)}` : EVENT_GONE_MESSAGE, components: [] });
});

registerEventAction('leave', async (interaction, parsed) => {
  if (!interaction.isButton()) return;
  const repo = createEventsRepo(getDb());
  const event = repo.get(Number(parsed.id));
  const refusal = signupRefusal(event, nowSeconds());
  if (refusal || !event) return void (await interaction.reply(ephemeral(refusal ?? NOT_FOUND_MESSAGE)));
  if (!repo.removeSignup(event.id, interaction.user.id)) return void (await interaction.reply(ephemeral("You're not signed up.")));

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const ok = await refreshEventPost(interaction.client, repo, event);
  await interaction.editReply(ok ? 'You left the event.' : EVENT_GONE_MESSAGE);
});

registerEventAction('roster', async (interaction, parsed) => {
  if (!interaction.isButton()) return;
  const repo = createEventsRepo(getDb());
  const event = repo.get(Number(parsed.id));
  if (!event) return void (await interaction.reply(ephemeral(NOT_FOUND_MESSAGE)));
  const [first, ...rest] = formatFullRoster(repo.listSignups(event.id));
  await interaction.reply(ephemeral(first!));
  for (const chunk of rest) await interaction.followUp(ephemeral(chunk));
});
