import { describe, expect, it } from 'vitest';
import { buildReminderMessages, formatReminder } from './schedule.js';

describe('buildReminderMessages', () => {
  it('returns nothing without users', () => {
    expect(buildReminderMessages('header', [])).toEqual([]);
  });

  it('puts header and mentions in one message when they fit', () => {
    expect(buildReminderMessages('header', ['1', '2'])).toEqual(['header\n<@1> <@2>']);
  });

  it('splits long mention lists without losing anyone', () => {
    const ids = Array.from({ length: 300 }, (_, i) => String(100000000000000000n + BigInt(i)));
    const messages = buildReminderMessages(formatReminder('Raid', 1000, 'https://discord.com/channels/1/2/3'), ids);
    expect(messages.length).toBeGreaterThan(1);
    for (const m of messages) expect(m.length).toBeLessThanOrEqual(2000);
    const mentioned = messages.flatMap((m) => [...m.matchAll(/<@(\d+)>/g)].map((x) => x[1]));
    expect(mentioned).toEqual(ids);
  });
});
