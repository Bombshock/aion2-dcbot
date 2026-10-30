import { formatClass } from './classes.js';

export interface EventView {
  id: number;
  creatorId: string;
  title: string;
  description: string;
  startsAt: number;
  status: 'open' | 'cancelled' | 'ended';
}

export interface SignupView {
  userId: string;
  classId: string;
}

export interface EventEmbedData {
  title: string;
  description: string;
  color: number;
  fields: { name: string; value: string; inline?: boolean }[];
}

export const EMPTY_ROSTER_TEXT = 'No sign-ups yet';

const COLORS = { open: 0x5865f2, cancelled: 0x99aab5, ended: 0x99aab5 } as const;
const FIELD_LIMIT = 1024;

export function formatRoster(signups: readonly SignupView[]): string {
  if (signups.length === 0) return EMPTY_ROSTER_TEXT;
  const lines = signups.map((s) => `<@${s.userId}> - ${formatClass(s.classId)}`);
  const out: string[] = [];
  let length = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const more = `\n… and ${lines.length - i} more`;
    if (length + line.length + 1 + more.length > FIELD_LIMIT && i < lines.length - 1) {
      out.push(more.trim());
      break;
    }
    out.push(line);
    length += line.length + 1;
  }
  return out.join('\n');
}

/** Embed content of an event post; shared by every ticket that refreshes the post. */
export function buildEventEmbed(event: EventView, signups: readonly SignupView[]): EventEmbedData {
  const prefix = event.status === 'cancelled' ? '[Cancelled] ' : event.status === 'ended' ? '[Ended] ' : '';
  return {
    title: `${prefix}${event.title}`,
    description: event.description,
    color: COLORS[event.status],
    fields: [
      { name: 'When', value: `<t:${event.startsAt}:F>\n<t:${event.startsAt}:R>` },
      { name: 'Organizer', value: `<@${event.creatorId}>`, inline: true },
      { name: `Roster (${signups.length})`, value: formatRoster(signups) },
    ],
  };
}
