---
commit-after-done: true
run-after-done: [test]
model: sonnet
tags: [groups, classes]
---
# join and leave groups

Members join a group by picking their class; the bot places them in a matching slot. Depends on *create group
search posts*.

## How

- **Join** (`grp:join:<id>`) → ephemeral class picker showing **only classes that fit a free slot**.
  If no slot is free: "This group is full".
- On pick: `assignSlot` (ticket 08) inside a DB transaction; on success save the member, re-render the post,
  confirm ephemerally "You joined as ✨ Cleric (Healer slot)". Notify the creator with a mention in the
  group thread (or the channel if threads are off).
- Clicking **Join** while already in the group lets the user switch class; they move to a fitting slot or get
  an error and keep their old slot.
- **Leave** (`grp:leave:<id>`) frees the slot. If the creator leaves, the earliest other member becomes the
  creator; if nobody is left, the group closes.
- When all slots are filled: status `full`, footer "5/5 · full ✅", Join disabled, and all members are
  mentioned once ("Group is ready!"). A leave reopens it.

## Edge cases

- Two people pick the last slot at the same time: the transaction + UNIQUE (`group_id`, `slot_index`)
  guarantee one wins; the other gets "Slot was just taken" and a fresh picker.
- A user may be in several groups at once (allowed).

## Verify

- With two accounts: join, switch class, leave; post updates each time.
- Fill a 2-slot Duo: post shows full and Join is disabled; one leaves, it reopens.
- Unit test for the concurrent last-slot case on the repository.

## Summary

- `src/db/groups.ts`: new transactional `joinMember` (best free slot via `assignSlot`, own slot counts as free so members can switch class; updates status to `full`/`open`) and `leaveMember` (frees the slot, reopens a full group, hands the group to the earliest-joined remaining member if the creator leaves, closes it when empty). `creatorId` is now updatable.
- `src/domain/groups.ts`: `joinableClassIds` – classes that fit a free slot.
- `src/interactions/groupJoin.ts` (new): `grp:join` (picker with only fitting classes, "This group is full" otherwise), `grp:pickclass`, `grp:leave`, post refresh, creator mention on join, one "Group is ready!" mention of all members when the group becomes full. On "slot just taken" the user gets a fresh picker. Group actions now go through `registerGroupAction`; `lfg.ts` registers `create` that way (the area handler could previously only be registered once).
- Groups have no threads yet, so announcements are posted in the group's channel.
- Tests: `src/db/groupJoin.test.ts` (join, switch, full/reopen, concurrent last slot, creator handover, close, picker classes). `npx tsc --noEmit` and `vitest run` pass (99 tests).
- `npm run test` from `run-after-done` was skipped as instructed (the project doesn't offer it); I ran `npx vitest run` directly instead.
- Not verified against a live Discord server; verify with two accounts as described above.
