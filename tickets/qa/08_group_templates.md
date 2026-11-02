---
commit-after-done: true
run-after-done: [test]
model: opus
tags: [groups, setup]
---
# group templates

Groups for group search follow a template that defines **up to 5 slots** and which classes may fill each
slot. Depends on *class catalog* and *database schema*.

## How

- A slot is `{ label, allowed: [classId…] }`. Shorthands when writing templates: `tank`, `healer`, `dps`,
  `support` expand to the classes of that role (from the class catalog); `any` = all classes.
- `src/domain/templates.ts`:
  - validation: 1–5 slots, every class id exists, non-empty `allowed`.
  - `assignSlot(template, members, classId)` → index of the first free slot that allows the class, or `null`.
    Prefer the most restrictive matching slot first, so a Cleric fills the "Healer" slot before an "Any" slot.
- Built-in templates (guild_id NULL), available on every server:

  | Name | Slots |
  |---|---|
  | Dungeon (5) | Tank · Healer · DPS · DPS · Any |
  | Small group (3) | Any · Any · Any |
  | Duo (2) | Any · Any |
  | Open (5) | Any × 5 |

- `/template` command (Manage Guild only):
  - `create name:<text>` → modal with one line per slot, e.g. `Tank: tank` / `Heal: cleric, chanter` /
    `Flex: any`. Validated and saved for this guild.
  - `list` shows built-in and custom templates with their slots.
  - `delete name:<autocomplete>` — custom templates only; existing groups keep working (copy the slots
    into the group on creation, see ticket 09).

## Verify

- Unit tests for parsing, validation (6 slots rejected, unknown class rejected) and `assignSlot`, including
  "Cleric goes to Healer slot even though an Any slot is earlier".
- Create a custom template in Discord and see it in `/template list`.

## Summary

- New `src/domain/templates.ts`:
  - `expandClasses` turns `tank`/`healer`/`dps`/`support`/`any` and class names (case-insensitive, comma-separated) into class ids.
  - `parseTemplateText` reads the modal text (one `Label: classes` line per slot).
  - `validateSlots` checks 1–5 slots, a label of at most 20 characters, a non-empty `allowed` list and that every class id exists.
  - `assignSlot(slots, members, classId)` returns the free slot with the fewest allowed classes that fits the class, with earlier slots winning ties, or `null`.
  - `BUILTIN_TEMPLATES` holds Dungeon (5), Small group (3), Duo (2) and Open (5).
  - There are also formatting helpers for `/template list`, which cuts the list to fit 2000 characters.
- Built-in templates are written to the DB as `guild_id NULL` rows when `getDb()` first opens it (`src/db/instance.ts`). `syncBuiltins` in `src/db/groups.ts` matches them by name, adds missing ones and updates their slots, so they never duplicate. The repo also gained `findByName` (built-in or own guild, case-insensitive).
- New `/template` command (`src/commands/template.ts`, default permission Manage Guild, not in DMs):
  - `create name:` opens a modal with one paragraph field, one line per slot. The name must not match a built-in or existing template. Errors show the problem, a syntax hint and the typed text.
  - `list` shows built-in and custom templates with their slots.
  - `delete name:` autocompletes custom templates only and refuses built-ins. Groups keep working because the schema already sets `groups.template_id` to NULL on delete. Copying slots into the group is left to the group search ticket.
- Tests: `src/domain/templates.test.ts` covers parsing, validation (6 slots and unknown classes rejected), `assignSlot` (including "Cleric goes to Healer even though an Any slot is earlier") and formatting. `src/db/repositories.test.ts` adds tests for `findByName` and `syncBuiltins`.
- The delete reply no longer says "Existing groups keep their slots", because slots aren't copied into groups yet.
- Checks: `tsc --noEmit` is clean and `npx vitest run` passes (81 tests). I ran both again after the last change.
- `npm run test` from `run-after-done` was skipped as instructed (the prompt says the project doesn't offer it). Note that `package.json` does define `test` as `vitest run`, the same suite I ran.
- Not verified on a live Discord server. Run `npm run register` to register `/template`. Then check by hand: `/template create name:Test` with `Tank: tank` / `Heal: cleric, chanter` / `Flex: any`, look for it in `/template list`, and delete it again with `/template delete`.
- No new dependencies.
