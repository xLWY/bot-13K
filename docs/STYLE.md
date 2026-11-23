# Style guide (user-facing text)

This is the canonical convention for every string a user can see. It was written during the November 2026 cleanup to stop the drift between commands, handlers and services.

## Language and tone

- **French everywhere.** No English fallbacks, even in `reason` fields returned to users.
- **`tu` register** for commands. Owner/config notices may be slightly more formal, but never mix `tu` and `vous` inside one message.
- **Typographic apostrophe `’`**, real accents (`réservée`, `catégorie`, `privé`, `déjà`) and ellipsis `…`. Avoid `\'` escapes by using template literals or double quotes.
- Say **« propriétaire du bot »** in user copy. `owner` is reserved for identifiers, `OWNER_IDS`, log and footer tech labels.
- No leading `*` marker in command descriptions; the permission filter in `/help` is the real indicator.
- Errors: one capitalized sentence ending with a period, then an actionable hint when useful (`Réessaie dans un instant.`). Never expose a raw stack or an English default.

## Emoji

Fixed semantic set only:

| Meaning | Emoji |
| --- | --- |
| Success | ✅ |
| Error | ❌ |
| Warning | ⚠️ |
| Info | ℹ️ |
| Status | 🔴 / 🟢 |

Emoji belongs in an embed title or a dedicated status field, not sprinkled through prose. The standard paginator uses `◀`, a disabled `1 / N` indicator and `▶`, plus an optional select menu to jump to a page. Use `buildNavRow()` and `buildPageJumpRow()` from `src/ui/kit.js` instead of rebuilding buttons in each command.

## Embeds and colors

- Build embeds with `createEmbed`, `errorEmbed`, `successEmbed`, `infoEmbed` or `warningEmbed` from `src/utils/embeds.js`.
- Colors come from `getColor()` in `src/config/bot.js` (single source of truth). Never inline a hex literal.
- Use `timestamp: true`. The footer is `brandFooter(context)` from `src/ui/kit.js` : `13K Bot • /help pour explorer les commandes`, preceded by a short context label.
- Truncate once with a `…` marker before slicing field arrays.
- Shared UI helpers live in `src/ui/kit.js` : `formatNumber`, `discordTimestamp`, `guildIconUrl`, `progressBar`, `buildNavRow`, `buildPageJumpRow`. Reuse them rather than duplicating formatting logic in commands.

## Errors

- One renderer: a user-facing failure becomes an `errorEmbed`, mention-suppressed with `allowedMentions: { parse: [], repliedUser: false }`.
- Prefer ephemeral replies over auto-deleting messages.
- Copy comes from `getUserMessage()` or an explicit canonical string — never hardcode a second "unknown error" text in a helper.

## Discovery

- One `ownerOnly` flag and one canonical category map must drive both command registration and `/help`.
- `/help` filters by DM context and effective permissions; it never claims markers or channels that do not exist.

## Design system v2

- Pure formatting lives in `src/ui/format.js` and can be tested without `discord.js`.
- Discord primitives live in `src/ui/kit.js`. Prefer `brandedEmbed(options, client, context)`, `statField()`, `cardField()`, `statusField()` and `brandAuthor()` over hand-built fields.
- A numbered card is `01 · Titre`, never an icon URL in the field name. The thumbnail is the bot avatar, not an arbitrary guild icon.
- KPI fields are inline and wrapped in backticks so they align across platforms.

## Current exceptions

A few legacy surfaces still use older wording (notably some moderation dashboards and `\u{...}` escapes). They are being migrated incrementally; new code must follow this guide.
