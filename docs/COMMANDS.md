# Command inventory

Generated from `src/commands/` (November 2026). Files directly inside `modules/` are **not** registered as slash commands: they implement dashboards reached through a parent command.

## Registration model

| Scope | Behaviour |
| --- | --- |
| Global (all guilds + DMs) | The DM-enabled commands `/ownerrole`, `/manage`, `/invite` and `/botinfo`. Their `default_member_permissions` are stripped globally; the owner check stays in code. |
| Per-guild | Every other command, registered in `GUILD_ID` when set, otherwise globally. |
| Prefix | Most commands also work with `!` in guilds (`!ping`, `!manage list`, …). In DMs the prefix is restricted to the owner and to an explicit allowlist. |

The allowlists live in a single source of truth: `src/config/commandMeta.js`
(`DM_ENABLED_COMMANDS`, `GLOBAL_COMMANDS`). `commandLoader.js`, `help.js` and
`prefixCommands.js` import it. Owner checks use the `ownerOnly: true` flag on
the command itself, enforced by `isBotOwner()`.

Global commands are sent with explicit `contexts: [0, 1]` (guild + bot DM), and
`default_member_permissions` is stripped, so `/manage` is visible in DMs. DM
visibility can take up to an hour to propagate after a global command change.

### DM troubleshooting

If Discord shows « Ton message n'a pas pu être envoyé » when you try to open a
DM with the bot, the command code is not involved: the DM channel itself is
refused. Check, in order:

1. You and the bot share at least one server (open the bot profile → *Mutual
   servers*). If not, run `/invite` or use
   `https://discord.com/oauth2/authorize?client_id=<CLIENT_ID>&scope=bot%20applications.commands&permissions=268782678`.
2. **Public Bot** is enabled in the Developer Portal → *Bot* tab.
3. The bot is not in your blocked-users list.
4. *Allow direct messages from server members* is enabled in your privacy settings.
5. Test with another account that shares a server with the bot to isolate a
   per-account configuration issue.

## Root commands

| Command | Description | DM |
| --- | --- | --- |
| `/ping` | Bot latency | yes |
| `/help` | Interactive command browser | yes |
| `/invite` | Get the OAuth2 link to add the bot to a server | yes |
| `/botinfo` | Status, guild count, commands, uptime and database mode | yes, owner |
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
| `/manage invite [permissions]` | Generate an OAuth2 link to add the bot to a server (`recommended` or `admin`) | yes, owner |

`!manage` alone defaults to `list` in prefix form.

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
3. For owner-only commands, set `ownerOnly: true` and keep the `isBotOwner(interaction.user.id)` guard in `execute()`.
4. For DM support, add the name to `DM_ENABLED_COMMANDS` in `src/config/commandMeta.js` (and to `GLOBAL_COMMANDS` if it must be registered globally when `GUILD_ID` is set).
5. Add a test under `tests/unit/` for any pure helper you introduce.
