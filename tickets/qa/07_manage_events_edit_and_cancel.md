---
commit-after-done: true
run-after-done: [test]
model: sonnet
tags: [events]
---
# manage events edit and cancel

The organizer (or an admin) can change or cancel an event after posting it. Depends on *event sign up*.

## How

- **Manage** button (`evt:manage:<id>`) → ephemeral menu, only for the creator or members with Manage Guild
  (others get "Only the organizer can manage this event"):
  - **Edit** → same modal as creation, prefilled; saves and re-renders the post.
  - **Remove participant** → user select limited to signed-up users; removes them.
  - **Cancel event** → confirm step; status `cancelled`, post shows "❌ Cancelled", Sign up/Leave disabled.
- When the start time changes, signed-up users are mentioned once in a short reply in the channel
  ("Time changed to <t:…:F>").

## Verify

- As creator: edit title and time, remove a participant, cancel. Each change shows on the post.
- As another member: Manage is refused.

## Summary

- New `src/interactions/eventManage.ts` (imported in `src/index.ts`) handles the **Manage** button. Only the creator or members with Manage Guild get the ephemeral menu; others get "Only the organizer can manage this event." Every sub-action re-checks this, and managing is refused for cancelled or ended events.
  - **Edit** opens the creation modal prefilled (time shown in the guild timezone), updates the event and re-renders the post. An unchanged time is accepted even if it has passed; a new time must be in the future. If the start time changed, the bot replies to the event post mentioning all signed-up users: "Time changed to <t:…:F>" (mentions capped to fit 2000 characters).
  - **Remove participant** shows a select of the signed-up users and removes the chosen one. Discord string selects hold at most 25 options, so rosters above 25 get a user select instead; picking someone who isn't signed up is answered with "That user is not signed up."
  - **Cancel event** asks for confirmation, then sets status `cancelled`. The post title becomes "❌ Cancelled: <title>" and the Sign up/Leave buttons are shown disabled (Manage and roster buttons are removed).
- The create modal moved into `src/interactions/eventModal.ts` so creation and editing share it. `formatLocalDateTime` (datetime) and `formatTimeChangeNotice` (eventMessage) are new helpers.
- Tests added for `formatLocalDateTime`, `formatTimeChangeNotice` and `manageRefusal`; the cancelled-title test was updated.
- Checks: `tsc --noEmit` is clean and `vitest run` passes (60 tests). `npm run test` from `run-after-done` was skipped as instructed: the project doesn't offer it. I ran `npx vitest run` directly, which is the same suite.
- Not verified against a live Discord server; the button and modal flows need a manual check as described under Verify.
- No new dependencies.
