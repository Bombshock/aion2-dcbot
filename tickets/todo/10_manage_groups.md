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
