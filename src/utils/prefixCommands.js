import { PermissionsBitField } from 'discord.js';
import { logger } from './logger.js';
import { getGuildConfig } from '../services/guildConfig.js';
import { handleInteractionError } from './errorHandler.js';
import { enforceAbuseProtection, formatCooldownDuration } from './abuseProtection.js';

const OPTION_TYPE = {
    SUBCOMMAND: 1,
    SUBCOMMAND_GROUP: 2,
    STRING: 3,
    INTEGER: 4,
    BOOLEAN: 5,
    USER: 6,
    CHANNEL: 7,
    ROLE: 8,
    MENTIONABLE: 9,
    NUMBER: 10,
    ATTACHMENT: 11
};

const DEFAULT_PREFIX = '!';
const STATBOT_PREFIX = 's?';

/**
 * Splits a string into tokens, keeping "quoted phrases" and 'single quoted' together.
 */
function tokenize(str) {
    const tokens = [];
    const regex = /"([^"]*)"|'([^']*)'|(\S+)/g;
    let match;
    while ((match = regex.exec(str)) !== null) {
        tokens.push(match[1] ?? match[2] ?? match[3]);
    }
    return tokens;
}

function extractId(token, mentionPattern) {
    if (!token) return null;
    const mentionMatch = token.match(mentionPattern);
    if (mentionMatch) return mentionMatch[1];
    const rawIdMatch = token.match(/^(\d{15,20})$/);
    return rawIdMatch ? rawIdMatch[1] : null;
}

function resolveUser(message, token) {
    const id = extractId(token, /^<@!?(\d+)>$/);
    if (!id) return null;
    return message.mentions.users.get(id) || message.client.users.cache.get(id) || null;
}

