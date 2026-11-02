import { CLASSES, getClass, type Role } from './classes.js';

export const MAX_SLOTS = 5;
export const MAX_LABEL_LENGTH = 20;
export const MAX_TEMPLATE_NAME_LENGTH = 50;

export interface TemplateSlot {
  label: string;
  /** Class ids from the class catalog. */
  allowed: string[];
}

export interface TemplateDefinition {
  name: string;
  slots: TemplateSlot[];
}

export type Result<T> = { ok: true; value: T } | { ok: false; message: string };

const ROLE_SHORTHANDS: readonly Role[] = ['tank', 'healer', 'dps', 'support'];
const ALL_CLASS_IDS = CLASSES.map((c) => c.id);

/**
 * Expands a comma-separated class list into class ids in catalog order. Accepts class ids/names,
 * the role shorthands `tank`, `healer`, `dps`, `support` and `any` (all classes), case-insensitive.
 */
export function expandClasses(spec: string): Result<string[]> {
  const ids = new Set<string>();
  const tokens = spec
    .split(',')
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);
  for (const token of tokens) {
    if (token === 'any') ALL_CLASS_IDS.forEach((id) => ids.add(id));
    else if ((ROLE_SHORTHANDS as readonly string[]).includes(token)) CLASSES.filter((c) => c.role === token).forEach((c) => ids.add(c.id));
    else if (getClass(token)) ids.add(token);
    else return { ok: false, message: `Unknown class or role: ${token}` };
  }
  return { ok: true, value: ALL_CLASS_IDS.filter((id) => ids.has(id)) };
}

/** 1–5 slots, each with a label and a non-empty list of known class ids. */
export function validateSlots(slots: TemplateSlot[]): Result<TemplateSlot[]> {
  if (slots.length < 1) return { ok: false, message: 'A template needs at least 1 slot.' };
  if (slots.length > MAX_SLOTS) return { ok: false, message: `A template can have at most ${MAX_SLOTS} slots.` };
  for (const [i, slot] of slots.entries()) {
    const n = i + 1;
    if (!slot.label.trim()) return { ok: false, message: `Slot ${n} has no label.` };
    if (slot.label.length > MAX_LABEL_LENGTH) return { ok: false, message: `Slot ${n}: labels can be at most ${MAX_LABEL_LENGTH} characters.` };
    if (slot.allowed.length === 0) return { ok: false, message: `Slot ${n} allows no class.` };
    const unknown = slot.allowed.find((id) => !getClass(id));
    if (unknown) return { ok: false, message: `Slot ${n}: unknown class ${unknown}` };
  }
  return { ok: true, value: slots };
}

/** Parses the template modal text: one `Label: classes` line per slot, e.g. `Heal: cleric, chanter`. Blank lines are ignored. */
export function parseTemplateText(text: string): Result<TemplateSlot[]> {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const slots: TemplateSlot[] = [];
  for (const [i, line] of lines.entries()) {
    const colon = line.indexOf(':');
    if (colon < 0) return { ok: false, message: `Line ${i + 1}: write it as \`Label: classes\`, e.g. \`Heal: cleric, chanter\`.` };
    const allowed = expandClasses(line.slice(colon + 1));
    if (!allowed.ok) return { ok: false, message: `Line ${i + 1}: ${allowed.message}` };
    slots.push({ label: line.slice(0, colon).trim(), allowed: allowed.value });
  }
  return validateSlots(slots);
}

export function serializeSlots(slots: TemplateSlot[]): string {
  return JSON.stringify(slots);
}

export function parseSlotsJson(json: string): TemplateSlot[] {
  return JSON.parse(json) as TemplateSlot[];
}

/**
 * Index of the free slot the class should fill, or null when none allows it. The most restrictive
 * matching slot wins (fewest allowed classes), earlier slots break ties, so a Cleric takes
 * "Healer" before an earlier "Any" slot.
 */
export function assignSlot(slots: TemplateSlot[], members: readonly { slotIndex: number }[], classId: string): number | null {
  const taken = new Set(members.map((m) => m.slotIndex));
  let best: number | null = null;
  slots.forEach((slot, i) => {
    if (taken.has(i) || !slot.allowed.includes(classId)) return;
    if (best === null || slot.allowed.length < slots[best].allowed.length) best = i;
  });
  return best;
}

/** `"Tank (Gladiator, Templar)"`; a slot allowing every class shows `"Any (any class)"`. */
export function formatSlot(slot: TemplateSlot): string {
  const classes =
    slot.allowed.length === ALL_CLASS_IDS.length ? 'any class' : slot.allowed.map((id) => getClass(id)?.name ?? id).join(', ');
  return `${slot.label} (${classes})`;
}

/** `"**Duo (2)**: Any (any class) · Any (any class)"` */
export function formatTemplate(t: TemplateDefinition): string {
  return `**${t.name}**: ${t.slots.map(formatSlot).join(' · ')}`;
}

/** The `/template list` text, cut to fit a 2000-character message. */
export function formatTemplateList(builtins: TemplateDefinition[], custom: TemplateDefinition[], limit = 2000): string {
  const lines = ['__Built-in__', ...builtins.map(formatTemplate), '', '__This server__'];
  lines.push(...(custom.length > 0 ? custom.map(formatTemplate) : ['No custom templates yet. Create one with `/template create`.']));
  const text = lines.join('\n');
  if (text.length <= limit) return text;
  const cut = '\n… (list cut short)';
  return text.slice(0, text.lastIndexOf('\n', limit - cut.length)) + cut;
}

const slot = (label: string, spec: string): TemplateSlot => {
  const allowed = expandClasses(spec);
  if (!allowed.ok) throw new Error(allowed.message);
  return { label, allowed: allowed.value };
};

/** Built-in templates (guild_id NULL in the DB), available on every server. */
export const BUILTIN_TEMPLATES: readonly TemplateDefinition[] = [
  { name: 'Dungeon (5)', slots: [slot('Tank', 'tank'), slot('Healer', 'healer'), slot('DPS', 'dps'), slot('DPS', 'dps'), slot('Any', 'any')] },
  { name: 'Small group (3)', slots: [slot('Any', 'any'), slot('Any', 'any'), slot('Any', 'any')] },
  { name: 'Duo (2)', slots: [slot('Any', 'any'), slot('Any', 'any')] },
  { name: 'Open (5)', slots: Array.from({ length: 5 }, () => slot('Any', 'any')) },
];
