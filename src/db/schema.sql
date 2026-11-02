CREATE TABLE IF NOT EXISTS guild_settings (
  guild_id          TEXT PRIMARY KEY,
  events_channel_id TEXT,
  groups_channel_id TEXT,
  timezone          TEXT NOT NULL DEFAULT 'Europe/Berlin',
  organizer_role_id TEXT
);

CREATE TABLE IF NOT EXISTS events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id    TEXT NOT NULL,
  channel_id  TEXT NOT NULL,
  message_id  TEXT,
  creator_id  TEXT NOT NULL,
  title       TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  starts_at   INTEGER NOT NULL,
  status      TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'cancelled', 'ended')),
  created_at  INTEGER NOT NULL,
  reminded_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_events_guild_status ON events (guild_id, status, starts_at);

CREATE TABLE IF NOT EXISTS event_signups (
  event_id      INTEGER NOT NULL REFERENCES events (id) ON DELETE CASCADE,
  user_id       TEXT NOT NULL,
  class_id      TEXT NOT NULL,
  signed_up_at  INTEGER NOT NULL,
  PRIMARY KEY (event_id, user_id)
);

CREATE TABLE IF NOT EXISTS group_templates (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id   TEXT,
  name       TEXT NOT NULL,
  slots_json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_group_templates_guild ON group_templates (guild_id);

CREATE TABLE IF NOT EXISTS groups (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id    TEXT NOT NULL,
  channel_id  TEXT NOT NULL,
  message_id  TEXT,
  creator_id  TEXT NOT NULL,
  template_id INTEGER REFERENCES group_templates (id) ON DELETE SET NULL,
  title       TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  slots_json  TEXT NOT NULL,
  starts_at   INTEGER,
  status      TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'full', 'closed')),
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_groups_guild_status ON groups (guild_id, status);

CREATE TABLE IF NOT EXISTS group_members (
  group_id   INTEGER NOT NULL REFERENCES groups (id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL,
  class_id   TEXT NOT NULL,
  slot_index INTEGER NOT NULL,
  joined_at  INTEGER NOT NULL,
  PRIMARY KEY (group_id, user_id),
  UNIQUE (group_id, slot_index)
);

CREATE TABLE IF NOT EXISTS user_settings (
  user_id      TEXT PRIMARY KEY,
  dm_reminders INTEGER NOT NULL DEFAULT 0
);
