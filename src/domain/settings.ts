export const DEFAULT_TIMEZONE = 'Europe/Berlin';

export const TIMEZONE_SUGGESTIONS = [
  'Europe/Berlin',
  'Europe/London',
  'Europe/Paris',
  'Europe/Madrid',
  'Europe/Moscow',
  'UTC',
  'America/New_York',
  'America/Chicago',
  'America/Los_Angeles',
  'Asia/Seoul',
  'Asia/Tokyo',
  'Australia/Sydney',
] as const;

export const SETUP_REQUIRED_MESSAGE = 'Bitte einen Admin, zuerst /setup auszuführen';
export const BOTH_CHANNELS_MESSAGE = 'Setze beim ersten Mal beide Kanäle';
export const CHANNELS_USAGE_MESSAGE = 'Verwendung: `/setup channels events:<#kanal> groups:<#kanal>` – gib mindestens einen Kanal an.';

export interface SettingsValues {
  eventsChannelId: string | null;
  groupsChannelId: string | null;
  timezone: string;
  organizerRoleId: string | null;
}

export const DEFAULT_SETTINGS: SettingsValues = {
  eventsChannelId: null,
  groupsChannelId: null,
  timezone: DEFAULT_TIMEZONE,
  organizerRoleId: null,
};

export function isValidTimezone(tz: string): boolean {
  if (!tz.trim()) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export type ChannelsResult =
  | { ok: true; eventsChannelId: string | null; groupsChannelId: string | null }
  | { ok: false; message: string };

/**
 * Applies the `/setup channels` input to the current settings. `hasRow` tells whether the guild has saved
 * settings; the first time both channels must be given.
 */
export function resolveChannels(
  current: Pick<SettingsValues, 'eventsChannelId' | 'groupsChannelId'>,
  hasRow: boolean,
  input: { events?: string | null; groups?: string | null },
): ChannelsResult {
  const events = input.events ?? null;
  const groups = input.groups ?? null;
  if (!events && !groups) return { ok: false, message: CHANNELS_USAGE_MESSAGE };
  if (!hasRow && (!events || !groups)) return { ok: false, message: BOTH_CHANNELS_MESSAGE };
  return {
    ok: true,
    eventsChannelId: events ?? current.eventsChannelId,
    groupsChannelId: groups ?? current.groupsChannelId,
  };
}

export const REQUIRED_CHANNEL_PERMISSIONS = ['ViewChannel', 'SendMessages', 'EmbedLinks'] as const;
export type ChannelPermissionName = (typeof REQUIRED_CHANNEL_PERMISSIONS)[number];

/** Returns the required permissions the bot lacks; `has` answers whether the bot holds one. */
export function missingPermissions(has: (permission: ChannelPermissionName) => boolean): ChannelPermissionName[] {
  return REQUIRED_CHANNEL_PERMISSIONS.filter((p) => !has(p));
}

export function formatMissingPermissions(channelId: string, missing: readonly ChannelPermissionName[]): string {
  return `Mir fehlt ${missing.join(', ')} in <#${channelId}>.`;
}
