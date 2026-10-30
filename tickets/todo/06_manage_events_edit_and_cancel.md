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
