---
commit-after-done: true
run-after-done: [test]
model: sonnet
tags: [events]
---
# create events

Organizers post events (raids, sieges, guild nights…) to the events channel. Depends on *admin setup command*.

## How

- `/event create` opens a modal:
  - **Title** (short, required, max 100)
  - **Description** (paragraph, **required**, max 2000)
  - **Date & time** (short, required, format `YYYY-MM-DD HH:mm`, interpreted in the guild timezone)
- Who may create: Manage Guild, or the organizer role from setup.
- On submit: validate the date (parseable, in the future), save the event, post an embed in the events channel
  and store its `message_id`.
- Embed: title, description, start time as Discord timestamps (`<t:…:F>` and `<t:…:R>` so everyone sees their
  local time), organizer mention, and an empty roster ("No sign-ups yet").
- Buttons under the embed: **Sign up**, **Leave** (handled in ticket 06), **Manage** (ticket 07).
- Rendering lives in one function `renderEventMessage(event, signups)` that all later tickets reuse to
  refresh the post.
- Date parsing in `src/domain/` with unit tests (use `luxon` or `date-fns-tz` for timezones; mention the choice
  in the summary).

## Verify

- `/event create` with a valid date posts the embed in the events channel; the time shows correctly in your
  local time.
- An invalid or past date gives an ephemeral error and nothing is posted; the typed values are not lost
  (show them back in the error so the user can copy them).
