import { describe, expect, it } from 'vitest';
import { CLASSES, ROLES, classesByRole, formatClass, getClass } from './classes.js';

describe('class catalog', () => {
  it('has unique ids', () => {
    const ids = CLASSES.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('has 8 classes and every role is listed', () => {
    expect(CLASSES).toHaveLength(8);
    for (const c of CLASSES) expect(ROLES.map((r) => r.role)).toContain(c.role);
  });

  it('getClass finds known and ignores unknown ids', () => {
    expect(getClass('cleric')?.name).toBe('Cleric');
    expect(getClass('nope')).toBeUndefined();
  });

  it('classesByRole keeps table order', () => {
    expect(classesByRole('tank').map((c) => c.id)).toEqual(['gladiator', 'templar']);
    expect(classesByRole('dps').map((c) => c.id)).toEqual(['assassin', 'ranger', 'sorcerer', 'spiritmaster']);
    expect(classesByRole('healer').map((c) => c.id)).toEqual(['cleric']);
    expect(classesByRole('support').map((c) => c.id)).toEqual(['chanter']);
  });

  it('formatClass formats and falls back to the raw id', () => {
    expect(formatClass('gladiator')).toBe('⚔️ Gladiator');
    expect(formatClass('removed')).toBe('removed');
  });
});
