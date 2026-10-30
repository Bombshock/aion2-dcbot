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
