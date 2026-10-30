---
commit-after-done: true
run-after-done: [test]
model: sonnet
tags: [events, classes]
---
# event sign up with class selection

Members sign up for an event and pick their AION 2 class. Events have **no participant limit**.
Depends on *create events* and *class catalog and class picker*.

## How

- **Sign up** button (`evt:join:<id>`) → ephemeral class picker (all classes).
- Picking a class saves/updates the signup and re-renders the event post. Ephemeral confirmation:
  "Signed up as ⚔️ Gladiator".
- Clicking **Sign up** again while signed up lets the user switch class (current one preselected).
- **Leave** button (`evt:leave:<id>`) removes the signup; ephemeral "You're not signed up" if there was none.
- Roster in the embed, grouped by role then class, with counts:
  ```
  Tanks (2)      🛡️ @Anna (Templar) · ⚔️ @Ben (Gladiator)
  Healers (1)    ✨ @Cara (Cleric)
  ...
  Total: 12
  ```
- Sign-up is refused (ephemeral) when the event is cancelled or has started.

## Edge cases

- Embed field values are capped at 1024 chars and an embed at 6000: when the roster gets too long, switch to
  counts per class plus a "Show full roster" button that replies ephemerally with the complete list (split
  into several messages if needed). This keeps "unlimited" working with hundreds of sign-ups.
- Two clicks at the same time: the DB primary key prevents duplicates; the second write is an update.
- The event post was deleted by someone: reply with an error and mark the event ended.

## Verify

- Sign up, switch class, leave: the post updates each time.
- Unit test for the roster renderer with 0, 5 and 300 sign-ups (the last one stays within embed limits).
