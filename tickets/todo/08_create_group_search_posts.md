---
commit-after-done: true
run-after-done: [test]
model: sonnet
tags: [groups]
---
# create group search posts

Any member can open a group from a template in the group search channel. Depends on *group templates*,
*admin setup command* and *class catalog*.

## How

- `/lfg create template:<autocomplete> class:<choice>` in `src/commands/lfg.ts` (ticket 11 adds `list` to the
  same command). Not usable in DMs.
  - `template`: autocomplete over the built-in templates plus this guild's custom ones, matched by name; the
    option value is the template id.
  - `class`: choices built from the class catalog (`src/domain/classes.ts`), not hardcoded.
- Checks before showing the modal, each answered with an ephemeral error and no modal:
  - Groups channel unset or deleted → "Ask an admin to run /setup first" (helper from *admin setup command*).
  - Unknown template (e.g. typed text instead of picking, or just deleted) → "Unknown template".
  - Creator's class fits no slot → "Your class fits no slot in this template. Fitting classes: …".
  - Creator already has 3 groups with status `open` or `full` in this guild → "You already have 3 open
    groups. Close one first." Keep the limit in one constant.
- Modal, customId `grp:create:<templateId>:<classId>`:
  - **Title** (short, required, max 100, e.g. "Fire Temple run")
  - **Description** (paragraph, **required**, max 2000: goal, requirements, voice chat…)
  - **When** (short, optional, `YYYY-MM-DD HH:mm` in the guild timezone; empty = "now"). Use the date parser
    from *create events* in `src/domain/`; if this ticket goes first, create it here.
- On submit:
  - Re-run the template and limit checks (state may have changed while the modal was open).
  - Invalid or past **When** → ephemeral error that shows the typed values back so they can be copied; nothing
    is saved.
  - In one DB transaction: insert the group with a copy of the template's slots in `slots_json` and the
    creator as member in the slot from `assignSlot` (*group templates*).
  - Post the message in the groups channel, store `message_id`, reply ephemerally "Group posted: <link>".
    If posting fails (e.g. the bot lost permissions), delete the group again and reply with the error.
- Schema: add `slots_json` (TEXT, NOT NULL) to `groups` in `src/db/schema.sql` and the groups repository. The
  bot isn't deployed yet, so no migration; delete local dev DBs. Later template edits/deletes must not change
  open groups; all group code reads slots from the group, never from the template.
- `renderGroupMessage(group, members)` in `src/interactions/groupMessage.ts`, reused by tickets 10 and 11.
  Put the text building (slot lines, footer) as pure functions in `src/domain/groups.ts`.
  - Embed: title, description, time (`<t:…:F>` and `<t:…:R>`, or "Now" without a time), creator mention, slot
    list:
    ```
    1. Tank      🛡️ @Anna (Templar)
    2. Healer    — open (Cleric)
    3. DPS       — open (Assassin, Ranger, Sorcerer, Spiritmaster)
    5. Any       — open (any class)
    ```
    A slot allowing every class shows "any class" instead of all names. Use `formatClass` for taken slots.
  - Footer "<taken>/<total> · open", or "<total>/<total> · full ✅" when every slot is taken.
  - Buttons: **Join** (`grp:join:<id>`), **Leave** (`grp:leave:<id>`), **Manage** (`grp:manage:<id>`).
    Their handlers come in tickets 10 and 11. Join is disabled when the group is full.
- No thread for the group; that is a separate later ticket (*group threads*).

## Edge cases

- A 1-slot custom template: the creator fills it, so the group is created with status `full`.
- Creator is placed by `assignSlot`, so a Cleric in "Dungeon (5)" takes Healer, not Any.
- Groups that are `closed` don't count towards the limit of 3.

## Verify

- `npm test`: unit tests for the slot lines (taken, open, "any class"), the footer (open and full) and the
  "3 open groups" check against an in-memory DB.
- `/lfg create` with "Dungeon (5)" as Templar posts a group with you in the Tank slot, footer "1/5 · open".
- As Cleric in "Dungeon (5)": you land in the Healer slot.
- Creating a 4th open group is refused; after closing one in the DB, it works again.
- A past date in **When** gives an error with your typed text; nothing is posted.
- Without a groups channel configured: "Ask an admin to run /setup first".

## Re-refine (2026-10-30 13:52)

> Should groups get a thread for coordination (bot creates a thread on the post and adds members)?
> Suggestion: yes, create a thread on the post and add each member when they join.

not for now but add a ticket to do it later
