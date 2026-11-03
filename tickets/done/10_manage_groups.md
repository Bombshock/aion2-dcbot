---
commit-after-done: true
run-after-done: [test]
model: sonnet
tags: [groups]
---
# manage groups

The group creator (or an admin) can edit, kick and close a group. Depends on *join and leave groups*.

## How

- **Manage** (`grp:manage:<id>`) → ephemeral menu for the creator or Manage Guild members:
  - **Edit** → modal with title, description, when (prefilled).
  - **Kick member** → select of current members; frees their slot.
  - **Close group** → status `closed`, post shows "🔒 Closed", all buttons disabled, thread archived.
- `/lfg list` → ephemeral list of the server's open groups with links to their posts.

## Verify

- As creator: edit, kick, close; post updates each time.
- As another member: Manage is refused.
- `/lfg list` shows only open/full groups, not closed ones.

## Summary

- `src/interactions/groupManage.ts` (new, imported in `src/index.ts`): `grp:manage` opens an ephemeral menu for the creator or Manage Guild members, otherwise it is refused.
  - **Edit**: modal prefilled with title, description and when. An empty "when" means now. An unchanged time stays valid even if it has passed.
  - **Kick member**: select of the members except the creator; the slot is freed and a full group reopens.
  - **Close group**: asks for confirmation, then sets the status to `closed` and re-renders the post. The buttons are disabled.
- `src/db/groups.ts`: new `kickMember` (transactional, refuses the creator).
- `src/domain/groups.ts`: the closed footer now reads `🔒 Closed`.
- `src/commands/lfg.ts`: new `/lfg list`, an ephemeral list of open and full groups with links to their posts. Re-run `npm run register` to publish the new subcommand.
- Tests: `src/interactions/groupManage.test.ts` covers the refusal rules and `kickMember`.

Notes:
- Groups have no thread in the codebase, so there is nothing to archive on close. Say so if threads are planned.
- The creator can't be kicked, because they hold the group. They can leave (which hands over the group) or close it.
- I skipped `npm run test` from `run-after-done` as instructed (the project doesn't offer it), so I did not run that script. I ran `npx vitest run` directly instead: 13 files, 102 tests passed. `tsc --noEmit` passes.

Verify: as creator use Manage → Edit, Kick, Close and watch the post update. As another member, Manage is refused. `/lfg list` shows no closed groups.
