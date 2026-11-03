import { describe, expect, it } from 'vitest';
import {
  BOTH_CHANNELS_MESSAGE,
  CHANNELS_USAGE_MESSAGE,
  DEFAULT_SETTINGS,
  DEFAULT_TIMEZONE,
  formatMissingPermissions,
  isValidTimezone,
  missingPermissions,
  resolveChannels,
  TIMEZONE_SUGGESTIONS,
} from './settings.js';

describe('isValidTimezone', () => {
  it('accepts IANA names, including ones outside the suggestions', () => {
    expect(isValidTimezone('Europe/London')).toBe(true);
    expect(isValidTimezone('UTC')).toBe(true);
    expect(isValidTimezone('Africa/Nairobi')).toBe(true);
  });
  it('rejects unknown or empty names', () => {
    expect(isValidTimezone('Mars/Base')).toBe(false);
    expect(isValidTimezone('')).toBe(false);
    expect(isValidTimezone('   ')).toBe(false);
  });
  it('all suggestions are valid and the default is Europe/Berlin', () => {
    expect(DEFAULT_TIMEZONE).toBe('Europe/Berlin');
    expect(DEFAULT_SETTINGS.timezone).toBe('Europe/Berlin');
    expect(TIMEZONE_SUGGESTIONS.every(isValidTimezone)).toBe(true);
  });
});

describe('resolveChannels', () => {
  const empty = { eventsChannelId: null, groupsChannelId: null };
  it('requires both channels the first time', () => {
    expect(resolveChannels(empty, false, { events: 'e' })).toEqual({ ok: false, message: BOTH_CHANNELS_MESSAGE });
    expect(resolveChannels(empty, false, { groups: 'g' })).toEqual({ ok: false, message: BOTH_CHANNELS_MESSAGE });
    expect(resolveChannels(empty, false, { events: 'e', groups: 'g' })).toEqual({
      ok: true,
      eventsChannelId: 'e',
      groupsChannelId: 'g',
    });
  });
  it('updates only the given channel afterwards', () => {
    const current = { eventsChannelId: 'e1', groupsChannelId: 'g1' };
    expect(resolveChannels(current, true, { groups: 'g2' })).toEqual({ ok: true, eventsChannelId: 'e1', groupsChannelId: 'g2' });
  });
  it('replies with a usage hint when nothing is given', () => {
    expect(resolveChannels(empty, true, {})).toEqual({ ok: false, message: CHANNELS_USAGE_MESSAGE });
    expect(resolveChannels(empty, false, {})).toEqual({ ok: false, message: CHANNELS_USAGE_MESSAGE });
  });
  it('allows the same channel for both', () => {
    expect(resolveChannels(empty, false, { events: 'c', groups: 'c' })).toMatchObject({ ok: true });
  });
});

describe('missingPermissions', () => {
  it('lists nothing when all are present', () => {
    expect(missingPermissions(() => true)).toEqual([]);
  });
  it('lists the missing ones', () => {
    expect(missingPermissions((p) => p === 'ViewChannel')).toEqual(['SendMessages', 'EmbedLinks']);
  });
  it('names the channel in the message', () => {
    expect(formatMissingPermissions('42', ['EmbedLinks'])).toBe('Mir fehlt EmbedLinks in <#42>.');
  });
});
