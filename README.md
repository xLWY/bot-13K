# xlwy bot

A modular Discord.js v14 bot for moderation, tickets, giveaways, leveling, server statistics and server configuration. Data is persisted in PostgreSQL, with an in-memory fallback when the database is unavailable.

[![Support Server](https://img.shields.io/badge/-Support%20Server-%235865F2?logo=discord&logoColor=white&style=flat-square&logoWidth=20)](https://discord.gg/8kJBYhTGW9)
[![Discord.js](https://img.shields.io/npm/v/discord.js?style=flat-square&labelColor=%23202225&color=%23202225&logo=npm&logoColor=white&logoWidth=20)](https://www.npmjs.com/package/discord.js)
![PostgreSQL](https://img.shields.io/badge/-PostgreSQL-%23336791?logo=postgresql&logoColor=white&style=flat-square&logoWidth=20)

## Contents

- [Features](#features)
- [Quick setup (Docker)](#quick-setup-docker)
- [Manual installation](#manual-installation)
- [Configuration](#configuration)
- [Commands](#commands)
- [Tests](#tests)
- [Database fallback](#database-fallback)
- [Required intents and permissions](#required-intents-and-permissions)
- [Deployment](#deployment)
- [Contributing](#contributing)
- [License](#license)

## Features

| Area | What it does |
| --- | --- |
| Moderation | ban, kick, timeout, warn, clear, role management, mass actions, lock/unlock, nuke, staff tools |
| Tickets | ticket panel, claim, close, configurable types/staff roles, per-guild limits |
| Giveaways | create, end, delete and reroll with multi-winner support |
| Leveling | XP from messages, configurable levels, leveling dashboard |
| Server statistics | member/online/bot/voice counter channels with throttled updates |
| Reaction roles | self-assignable roles through panels |
| Welcome | greeting messages, auto roles and the `greet` dashboard |
| Join-to-create | temporary voice channels created on demand |
| Settings | prefix, logs, anti-spam and dashboards for most modules |
| Utilities | `embedbuilder`, `serverinfo`, `userinfo`, `avatar`, `hoxley`, `wipedata` |
| Owner tools | `/diag`, `/ownerrole` and `/manage` (list / info / leave servers, usable in DMs) |

The authoritative command inventory is in [docs/COMMANDS.md](docs/COMMANDS.md).

## Quick setup (Docker)

```bash
git clone https://github.com/xLWY/bot-13K.git
cd bot-13K
copy .env.example .env   # Linux/macOS: cp .env.example .env
# edit .env: DISCORD_TOKEN, CLIENT_ID, OWNER_IDS, database credentials
docker compose up -d
```

Compose starts the bot and a PostgreSQL 15 container with a persistent volume.

## Manual installation

Prerequisites: Node.js >= 18, npm, and PostgreSQL (recommended) or the in-memory fallback.

```bash
npm install
copy .env.example .env   # Linux/macOS: cp .env.example .env
# edit .env
npm run migrate:check    # verify the database before starting
npm start
```

Useful scripts:

| Script | Purpose |
| --- | --- |
| `npm start` | Start the bot (`node src/app.js`) |
| `npm test` | Run the unit/failure-path test suite |
| `npm run migrate` | Apply database migrations |
| `npm run migrate:check` | Check pending migrations without applying them |
| `npm run migrate:status` | Show migration/schema status |
| `npm run backup:db` | Dump the database |
| `npm run restore:db` | Restore a dump |
| `npm run backup:drill` | Restore drill in a scratch database |

## Configuration

All settings are read from `.env`; see [`.env.example`](.env.example) for the full commented list. The minimum required values are:

```env
DISCORD_TOKEN=<bot token>
CLIENT_ID=<application id>
OWNER_IDS=<your Discord user id, digits only>
DATABASE_URL=postgresql://user:password@host:5432/dbname
```

`OWNER_IDS` accepts several comma-separated IDs. When it is empty, the Discord application owner is used as a fallback. The bot exposes `GET /health` and `GET /ready` on `PORT` (default `3000`) for process managers.

Connection URL precedence: `DATABASE_URL` > `POSTGRES_URL` > `POSTGRES_CONNECTION_URL` > `PGURL` > individual `POSTGRES_*` variables. Set **one** URL variable to avoid pointing migrations at an unintended host.

## Commands

Slash commands are registered globally for the DM-enabled owner commands (`/ownerrole`, `/manage`) and per-guild for everything else. Most commands also accept a `!` prefix in guilds; the owner may use a small allowlist in DMs.

See [docs/COMMANDS.md](docs/COMMANDS.md) for categories, subcommands, aliases and DM availability.

## Tests

```bash
npm install
npm test
```

The suite uses Node's built-in test runner (`node --test`) and needs no test framework. It currently covers failure paths and pure utilities under `tests/failure-paths/` and `tests/unit/`. Some service tests need a real `npm install` because they import discord.js, winston or Zod.

## Database fallback

If PostgreSQL cannot be reached, the bot logs a clear warning and continues with **in-memory storage**: nothing is persisted and all data is lost on restart. Production deployments should monitor `/health` (`database.degraded`) and fix the connection before trusting any data.

## Required intents and permissions

Enable these privileged intents in the Discord Developer Portal (Bot → Privileged Gateway Intents):

- **Server Members**
- **Presence** (needed for online counters)
- **Message Content** (needed for prefix commands)

Gateway intents used by the client: Guilds, GuildMembers, GuildPresences, GuildMessages, GuildMessageReactions, MessageContent, GuildVoiceStates, GuildBans and GuildModeration.

Recommended bot permissions: View Channels, Send Messages, Embed Links, Attach Files, Read Message History, Manage Messages, Manage Channels, Manage Roles, Kick/Ban Members, Moderate Members and Connect. Some commands require the corresponding permission; owner commands bypass the Discord-side check but are still gated by `OWNER_IDS`.

## Deployment

Docker, Compose, Railway and migration/backup guidance live in [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

## Contributing

1. Fork the repository and create a feature branch.
2. Follow the existing module layout: `commands` → `handlers` → `services` → `utils`, and the user-facing conventions in [docs/STYLE.md](docs/STYLE.md).
3. Add or update tests for changed behaviour.
4. Run `npm test` and `npm run migrate:check` before opening a pull request.

## License

Released under the MIT License. See [LICENSE](LICENSE).

---

*README refreshed: November 2026.*
