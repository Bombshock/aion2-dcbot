import { describe, expect, it } from 'vitest';
import { CLASSES } from './classes.js';
import { buildEventEmbed, EMPTY_ROSTER_TEXT, formatFullRoster, formatTimeChangeNotice, isRosterCompact } from './eventMessage.js';

const event = { id: 1, creatorId: '99', title: 'Raid', description: 'Bring pots', startsAt: 1900000000, status: 'open' as const };

const make = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ userId: String(100000000000000000n + BigInt(i)), classId: CLASSES[i % CLASSES.length]!.id }));
const embedSize = (e: ReturnType<typeof buildEventEmbed>) =>
  e.title.length + e.description.length + e.fields.reduce((n, f) => n + f.name.length + f.value.length, 0);

describe('buildEventEmbed', () => {
  it('shows title, description, timestamps, organizer and an empty roster', () => {
    const e = buildEventEmbed(event, []);
    expect(e.title).toBe('Raid');
    expect(e.description).toBe('Bring pots');
    const text = e.fields.map((f) => f.value).join('\n');
    expect(text).toContain('<t:1900000000:F>');
    expect(text).toContain('<t:1900000000:R>');
    expect(text).toContain('<@99>');
    expect(text).toContain(EMPTY_ROSTER_TEXT);
  });
  it('groups sign-ups by role then class with counts', () => {
    const e = buildEventEmbed(event, [
      { userId: '1', classId: 'templar' },
      { userId: '2', classId: 'gladiator' },
      { userId: '3', classId: 'cleric' },
    ]);
    expect(e.fields.map((f) => f.name)).toEqual(['When', 'Organizer', 'Tanks (2)', 'Healers (1)', 'Total']);
    expect(e.fields.find((f) => f.name === 'Tanks (2)')!.value).toBe('⚔️ <@2> (Gladiator) · 🛡️ <@1> (Templar)');
    expect(e.fields.find((f) => f.name === 'Total')!.value).toBe('3');
  });
  it('marks cancelled events', () => {
    expect(buildEventEmbed({ ...event, status: 'cancelled' }, []).title).toBe('❌ Cancelled: Raid');
  });
});

describe('roster size handling', () => {
  it('renders 0 sign-ups as empty', () => {
    expect(isRosterCompact(event, [])).toBe(false);
    expect(buildEventEmbed(event, []).fields.at(-1)!.value).toBe(EMPTY_ROSTER_TEXT);
  });
  it('lists names for 5 sign-ups', () => {
    const signups = make(5);
    expect(isRosterCompact(event, signups)).toBe(false);
    expect(buildEventEmbed(event, signups).fields.map((f) => f.value).join('\n')).toContain('<@' + signups[0]!.userId + '>');
  });
  it('switches to counts per class for 300 sign-ups and stays within embed limits', () => {
    const signups = make(300);
    expect(isRosterCompact(event, signups)).toBe(true);
    const e = buildEventEmbed({ ...event, description: 'x'.repeat(2000) }, signups);
    expect(e.fields.every((f) => f.value.length <= 1024)).toBe(true);
    expect(embedSize(e)).toBeLessThanOrEqual(6000);
    expect(e.fields.find((f) => f.name === 'Total')!.value).toBe('300');
    expect(e.fields.find((f) => f.name.startsWith('Tanks'))!.value).toContain('×');
  });
  it('splits the full roster into messages of at most 2000 characters', () => {
    const chunks = formatFullRoster(make(300));
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((c) => c.length <= 2000)).toBe(true);
    expect(chunks.join('\n')).toContain('Total: 300');
  });
});

describe('formatTimeChangeNotice', () => {
  it('mentions everyone and names the new time', () => {
    expect(formatTimeChangeNotice(['1', '2'], 1900000000)).toBe('<@1> <@2> Time changed to <t:1900000000:F>');
    expect(formatTimeChangeNotice([], 1900000000)).toBe('Time changed to <t:1900000000:F>');
  });
  it('stays within 2000 characters', () => {
    expect(formatTimeChangeNotice(make(200).map((s) => s.userId), 1900000000).length).toBeLessThanOrEqual(2000);
  });
});
