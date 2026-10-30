---
commit-after-done: true
run-after-done: [test]
model: sonnet
tags: [infra]
---
# database schema and repositories

SQLite storage for everything the bot needs to survive restarts. Depends on *project scaffold*.

## How

`src/db/schema.sql` (applied on startup, idempotent) and small repository modules in `src/db/`:

| Table | Key columns |
|---|---|
| `guild_settings` | `guild_id` PK, `events_channel_id`, `groups_channel_id`, `timezone`, `organizer_role_id` (nullable) |
| `events` | `id`, `guild_id`, `channel_id`, `message_id`, `creator_id`, `title`, `description`, `starts_at` (unix), `status` (open/cancelled/ended), `created_at` |
| `event_signups` | `event_id`, `user_id`, `class_id`, `signed_up_at` — PK (`event_id`, `user_id`) |
| `group_templates` | `id`, `guild_id` (NULL = built-in), `name`, `slots_json` |
| `groups` | `id`, `guild_id`, `channel_id`, `message_id`, `creator_id`, `template_id`, `title`, `description`, `starts_at` (nullable), `status` (open/full/closed), `created_at` |
| `group_members` | `group_id`, `user_id`, `class_id`, `slot_index`, `joined_at` — PK (`group_id`, `user_id`), UNIQUE (`group_id`, `slot_index`) |

- Store `class_id` as the string id from the class catalog (e.g. `gladiator`), not a number.
- Repositories return plain objects; no discord.js types in `src/db/`.
- Tests use an in-memory database (`:memory:`).

## Verify

- `npm test`: repository tests create, read, update and delete each entity; the unique constraints reject a
  second signup by the same user and a double-booked slot.
