/** A difficulty of a dungeon; `itemLevel` is the minimum item level, null where it isn't known. */
export interface DungeonMode {
  id: string;
  label: string;
  itemLevel: number | null;
}

export interface Dungeon {
  id: string;
  name: string;
  modes: DungeonMode[];
}

/** A dungeon in one mode, what a group post is prefilled with. */
export interface DungeonPreset {
  /** `<dungeon id>.<mode id>`, safe inside customIds (no colons). */
  id: string;
  dungeon: Dungeon;
  mode: DungeonMode;
  title: string;
}

/** The template a preset picked from the panel uses, so the panel flow can skip the template step. */
export const PRESET_TEMPLATE_NAME = 'Dungeon (5)';

/** Without `hardItemLevel` the dungeon has no released hard mode yet. */
const expedition = (id: string, name: string, conquestItemLevel: number, hardItemLevel?: number): Dungeon => ({
  id,
  name,
  modes: [
    { id: 'exploration', label: 'Erkundung', itemLevel: null },
    { id: 'conquest', label: 'Eroberung', itemLevel: conquestItemLevel },
    ...(hardItemLevel === undefined ? [] : [{ id: 'conquest-hard', label: 'Eroberung Schwer', itemLevel: hardItemLevel }]),
  ],
});

const transcendence = (id: string, name: string, stageItemLevels: [number, number, number, number]): Dungeon => ({
  id,
  name,
  modes: stageItemLevels.map((itemLevel, i) => ({ id: `t${i + 1}`, label: `Transzendenz ${i + 1}`, itemLevel })),
});

/** The 5-player dungeons of the global version, in progression order. */
export const DUNGEONS: readonly Dungeon[] = [
  expedition('krao', 'Krao Cave', 700, 2600),
  expedition('draupnir', 'Draupnir', 700, 2600),
  expedition('urugugu', 'Urugugu Canyon', 1400, 2700),
  expedition('vakron', 'Vakron Sky Island', 1400, 2700),
  expedition('firetemple', 'Fire Temple', 2100, 2800),
  expedition('horn', 'Ferocious Horn Den', 2100, 2800),
  transcendence('deus', 'Deus Research Base', [1600, 1900, 2200, 2500]),
  transcendence('arkanis', 'Shattered Arkanis', [1600, 1900, 2200, 2500]),
  transcendence('lifetemple', 'Submerged Life Temple', [2400, 2800, 3200, 3500]),
  transcendence('scarlet', 'Mirror of Scarlet Desire', [3200, 3500, 3800, 4000]),
];

const toPreset = (dungeon: Dungeon, mode: DungeonMode): DungeonPreset => ({
  id: `${dungeon.id}.${mode.id}`,
  dungeon,
  mode,
  title: `${dungeon.name} (${mode.label})`,
});

export const DUNGEON_PRESETS: readonly DungeonPreset[] = DUNGEONS.flatMap((d) => d.modes.map((m) => toPreset(d, m)));

export function getDungeon(id: string): Dungeon | undefined {
  return DUNGEONS.find((d) => d.id === id);
}

export function getPreset(id: string): DungeonPreset | undefined {
  return DUNGEON_PRESETS.find((p) => p.id === id);
}

/** Presets whose title contains every typed word, case-insensitive, so `fire con` finds Fire Temple (Eroberung). */
export function searchPresets(typed: string): DungeonPreset[] {
  const words = typed.toLowerCase().split(/\s+/).filter(Boolean);
  return DUNGEON_PRESETS.filter((p) => words.every((w) => p.title.toLowerCase().includes(w)));
}

/** `"Ab Gegenstandsstufe 2.100"` */
export function formatItemLevel(itemLevel: number): string {
  return `Ab Gegenstandsstufe ${itemLevel.toLocaleString('de-DE')}`;
}

/** The prefilled description; empty when the item level is unknown. */
export function presetDescription(preset: DungeonPreset): string {
  return preset.mode.itemLevel === null ? '' : formatItemLevel(preset.mode.itemLevel);
}
