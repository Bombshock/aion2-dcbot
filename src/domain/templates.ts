import { CLASSES, getClass, type Role } from './classes.js';

export const MAX_SLOTS = 20;
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

const ROLE_SHORTHANDS: readonly Role[] = ['tank', 'healer', 'dps'];
const ALL_CLASS_IDS = CLASSES.map((c) => c.id);

/**
 * Expands a comma-separated class list into class ids in catalog order. Accepts class ids/names (a name covers
 * every role of the class, e.g. `gladiator` = tank and DPS Gladiator),
 * the role shorthands `tank`, `healer`, `dps` and `any` (all classes), case-insensitive.
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
    else {
      const matches = CLASSES.filter((c) => c.id === token || c.name.toLowerCase() === token);
      if (matches.length === 0) return { ok: false, message: `Unbekannte Klasse oder Rolle: ${token}` };
      matches.forEach((c) => ids.add(c.id));
    }
  }
  return { ok: true, value: ALL_CLASS_IDS.filter((id) => ids.has(id)) };
}

/** 1–20 slots, each with a label and a non-empty list of known class ids. */
export function validateSlots(slots: TemplateSlot[]): Result<TemplateSlot[]> {
  if (slots.length < 1) return { ok: false, message: 'Eine Vorlage braucht mindestens 1 Platz.' };
  if (slots.length > MAX_SLOTS) return { ok: false, message: `Eine Vorlage kann höchstens ${MAX_SLOTS} Plätze haben.` };
  for (const [i, slot] of slots.entries()) {
    const n = i + 1;
    if (!slot.label.trim()) return { ok: false, message: `Platz ${n} hat keine Bezeichnung.` };
    if (slot.label.length > MAX_LABEL_LENGTH) return { ok: false, message: `Platz ${n}: Bezeichnungen dürfen höchstens ${MAX_LABEL_LENGTH} Zeichen lang sein.` };
    if (slot.allowed.length === 0) return { ok: false, message: `Platz ${n} erlaubt keine Klasse.` };
    const unknown = slot.allowed.find((id) => !getClass(id));
    if (unknown) return { ok: false, message: `Platz ${n}: unbekannte Klasse ${unknown}` };
  }
  return { ok: true, value: slots };
}

/** Parses the template modal text: one `Label: classes` line per slot, e.g. `DPS: ranger, chanter`. Blank lines are ignored. */
export function parseTemplateText(text: string): Result<TemplateSlot[]> {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const slots: TemplateSlot[] = [];
  for (const [i, line] of lines.entries()) {
    const colon = line.indexOf(':');
    if (colon < 0) return { ok: false, message: `Zeile ${i + 1}: schreibe sie als \`Bezeichnung: Klassen\`, z. B. \`DPS: ranger, chanter\`.` };
    const allowed = expandClasses(line.slice(colon + 1));
    if (!allowed.ok) return { ok: false, message: `Zeile ${i + 1}: ${allowed.message}` };
    slots.push({ label: line.slice(0, colon).trim(), allowed: allowed.value });
  }
  return validateSlots(slots);
}

/**
 * Lets stored slots take a class added to the catalog later: every slot that allows all of `ifAllowing` gets
 * `classId`, in catalog order. Other slots are returned unchanged.
 */
export function addClassToSlots(slots: TemplateSlot[], classId: string, ifAllowing: readonly string[]): TemplateSlot[] {
  return slots.map((slot) =>
    ifAllowing.every((id) => slot.allowed.includes(id)) && !slot.allowed.includes(classId)
      ? { ...slot, allowed: ALL_CLASS_IDS.filter((id) => id === classId || slot.allowed.includes(id)) }
      : slot,
  );
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

/** `"Tank (Gladiator, Templar)"`; a slot allowing every class shows `"Beliebig (jede Klasse)"`. */
export function formatSlot(slot: TemplateSlot): string {
  const classes =
    slot.allowed.length === ALL_CLASS_IDS.length ? 'jede Klasse' : [...new Set(slot.allowed.map((id) => getClass(id)?.name ?? id))].join(', ');
  return `${slot.label} (${classes})`;
}

/** `"**Duo**: Beliebig (jede Klasse) · Beliebig (jede Klasse)"` */
export function formatTemplate(t: TemplateDefinition): string {
  return `**${t.name}**: ${t.slots.map(formatSlot).join(' · ')}`;
}

/** The `/template list` text, cut to fit a 2000-character message. */
export function formatTemplateList(builtins: TemplateDefinition[], custom: TemplateDefinition[], limit = 2000): string {
  const lines = ['__Eingebaut__', ...builtins.map(formatTemplate), '', '__Dieser Server__'];
  lines.push(...(custom.length > 0 ? custom.map(formatTemplate) : ['Noch keine eigenen Vorlagen. Erstelle eine mit `/template create`.']));
  const text = lines.join('\n');
  if (text.length <= limit) return text;
  const cut = '\n… (Liste gekürzt)';
  return text.slice(0, text.lastIndexOf('\n', limit - cut.length)) + cut;
}

const slot = (label: string, spec: string): TemplateSlot => {
  const allowed = expandClasses(spec);
  if (!allowed.ok) throw new Error(allowed.message);
  return { label, allowed: allowed.value };
};

/** Tanks, then healers, then "Beliebig" slots open to every class that is neither tank nor healer. */
const party = (tanks: number, healers: number, any: number): TemplateSlot[] => [
  ...Array.from({ length: tanks }, () => slot('Tank', 'tank')),
  ...Array.from({ length: healers }, () => slot('Heiler', 'healer')),
  ...Array.from({ length: any }, () => slot('Beliebig', 'dps')),
];

/** Built-in templates (guild_id NULL in the DB), available on every server. */
export const BUILTIN_TEMPLATES: readonly TemplateDefinition[] = [
  { name: 'Dungeon (5)', slots: party(1, 1, 3) },
  { name: 'Abyss (20)', slots: party(4, 4, 12) },
  { name: 'Raid (10)', slots: party(2, 2, 6) },
];
