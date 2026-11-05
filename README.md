# Aion2-LFG

A Discord bot for AION 2 communities: post events, let members sign up with their class, and find groups.

## Commands

Only admins (Manage Server) and members with the organizer role can use slash commands; `/reminders dm` is open to everyone. Members join and create groups through the post buttons and the LFG panel.

| Command | What it does |
| --- | --- |
| `/ping` | Check that the bot is alive |
| `/setup channels` | Set the channels for events and group search |
| `/setup timezone` | Set the timezone used for dates in forms |
| `/setup organizer-role` | Set the role allowed to create events (omit to clear) |
| `/setup lfg-panel` | Post the group search explainer with a create button in the groups channel |
| `/setup show` | Show the current configuration |
| `/event create` | Plan an event from a group template with a duration (organizers only); `weekly:true` reposts it every 7 days after it ends |
| `/event list` | List the upcoming events |
| `/cleanup events` | Remove ended events from the database and delete leftover event posts and start reminders in the channels; `all:true` also removes running and repeating events (admins only) |
| `/cleanup lfg` | The same for group search posts; `all:true` also removes open groups (admins only) |

## Running the bot

Requires Node.js 20 or newer.

1. Create an application and bot in the [Discord Developer Portal](https://discord.com/developers/applications).
2. Copy `.env.example` to `.env` and fill in `DISCORD_TOKEN` and `DISCORD_CLIENT_ID`. Set `DEV_GUILD_ID` to register commands on a single test server instantly.
3. Install, register the slash commands and start:

   ```bash
   npm install
   npm run register
   npm start
   ```

   `npm install` builds the bot into `dist/` through its postinstall script, and `npm start` runs the root `index.js`, which starts that build. Hosts that run `npm install` and then `node index.js` need no extra step. After changing code locally, rebuild with `npm run build`.

For development, `npm run dev` restarts the bot on changes and `npm test` runs the tests.

## Roadmap

This list is generated from the ticket board in [`tickets/`](tickets) by `npm run readme`, and a GitHub Action keeps it up to date on every push.

<!-- roadmap:start -->
### Done

- [x] Project scaffold
- [x] Database schema and repositories
- [x] Aion2 class catalog and class picker
- [x] Admin setup command
- [x] Create events
- [x] Event sign up with class selection
- [x] Manage events edit and cancel
- [x] Create group search posts
- [x] Join and leave groups
- [x] Manage groups
- [x] Reminders and auto cleanup
- [x] Group templates

### Planned

- [ ] Group threads
- [ ] Readme and deployment
<!-- roadmap:end -->

## Legal

- [Terms of Service](TERMS.md)
- [Privacy Policy](PRIVACY.md)

Not affiliated with Discord Inc. or NCSOFT.
