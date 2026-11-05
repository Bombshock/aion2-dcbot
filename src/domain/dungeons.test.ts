import { describe, expect, it } from 'vitest';
import { BUILTIN_TEMPLATES } from './templates.js';
import { DUNGEON_PRESETS, DUNGEONS, getPreset, presetDescription, PRESET_TEMPLATE_NAME, searchPresets } from './dungeons.js';

describe('dungeon presets', () => {
  it('has unique ids that fit in customIds and a select menu', () => {
    const ids = DUNGEON_PRESETS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.every((id) => !id.includes(':'))).toBe(true);
    expect(DUNGEONS.length + 1).toBeLessThanOrEqual(25);
    expect(DUNGEONS.every((d) => d.modes.length <= 25)).toBe(true);
  });

  it('uses an existing built-in template for panel picks', () => {
    expect(BUILTIN_TEMPLATES.some((t) => t.name === PRESET_TEMPLATE_NAME)).toBe(true);
  });

  it('builds titles and item level descriptions', () => {
    const conquest = getPreset('firetemple.conquest');
    expect(conquest?.title).toBe('Fire Temple (Eroberung)');
    expect(conquest && presetDescription(conquest)).toBe('Ab Gegenstandsstufe 2.100');
    const exploration = getPreset('firetemple.exploration');
    expect(exploration && presetDescription(exploration)).toBe('');
    expect(getPreset('deus.t3')?.title).toBe('Deus Research Base (Transzendenz 3)');
    const hard = getPreset('krao.conquest-hard');
    expect(hard?.title).toBe('Krao Cave (Eroberung Schwer)');
    expect(hard && presetDescription(hard)).toBe('Ab Gegenstandsstufe 2.600');
  });

  it('matches every typed word', () => {
    expect(searchPresets('fire ero').map((p) => p.id)).toEqual(['firetemple.conquest', 'firetemple.conquest-hard']);
    expect(searchPresets('schwer').map((p) => p.id)).toEqual([
      'krao.conquest-hard',
      'draupnir.conquest-hard',
      'urugugu.conquest-hard',
      'vakron.conquest-hard',
      'firetemple.conquest-hard',
      'horn.conquest-hard',
    ]);
    expect(searchPresets('arkanis').map((p) => p.id)).toEqual(['arkanis.t1', 'arkanis.t2', 'arkanis.t3', 'arkanis.t4']);
    expect(searchPresets('')).toHaveLength(DUNGEON_PRESETS.length);
  });
});
