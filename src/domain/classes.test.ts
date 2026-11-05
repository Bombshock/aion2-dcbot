import { describe, expect, it } from 'vitest';
import { CLASSES, ROLES, classLabel, classesByRole, formatClass, getClass } from './classes.js';

describe('class catalog', () => {
  it('has unique ids', () => {
    const ids = CLASSES.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('has 8 classes (Gladiator as tank and DPS, Chanter as DPS and healer) and every role is listed', () => {
    expect(CLASSES).toHaveLength(10);
    expect(new Set(CLASSES.map((c) => c.name)).size).toBe(8);
    for (const c of CLASSES) expect(ROLES.map((r) => r.role)).toContain(c.role);
  });

  it('getClass finds known and ignores unknown ids', () => {
    expect(getClass('cleric')?.name).toBe('Cleric');
    expect(getClass('nope')).toBeUndefined();
  });

  it('classesByRole keeps table order', () => {
    expect(classesByRole('tank').map((c) => c.id)).toEqual(['gladiator', 'templar']);
    expect(classesByRole('dps').map((c) => c.id)).toEqual(['gladiator_dps', 'assassin', 'ranger', 'sorcerer', 'spiritmaster', 'chanter']);
    expect(classesByRole('healer').map((c) => c.id)).toEqual(['cleric', 'chanter_healer']);
  });

  it('formatClass formats and falls back to the raw id', () => {
    expect(formatClass('gladiator')).toBe('⚔️ Gladiator (Tank)');
    expect(formatClass('gladiator_dps')).toBe('⚔️ Gladiator (DPS)');
    expect(formatClass('chanter')).toBe('🎵 Chanter (DPS)');
    expect(formatClass('chanter_healer')).toBe('🎵 Chanter (Heiler)');
    expect(formatClass('cleric')).toBe('✨ Cleric');
    expect(formatClass('removed')).toBe('removed');
  });

  it('classLabel adds the role only to classes listed with several roles', () => {
    expect(CLASSES.map(classLabel)).toContain('Gladiator (Tank)');
    expect(CLASSES.map(classLabel)).toContain('Gladiator (DPS)');
    expect(classLabel(getClass('templar')!)).toBe('Templar');
  });
});
