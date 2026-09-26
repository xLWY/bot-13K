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

const ZERO_WIDTH = /[\u200B-\u200F\u202A-\u202E\u2060-\u2064\uFEFF]/g;

function normalizeKey(value) {
    return String(value)
        .replace(ZERO_WIDTH, '')
        .replace(/^[^\p{L}\p{N}]+/u, '')
        .replace(/[^\p{L}\p{N}]+$/u, '')
        .trim()
        .toLowerCase();
}

function buildChannelLookup(guild) {
    const lookup = new Map();

    const register = (name, id) => {
        const key = normalizeKey(name);
        if (key && !lookup.has(key)) lookup.set(key, id);
    };

    for (const channel of guild?.channels?.cache?.values?.() || []) {
        if (!channel?.id) continue;
        register(channel.name, channel.id);
    }

    return lookup;
}

function buildMemberLookup(guild) {
    const lookup = new Map();

    const register = (name, userId) => {
        if (!userId) return;
        const key = normalizeKey(name);
        if (key && !lookup.has(key)) lookup.set(key, userId);
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

    const words = [];
    const re = /[^\s]+/g;
    let m;
    while ((m = re.exec(escaped)) !== null) {
        words.push({ start: m.index, end: m.index + m[0].length, text: m[0] });
    }

    let out = '';
    let cursor = 0;

    for (let i = 0; i < words.length; i++) {
        const word = words[i];
        const raw = word.text;

        if (raw[0] !== '#' && raw[0] !== '@') continue;

        const sigilAt = raw.search(/[#@]/);
        if (sigilAt <= 0) continue;

        const prefix = raw[sigilAt];
        const lookup = prefix === '#' ? channelLookup : memberLookup;
        if (lookup.size === 0) continue;

        let last = normalizeKey(raw.slice(sigilAt + 1));
        if (!last) continue;
        if (prefix === '@' && RESERVED_MENTIONS.has(last)) continue;

        let resolved = lookup.get(last) || null;
        let used = 1;

        for (let j = i + 1; j < words.length && j <= i + 5; j++) {
            const next = words[j].text;
            if (/[#@<]/.test(next)) break;
            if (words[j].start !== words[j - 1].end) break;

            const combined = normalizeKey(`${last} ${next}`);
            if (!combined) break;

            if (lookup.get(combined)) {
                resolved = lookup.get(combined);
                used = j - i + 1;
                last = combined;
            } else {
                break;
            }
        }

        if (!resolved) continue;

        out += escaped.slice(cursor, word.start);
        out += prefix === '#' ? '\u0001' : '\u0002';
        out += `${resolved}\u0004`;

        for (let k = i; k < i + used; k++) {
            cursor = words[k].end;
        }
        i += used - 1;
    }

    out += escaped.slice(cursor);

    return out
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


