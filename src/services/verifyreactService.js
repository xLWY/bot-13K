import { PermissionFlagsBits } from 'discord.js';
import { logger } from '../utils/logger.js';
import { logEvent, EVENT_TYPES } from './loggingService.js';

const CONFIG_KEY_PREFIX = 'verifyreact:';

export async function getVerifyReactConfig(client, guildId) {
    try {
        return (await client.db.get(`${CONFIG_KEY_PREFIX}${guildId}`)) || null;
    } catch (error) {
        logger.debug(`Failed to load verifyreact config for guild ${guildId}:`, error.message);
        return null;
    }
}

export async function saveVerifyReactConfig(client, guildId, config) {
    const now = new Date().toISOString();
    const stored = { ...config, updatedAt: now };
    await client.db.set(`${CONFIG_KEY_PREFIX}${guildId}`, stored);
    return stored;
}

export async function deleteVerifyReactConfig(client, guildId) {
    await client.db.delete(`${CONFIG_KEY_PREFIX}${guildId}`);
}

export function parseEmojiInput(input, guild) {
    const raw = input.trim();

    const customMatch = raw.match(/^<a?:([A-Za-z0-9_]+):(\d{15,21})>$/);
    if (customMatch) {
        return { id: customMatch[2], name: customMatch[1], animated: raw.startsWith('<a:') };
    }

    if (/^\d{15,21}$/.test(raw)) {
        const found = guild.emojis.cache.get(raw);
        return found
            ? { id: found.id, name: found.name, animated: !!found.animated }
            : { id: raw, name: null };
    }

    const nameOnly = raw.match(/^:([A-Za-z0-9_]+):$/);
    const name = nameOnly ? nameOnly[1] : raw;

    const found = guild.emojis.cache.find(e => e.name === name);
    if (found) {
        return { id: found.id, name: found.name, animated: !!found.animated };
    }

    return { id: null, name };
}

export function formatEmoji(emojiConfig) {
    if (!emojiConfig) return '?';
    if (emojiConfig.id) {
        const animated = emojiConfig.animated ? 'a' : '';
        return `<${animated}:${emojiConfig.name || 'emoji'}:${emojiConfig.id}>`;
    }
    return emojiConfig.name || '?';
}

export function emojiMatches(reactEmoji, config) {
    if (!reactEmoji || !config?.emoji) return false;
    if (config.emoji.id) {
        return Boolean(reactEmoji.id) && reactEmoji.id === config.emoji.id;
    }
    return Boolean(config.emoji.name) && reactEmoji.name === config.emoji.name;
}

export async function handleReactionRoleEvent(client, reaction, user, action) {
    try {
        if (!reaction || !user || user.bot) return;

        const message = reaction.message;
        const guildId = message?.guildId;
        if (!guildId) return;

        const config = await getVerifyReactConfig(client, guildId);
        if (!config?.enabled) return;

        if (message.channelId !== config.channelId || message.id !== config.messageId) return;
        if (!emojiMatches(reaction.emoji, config)) return;

        const guild = client.guilds.cache.get(guildId);
        if (!guild) return;

        const member = await guild.members.fetch(user.id).catch(() => null);
        if (!member) return;

        const role = guild.roles.cache.get(config.roleId);
        if (!role) return;

        const me = guild.members.me;
        const canManage =
            me &&
            me.permissions.has(PermissionFlagsBits.ManageRoles) &&
            role.position < me.roles.highest.position;

        if (!canManage) {
            logger.warn(`[verifyreact] Cannot ${action} role ${role.name} for user ${user.id} (permissions/hierarchy).`);
            await member.send(
                `Je ne peux pas ${action === 'add' ? 'te donner' : 'te retirer'} le rôle ${role.name} automatiquement. Signale ce problème à un administrateur.`
            ).catch(() => {});
            return;
        }

        if (action === 'add') {
            if (member.roles.cache.has(role.id)) return;
            await member.roles.add(role, 'Réaction sur le message des règles');
            await logEvent({
                client,
                guildId,
                eventType: EVENT_TYPES.REACTION_ROLE_ADD,
                data: {
                    description: `Rôle ${role.name} attribué via réaction par ${user.tag}`,
                    userId: user.id,
                    fields: [
                        { name: '👤 Membre', value: `${user.tag} (${user.id})`, inline: true },
                        { name: '🎭 Rôle', value: role.toString(), inline: true }
                    ]
                }
            }).catch(() => {});
            logger.info(`[verifyreact] Role ${role.name} added to ${user.tag} (${user.id})`);
        } else {
            if (!member.roles.cache.has(role.id)) return;
            await member.roles.remove(role, 'Réaction retirée sur le message des règles');
            await logEvent({
                client,
                guildId,
                eventType: EVENT_TYPES.REACTION_ROLE_REMOVE,
                data: {
                    description: `Rôle ${role.name} retiré via réaction par ${user.tag}`,
                    userId: user.id,
                    fields: [
                        { name: '👤 Membre', value: `${user.tag} (${user.id})`, inline: true },
                        { name: '🎭 Rôle', value: role.toString(), inline: true }
                    ]
                }
            }).catch(() => {});
            logger.info(`[verifyreact] Role ${role.name} removed from ${user.tag} (${user.id})`);
        }
    } catch (error) {
        logger.error(`[verifyreact] Error handling ${action} reaction event:`, error.message);
    }
}