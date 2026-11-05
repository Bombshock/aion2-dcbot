import { describe, expect, it } from 'vitest';
import { buildClassPicker } from './classPicker.js';

function menuOf(reply: ReturnType<typeof buildClassPicker>) {
  return reply.components[0].toJSON().components[0] as any;
}

describe('buildClassPicker', () => {
  it('offers all classes (Gladiator as tank and DPS, Chanter as DPS and healer) by default with the right customId', () => {
    const reply = buildClassPicker({ area: 'grp', id: 42 });
    const menu = menuOf(reply);
    expect(reply.ephemeral).toBe(true);
    expect(menu.custom_id).toBe('grp:pickclass:42');
    expect(menu.placeholder).toBe('Wähle deine Klasse');
    expect(menu.min_values).toBe(1);
    expect(menu.max_values).toBe(1);
    expect(menu.options).toHaveLength(10);
    expect(menu.options[0]).toMatchObject({ label: 'Gladiator (Tank)', value: 'gladiator', emoji: { name: '⚔️' } });
    expect(menu.options[1]).toMatchObject({ label: 'Gladiator (DPS)', value: 'gladiator_dps', emoji: { name: '⚔️' } });
    expect(menu.options.slice(-2).map((o: any) => o.label)).toEqual(['Chanter (DPS)', 'Chanter (Heiler)']);
    expect(menu.options.some((o: any) => o.default)).toBe(false);
  });

  it('filters to a subset in table order', () => {
    const menu = menuOf(buildClassPicker({ area: 'grp', id: 'x', classIds: ['cleric', 'ranger'] }));
    expect(menu.custom_id).toBe('grp:pickclass:x');
    expect(menu.options.map((o: any) => o.value)).toEqual(['ranger', 'cleric']);
  });

  it('preselects the current class only if offered', () => {
    const on = menuOf(buildClassPicker({ area: 'grp', id: 1, currentClassId: 'cleric' }));
    expect(on.options.filter((o: any) => o.default).map((o: any) => o.value)).toEqual(['cleric']);
    const off = menuOf(buildClassPicker({ area: 'grp', id: 1, classIds: ['ranger'], currentClassId: 'cleric' }));
    expect(off.options.some((o: any) => o.default)).toBe(false);
  });

  it('throws on an empty subset', () => {
    expect(() => buildClassPicker({ area: 'grp', id: 1, classIds: [] })).toThrow();
  });
  it('uses a custom action when given', () => {
    expect(menuOf(buildClassPicker({ area: 'grp', action: 'newclass', id: 7 })).custom_id).toBe('grp:newclass:7');
  });
});
