---
commit-after-done: true
run-after-done: [test]
model: sonnet
tags: [events, groups]
---
# reminders and auto cleanup

Remind participants before an event and tidy up old posts. Depends on *manage events* and *manage groups*.

## How

- A scheduler in `src/scheduler.ts` runs every minute, started from `src/index.ts` once the client is ready.
  It reads due work from the DB on every tick, so restarts lose nothing. Skip a tick if the previous one is
  still running.
- Each job is a repository query that takes `now` as a parameter (no `Date.now()` inside), so it can be tested
  with a fake clock:
  - **Event reminder:** events with status `open`, `reminded_at` NULL and `starts_at - 30 min <= now <
    starts_at`. Post one message in the event's channel mentioning all signed-up users, e.g.
    "⏰ **<title>** starts <t:…:R> — <link to post>" followed by the mentions. If the mentions don't fit in
    2000 chars, split them across several messages (pure function in `src/domain/`). Then set `reminded_at`.
    No sign-ups → no message, but still set `reminded_at`.
  - **DM reminder (opt-in):** at the same moment, users from the signups who enabled DM reminders also get a
    DM with the same text. They are still mentioned in the channel too. A failed DM (DMs closed, user left)
    is logged and skipped.
  - **Event start:** events with status `open` and `starts_at <= now` → status `ended`, re-render the post via
    `renderEventMessage` showing "▶️ Started", Sign up and Leave disabled.
  - **Group expiry:** groups with status `open` or `full` and either `starts_at + 2 h <= now`, or no
    `starts_at` and `created_at + 6 h <= now` → closed with the same logic as Manage → Close group (*manage
    groups*). Extract that into a shared function if it isn't one yet (also used when the last member leaves,
    *join and leave groups*), so *group threads* can archive the thread in one place later.
- Durations live in one constants block (e.g. `src/domain/schedule.ts`: reminder lead 30 min, group expiry
  2 h after start / 6 h after creation, tick 60 s) so they can become `/setup` options later.

### DM reminder setting

- New command `/reminders dm enabled:<true|false>` in `src/commands/reminders.ts`, usable by every member,
  ephemeral reply "DM reminders are now on/off". **Off by default.** The setting is per user, across all
  servers.
- Storage: new table `user_settings` (`user_id` PK, `dm_reminders` INTEGER NOT NULL DEFAULT 0) with a small
  repository in `src/db/`. A user without a row counts as off.
- The ephemeral sign-up confirmation (*event sign up*) gets a hint line when DMs are off: "Tip: `/reminders dm`
  to also get a DM before the event."

### Schema

Add `reminded_at` (unix, nullable) to `events` and the `user_settings` table in `src/db/schema.sql`. The bot
isn't deployed yet, so no migration; delete local dev DBs.

## Edge cases

- Event created or moved to less than 30 min ahead: the reminder goes out on the next tick.
- Start time edited (*manage events*): reset `reminded_at` to NULL when the new start is more than 30 min
  ahead, so the reminder fires again for the new time.
- Cancelled events get neither reminder nor start handling (status isn't `open`).
- Bot was offline past the start time: no late reminder (the window has passed); the event is still marked
  `ended` on the first tick. Overdue groups are closed on the first tick too.
- Event post or channel deleted: log it, still update the DB status / `reminded_at` so the job doesn't retry
  every minute.
- An error in one item is logged and doesn't stop the other items or the scheduler.
- Mentions use `allowedMentions: { users: [...] }` so only the participants are pinged.

## Verify

- `npm test`: with an in-memory DB and a fake `now`, each due query picks exactly the right rows (just inside
  and just outside each window, cancelled/closed rows ignored, `reminded_at` set → not picked again). Unit test
  for the mention splitting (all chunks ≤ 2000 chars, no user lost).
- Create an event 31 minutes ahead and sign up: the reminder arrives about a minute later; after the start the
  post shows "Started" and Sign up is disabled.
- With `/reminders dm enabled:true` you also get a DM; with the default (off) you don't.
- Restart the bot inside the reminder window before it fired: the reminder still arrives, only once.
- A group without a time is closed 6 h after creation (set `created_at` back in the DB to check quickly).

## Re-refine (2026-10-30 13:53)

> Should members also get a DM reminder? Suggestion: no, a channel mention only (DMs are often blocked and
> feel spammy).

dm reminders should be off by default but can be enabled by the user