function resolveChannel(message, token) {
    const id = extractId(token, /^<#(\d+)>$/);
    if (!id || !message.guild) return null;
    return message.guild.channels.cache.get(id) || null;
}

function resolveRole(message, token) {
    const id = extractId(token, /^<@&(\d+)>$/);
    if (!id || !message.guild) return null;
    return message.guild.roles.cache.get(id) || null;
}

function parseBoolean(token) {
    const normalized = token?.toLowerCase();
    if (['true', 'yes', 'oui', 'on', '1'].includes(normalized)) return true;
    if (['false', 'no', 'non', 'off', '0'].includes(normalized)) return false;
    return null;
}

/**
 * Walks the option schema pulled from the slash command definition and matches
 * tokens from the raw text against it, resolving mentions/ids into real objects.
 */
function buildOptionsFromTokens(message, optionDefs, tokens) {
    const values = {};

    for (let i = 0; i < optionDefs.length; i++) {
        const def = optionDefs[i];
        const isLast = i === optionDefs.length - 1;
        let rawToken;

        if (isLast && def.type === OPTION_TYPE.STRING) {
            rawToken = tokens.slice(i).join(' ').trim() || undefined;
        } else {
            rawToken = tokens[i];
        }

        if (rawToken === undefined || rawToken === '') {
            if (def.required) {
                return { error: `Argument requis manquant : \`${def.name}\`` };
            }
            continue;
        }

        let value;
        switch (def.type) {
            case OPTION_TYPE.STRING:
                value = rawToken;
                break;
            case OPTION_TYPE.INTEGER: {
                const n = parseInt(rawToken, 10);
                if (Number.isNaN(n)) return { error: `\`${def.name}\` doit être un nombre entier.` };
                value = n;
                break;
            }
            case OPTION_TYPE.NUMBER: {
                const n = parseFloat(rawToken);
                if (Number.isNaN(n)) return { error: `\`${def.name}\` doit être un nombre.` };
                value = n;
                break;
            }
            case OPTION_TYPE.BOOLEAN: {
                const b = parseBoolean(rawToken);
                if (b === null) return { error: `\`${def.name}\` doit être « true » ou « false ».` };
                value = b;
                break;
            }
            case OPTION_TYPE.USER: {
                const user = resolveUser(message, rawToken);
                if (!user) return { error: `Impossible de trouver un utilisateur pour \`${def.name}\`. Mentionne-le ou utilise son ID.` };
                value = user;
                break;
            }
            case OPTION_TYPE.CHANNEL: {
                const channel = resolveChannel(message, rawToken);
                if (!channel) return { error: `Impossible de trouver un salon pour \`${def.name}\`. Mentionne-le ou utilise son ID.` };
                value = channel;
                break;
            }
            case OPTION_TYPE.ROLE: {
                const role = resolveRole(message, rawToken);
                if (!role) return { error: `Impossible de trouver un rôle pour \`${def.name}\`. Mentionne-le ou utilise son ID.` };
                value = role;
                break;
            }
            case OPTION_TYPE.MENTIONABLE: {
                const resolved = resolveUser(message, rawToken) || resolveRole(message, rawToken);
                if (!resolved) return { error: `Impossible de résoudre \`${def.name}\`.` };
                value = resolved;
                break;
            }
            case OPTION_TYPE.ATTACHMENT:
                return { error: `\`${def.name}\` nécessite une pièce jointe — utilise la version slash \`/\` de cette commande à la place.` };
            default:
                value = rawToken;
        }

        values[def.name] = { value, type: def.type };
    }

    return { values };
}

function usageLine(prefix, commandName, subcommand, optionDefs) {
    const argsPart = optionDefs.map(o => (o.required ? `<${o.name}>` : `[${o.name}]`)).join(' ');
    return `\`${prefix}${commandName}${subcommand ? ` ${subcommand}` : ''}${argsPart ? ` ${argsPart}` : ''}\``;
}

function makeOptionsAccessor(values, message, subcommand, subcommandGroup) {
    const get = (name) => (values[name] ? values[name].value : null);

    return {
        data: Object.entries(values).map(([name, v]) => ({
            name,
            type: v.type,
            value: (v.value && typeof v.value === 'object' && 'id' in v.value) ? v.value.id : v.value
        })),
        getString: (name) => { const v = get(name); return v === null ? null : String(v); },
        getInteger: (name) => get(name),
        getNumber: (name) => get(name),
        getBoolean: (name) => get(name),
        getUser: (name) => get(name),
        getMember: (name) => {
            const user = get(name);
            if (!user || !message.guild) return null;
            return message.guild.members.cache.get(user.id) || null;
        },
        getChannel: (name) => get(name),
        getRole: (name) => get(name),
        getMentionable: (name) => get(name),
        getAttachment: () => null,
        getFocused: () => null,
        getSubcommand: (required = true) => {
            if (!subcommand && required) throw new Error('No subcommand specified for this prefix command.');
            return subcommand || null;
        },
        getSubcommandGroup: (required = false) => {
            if (!subcommandGroup && required) throw new Error('No subcommand group specified for this prefix command.');
            return subcommandGroup || null;
        }
    };
}

function normalizeReplyPayload(options) {
    if (!options || typeof options !== 'object') return options;
    const { flags, ephemeral, ...rest } = options;
    return rest;
}

/**
 * Builds a lightweight object that mimics a discord.js ChatInputCommandInteraction
 * closely enough for our commands' execute() functions to run unmodified against
 * a plain text Message instead of a real slash interaction.
 */
function createPrefixInteraction(message, client, commandName, optionsAccessor) {
    let deferred = false;
    let replied = false;
    let replyMessage = null;

    const interaction = {
        id: message.id,
        type: 2,
        commandName,
        customId: undefined,
        user: message.author,
        member: message.member,
        guild: message.guild,
        guildId: message.guild?.id ?? null,
        channel: message.channel,
        channelId: message.channel?.id ?? null,
        client,
        createdTimestamp: message.createdTimestamp,
        memberPermissions: message.member?.permissions ?? new PermissionsBitField(),
        options: optionsAccessor,
        isChatInputCommand: () => true,
        isPrefixCommand: () => true,
        isAutocomplete: () => false,
        isButton: () => false,
        isStringSelectMenu: () => false,
        isModalSubmit: () => false,
        get deferred() { return deferred; },
        get replied() { return replied; },
        deferReply: async () => {
            replyMessage = await message.channel.send({ content: '⏳ Je m\'en occupe…' });
            deferred = true;
            return replyMessage;
        },
        editReply: async (options) => {
            const payload = normalizeReplyPayload(options);
            if (replyMessage) {
                replyMessage = await replyMessage.edit(payload);
            } else {
                replyMessage = await message.channel.send(payload);
                replied = true;
            }
            return replyMessage;
        },
        reply: async (options) => {
            const payload = normalizeReplyPayload(options);
            replyMessage = await message.reply(payload);
            replied = true;
            return replyMessage;
        },
        followUp: async (options) => {
            const payload = normalizeReplyPayload(options);
            return await message.channel.send(payload);
        },
        deleteReply: async () => {
            if (replyMessage && replyMessage.deletable) {
                await replyMessage.delete();
            }
        },
        fetchReply: async () => replyMessage,
        showModal: async () => {
            throw new Error('Les modales ne sont pas prises en charge pour les commandes à préfixe — utilise la version slash `/` de cette commande à la place.');
        }
    };

    return interaction;
}

/**
 * Attempts to handle `message` as a prefix command for the given client.
 * Returns true if the message was recognized and processed as a command
 * (whether it succeeded or errored), false if it should be treated as
 * a normal chat message instead.
 */

async function tryDeletePrefixMessage(message) {
    if (!message.deletable) return;
    try {
        await message.delete();
    } catch (error) {
        logger.debug(`Could not delete prefix command message (${error.code || error.message}):`);
    }
}

async function replyWithNotice(message, text) {
    const sent = await message.reply(`<@${message.author.id}> ${text}`).catch(() => null);
    if (sent) {
        setTimeout(async () => {
            try { await sent.delete(); } catch (_) {
                // already deleted
            }
        }, 5000).unref?.();
    }
}

export async function handlePrefixCommand(message, client) {
    if (message.author.bot || !message.guild) return false;
    if (!message.content) return false;

    let guildConfig = null;
    try {
        guildConfig = await getGuildConfig(client, message.guild.id);
    } catch (error) {
        logger.error('Failed to load guild config for prefix command check:', error);
    }

    const configuredPrefix = guildConfig?.prefix || DEFAULT_PREFIX;
    const matchedPrefix = [configuredPrefix, STATBOT_PREFIX].find((p) => p && message.content.startsWith(p));
    if (!matchedPrefix) return false;
    const deleteTriggerAfterRun = matchedPrefix === configuredPrefix;

    const withoutPrefix = message.content.slice(matchedPrefix.length).trim();
    if (!withoutPrefix) return false;

    const tokens = tokenize(withoutPrefix);
    const commandName = tokens.shift()?.toLowerCase();
    if (!commandName) return false;

    const command = client.commands.get(commandName);
    if (!command) return false;

    try {
        const abuseProtection = await enforceAbuseProtection(
            { guildId: message.guild.id, user: message.author },
            command,
            commandName
        );
        if (!abuseProtection.allowed) {
            const formattedCooldown = formatCooldownDuration(abuseProtection.remainingMs);
            await replyWithNotice(message, `cette commande est en temps de recharge, attends ${formattedCooldown} avant de réessayer`);
            return true;
        }

        if (guildConfig?.disabledCommands?.[commandName]) {
            await replyWithNotice(message, 'cette commande a été désactivée sur ce serveur');
            return true;
        }

        const commandJSON = typeof command.data.toJSON === 'function' ? command.data.toJSON() : command.data;
        let optionDefs = commandJSON.options || [];
        let subcommand = null;
        let subcommandGroup = null;

        if (optionDefs[0]?.type === OPTION_TYPE.SUBCOMMAND_GROUP) {
            const groupToken = tokens.shift();
            const group = optionDefs.find(o => o.name === groupToken?.toLowerCase());
            if (!group) {
                await replyWithNotice(message, `utilisation : ${usageLine(matchedPrefix, commandName, null, [])} — groupes disponibles : ${optionDefs.map(o => o.name).join(', ')}`);
                return true;
            }
            subcommandGroup = group.name;
            const subToken = tokens.shift();
            const sub = group.options?.find(o => o.name === subToken?.toLowerCase());
            if (!sub) {
                await replyWithNotice(message, `utilisation : \`${matchedPrefix}${commandName} ${group.name} <sous-commande>\` — disponibles : ${(group.options || []).map(o => o.name).join(', ')}`);
                return true;
            }
            subcommand = sub.name;
            optionDefs = sub.options || [];
        } else if (optionDefs[0]?.type === OPTION_TYPE.SUBCOMMAND) {
            const subToken = tokens.shift();
            const sub = optionDefs.find(o => o.name === subToken?.toLowerCase());
            if (!sub) {
                await replyWithNotice(message, `utilisation : \`${matchedPrefix}${commandName} <sous-commande>\` — disponibles : ${optionDefs.map(o => o.name).join(', ')}`);
                return true;
            }
            subcommand = sub.name;
            optionDefs = sub.options || [];
        }

        const requiredPerms = commandJSON.default_member_permissions;
        if (requiredPerms !== undefined && requiredPerms !== null) {
            const perms = new PermissionsBitField(BigInt(requiredPerms));
            if (!message.member.permissions.has(perms)) {
                await replyWithNotice(message, 'tu n\'as pas la permission d\'utiliser cette commande');
                return true;
            }
        }

        const parsed = buildOptionsFromTokens(message, optionDefs, tokens);
        if (parsed.error) {
            await replyWithNotice(message, `${parsed.error} — utilisation : ${usageLine(matchedPrefix, commandName, subcommand, optionDefs)}`);
            return true;
        }

        const optionsAccessor = makeOptionsAccessor(parsed.values, message, subcommand, subcommandGroup);
        const interaction = createPrefixInteraction(message, client, commandName, optionsAccessor);

        logger.info(`Prefix command executed: ${matchedPrefix}${commandName} by ${message.author.tag}`, {
            event: 'prefix.command.received',
            guildId: message.guild.id,
            userId: message.author.id,
            command: commandName
        });

        await command.execute(interaction, guildConfig, client);
    } catch (error) {
        logger.error(`Error executing prefix command "${commandName}":`, error);
        try {
            const fallbackInteraction = createPrefixInteraction(message, client, commandName, makeOptionsAccessor({}, message, null, null));
            await handleInteractionError(fallbackInteraction, error, { type: 'prefix_command', commandName });
        } catch (innerError) {
            logger.error('Failed to send prefix command error response:', innerError);
        }
    } finally {
        if (deleteTriggerAfterRun) {
            await tryDeletePrefixMessage(message);
        }
    }

    return true;
}
