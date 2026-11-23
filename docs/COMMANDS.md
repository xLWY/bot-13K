# Command inventory

Generated from `src/commands/` (November 2026). Files directly inside `modules/` are **not** registered as slash commands: they implement dashboards reached through a parent command.

## Registration model

| Scope | Behaviour |
| --- | --- |
| Global (all guilds + DMs) | Only the DM-enabled owner commands `/ownerrole` and `/manage`. Their `default_member_permissions` are stripped globally; the owner check stays in code. |
| Per-guild | Every other command, registered in `GUILD_ID` when set, otherwise globally. |
| Prefix | Most commands also work with `!` in guilds (`!ping`, `!manage list`, …). In DMs the prefix is restricted to the owner and to an explicit allowlist. |

The allowlists live in:

- `src/handlers/commandLoader.js` — `DM_ENABLED_COMMANDS`, `GLOBAL_COMMANDS`
- `src/utils/prefixCommands.js` — `DM_SAFE_COMMANDS`
- `src/commands/help.js` — `OWNER_ONLY_COMMANDS`

Keep all three in sync when adding a DM-capable command.

## Root commands

| Command | Description | DM |
| --- | --- | --- |
| `/ping` | Bot latency | yes |
| `/help` | Interactive command browser | yes |
| `/diag` | Owner diagnostic (guilds, commands, logs, uptime) | yes, owner |
| `/logtest` | Verify owner DM log delivery | yes, owner |

## Giveaway

| Command | Description |
| --- | --- |
| `/gcreate` | Create a giveaway (duration, winners, prize, channel) |
| `/gend` | End a giveaway early by message ID |
| `/gdelete` | Delete a giveaway by message ID |
| `/greroll` | Reroll winners by message ID |

## JoinToCreate

| Command | Description |
| --- | --- |
| `/jointocreate` | Configure and manage temporary voice channels |

Dashboards: `modules/setup.js`, `modules/config_setup.js`.

## Moderation

| Command | Description |
| --- | --- |
| `/ban`, `/unban` | Ban / unban a member |
| `/kick`, `/timeout`, `/untimeout` | Kick / mute / unmute |
| `/warn`, `/warnings` | Warn a member and review warnings |
| `/clear` | Bulk delete messages |
| `/addrole`, `/removerole` | Manage member roles |
| `/lock`, `/unlock` | Lock / unlock a channel |
| `/nuke` | Recreate a channel |
| `/massban`, `/masskick` | Bulk actions |
| `/dm` | Send a direct message as the bot |
| `/fakemsg` | Send a message with a custom author/embed |
| `/pingall` | Ping everyone |
| `/staff` | Staff moderation panel |

## Owner

| Command | Description | DM |
| --- | --- | --- |
| `/ownerrole` | Give the owner a selectable role in the target guild | yes, owner |
| `/manage list` | List every guild the bot is in (paginated) | yes, owner |
| `/manage info <serveur>` | Detailed guild information | yes, owner |
| `/manage leave <serveur>` | Make the bot leave a guild, with confirmation | yes, owner |

## Reaction roles

| Command | Description |
| --- | --- |
| `/reactroles` | Manage reaction-role panels |

## ServerStats

| Command | Description |
| --- | --- |
| `/serverstats` | Manage member/online/bot/voice counter channels |
| `/t` | Shortcut for counter operations |

Dashboards: `modules/serverstats_create.js`, `serverstats_delete.js`, `serverstats_list.js`, `serverstats_update.js`, `serverstats_debug.js`.

## Settings

| Command | Description |
| --- | --- |
| `/prefix` | View or change the guild prefix |
| `/logs` | Configure the fallback log channel |
| `/leveling` | Show leveling configuration |
| `/panel` | Open the global guild control panel |

Dashboards: `modules/antispam_dashboard.js`, `giveaway_dashboard.js`, `jtc_dashboard.js`, `leveling_dashboard.js`, `serverstats_dashboard.js`, `shop_dashboard.js`.

## Ticket

| Command | Description |
| --- | --- |
| `/ticket` | Ticket panel / configuration |
| `/claim` | Claim a ticket |
| `/close` | Close a ticket |

Dashboard: `modules/ticket_dashboard.js`. Ticket buttons and modals are handled in `src/handlers/ticketButtons.js` and `src/interactions/`.

## Utility

| Command | Description |
| --- | --- |
| `/avatar` | Show a user avatar | 
| `/serverinfo` | Guild information |
| `/userinfo` | Member information |
| `/embedbuilder` | Interactive embed builder |
| `/hoxley` | Send a bundled image |
| `/wipedata` | Irreversibly delete the invoker's personal data |

## Welcome

No standalone slash command; configuration is exposed through `commands/Welcome/modules/greet_dashboard.js`.

## Adding a command

1. Create `src/commands/<Category>/<name>.js` exporting `{ data, execute }`.
2. Set `category` on the export for `/help` grouping.
3. For owner-only commands, add `isBotOwner(interaction.user.id)` in `execute()` **and** add the name to `OWNER_ONLY_COMMANDS` in `src/commands/help.js`.
4. For DM support, update all three allowlists listed above.
5. Add a test under `tests/unit/` for any pure helper you introduce.
