import { describe, expect, it } from 'vitest';
import {
  addLocalDays,
  formatDuration,
  formatLocalDateTime,
  nextOccurrenceStart,
  parseDuration,
  parseFutureDateTime,
  parseLocalDateTime,
} from './datetime.js';

const secs = (iso: string) => Date.parse(iso) / 1000;

describe('parseLocalDateTime', () => {
  it('interprets winter time in Europe/Berlin (UTC+1)', () => {
    expect(parseLocalDateTime('15.01.2030 20:00', 'Europe/Berlin')).toEqual({ ok: true, epochSeconds: secs('2030-01-15T19:00:00Z') });
  });
  it('interprets summer time in Europe/Berlin (UTC+2)', () => {
    expect(parseLocalDateTime('15.07.2030 20:00', 'Europe/Berlin')).toEqual({ ok: true, epochSeconds: secs('2030-07-15T18:00:00Z') });
  });
  it('handles zones west of UTC and UTC itself', () => {
    expect(parseLocalDateTime('15.01.2030 20:00', 'America/New_York')).toEqual({ ok: true, epochSeconds: secs('2030-01-16T01:00:00Z') });
    expect(parseLocalDateTime('15.01.2030 20:00', 'UTC')).toEqual({ ok: true, epochSeconds: secs('2030-01-15T20:00:00Z') });
  });
  it('accepts surrounding whitespace and single-digit hours', () => {
    expect(parseLocalDateTime(' 15.01.2030 9:30 ', 'UTC')).toEqual({ ok: true, epochSeconds: secs('2030-01-15T09:30:00Z') });
  });
  it('accepts single-digit day and month', () => {
    expect(parseLocalDateTime('5.1.2030 20:00', 'UTC')).toEqual({ ok: true, epochSeconds: secs('2030-01-05T20:00:00Z') });
  });
  it('rejects malformed input', () => {
    for (const s of ['', 'tomorrow', '15.01.2030', '2030-01-15 20:00', '15.01.2030 20:00:00', '15.01.30 20:00']) {
      expect(parseLocalDateTime(s, 'UTC').ok).toBe(false);
    }
  });
  it('rejects impossible dates and times', () => {
    for (const s of ['31.02.2030 10:00', '01.13.2030 10:00', '15.01.2030 24:00', '15.01.2030 10:60']) {
      expect(parseLocalDateTime(s, 'UTC').ok).toBe(false);
    }
  });
  it('rejects local times skipped by the spring DST change', () => {
    expect(parseLocalDateTime('31.03.2030 02:30', 'Europe/Berlin').ok).toBe(false);
  });
  it('picks a valid instant for ambiguous autumn times', () => {
    const r = parseLocalDateTime('27.10.2030 02:30', 'Europe/Berlin');
    expect(r.ok).toBe(true);
  });
});

describe('parseFutureDateTime', () => {
  const now = secs('2030-01-15T12:00:00Z');
  it('accepts a later time', () => {
    expect(parseFutureDateTime('15.01.2030 20:00', 'UTC', now).ok).toBe(true);
  });
  it('rejects a past time and the current moment', () => {
    expect(parseFutureDateTime('15.01.2030 11:00', 'UTC', now)).toEqual({ ok: false, message: 'Dieses Datum liegt in der Vergangenheit.' });
    expect(parseFutureDateTime('15.01.2030 12:00', 'UTC', now).ok).toBe(false);
  });
  it('passes format errors through', () => {
    expect(parseFutureDateTime('nope', 'UTC', now).ok).toBe(false);
  });
});

describe('formatLocalDateTime', () => {
  it('round-trips with parseLocalDateTime', () => {
    for (const [input, zone] of [
      ['15.01.2030 20:00', 'Europe/Berlin'],
      ['15.07.2030 09:05', 'America/New_York'],
      ['15.01.2030 00:00', 'UTC'],
    ] as const) {
      const parsed = parseLocalDateTime(input, zone);
      expect(parsed.ok && formatLocalDateTime(parsed.epochSeconds, zone)).toBe(input);
    }
  });
});

describe('parseDuration', () => {
  it('reads hours, minutes and clock notation', () => {
    const cases: [string, number][] = [['2h', 7200], ['90m', 5400], ['1h30m', 5400], ['1h 30min', 5400], ['1:30', 5400], [' 45M ', 2700], ['24h', 86_400]];
    for (const [input, seconds] of cases) expect(parseDuration(input)).toEqual({ ok: true, seconds });
  });
  it('rejects malformed, zero and too long durations', () => {
    for (const s of ['', '2', 'zwei', '0h', '0m', '1:75', '2h30', 'h']) expect(parseDuration(s).ok).toBe(false);
    expect(parseDuration('25h')).toEqual({ ok: false, message: 'Ein Event kann höchstens 24 Stunden dauern.' });
  });
  it('round-trips with formatDuration', () => {
    for (const s of ['2h', '45m', '1h30m']) {
      const parsed = parseDuration(s);
      expect(parsed.ok && formatDuration(parsed.seconds)).toBe(s);
    }
  });
});

describe('addLocalDays', () => {
  it('keeps the wall-clock time across a DST change', () => {
    const r = parseLocalDateTime('24.10.2030 20:00', 'Europe/Berlin');
    const next = r.ok ? addLocalDays(r.epochSeconds, 7, 'Europe/Berlin') : 0;
    expect(formatLocalDateTime(next, 'Europe/Berlin')).toBe('31.10.2030 20:00');
    expect(next - (r.ok ? r.epochSeconds : 0)).toBe(7 * 86_400 + 3600);
  });
  it('crosses month and year ends', () => {
    expect(addLocalDays(secs('2030-12-28T20:00:00Z'), 7, 'UTC')).toBe(secs('2031-01-04T20:00:00Z'));
  });
});

describe('nextOccurrenceStart', () => {
  const start = secs('2030-01-01T20:00:00Z');
  it('is one interval on when that lies in the future', () => {
    expect(nextOccurrenceStart(start, 7, 'UTC', start + 3 * 3600)).toBe(secs('2030-01-08T20:00:00Z'));
  });
  it('skips occurrences missed while the bot was offline', () => {
    expect(nextOccurrenceStart(start, 7, 'UTC', secs('2030-01-20T00:00:00Z'))).toBe(secs('2030-01-22T20:00:00Z'));
  });
});
