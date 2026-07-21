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
                return { error: `Missing required argument: \`${def.name}\`` };
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
                if (Number.isNaN(n)) return { error: `\`${def.name}\` must be a whole number.` };
                value = n;
                break;
            }
            case OPTION_TYPE.NUMBER: {
                const n = parseFloat(rawToken);
                if (Number.isNaN(n)) return { error: `\`${def.name}\` must be a number.` };
                value = n;
                break;
            }
            case OPTION_TYPE.BOOLEAN: {
                const b = parseBoolean(rawToken);
                if (b === null) return { error: `\`${def.name}\` must be true/false.` };
                value = b;
                break;
            }
            case OPTION_TYPE.USER: {
                const user = resolveUser(message, rawToken);
                if (!user) return { error: `Could not find a user for \`${def.name}\`. Mention them or use their ID.` };
                value = user;
                break;
            }
            case OPTION_TYPE.CHANNEL: {
                const channel = resolveChannel(message, rawToken);
                if (!channel) return { error: `Could not find a channel for \`${def.name}\`. Mention it or use its ID.` };
                value = channel;
                break;
            }
            case OPTION_TYPE.ROLE: {
                const role = resolveRole(message, rawToken);
                if (!role) return { error: `Could not find a role for \`${def.name}\`. Mention it or use its ID.` };
                value = role;
                break;
            }
            case OPTION_TYPE.MENTIONABLE: {
                const resolved = resolveUser(message, rawToken) || resolveRole(message, rawToken);
                if (!resolved) return { error: `Could not resolve \`${def.name}\`.` };
                value = resolved;
                break;
            }
            case OPTION_TYPE.ATTACHMENT:
                return { error: `\`${def.name}\` needs a file attachment — please use the \`/\` slash command version for this one.` };
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
        isAutocomplete: () => false,
        isButton: () => false,
        isStringSelectMenu: () => false,
        isModalSubmit: () => false,
        get deferred() { return deferred; },
        get replied() { return replied; },
        deferReply: async () => {
            replyMessage = await message.channel.send({ content: '⏳ Working on it…' });
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
export async function handlePrefixCommand(message, client) {
    if (message.author.bot || !message.guild) return false;
    if (!message.content) return false;

    let guildConfig = null;
    try {
        guildConfig = await getGuildConfig(client, message.guild.id);
    } catch (error) {
        logger.error('Failed to load guild config for prefix command check:', error);
    }

    const prefix = guildConfig?.prefix || DEFAULT_PREFIX;
    if (!message.content.startsWith(prefix)) return false;

    const withoutPrefix = message.content.slice(prefix.length).trim();
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
            await message.reply(`⏳ This command is on cooldown. Please wait ${formattedCooldown} before trying again.`);
            return true;
        }

        if (guildConfig?.disabledCommands?.[commandName]) {
            await message.reply('❌ This command has been disabled for this server.');
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
                await message.reply(`Usage: ${usageLine(prefix, commandName, null, [])} — available groups: ${optionDefs.map(o => o.name).join(', ')}`);
                return true;
            }
            subcommandGroup = group.name;
            const subToken = tokens.shift();
            const sub = group.options?.find(o => o.name === subToken?.toLowerCase());
            if (!sub) {
                await message.reply(`Usage: \`${prefix}${commandName} ${group.name} <subcommand>\` — available: ${(group.options || []).map(o => o.name).join(', ')}`);
                return true;
            }
            subcommand = sub.name;
            optionDefs = sub.options || [];
        } else if (optionDefs[0]?.type === OPTION_TYPE.SUBCOMMAND) {
            const subToken = tokens.shift();
            const sub = optionDefs.find(o => o.name === subToken?.toLowerCase());
            if (!sub) {
                await message.reply(`Usage: \`${prefix}${commandName} <subcommand>\` — available: ${optionDefs.map(o => o.name).join(', ')}`);
                return true;
            }
            subcommand = sub.name;
            optionDefs = sub.options || [];
        }

        const requiredPerms = commandJSON.default_member_permissions;
        if (requiredPerms !== undefined && requiredPerms !== null) {
            const perms = new PermissionsBitField(BigInt(requiredPerms));
            if (!message.member.permissions.has(perms)) {
                await message.reply('❌ You do not have permission to use this command.');
                return true;
            }
        }

        const parsed = buildOptionsFromTokens(message, optionDefs, tokens);
        if (parsed.error) {
            await message.reply(`❌ ${parsed.error}\nUsage: ${usageLine(prefix, commandName, subcommand, optionDefs)}`);
            return true;
        }

        const optionsAccessor = makeOptionsAccessor(parsed.values, message, subcommand, subcommandGroup);
        const interaction = createPrefixInteraction(message, client, commandName, optionsAccessor);

        logger.info(`Prefix command executed: ${prefix}${commandName} by ${message.author.tag}`, {
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
    }

    return true;
}
