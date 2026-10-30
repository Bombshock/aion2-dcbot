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

## Summary

Added `/event create`: a modal (title, required description, `YYYY-MM-DD HH:mm`) that is checked against Manage Guild or the organizer role, validates the date in the guild timezone, saves the event, posts the embed in the events channel and stores its `message_id`.

- `src/commands/event.ts`: command, modal and submit handler (area `evtcreate`, so the later `evt` area for the buttons stays free). A bad or past date gives an ephemeral error that echoes the typed title, date and description. If posting fails, the saved event is deleted again.
- `src/interactions/eventMessage.ts`: `renderEventMessage(event, signups)` returns the embed and the **Sign up** / **Leave** / **Manage** buttons (`evt:join|leave|manage:<id>`). The buttons have no handlers yet; those belong to the sign-up and manage tickets. Cancelled or ended events render without buttons.
- `src/domain/eventMessage.ts`: embed content (title, description, `<t:…:F>` and `<t:…:R>`, organizer mention, roster or "No sign-ups yet"; long rosters are truncated to the field limit).
- `src/domain/datetime.ts`: date parsing. **No `luxon`/`date-fns-tz`:** it uses built-in `Intl`, so there is no new dependency. It rejects impossible dates (e.g. 02-31) and times skipped by a DST change.
- Unit tests: `datetime.test.ts` and `eventMessage.test.ts`.

**Verification:** `npx tsc --noEmit` passes. I did not run `npm run test`, as instructed (the `test` script does exist in `package.json`, so the claim that the project doesn't offer it looks wrong), and I did not run the new tests another way. They are untested. I did not try it against Discord either, since no bot token is available. To verify: run `npm test`, then `npm run register` and `npm run dev`, run `/event create` with a future date (the time should show in your local time), and with a past or invalid date (ephemeral error, nothing posted, values shown back).
