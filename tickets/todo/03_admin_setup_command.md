---
commit-after-done: true
run-after-done: [test]
model: sonnet
tags: [setup]
---
# admin setup command

Admins choose the channel for events and the channel for group search. Depends on *database schema*.

## How

One slash command `/setup` with subcommands, in `src/commands/setup.ts`. It reads and writes the
`guild_settings` table through the repository from `src/db/`.

- `/setup channels events:<#channel> groups:<#channel>` — both options required the first time, optional
  afterwards (only the given one is updated). Discord can't make an option conditionally required, so both
  are declared optional and the handler checks: if no row exists yet and one is missing, reply
  "Set both channels the first time". If neither is given, reply with a short usage hint.
  Restrict the channel options to text and announcement channels.
- `/setup timezone tz:<IANA name>` (autocomplete from a short list: Europe/Berlin, Europe/London, UTC, …).
  Used to interpret dates typed in event/group forms. Autocomplete only suggests; also accept any other valid
  IANA name and reject invalid ones ("Unknown timezone").
- **Default timezone is Europe/Berlin** when an admin never sets one: `guild_settings.timezone` defaults to
  it, and code reading settings for a guild without a row also gets Europe/Berlin.
- `/setup organizer-role role:<@role>` (optional): members with this role may create events, besides admins.
  Running it without `role` clears the organizer role.
- `/setup show` prints the current configuration: both channels (or "not set"), timezone, organizer role
  (or "none").
- Command is restricted with `setDefaultMemberPermissions(ManageGuild)` and `setDMPermission(false)`.
- On save, check the bot can `ViewChannel`, `SendMessages`, `EmbedLinks` in each chosen channel; if not,
  reply with which permission is missing (and in which channel) and don't save anything.
- All replies are ephemeral.
- Shared helper for later tickets, e.g. `src/domain/settings.ts` / `src/db/` (pure parts in `domain/`):
  - `getGuildSettings(guildId)` → settings with the Europe/Berlin default applied.
  - A function that returns the events or groups channel if it is set **and still exists** (fetch it from
    the guild), otherwise `null`. `/event create` and `/lfg create` use it.
  - Permission-check and timezone-validation logic as pure functions with unit tests.

## Edge cases

- Events and groups pointing to the same channel is allowed.
- `/event create` and `/lfg create` must answer "Ask an admin to run /setup first" when their channel is unset.
  Those commands come in later tickets; this ticket provides the helper and the message text.
- A configured channel that was deleted: treat as unset (`/setup show` shows "not set").
- The bot's permissions in a channel can change after setup; only checking on save is enough here.

## Verify

- `npm test`: unit tests for timezone validation, the "both channels required the first time" rule, the
  missing-permission check and the Europe/Berlin default.
- As admin: run `/setup channels`, then `/setup show` lists both channels and timezone Europe/Berlin.
- `/setup timezone tz:Europe/London`, then `/setup show` shows Europe/London; `tz:Mars/Base` is rejected.
- As a normal member: the command is not visible.
- Choose a channel where the bot can't post: you get an error naming the missing permission, and `/setup show`
  is unchanged.
- Delete a configured channel: `/setup show` shows it as "not set".

## Re-refine (2026-10-30 13:51)

> Default timezone when an admin never sets one? Suggestion: Europe/Berlin.

Europe/Berlin.
