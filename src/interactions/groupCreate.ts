import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
  PermissionFlagsBits,
  type AutocompleteInteraction,
  type Client,
  type GuildMember,
  type ModalSubmitInteraction,
} from 'discord.js';
import { createGroupsRepo, createGroupTemplatesRepo, type GroupKind, type GroupRecord } from '../db/groups.js';
import { getDb } from '../db/instance.js';
import { getClass } from '../domain/classes.js';
import { formatDuration, formatLocalDateTime, parseDuration, parseFutureDateTime } from '../domain/datetime.js';
import { getPreset, PRESET_TEMPLATE_NAME, presetDescription, searchPresets } from '../domain/dungeons.js';
import { checkCreateGroup, MAX_ACTIVE_GROUPS_PER_CREATOR, statusForFill } from '../domain/groups.js';
import { SCHEDULE } from '../domain/schedule.js';
import { parseSlotsJson, type Result, type TemplateSlot } from '../domain/templates.js';
import { getEventsChannel, getGroupsChannel, getGuildSettings, SETUP_REQUIRED_MESSAGE } from '../settings.js';
import { buildGroupModal, GROUP_FIELD as FIELD } from './groupModal.js';
import { GROUP_AREA, renderGroupMessage } from './groupMessage.js';
import { closeVanishedGroups, registerGroupAction } from './groupJoin.js';
import { buildCustomId, dismissReply } from './router.js';

const AUTOCOMPLETE_LIMIT = 25;
const UNKNOWN_TEMPLATE_MESSAGE = 'Unbekannte Vorlage';
export const EVENT_NOT_ALLOWED_MESSAGE = 'Du brauchst die Berechtigung „Server verwalten“ oder die Organisator-Rolle, um Events zu erstellen.';

/**
 * What is being created: an LFG group needs the creator's class (they take a slot), an event doesn't.
 * A dungeon preset only prefills the form; events aren't dungeon runs, so they have none.
 * A weekly event is posted again after it ends.
 */
export type CreateRequest = { kind: 'lfg'; templateId: string; classId: string; presetId?: string } | { kind: 'event'; templateId: string; weekly: boolean };

/** The built-in dungeon template, which events don't offer. */
const isDungeonTemplate = (t: { guildId: string | null; name: string }) => t.guildId === null && t.name === PRESET_TEMPLATE_NAME;

interface Prepared {
  templateId: number;
  slots: TemplateSlot[];
  slotsJson: string;
  /** The creator's slot; null for events, whose organizer signs up like everyone else. */
  slotIndex: number | null;
}

/** Manage Guild or the organizer role from /setup. */
export function canCreateEvents(member: GuildMember | null, organizerRoleId: string | null): boolean {
  if (!member) return false;
  if (member.permissions.has(PermissionFlagsBits.ManageGuild)) return true;
  return !!organizerRoleId && member.roles.cache.has(organizerRoleId);
}

/** Why a group can't be created; at the group limit with close buttons for the creator's groups. */
export interface CreateRefusal {
  ok: false;
  message: string;
  components?: ActionRowBuilder<ButtonBuilder>[];
}

/** Ephemeral reply payload for a refusal. */
export const refusalReply = (r: CreateRefusal) => ({ content: r.message, components: r.components ?? [] });

/** The limit message listing the creator's groups, each with a button into the usual close confirmation. */
function limitRefusal(message: string, groups: readonly GroupRecord[]): CreateRefusal {
  const link = (g: GroupRecord) => (g.messageId ? `[${g.title}](https://discord.com/channels/${g.guildId}/${g.channelId}/${g.messageId})` : g.title);
  const buttons = groups.map((g) =>
    new ButtonBuilder()
      .setCustomId(buildCustomId(GROUP_AREA, 'close', g.id))
      .setLabel(`„${g.title.slice(0, 60)}“ schließen`)
      .setStyle(ButtonStyle.Danger),
  );
  return {
    ok: false,
    message: [message, ...groups.map((g) => `- ${link(g)}`)].join('\n'),
    components: buttons.length ? [new ActionRowBuilder<ButtonBuilder>().addComponents(buttons.slice(0, 5))] : [],
  };
}

/**
 * Before the limit check: closes the creator's groups whose post was deleted, so they don't count.
 * Only checks Discord when the creator is at the limit. Call it before prepareCreate, not in between prepareCreate and the insert.
 */
export async function closeVanishedBeforeCreate(client: Client, guildId: string, userId: string, req: CreateRequest): Promise<void> {
  if (req.kind !== 'lfg') return;
  const repo = createGroupsRepo(getDb());
  const groups = repo.listActiveByCreator(guildId, userId);
  if (groups.length >= MAX_ACTIVE_GROUPS_PER_CREATOR) await closeVanishedGroups(client, repo, groups);
}

