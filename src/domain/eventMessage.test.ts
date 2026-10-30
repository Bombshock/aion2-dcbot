import { describe, expect, it } from 'vitest';
import { CLASSES } from './classes.js';
import { buildEventEmbed, EMPTY_ROSTER_TEXT, formatRoster } from './eventMessage.js';

const event = { id: 1, creatorId: '99', title: 'Raid', description: 'Bring pots', startsAt: 1900000000, status: 'open' as const };

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
  it('lists sign-ups with their class', () => {
    const e = buildEventEmbed(event, [{ userId: '5', classId: CLASSES[0]!.id }]);
    const roster = e.fields.find((f) => f.name.startsWith('Roster'))!;
    expect(roster.name).toBe('Roster (1)');
    expect(roster.value).toContain('<@5>');
    expect(roster.value).toContain(CLASSES[0]!.name);
  });
  it('marks cancelled events', () => {
    expect(buildEventEmbed({ ...event, status: 'cancelled' }, []).title).toBe('[Cancelled] Raid');
  });
});

describe('formatRoster', () => {
  it('stays within the embed field limit for large rosters', () => {
    const many = Array.from({ length: 200 }, (_, i) => ({ userId: String(1e17 + i), classId: CLASSES[0]!.id }));
    const out = formatRoster(many);
    expect(out.length).toBeLessThanOrEqual(1024);
    expect(out).toMatch(/more$/);
  });
});
