---
commit-after-done: true
model: haiku
tags: [infra]
refined: true
---
# readme and deployment

Make it easy to host the bot and add it to a server. Do this last.

## How

- `README.md`: what the bot does, creating the Discord application, required bot permissions
  (View Channels, Send Messages, Embed Links, Read Message History, Create Public Threads,
  Send Messages in Threads, Manage Threads), the OAuth2 invite URL with scopes `bot applications.commands`,
  `.env` setup, `npm run register`, `npm start`, and an admin quick start (`/setup channels` → `/event create`
  → `/lfg create`).
- `Dockerfile` (node:20-slim, multi-stage build) and `docker-compose.yml` with a volume for the SQLite file.
- Command overview table for all slash commands.

## Verify

- Following the README on a clean machine gets the bot online in a test server.
- `docker compose up` starts the bot and the DB survives `docker compose down && up`.
