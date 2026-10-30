import type Database from 'better-sqlite3';

export interface GuildSettings {
  guildId: string;
  eventsChannelId: string | null;
  groupsChannelId: string | null;
  timezone: string;
  organizerRoleId: string | null;
}

interface Row {
  guild_id: string;
  events_channel_id: string | null;
  groups_channel_id: string | null;
  timezone: string;
  organizer_role_id: string | null;
}

const toSettings = (r: Row): GuildSettings => ({
  guildId: r.guild_id,
  eventsChannelId: r.events_channel_id,
  groupsChannelId: r.groups_channel_id,
  timezone: r.timezone,
  organizerRoleId: r.organizer_role_id,
});

export function createGuildSettingsRepo(db: Database.Database) {
  return {
    /** Inserts or fully replaces the settings of a guild. */
    upsert(s: GuildSettings): GuildSettings {
      db.prepare(
        `INSERT INTO guild_settings (guild_id, events_channel_id, groups_channel_id, timezone, organizer_role_id)
         VALUES (@guildId, @eventsChannelId, @groupsChannelId, @timezone, @organizerRoleId)
         ON CONFLICT (guild_id) DO UPDATE SET
           events_channel_id = excluded.events_channel_id,
           groups_channel_id = excluded.groups_channel_id,
           timezone = excluded.timezone,
           organizer_role_id = excluded.organizer_role_id`,
      ).run(s);
      return s;
    },
    get(guildId: string): GuildSettings | undefined {
      const row = db.prepare('SELECT * FROM guild_settings WHERE guild_id = ?').get(guildId) as Row | undefined;
      return row && toSettings(row);
    },
    delete(guildId: string): boolean {
      return db.prepare('DELETE FROM guild_settings WHERE guild_id = ?').run(guildId).changes > 0;
    },
  };
}
