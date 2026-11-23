# Deployment guide

## Requirements

- Node.js >= 18 (the container uses Node 20 Alpine)
- PostgreSQL 14+ strongly recommended. Without it the bot runs with in-memory storage and **loses all data on restart**.
- A Discord application with the privileged intents documented in the [README](../README.md#required-intents-and-permissions).

## Environment

Start from `.env.example`. The variables that must be set in every environment are:

```env
DISCORD_TOKEN=...
CLIENT_ID=...
OWNER_IDS=123456789012345678
DATABASE_URL=postgresql://user:pass@host:5432/db
NODE_ENV=production
LOG_LEVEL=warn
```

Connection URL precedence: `DATABASE_URL` > `POSTGRES_URL` > `POSTGRES_CONNECTION_URL` > `PGURL` > individual `POSTGRES_*` fields. Set only one to avoid migrations targeting the wrong host.

`OWNER_IDS` must contain digits only, comma-separated. If it is empty the Discord application owner is used as a fallback. `GUILD_ID` controls where guild commands are registered; leaving it empty registers them globally.

At startup the bot logs an `INVITE LINK: ...` line. Use it to add the bot to a server: if the log says `Serving 0 guild(s)`, the bot is in no server at all, so it appears offline in Discord, DMs are refused, and guild command registration fails with `DiscordAPIError[10004]: Unknown Guild`. The loader now falls back to global-only registration in that case.

## Health endpoints

| Endpoint | Meaning |
| --- | --- |
| `GET /health` | Process is alive. `database.degraded` tells whether PostgreSQL is available. |
| `GET /ready` | `200` only when the Discord client is ready **and** the database is not degraded; otherwise `503`. |

Use `/ready` for zero-downtime rollouts and `/health` for basic restarts. Keep the port reachable from the host/process manager (default `3000`, override with `PORT`).

## Docker

```bash
docker build -t xlwybot .
docker run --env-file .env -p 3000:3000 --restart unless-stopped xlwybot
```

The image runs as a non-root user and contains a built-in healthcheck against `/health`.

## Docker Compose

```bash
copy .env.example .env   # edit the token, client id, owner id and POSTGRES_* values
docker compose up -d
docker compose logs -f bot
```

Compose builds the bot from the local `Dockerfile` and starts PostgreSQL 15 with a named volume. The bot waits for the database healthcheck before starting. `OWNER_IDS`, `LOG_LEVEL`, `AUTO_MIGRATE` and `SCHEMA_VERSION` are forwarded explicitly.

> There is no GitHub Actions workflow in this repository, so the GHCR image is **not** published automatically. Build locally or add your own publishing workflow before pulling `ghcr.io/xLWY/bot-13K:main`.

## Railway

`railway.json` uses the Dockerfile builder, `npm start`, `/health` for healthchecks and restarts on failure. Set the environment variables in the Railway dashboard; its Postgres plugin injects `DATABASE_URL`, which this bot reads first. A successful deploy requires `OWNER_IDS` to be set to your numeric Discord ID.

## Migrations

Migrations live in `scripts/migrate.js`. Check before starting a new version:

```bash
npm run migrate:check
npm run migrate:status
npm run migrate          # apply
```

Set `AUTO_MIGRATE=true` to let the bot apply migrations at startup; for controlled rollouts set it to `false` and run `npm run migrate` as a release step first. `SCHEMA_VERSION` must match the version the code expects; a mismatch is a hard error, not a silent fallback.

## Backups

```bash
npm run backup:db       # dump to BACKUP_DIR
npm run restore:db      # restore from a dump
npm run backup:drill    # restore into a scratch database and verify
```

Schedule `backup:db` daily and `backup:drill` periodically. Keep `POSTGRES_RESTORE_URL` pointed at a scratch database for drills, never at production.

## Degraded mode

If the database connection fails, startup logs a warning box and the bot continues in memory-only mode. `/health` reports `database.degraded: true` and `/ready` returns `503`. Treat this as an incident: no data will survive the next restart.

## Upgrades

1. Take a backup.
2. Run `npm run migrate:check` on the new code.
3. Apply migrations or set `AUTO_MIGRATE=true`.
4. Deploy, watch `docker compose logs -f bot` (or the Railway logs) for `ONLINE ✅`.
5. Verify `/health` and `/ready`, then exercise `/ping` and `/manage list` in a DM.
