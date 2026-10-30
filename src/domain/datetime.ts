export const DATE_FORMAT_HINT = 'YYYY-MM-DD HH:mm';

export type ParseResult = { ok: true; epochSeconds: number } | { ok: false; message: string };

const PATTERN = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})$/;

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
 * Parses `YYYY-MM-DD HH:mm` as wall-clock time in `timeZone` and returns epoch seconds.
 * Rejects malformed or impossible dates (e.g. 2030-02-31) and local times skipped by a DST change.
 */
export function parseLocalDateTime(input: string, timeZone: string): ParseResult {
  const bad: ParseResult = { ok: false, message: `Couldn't read that date. Use the format ${DATE_FORMAT_HINT}.` };
  const m = PATTERN.exec(input.trim());
  if (!m) return bad;
  const [year, month, day, hour, minute] = m.slice(1).map(Number) as [number, number, number, number, number];
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
    return { ok: false, message: `That time doesn't exist in ${timeZone} (daylight saving change).` };
  }
  return { ok: true, epochSeconds: Math.floor(utcMs / 1000) };
}

/** Parses like `parseLocalDateTime` and additionally requires the moment to lie after `nowSeconds`. */
export function parseFutureDateTime(input: string, timeZone: string, nowSeconds: number): ParseResult {
  const r = parseLocalDateTime(input, timeZone);
  if (r.ok && r.epochSeconds <= nowSeconds) return { ok: false, message: 'That date is in the past.' };
  return r;
}
