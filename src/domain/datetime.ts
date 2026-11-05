export const DATE_FORMAT_HINT = 'TT.MM.JJJJ HH:mm';
export const DATE_PLACEHOLDER = '31.01.2030 20:00';

export type ParseResult = { ok: true; epochSeconds: number } | { ok: false; message: string };

const PATTERN = /^(\d{1,2})\.(\d{1,2})\.(\d{4}) +(\d{1,2}):(\d{2})$/;

/** Offset (ms) of `timeZone` from UTC at the given instant. */
function zoneOffsetMs(utcMs: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
  }).formatToParts(new Date(utcMs));
  const get = (type: string) => Number(parts.find((p) => p.type === type)!.value);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return asUtc - Math.floor(utcMs / 1000) * 1000;
}

/**
 * Parses German `DD.MM.YYYY HH:mm` (day and month may be single-digit) as wall-clock time in `timeZone` and returns epoch seconds.
 * Rejects malformed or impossible dates (e.g. 2030-02-31) and local times skipped by a DST change.
 */
export function parseLocalDateTime(input: string, timeZone: string): ParseResult {
  const bad: ParseResult = { ok: false, message: `Dieses Datum konnte ich nicht lesen. Nutze das Format ${DATE_FORMAT_HINT}.` };
  const m = PATTERN.exec(input.trim());
  if (!m) return bad;
  const [day, month, year, hour, minute] = m.slice(1).map(Number) as [number, number, number, number, number];
  const wallMs = Date.UTC(year, month - 1, day, hour, minute);
  const check = new Date(wallMs);
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== day ||
    hour > 23 ||
    minute > 59
  ) {
    return bad;
  }

  // Find the UTC instant whose wall-clock time in the zone equals the input.
  let utcMs = wallMs - zoneOffsetMs(wallMs, timeZone);
  utcMs = wallMs - zoneOffsetMs(utcMs, timeZone);
  if (utcMs + zoneOffsetMs(utcMs, timeZone) !== wallMs) {
    return { ok: false, message: `Diese Uhrzeit gibt es in ${timeZone} nicht (Zeitumstellung).` };
  }
  return { ok: true, epochSeconds: Math.floor(utcMs / 1000) };
}

/** Formats epoch seconds as `DD.MM.YYYY HH:mm` wall-clock time in `timeZone` (the inverse of `parseLocalDateTime`). */
export function formatLocalDateTime(epochSeconds: number, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(new Date(epochSeconds * 1000));
  const get = (type: string) => parts.find((p) => p.type === type)!.value;
  return `${get('day')}.${get('month')}.${get('year')} ${get('hour')}:${get('minute')}`;
}

/** Parses like `parseLocalDateTime` and additionally requires the moment to lie after `nowSeconds`. */
export function parseFutureDateTime(input: string, timeZone: string, nowSeconds: number): ParseResult {
  const r = parseLocalDateTime(input, timeZone);
  if (r.ok && r.epochSeconds <= nowSeconds) return { ok: false, message: 'Dieses Datum liegt in der Vergangenheit.' };
  return r;
}

export const DURATION_FORMAT_HINT = 'z. B. 2h, 90m, 1h30m';
/** Events can't run longer than a day, which keeps an occurrence well clear of the next one. */
export const MAX_DURATION_SECONDS = 24 * 60 * 60;

const DURATION_PATTERN = /^(?:(\d+)\s*h)?\s*(?:(\d+)\s*m(?:in)?)?$/i;
const CLOCK_DURATION_PATTERN = /^(\d{1,2}):(\d{2})$/;

export type DurationResult = { ok: true; seconds: number } | { ok: false; message: string };

/** Parses a duration like `2h`, `90m`, `1h30m`, `1h 30min` or `1:30` into seconds; between 1 minute and 24 hours. */
export function parseDuration(input: string): DurationResult {
  const text = input.trim();
  const clock = CLOCK_DURATION_PATTERN.exec(text);
  const m = clock ?? DURATION_PATTERN.exec(text);
  const minutesOk = !clock || Number(clock[2]) < 60;
  const seconds = m && text && minutesOk ? (Number(m[1] ?? 0) * 60 + Number(m[2] ?? 0)) * 60 : 0;
  if (seconds <= 0) return { ok: false, message: `Diese Dauer konnte ich nicht lesen (${DURATION_FORMAT_HINT}).` };
  if (seconds > MAX_DURATION_SECONDS) return { ok: false, message: 'Ein Event kann höchstens 24 Stunden dauern.' };
  return { ok: true, seconds };
}

/** Formats seconds as `2h`, `45m` or `1h30m` (the inverse of `parseDuration`). */
export function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return `${hours ? `${hours}h` : ''}${minutes || !hours ? `${minutes}m` : ''}`;
}

/** The same wall-clock time `days` days later in `timeZone`, so a weekly 20:00 stays at 20:00 across DST changes. */
export function addLocalDays(epochSeconds: number, days: number, timeZone: string): number {
  const [date = '', time = ''] = formatLocalDateTime(epochSeconds, timeZone).split(' ');
  const [day, month, year] = date.split('.').map(Number) as [number, number, number];
  const shifted = new Date(Date.UTC(year, month - 1, day + days));
  const pad = (n: number) => String(n).padStart(2, '0');
  const r = parseLocalDateTime(`${pad(shifted.getUTCDate())}.${pad(shifted.getUTCMonth() + 1)}.${shifted.getUTCFullYear()} ${time}`, timeZone);
  // The time doesn't exist that day (skipped by a DST change): fall back to plain elapsed time. The format drops seconds; add them back.
  return r.ok ? r.epochSeconds + (epochSeconds % 60) : epochSeconds + days * 86_400;
}

/** Start of the next occurrence of a repeating event: `days` days on, and further on until it lies after `nowSeconds`. */
export function nextOccurrenceStart(startsAt: number, days: number, timeZone: string, nowSeconds: number): number {
  let next = addLocalDays(startsAt, days, timeZone);
  while (next <= nowSeconds) next = addLocalDays(next, days, timeZone);
  return next;
}
