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

## Summary

- `src/interactions/eventSignup.ts` (new, imported in `src/index.ts`): handlers for `evt:join` (ephemeral class picker, current class preselected), `evt:pickclass` (saves/updates the sign-up, re-renders the post, replies "Signed up as ⚔️ Gladiator"), `evt:leave` ("You're not signed up." if none) and `evt:roster` (ephemeral full roster, split into several messages). Sign-ups are refused when the event is cancelled, ended, started or gone. Other tickets can add `evt:*` actions with `registerEventAction`. If the event post was deleted, the event is marked ended and the user gets an error. A concurrent second insert becomes an update.
- `src/domain/eventMessage.ts`: roster is grouped by role then class with counts per role and a Total field. When it would exceed 1024 chars per field or the embed budget, it switches to counts per class; `isRosterCompact` and `formatFullRoster` support that. `src/interactions/eventMessage.ts` adds a "Show full roster" button in compact mode.
- Tests: roster renderer with 0, 5 and 300 sign-ups (300 stays within embed limits), full-roster splitting, `saveSignup`, `signupRefusal`. `tsc --noEmit` is clean and `npx vitest run` passes (54 tests).
- `npm run test` from `run-after-done` was skipped as instructed (the prompt said the project doesn't offer it; `package.json` does define a `test` script, so it exists). I ran `npx vitest run` directly for verification.
- Not verified against a live Discord server. To verify: sign up, switch class, leave, and delete the post, then check the post updates each time.
- No new dependencies.
