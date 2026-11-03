---
commit-after-done: true
run-after-done: [test]
model: sonnet
tags: [classes]
---
# aion2 class catalog and class picker

One place that knows all AION 2 classes, plus a reusable "pick your class" component used by both event and
group sign-ups. Depends on *project scaffold* (ticket 02). Used by tickets 06 (event sign-up), 08 (group
templates) and 10 (join groups).

## How

- `src/domain/classes.ts` (pure, no discord.js imports): the 8 classes confirmed for the global servers,
  each with `id`, `name`, `role`, `emoji`. Order of the list = display order everywhere.

  | id | name | role | emoji |
  |---|---|---|---|
  | `gladiator` | Gladiator | tank | ⚔️ |
  | `templar` | Templar | tank | 🛡️ |
  | `assassin` | Assassin | dps | 🗡️ |
  | `ranger` | Ranger | dps | 🏹 |
  | `sorcerer` | Sorcerer | dps | 🔥 |
  | `spiritmaster` | Spiritmaster | dps | 🌀 |
  | `cleric` | Cleric | healer | ✨ |
  | `chanter` | Chanter | support | 🎵 |

  - Adding a class later (e.g. the 9th class once it reaches the global servers) must be a one-line change
    here; nothing else may hardcode class ids or names.
  - Role mapping is decided as above. Groups that need different mappings use explicit class lists per slot
    (ticket 08), not a change here.
  - Emojis are unicode placeholders; custom server emojis (`<:name:id>`) can replace them in the same table.
  - Also export the roles in display order with a plural label, used for roster headings in ticket 06:
    `tank` → "Tanks", `healer` → "Healers", `dps` → "DPS", `support` → "Support".
- Helpers in the same file:
  - `getClass(id)` → the class, or `undefined` for an unknown id.
  - `classesByRole(role)` → classes of that role, in table order.
  - `formatClass(id)` → `"⚔️ Gladiator"`; for an unknown id (e.g. a class removed while still stored in the
    DB) return the raw id instead of throwing.
- `src/interactions/classPicker.ts`: a function that builds the reply for an **ephemeral** message with one
  `StringSelectMenu`:
  - Inputs: `area` (`evt` / `grp`), the event/group `id`, optionally a subset of class ids (groups only offer
    classes that fit a free slot) and the user's current class id.
  - customId `<area>:pickclass:<id>`; one option per class with value = class id, label = name,
    emoji = class emoji; placeholder "Pick your class"; exactly one choice.
  - The current class, if given and in the offered list, is preselected (`default: true`).
  - It only builds the message. Handling the selection (saving, re-rendering) belongs to tickets 06 and 10.

## Edge cases

- Empty subset: the picker isn't built; callers show their own message first (ticket 10: "This group is
  full"). The builder may throw on an empty list.
- Current class not in the subset: no option is preselected.
- Discord allows max 25 select options; with 8 classes this is no concern, no paging needed.

## Verify

- `npm test`: unit tests for `getClass`, `classesByRole`, `formatClass` (incl. unknown id), a test that fails
  if a class id is duplicated, and tests for the picker builder (8 options by default, subset filtering,
  preselection, customId format).
- Manually (once ticket 06 wires the button): the picker shows 8 options, each with emoji and name.

## Re-refine (2026-10-30 13:50)

> Some sources mention a 9th class (Korean/Taiwanese update) that is not confirmed for the global servers.
> Should it be included? Suggestion: ship the 8 confirmed classes; add the 9th when it reaches your region.

ship the 8 confirmed classes; add the 9th when it reaches your region.

> Is the role mapping right for how your community plays (e.g. Gladiator as tank vs. melee DPS, Chanter as
> support vs. healer)? Suggestion: keep the table above; group templates (ticket 08) can still accept
> any explicit class list per slot.

keep the table above; group templates (ticket 08) can still accept any explicit class list per slot.

## Summary

- Added `src/domain/classes.ts`: the 8 confirmed classes (`CLASSES`), `ROLES` (display order with plural labels), `getClass`, `classesByRole`, `formatClass` (falls back to the raw id for unknown ids).
- Added `src/interactions/classPicker.ts`: `buildClassPicker({ area, id, classIds?, currentClassId? })` returns an ephemeral reply with one select menu (customId `<area>:pickclass:<id>`, placeholder "Pick your class", exactly one choice, current class preselected if offered). Throws on an empty class list. Selection handling is left to the event/group tickets.
- Tests: `src/domain/classes.test.ts` and `src/interactions/classPicker.test.ts`.
- Verify: `npx tsc --noEmit` is clean and `npx vitest run` passes (24 tests). I ran vitest directly because `npm run test` from `run-after-done` was skipped as instructed; the project doesn't offer it. The manual picker check has to wait until the event sign-up ticket wires the button.
- No new dependencies.