/** Discord drops a modal shown more than 3s after the interaction; leave room for the showModal request itself. */
const PRE_MODAL_CHECK_MS = 1500;

/**
 * closeVanishedBeforeCreate for the step before showModal, given up after PRE_MODAL_CHECK_MS (it keeps running in the background).
 * The modal submit runs the full check again, so a slow fetch here only means the limit refusal comes after the form.
 */
export async function closeVanishedBeforeModal(client: Client, guildId: string, userId: string, req: CreateRequest): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<void>((resolve) => (timer = setTimeout(resolve, PRE_MODAL_CHECK_MS)));
  await Promise.race([closeVanishedBeforeCreate(client, guildId, userId, req), deadline]).finally(() => clearTimeout(timer));
}

/** Template and limit checks shared by the commands, the panel and the modal submit (state may change while the modal is open). */
export function prepareCreate(guildId: string, userId: string, req: CreateRequest): { ok: true; value: Prepared } | CreateRefusal {
  const id = Number(req.templateId);
  const template = Number.isInteger(id) ? createGroupTemplatesRepo(getDb()).get(id) : undefined;
  if (!template || (template.guildId !== null && template.guildId !== guildId)) return { ok: false, message: UNKNOWN_TEMPLATE_MESSAGE };
  if (req.kind === 'event' && isDungeonTemplate(template)) return { ok: false, message: 'Für Dungeons gibt es keine Events. Nutze dafür `/lfg create`.' };
  const slots = parseSlotsJson(template.slotsJson);
  const base = { templateId: template.id, slots, slotsJson: template.slotsJson };
  if (req.kind === 'event') return { ok: true, value: { ...base, slotIndex: null } };
  if (!getClass(req.classId)) return { ok: false, message: 'Unbekannte Klasse' };
  const repo = createGroupsRepo(getDb());
  const active = repo.countActiveByCreator(guildId, userId);
  const check = checkCreateGroup(slots, req.classId, active);
  if (!check.ok) return active >= MAX_ACTIVE_GROUPS_PER_CREATOR ? limitRefusal(check.message, repo.listActiveByCreator(guildId, userId)) : check;
  return { ok: true, value: { ...base, slotIndex: check.value } };
}

/**
 * The form for title, description and date, with a dungeon preset's title and item level prefilled.
 * Events get today's next full hour prefilled so usually only the time needs adjusting.
 */
export function buildCreateModal(guildId: string, req: CreateRequest) {
  const preset = req.kind === 'lfg' && req.presetId ? getPreset(req.presetId) : undefined;
  const presetValues = preset ? { title: preset.title, description: presetDescription(preset) } : {};
  const id = req.kind === 'lfg' ? `lfg:${req.templateId}:${req.classId}` : `event:${req.templateId}:${req.weekly ? 1 : 0}`;
  const customId = buildCustomId(GROUP_AREA, 'create', id);
  if (req.kind === 'lfg') return buildGroupModal(customId, 'Gruppe erstellen', { timeRequired: false, values: presetValues });
  const nextHour = Math.ceil(Date.now() / 3_600_000) * 3600;
  const when = formatLocalDateTime(nextHour, getGuildSettings(guildId).timezone);
  const duration = formatDuration(SCHEDULE.groupExpiryAfterStartSeconds);
  return buildGroupModal(customId, req.weekly ? 'Wöchentliches Event erstellen' : 'Event erstellen', {
    timeRequired: true,
    withDuration: true,
    values: { ...presetValues, when, duration },
  });
}

function parseCreateId(id: string): CreateRequest | null {
  const [kind, templateId = '', extra = ''] = id.split(':');
  if (kind === 'lfg') return { kind, templateId, classId: extra };
  if (kind === 'event') return { kind, templateId, weekly: extra === '1' };
  return null;
}

const reply = (i: ModalSubmitInteraction, content: string, components: ActionRowBuilder<ButtonBuilder>[] = []) =>
  i.reply({ content, components, flags: MessageFlags.Ephemeral });

