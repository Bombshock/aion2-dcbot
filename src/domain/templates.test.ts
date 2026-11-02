import { describe, expect, it } from 'vitest';
import { CLASSES } from './classes.js';
import {
  assignSlot,
  BUILTIN_TEMPLATES,
  expandClasses,
  formatSlot,
  formatTemplateList,
  parseSlotsJson,
  parseTemplateText,
  serializeSlots,
  validateSlots,
  type TemplateSlot,
} from './templates.js';

const ALL = CLASSES.map((c) => c.id);
const dungeon = BUILTIN_TEMPLATES.find((t) => t.name === 'Dungeon (5)')!.slots;

describe('expandClasses', () => {
  it('expands role shorthands and any', () => {
    expect(expandClasses('tank')).toEqual({ ok: true, value: ['gladiator', 'templar'] });
    expect(expandClasses('healer')).toEqual({ ok: true, value: ['cleric'] });
    expect(expandClasses('any')).toEqual({ ok: true, value: ALL });
  });

  it('accepts class names case-insensitively, dedupes and keeps catalog order', () => {
    expect(expandClasses(' Chanter, cleric , healer')).toEqual({ ok: true, value: ['cleric', 'chanter'] });
  });

  it('rejects unknown classes', () => {
    expect(expandClasses('cleric, bard')).toEqual({ ok: false, message: 'Unknown class or role: bard' });
  });
});

describe('parseTemplateText', () => {
  it('parses one slot per line', () => {
    expect(parseTemplateText('Tank: tank\n\nHeal: cleric, chanter\r\nFlex: any')).toEqual({
      ok: true,
      value: [
        { label: 'Tank', allowed: ['gladiator', 'templar'] },
        { label: 'Heal', allowed: ['cleric', 'chanter'] },
        { label: 'Flex', allowed: ALL },
      ],
    });
  });

  it('rejects 6 slots', () => {
    const r = parseTemplateText(Array.from({ length: 6 }, () => 'Any: any').join('\n'));
    expect(r).toEqual({ ok: false, message: 'A template can have at most 5 slots.' });
  });

  it('rejects empty input', () => {
    expect(parseTemplateText('  \n ')).toMatchObject({ ok: false });
  });

  it('rejects an unknown class with its line number', () => {
    expect(parseTemplateText('Tank: tank\nHeal: druid')).toEqual({ ok: false, message: 'Line 2: Unknown class or role: druid' });
  });

  it('rejects lines without a colon, empty labels and empty class lists', () => {
    expect(parseTemplateText('tank')).toMatchObject({ ok: false });
    expect(parseTemplateText(': tank')).toEqual({ ok: false, message: 'Slot 1 has no label.' });
    expect(parseTemplateText('Tank:')).toEqual({ ok: false, message: 'Slot 1 allows no class.' });
  });
});

describe('validateSlots', () => {
  it('accepts 1 to 5 slots', () => {
    expect(validateSlots([{ label: 'Any', allowed: ['cleric'] }]).ok).toBe(true);
    expect(validateSlots(dungeon).ok).toBe(true);
  });

  it('rejects 0 and 6 slots, unknown class ids and empty allowed lists', () => {
    expect(validateSlots([]).ok).toBe(false);
    expect(validateSlots([...dungeon, dungeon[0]]).ok).toBe(false);
    expect(validateSlots([{ label: 'X', allowed: ['bard'] }])).toEqual({ ok: false, message: 'Slot 1: unknown class bard' });
    expect(validateSlots([{ label: 'X', allowed: [] }]).ok).toBe(false);
  });
});

describe('assignSlot', () => {
  it('puts a Cleric into the Healer slot even though an Any slot is earlier', () => {
    const slots: TemplateSlot[] = [
      { label: 'Any', allowed: ALL },
      { label: 'Healer', allowed: ['cleric'] },
    ];
    expect(assignSlot(slots, [], 'cleric')).toBe(1);
  });

  it('prefers the most restrictive slot, then the earliest', () => {
    expect(assignSlot(dungeon, [], 'templar')).toBe(0);
    expect(assignSlot(dungeon, [], 'ranger')).toBe(2);
    expect(assignSlot(dungeon, [], 'chanter')).toBe(4);
  });

  it('skips taken slots and falls back to less restrictive ones', () => {
    expect(assignSlot(dungeon, [{ slotIndex: 2 }], 'ranger')).toBe(3);
    expect(assignSlot(dungeon, [{ slotIndex: 2 }, { slotIndex: 3 }], 'ranger')).toBe(4);
    expect(assignSlot(dungeon, [{ slotIndex: 1 }], 'cleric')).toBe(4);
  });

  it('returns null when no free slot allows the class', () => {
    expect(assignSlot(dungeon, [{ slotIndex: 0 }, { slotIndex: 4 }], 'gladiator')).toBeNull();
    expect(assignSlot([{ label: 'Heal', allowed: ['cleric'] }], [], 'ranger')).toBeNull();
  });
});

describe('built-in templates', () => {
  it('are valid and match the ticket', () => {
    for (const t of BUILTIN_TEMPLATES) expect(validateSlots(t.slots).ok).toBe(true);
    expect(BUILTIN_TEMPLATES.map((t) => [t.name, t.slots.map((s) => s.label).join(' · ')])).toEqual([
      ['Dungeon (5)', 'Tank · Healer · DPS · DPS · Any'],
      ['Small group (3)', 'Any · Any · Any'],
      ['Duo (2)', 'Any · Any'],
      ['Open (5)', 'Any · Any · Any · Any · Any'],
    ]);
  });

  it('survive a JSON round trip', () => {
    expect(parseSlotsJson(serializeSlots(dungeon))).toEqual(dungeon);
  });
});

describe('formatting', () => {
  it('formats a slot, showing "any class" for all classes', () => {
    expect(formatSlot(dungeon[0])).toBe('Tank (Gladiator, Templar)');
    expect(formatSlot(dungeon[4])).toBe('Any (any class)');
  });

  it('lists built-in and custom templates', () => {
    const text = formatTemplateList([{ name: 'Duo (2)', slots: dungeon.slice(4).concat(dungeon[4]) }], []);
    expect(text).toBe(
      '__Built-in__\n**Duo (2)**: Any (any class) · Any (any class)\n\n__This server__\nNo custom templates yet. Create one with `/template create`.',
    );
  });

  it('cuts long lists to the limit', () => {
    const custom = Array.from({ length: 50 }, (_, i) => ({ name: `T${i}`, slots: dungeon }));
    const text = formatTemplateList([], custom);
    expect(text.length).toBeLessThanOrEqual(2000);
    expect(text.endsWith('… (list cut short)')).toBe(true);
  });
});
