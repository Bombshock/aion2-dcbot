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
const dungeon = (parseTemplateText('Tank: tank\nHealer: healer\nDPS: dps\nDPS: dps\nAny: any') as { value: TemplateSlot[] }).value;

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
    expect(expandClasses('cleric, bard')).toEqual({ ok: false, message: 'Unbekannte Klasse oder Rolle: bard' });
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

  it('rejects 21 slots', () => {
    const r = parseTemplateText(Array.from({ length: 21 }, () => 'Any: any').join('\n'));
    expect(r).toEqual({ ok: false, message: 'Eine Vorlage kann höchstens 20 Plätze haben.' });
  });

  it('rejects empty input', () => {
    expect(parseTemplateText('  \n ')).toMatchObject({ ok: false });
  });

  it('rejects an unknown class with its line number', () => {
    expect(parseTemplateText('Tank: tank\nHeal: druid')).toEqual({ ok: false, message: 'Zeile 2: Unbekannte Klasse oder Rolle: druid' });
  });

  it('rejects lines without a colon, empty labels and empty class lists', () => {
    expect(parseTemplateText('tank')).toMatchObject({ ok: false });
    expect(parseTemplateText(': tank')).toEqual({ ok: false, message: 'Platz 1 hat keine Bezeichnung.' });
    expect(parseTemplateText('Tank:')).toEqual({ ok: false, message: 'Platz 1 erlaubt keine Klasse.' });
  });
});

describe('validateSlots', () => {
  it('accepts 1 to 20 slots', () => {
    expect(validateSlots([{ label: 'Any', allowed: ['cleric'] }]).ok).toBe(true);
    expect(validateSlots([...dungeon, ...dungeon, ...dungeon, ...dungeon]).ok).toBe(true);
  });

  it('rejects 0 and 21 slots, unknown class ids and empty allowed lists', () => {
    expect(validateSlots([]).ok).toBe(false);
    expect(validateSlots([...dungeon, ...dungeon, ...dungeon, ...dungeon, dungeon[0]]).ok).toBe(false);
    expect(validateSlots([{ label: 'X', allowed: ['bard'] }])).toEqual({ ok: false, message: 'Platz 1: unbekannte Klasse bard' });
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
  it('are valid and have the agreed tank / healer / any split', () => {
    for (const t of BUILTIN_TEMPLATES) expect(validateSlots(t.slots).ok).toBe(true);
    const count = (slots: TemplateSlot[], label: string) => slots.filter((s) => s.label === label).length;
    expect(BUILTIN_TEMPLATES.map((t) => [t.name, count(t.slots, 'Tank'), count(t.slots, 'Heiler'), count(t.slots, 'Beliebig'), t.slots.length])).toEqual([
      ['Dungeon (5)', 1, 1, 3, 5],
      ['Abyss (20)', 4, 4, 12, 20],
      ['Raid (10)', 2, 2, 6, 10],
    ]);
  });

  it('take Gladiator and Templar as tanks, only Cleric as healer and every other class for Any', () => {
    const allowed = BUILTIN_TEMPLATES[0]!.slots.map((s) => s.allowed);
    expect(allowed).toEqual([
      ['gladiator', 'templar'],
      ['cleric'],
      ...Array.from({ length: 3 }, () => ['assassin', 'ranger', 'sorcerer', 'spiritmaster', 'chanter']),
    ]);
  });

  it('survive a JSON round trip', () => {
    expect(parseSlotsJson(serializeSlots(dungeon))).toEqual(dungeon);
  });
});

describe('formatting', () => {
  it('formats a slot, showing "any class" for all classes', () => {
    expect(formatSlot(dungeon[0])).toBe('Tank (Gladiator, Templar)');
    expect(formatSlot(dungeon[4])).toBe('Any (jede Klasse)');
  });

  it('lists built-in and custom templates', () => {
    const text = formatTemplateList([{ name: 'Duo (2)', slots: dungeon.slice(4).concat(dungeon[4]) }], []);
    expect(text).toBe(
      '__Eingebaut__\n**Duo (2)**: Any (jede Klasse) · Any (jede Klasse)\n\n__Dieser Server__\nNoch keine eigenen Vorlagen. Erstelle eine mit `/template create`.',
    );
  });

  it('cuts long lists to the limit', () => {
    const custom = Array.from({ length: 50 }, (_, i) => ({ name: `T${i}`, slots: dungeon }));
    const text = formatTemplateList([], custom);
    expect(text.length).toBeLessThanOrEqual(2000);
    expect(text.endsWith('… (Liste gekürzt)')).toBe(true);
  });
});