async function submit(i: ModalSubmitInteraction, req: CreateRequest) {
  const guild = i.guild;
  if (!guild) return reply(i, 'Dieser Befehl funktioniert nur auf einem Server.');

  const title = i.fields.getTextInputValue(FIELD.title).trim();
  const description = i.fields.getTextInputValue(FIELD.description).trim();
  const when = i.fields.getTextInputValue(FIELD.when).trim();
  const duration = req.kind === 'event' ? i.fields.getTextInputValue(FIELD.duration).trim() : '';
  const settings = getGuildSettings(guild.id);

  if (req.kind === 'event' && !canCreateEvents(i.member as GuildMember | null, settings.organizerRoleId)) return reply(i, EVENT_NOT_ALLOWED_MESSAGE);
  const channel = await (req.kind === 'event' ? getEventsChannel(guild) : getGroupsChannel(guild));
  if (!channel || !channel.isTextBased()) return reply(i, SETUP_REQUIRED_MESSAGE);

  await closeVanishedBeforeCreate(i.client, guild.id, i.user.id, req);
  const prepared = prepareCreate(guild.id, i.user.id, req);
  if (!prepared.ok) return reply(i, prepared.message, prepared.components);

  // Echo the typed values so the user can copy them into a new attempt.
  const echo = (message: string) =>
    reply(
      i,
      [message, `Daten werden in ${settings.timezone} gelesen.`, '', 'Deine Eingabe:', `Titel: ${title}`, `Wann: ${when}`, ...(duration ? [`Dauer: ${duration}`] : []), `Beschreibung:\n${description}`]
        .join('\n')
        .slice(0, 2000),
    );
  let startsAt: number | null = null;
  if (when) {
    const parsed = parseFutureDateTime(when, settings.timezone, Math.floor(Date.now() / 1000));
    if (!parsed.ok) return echo(parsed.message);
    startsAt = parsed.epochSeconds;
  }
  let durationSeconds: number | null = null;
  if (req.kind === 'event') {
    const parsed = parseDuration(duration);
    if (!parsed.ok) return echo(parsed.message);
    durationSeconds = parsed.seconds;
  }

  const { slots, slotIndex } = prepared.value;
  const members = req.kind === 'lfg' && slotIndex !== null ? [{ userId: i.user.id, classId: req.classId, slotIndex }] : [];
  const kind: GroupKind = req.kind;
  const newGroup = {
    guildId: guild.id,
    channelId: channel.id,
    creatorId: i.user.id,
    templateId: prepared.value.templateId,
    title,
    description,
    slotsJson: prepared.value.slotsJson,
    startsAt,
    status: statusForFill(slots, members),
    kind,
    durationSeconds,
    repeatDays: req.kind === 'event' && req.weekly ? SCHEDULE.eventRepeatDays : null,
  };
  // The checks above and this insert run without an await in between, so the limit can't be raced.
  const repo = createGroupsRepo(getDb());
  const [member] = members;
  const group = member ? repo.createWithMember(newGroup, member) : repo.create(newGroup);

  // From the panel flow the modal came from the ephemeral class picker: reuse that message instead of stacking a new one.
  if (i.isFromMessage()) await i.deferUpdate();
  else await i.deferReply({ flags: MessageFlags.Ephemeral });
  try {
    const message = await channel.send(renderGroupMessage({ ...group, slots }, members));
    repo.update(group.id, { messageId: message.id });
    // dismissReply never throws, so the group already posted is not rolled back by the catch below.
    await dismissReply(i);
  } catch (err) {
    repo.delete(group.id);
    console.error('Posting group failed', err);
    await i.editReply({ content: `Ich konnte nicht in <#${channel.id}> posten. Prüfe dort meine Berechtigungen.`, components: [] });
  }
}

registerGroupAction('create', async (interaction, parsed) => {
  if (!interaction.isModalSubmit()) return;
  const req = parseCreateId(parsed.id);
  if (req) await submit(interaction, req);
});

/**
 * Autocomplete for the `template` option (the guild's own and the built-in templates, without the dungeon template for /event)
 * and the `dungeon` option (the presets).
 */
export async function autocompleteCreateOptions(interaction: AutocompleteInteraction) {
  if (!interaction.guildId) return interaction.respond([]);
  const focused = interaction.options.getFocused(true);
  if (focused.name === 'dungeon') {
    const presets = searchPresets(focused.value).slice(0, AUTOCOMPLETE_LIMIT);
    return interaction.respond(presets.map((p) => ({ name: p.title, value: p.id })));
  }
  const typed = focused.value.toLowerCase();
  const choices = createGroupTemplatesRepo(getDb())
    .listForGuild(interaction.guildId)
    .filter((t) => !(interaction.commandName === 'event' && isDungeonTemplate(t)))
    .filter((t) => t.name.toLowerCase().includes(typed))
    .slice(0, AUTOCOMPLETE_LIMIT);
  await interaction.respond(choices.map((t) => ({ name: t.name, value: String(t.id) })));
}
