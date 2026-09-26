import { logger } from './logger.js';

const DEFAULT_TEMPLATES = {
    welcome: 'Bienvenue {user} sur **{server}** ! 🎉\n\nNous sommes ravis de t\'accueillir parmi nous. N\'oublie pas de te présenter et de lire les salons pour découvrir le serveur !'
};

function replaceAll(message, token, value) {
    if (value === undefined || value === null) {
        return message;
    }
    return message.split(token).join(String(value));
}






export function formatWelcomeMessage(message, data) {
    
    if (typeof message !== 'string') return '';
    if (!message) return '';
    if (!data || typeof data !== 'object') return message;

    const user = data?.user;
    const guild = data?.guild;

    
    if (!user || typeof user !== 'object') {
        logger.warn('Invalid user object passed to formatWelcomeMessage');
    }
    if (!guild || typeof guild !== 'object') {
        logger.warn('Invalid guild object passed to formatWelcomeMessage');
    }

    const config = data?.config || {};

    const tokens = {
        '{user}': user?.toString?.() || 'Utilisateur',
        '{user.mention}': user?.toString?.() || 'Utilisateur',
        '{user.tag}': user?.tag || 'Inconnu#0000',
        '{user.username}': user?.username || 'Inconnu',
        '{username}': user?.username || 'Inconnu',
        '{user.discriminator}': user?.discriminator || '0000',
        '{user.id}': user?.id || 'inconnu',
        '{server}': guild?.name || 'Serveur',
        '{server.name}': guild?.name || 'Serveur',
        '{guild.name}': guild?.name || 'Serveur',
        '{guild.id}': guild?.id || 'inconnu',
        '{guild.memberCount}': guild?.memberCount?.toString?.() || '0',
        '{memberCount}': guild?.memberCount?.toString?.() || '0',
        '{membercount}': guild?.memberCount?.toString?.() || '0',
        '{welcomeChannel}': config.channelId ? `<#${config.channelId}>` : '',
        '{arrivalChannel}': config.arrivalChannelId ? `<#${config.arrivalChannelId}>` : '',
        '{pingChannel}': config.pingChannelId ? `<#${config.pingChannelId}>` : ''
    };

    let result = message;
    for (const [token, value] of Object.entries(tokens)) {
        if (value === undefined || value === null) continue;
        result = replaceAll(result, token, String(value));
    }

    result = result.replace(/\\n/g, '\n');
    result = result.replace(/#(\d{15,})/g, '<#$1>');

    const leftovers = result.match(/\{[a-zA-Z0-9_.]{2,30}\}/g);
    if (leftovers) {
        logger.warn(
            `Unresolved token(s) in welcome template: ${[...new Set(leftovers)].join(', ')}`
        );
    }

    return result;
}

const RESERVED_MENTIONS = new Set(['everyone', 'here', 'this', 'channel']);

function stripDecorations(value) {
    return String(value)
        .replace(/^[^\p{L}\p{N}]+/u, '')
        .replace(/[^\p{L}\p{N}]+$/u, '')
        .trim()
        .toLowerCase();
}

function buildChannelLookup(guild) {
    const lookup = new Map();

    for (const channel of guild?.channels?.cache?.values?.() || []) {
        if (!channel?.name || !channel?.id) continue;

        const full = channel.name.toLowerCase();
        if (!lookup.has(full)) lookup.set(full, channel.id);

        const stripped = stripDecorations(channel.name);
        if (stripped && !lookup.has(stripped)) lookup.set(stripped, channel.id);
    }

    return lookup;
}

function buildMemberLookup(guild) {
    const lookup = new Map();

    const register = (name, userId) => {
        if (!name || !userId) return;
        const key = String(name).toLowerCase();
        if (!lookup.has(key)) lookup.set(key, userId);
    };

    for (const member of guild?.members?.cache?.values?.() || []) {
        if (!member?.user?.id) continue;
        register(member.user.username, member.user.id);
        register(member.user.globalName, member.user.id);
        register(member.nickname, member.user.id);
        register(member.displayName, member.user.id);
    }

    return lookup;
}

export async function resolveMentions(message, guild) {
    if (typeof message !== 'string' || !message || !guild) return message;
    if (!message.includes('#') && !message.includes('@')) return message;

    if (!guild.channels?.cache?.size) {
        await guild.channels.fetch().catch(() => null);
    }

    const channelLookup = buildChannelLookup(guild);
    const memberLookup = buildMemberLookup(guild);
    if (channelLookup.size === 0 && memberLookup.size === 0) return message;

    const escaped = message
        .replace(/\\n/g, '\n')
        .split('<#').join('\u0001')
        .split('<@').join('\u0002');

    const restored = escaped.replace(/[#@]([^\s@#]{1,40}(?:\s[^\s@#]{1,40}){0,4})/g, (match, rawName) => {
        const prefix = match[0];
        const words = rawName.trim().split(/\s+/);

        for (let count = words.length; count >= 1; count--) {
            const candidate = words.slice(0, count).join(' ');
            const keys = [candidate.toLowerCase()];
            const stripped = stripDecorations(candidate);
            if (stripped && stripped !== keys[0]) keys.push(stripped);

            if (prefix === '#') {
                for (const key of keys) {
                    const channelId = channelLookup.get(key);
                    if (channelId) return `\u0001${channelId}\u0004`;
                }
            } else {
                for (const key of keys) {
                    if (RESERVED_MENTIONS.has(key)) return match;
                    const userId = memberLookup.get(key);
                    if (userId) return `\u0002${userId}\u0004`;
                }
            }
        }

        return match;
    });

    return restored
        .split('\u0001').join('<#')
        .split('\u0002').join('<@')
        .split('\u0004').join('>');
}

export async function formatWelcomeMessageAsync(message, data) {
    try {
        const resolved = await resolveMentions(message, data?.guild);
        return formatWelcomeMessage(resolved, data);
    } catch (error) {
        logger.debug('Mention resolution failed:', error.message);
        return formatWelcomeMessage(message, data);
    }
}

export function getDefaultWelcomeMessage() {
    return DEFAULT_TEMPLATES.welcome;
}


