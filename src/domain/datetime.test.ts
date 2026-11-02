import { describe, expect, it } from 'vitest';
import { formatLocalDateTime, parseFutureDateTime, parseLocalDateTime } from './datetime.js';

const secs = (iso: string) => Date.parse(iso) / 1000;

describe('parseLocalDateTime', () => {
  it('interprets winter time in Europe/Berlin (UTC+1)', () => {
    expect(parseLocalDateTime('2030-01-15 20:00', 'Europe/Berlin')).toEqual({ ok: true, epochSeconds: secs('2030-01-15T19:00:00Z') });
  });
  it('interprets summer time in Europe/Berlin (UTC+2)', () => {
    expect(parseLocalDateTime('2030-07-15 20:00', 'Europe/Berlin')).toEqual({ ok: true, epochSeconds: secs('2030-07-15T18:00:00Z') });
  });
  it('handles zones west of UTC and UTC itself', () => {
    expect(parseLocalDateTime('2030-01-15 20:00', 'America/New_York')).toEqual({ ok: true, epochSeconds: secs('2030-01-16T01:00:00Z') });
    expect(parseLocalDateTime('2030-01-15 20:00', 'UTC')).toEqual({ ok: true, epochSeconds: secs('2030-01-15T20:00:00Z') });
  });
  it('accepts surrounding whitespace and single-digit hours', () => {
    expect(parseLocalDateTime(' 2030-01-15 9:30 ', 'UTC')).toEqual({ ok: true, epochSeconds: secs('2030-01-15T09:30:00Z') });
  });
  it('rejects malformed input', () => {
    for (const s of ['', 'tomorrow', '2030-01-15', '15.01.2030 20:00', '2030-01-15 20:00:00']) {
      expect(parseLocalDateTime(s, 'UTC').ok).toBe(false);
    }
  });
  it('rejects impossible dates and times', () => {
    for (const s of ['2030-02-31 10:00', '2030-13-01 10:00', '2030-01-15 24:00', '2030-01-15 10:60']) {
      expect(parseLocalDateTime(s, 'UTC').ok).toBe(false);
    }
  });
  it('rejects local times skipped by the spring DST change', () => {
    expect(parseLocalDateTime('2030-03-31 02:30', 'Europe/Berlin').ok).toBe(false);
  });
  it('picks a valid instant for ambiguous autumn times', () => {
    const r = parseLocalDateTime('2030-10-27 02:30', 'Europe/Berlin');
    expect(r.ok).toBe(true);
  });
});

describe('parseFutureDateTime', () => {
  const now = secs('2030-01-15T12:00:00Z');
  it('accepts a later time', () => {
    expect(parseFutureDateTime('2030-01-15 20:00', 'UTC', now).ok).toBe(true);
  });
  it('rejects a past time and the current moment', () => {
    expect(parseFutureDateTime('2030-01-15 11:00', 'UTC', now)).toEqual({ ok: false, message: 'That date is in the past.' });
    expect(parseFutureDateTime('2030-01-15 12:00', 'UTC', now).ok).toBe(false);
  });
  it('passes format errors through', () => {
    expect(parseFutureDateTime('nope', 'UTC', now).ok).toBe(false);
  });
});

describe('formatLocalDateTime', () => {
  it('round-trips with parseLocalDateTime', () => {
    for (const [input, zone] of [
      ['2030-01-15 20:00', 'Europe/Berlin'],
      ['2030-07-15 09:05', 'America/New_York'],
      ['2030-01-15 00:00', 'UTC'],
    ] as const) {
      const parsed = parseLocalDateTime(input, zone);
      expect(parsed.ok && formatLocalDateTime(parsed.epochSeconds, zone)).toBe(input);
    }
  });
});
