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
