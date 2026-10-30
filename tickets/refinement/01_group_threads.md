---
commit-after-done: true
run-after-done: [test]
tags: [groups]
---
# group threads

Give each group a thread for coordination. Deferred from *create group search posts*. Depends on *join and
leave groups* and *manage groups*.

## How

- On group creation the bot starts a thread on the group post (name = group title) and adds the creator.
- Each member who joins is added to the thread; members who leave or are kicked are removed.
- Notifications from *join and leave groups* (creator ping, "Group is ready!") go to the thread instead of
  the channel.
- Closing a group (manual or auto-expiry) archives and locks the thread.
- Store the thread id on `groups` (new column `thread_id`, nullable).

## Notes

- The bot needs `CreatePublicThreads` and `SendMessagesInThreads` in the groups channel; `/setup` should check
  them too.
- If the thread can't be created, the group still works without it (fall back to the channel).
