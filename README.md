# Aion2-LFG

A Discord bot for AION 2 communities: post events, let members sign up with their class, and find groups.

## Commands

| Command | What it does |
| --- | --- |
| `/ping` | Check that the bot is alive |
| `/setup channels` | Set the channels for events and group search |
| `/setup timezone` | Set the timezone used for dates in forms |
| `/setup organizer-role` | Set the role allowed to create events (omit to clear) |
| `/setup lfg-panel` | Post the group search explainer with a create button in the groups channel |
| `/setup show` | Show the current configuration |
| `/event create` | Create an event |

## Running the bot

Requires Node.js 20 or newer.

1. Create an application and bot in the [Discord Developer Portal](https://discord.com/developers/applications).
2. Copy `.env.example` to `.env` and fill in `DISCORD_TOKEN` and `DISCORD_CLIENT_ID`. Set `DEV_GUILD_ID` to register commands on a single test server instantly.
3. Install, register the slash commands, build and start:

   ```bash
   npm install
   npm run register
   npm run build
   npm start
   ```

For development, `npm run dev` restarts the bot on changes and `npm test` runs the tests.

## Roadmap

This list is generated from the ticket board in [`tickets/`](tickets) by `npm run readme`, and a GitHub Action keeps it up to date on every push.

<!-- roadmap:start -->
### In review

- [x] Project scaffold
- [x] Database schema and repositories
- [x] Aion2 class catalog and class picker
- [x] Admin setup command
- [x] Create events

### In progress

- [ ] Event sign up with class selection

### Planned

- [ ] Manage events edit and cancel
- [ ] Group templates
- [ ] Create group search posts
- [ ] Join and leave groups
- [ ] Manage groups
- [ ] Reminders and auto cleanup
- [ ] Group threads
- [ ] Readme and deployment
<!-- roadmap:end -->

## Legal

- [Terms of Service](TERMS.md)
- [Privacy Policy](PRIVACY.md)

Not affiliated with Discord Inc. or NCSOFT.
