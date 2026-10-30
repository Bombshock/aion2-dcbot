---
commit-after-done: true
model: sonnet
tags: [infra]
---
# project scaffold

Set up the bot project so all later tickets have a common base.

## How

- Stack: **Node.js 20+, TypeScript, discord.js v14**, **better-sqlite3** for storage, **vitest** for tests.
- `git init` in the project root (`aion2-dcbot/`), with a `.gitignore` (node_modules, dist, `.env`, `*.db`).
- Layout:
  ```
  src/
    index.ts            # client login, intent setup (Guilds only), event wiring
    config.ts           # reads .env: DISCORD_TOKEN, DISCORD_CLIENT_ID, DEV_GUILD_ID (optional), DB_PATH
    commands/           # one file per slash command, exporting { data, execute }
    interactions/       # button / select / modal handlers, routed by customId prefix
    domain/             # pure logic (no discord.js imports) – easy to unit test
    db/                 # schema + repositories
  scripts/register-commands.ts   # registers slash commands (guild if DEV_GUILD_ID set, else global)
  ```
- Interaction router: customIds follow `<area>:<action>:<id>` (e.g. `evt:join:42`). Handlers look up state
  from the DB by id, so buttons keep working after a restart (no in-memory collectors).
- `package.json` scripts: `dev` (tsx watch), `build`, `start`, `test`, `register`.
- `.env.example` with the variables above.
- A `/ping` command to prove the wiring works.

## Verify

- `npm test` runs (one trivial test is fine), `npm run build` passes.
- With a test bot token: `npm run register` then `npm run dev`; `/ping` answers in the dev server.

## Summary

Scaffolded the bot as specified: `package.json` (scripts `dev`, `build`, `start`, `test`, `register`), `tsconfig.json`, `.gitignore`, `.env.example`, `src/config.ts`, `src/index.ts` (Guilds intent only, command + component routing, error reply), `src/commands/` (`index.ts` registry, `ping.ts`), `src/interactions/router.ts` (`<area>:<action>:<id>` parse/build, handler registry by area, stateless), `src/db/index.ts` (opens SQLite, WAL, FKs; schema comes in the DB ticket), empty `src/domain/`, and `scripts/register-commands.ts` (guild if `DEV_GUILD_ID`, else global). Ran `git init`.

- **New dependency:** `dotenv`, used to load `.env` in `config.ts`. The others are those named in the ticket (plus `tsx`, `typescript`, `@types/*`).
- **Tests:** `npm test` passes (3 tests, customId parsing). `npm run build` passes.
- **Not verified:** the live check with a real bot token (`npm run register`, `npm run dev`, `/ping`), since no token is available here.
- **Unrelated:** `npm install` reports 6 audit vulnerabilities (1 high, 2 critical) in transitive dependencies; not addressed.
- **Verify:** `npm test`, `npm run build`; then with a test token in `.env`, `npm run register`, `npm run dev`, and run `/ping` (replies "Pong!").
