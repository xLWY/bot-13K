import {
    ChannelType,
    PermissionFlagsBits,
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle
} from 'discord.js';
import { getColor } from '../config/bot.js';
import { logger } from '../utils/logger.js';
import {
    getJoinToCreateConfig,
    getTemporaryChannelInfo,
    updateTemporaryChannelInfo
} from '../utils/database.js';
import { formatChannelName } from './joinToCreateService.js';

export const CONTROL_TEXT_PREFIX = '🎛 ';

const MAX_NAME_LENGTH = 100;
const FORBIDDEN_CHARS = /[@#:`\u0000-\u001F\u007F\u200B-\u200D\uFEFF]/g;

export function sanitizeChannelName(input, fallback = 'Salon vocal') {
    const name = String(input || '')
        .normalize('NFKC')
        .replace(FORBIDDEN_CHARS, '')
        .replace(/\r?\n/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

    return (name || fallback).substring(0, MAX_NAME_LENGTH);
}

export function getChannelState(voiceChannel) {
    const everyoneOverwrite = voiceChannel.permissionOverwrites.cache.get(voiceChannel.guild.id);
    const locked = everyoneOverwrite?.deny?.has(PermissionFlagsBits.Connect) ?? false;
    const hidden = everyoneOverwrite?.deny?.has(PermissionFlagsBits.ViewChannel) ?? false;
    return { locked, hidden };
}

export function canControlMember(member, tempInfo, config) {
    if (!member || member.user?.bot) return false;

    if (tempInfo && tempInfo.ownerId === member.id) return true;

    if (
        member.permissions?.has(PermissionFlagsBits.ManageChannels) ||
        member.permissions?.has(PermissionFlagsBits.ManageGuild)
    ) {
        return true;
    }

    const modRoleId =
        config?.moderatorRoleId ||
        config?.channelOptions?.[tempInfo?.triggerChannelId]?.moderatorRoleId;

    if (modRoleId && member.roles?.cache?.has(modRoleId)) {
        return true;
    }

    return false;
}

export async function getChannelConfigExtra(client, guildId, tempInfo) {
    const config = await getJoinToCreateConfig(client, guildId);
    return {
        config,
        channelOptions: config.channelOptions?.[tempInfo?.triggerChannelId] || {}
    };
}

export async function buildControlPanel(client, voiceChannel, tempInfo) {
    const guild = voiceChannel.guild;
    const config = await getJoinToCreateConfig(client, guild.id);
    const state = getChannelState(voiceChannel);

    const owner = await guild.members.fetch(tempInfo.ownerId).catch(() => null);
    const ownerLabel = owner ? owner.toString() : `<@${tempInfo.ownerId}>`;

    const limitLabel =
        voiceChannel.userLimit === 0 || voiceChannel.userLimit == null
            ? 'Illimitée'
            : `${voiceChannel.userLimit} utilisateurs`;

    const embed = new EmbedBuilder()
        .setTitle('🎙️ Salon temporaire')
        .setColor(getColor('primary'))
        .setDescription(`Panneau de contrôle de <#${voiceChannel.id}>\n\nLe salon est supprimé automatiquement quand il est vide.`)
        .addFields(
            { name: '👑 Propriétaire', value: ownerLabel, inline: true },
            { name: '👥 Membres', value: `${voiceChannel.members.size}`, inline: true },
            { name: '📥 Limite', value: limitLabel, inline: true },
            { name: '🔒 Verrouillé', value: state.locked ? 'Oui' : 'Non', inline: true },
            { name: '🎫 Privé', value: state.hidden ? 'Oui' : 'Non', inline: true }
        )
        .setFooter({ text: 'Les boutons ne sont utilisables que par le propriétaire ou un modérateur.' })
        .setTimestamp();

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`tv_rename:${voiceChannel.id}`)
            .setLabel('✏️ Renommer')
            .setStyle(ButtonStyle.Primary),
        state.locked
            ? new ButtonBuilder()
                .setCustomId(`tv_lock:${voiceChannel.id}`)
                .setLabel('🔓 Déverrouiller')
                .setStyle(ButtonStyle.Secondary)
            : new ButtonBuilder()
                .setCustomId(`tv_lock:${voiceChannel.id}`)
                .setLabel('🔒 Verrouiller')
                .setStyle(ButtonStyle.Danger),
        state.hidden
            ? new ButtonBuilder()
                .setCustomId(`tv_private:${voiceChannel.id}`)
                .setLabel('👀 Rendre visible')
                .setStyle(ButtonStyle.Secondary)
            : new ButtonBuilder()
                .setCustomId(`tv_private:${voiceChannel.id}`)
                .setLabel('🎫 Rendre privé')
                .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
            .setCustomId(`tv_limit:${voiceChannel.id}`)
            .setLabel('👥 Limite')
            .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
            .setCustomId(`tv_transfer:${voiceChannel.id}`)
            .setLabel('🎤 Transférer')
            .setStyle(ButtonStyle.Secondary)
    );

    return { embeds: [embed], components: [row] };
}

export async function createControlPanel(client, guild, voiceChannel) {
    try {
        const tempInfo = await getTemporaryChannelInfo(client, guild.id, voiceChannel.id);
        if (!tempInfo) {
            logger.warn(`No temp channel info for ${voiceChannel.id}, skipping control panel`);
            return false;
        }

        const textChannelName = sanitizeChannelName(
            `${CONTROL_TEXT_PREFIX}${voiceChannel.name}`,
            '🎛 Salon vocal'
        );

        const textChannel = await guild.channels.create({
            name: textChannelName,
            type: ChannelType.GuildText,
            parent: voiceChannel.parentId
        });

        const layout = await buildControlPanel(client, voiceChannel, tempInfo);
        const message = await textChannel.send({
            content: `<@${tempInfo.ownerId}>`,
            ...layout
        });

        await updateTemporaryChannelInfo(client, guild.id, voiceChannel.id, {
            textChannelId: textChannel.id,
            panelMessageId: message.id
        });

        logger.info(`Created control panel for temporary channel ${voiceChannel.id} (text ${textChannel.id})`);
        return true;
    } catch (error) {
        logger.error(`Failed to create control panel for temporary channel ${voiceChannel.name}:`, error);
        return false;
    }
}

export async function refreshControlPanel(client, guild, voiceChannelId, tempInfo) {
    try {
        if (!tempInfo?.textChannelId || !tempInfo?.panelMessageId) return false;

        const voiceChannel = await guild.channels.fetch(voiceChannelId).catch(() => null);
        if (!voiceChannel) return false;

        const textChannel = await guild.channels.fetch(tempInfo.textChannelId).catch(() => null);
        if (!textChannel || textChannel.type !== ChannelType.GuildText) return false;

        const message = await textChannel.messages.fetch(tempInfo.panelMessageId).catch(() => null);
        if (!message) return false;

        const layout = await buildControlPanel(client, voiceChannel, tempInfo);
        await message.edit(layout);
        return true;
    } catch (error) {
        logger.warn('Failed to refresh control panel:', error);
        return false;
    }
}

export async function ensureControlOverrides(voiceChannel, tempInfo, config) {
    try {
        await voiceChannel.permissionOverwrites.edit(tempInfo.ownerId, {
            ViewChannel: true,
            Connect: true,
            Speak: true,
            PrioritySpeaker: true,
            MoveMembers: true
        });

        const modRoleId =
            config?.moderatorRoleId ||
            config?.channelOptions?.[tempInfo?.triggerChannelId]?.moderatorRoleId;

        if (modRoleId) {
            await voiceChannel.permissionOverwrites.edit(modRoleId, {
                ViewChannel: true,
                Connect: true,
                Speak: true
            });
        }

        if (voiceChannel.guild.members.me) {
            await voiceChannel.permissionOverwrites.edit(voiceChannel.guild.members.me.id, {
                ViewChannel: true,
                Connect: true,
                Speak: true,
                ManageChannels: true
            });
        }
    } catch (error) {
        logger.warn('Failed to ensure control overrides:', error);
    }
}

export async function setChannelLocked(client, voiceChannel, tempInfo, config, locked) {
    try {
        if (locked) {
            await voiceChannel.permissionOverwrites.edit(voiceChannel.guild.id, {
                Connect: false,
                Speak: null,
                ViewChannel: null
            });
        } else {
            await voiceChannel.permissionOverwrites.edit(voiceChannel.guild.id, {
                Connect: null,
                Speak: null,
                ViewChannel: null
            });
        }

        await ensureControlOverrides(voiceChannel, tempInfo, config);
        await refreshControlPanel(client, voiceChannel.guild, voiceChannel.id, tempInfo);
        return true;
    } catch (error) {
        logger.error(`Failed to toggle lock on channel ${voiceChannel.id}:`, error);
        return false;
    }
}

export async function setChannelPrivate(client, voiceChannel, tempInfo, config, privateChannel) {
    const guild = voiceChannel.guild;
    const textChannelId = tempInfo?.textChannelId;

    try {
        if (privateChannel) {
            await voiceChannel.permissionOverwrites.edit(guild.id, {
                ViewChannel: false,
                Connect: false,
                Speak: false
            });

            if (textChannelId) {
                const textChannel = await guild.channels.fetch(textChannelId).catch(() => null);
                if (textChannel) {
                    await textChannel.permissionOverwrites.edit(guild.id, { ViewChannel: false });
                    if (guild.members.me) {
                        await textChannel.permissionOverwrites.edit(guild.members.me.id, { ViewChannel: true });
                    }
                }
            }
        } else {
            await voiceChannel.permissionOverwrites.edit(guild.id, {
                ViewChannel: null,
                Connect: null,
                Speak: null
            });

            if (textChannelId) {
                const textChannel = await guild.channels.fetch(textChannelId).catch(() => null);
                if (textChannel) {
                    await textChannel.permissionOverwrites.edit(guild.id, { ViewChannel: null });
                }
            }
        }

        await ensureControlOverrides(voiceChannel, tempInfo, config);
        await refreshControlPanel(client, guild, voiceChannel.id, tempInfo);
        return true;
    } catch (error) {
        logger.error(`Failed to toggle private on channel ${voiceChannel.id}:`, error);
        return false;
    }
}

export async function renameTemporaryChannel(client, voiceChannel, tempInfo, newName) {
    const guild = voiceChannel.guild;
    const safeName = sanitizeChannelName(newName, 'Salon vocal');

    await voiceChannel.setName(safeName);

    if (tempInfo?.textChannelId) {
        const textChannel = await guild.channels.fetch(tempInfo.textChannelId).catch(() => null);
        if (textChannel) {
            await textChannel.setName(
                sanitizeChannelName(`${CONTROL_TEXT_PREFIX}${safeName}`, '🎛 Salon vocal')
            ).catch(() => {});
        }
    }

    await refreshControlPanel(client, guild, voiceChannel.id, tempInfo);
    return safeName;
}

export async function transferTemporaryChannel(client, voiceChannel, newOwnerId) {
    const guild = voiceChannel.guild;
    const tempInfo = await getTemporaryChannelInfo(client, guild.id, voiceChannel.id);
    if (!tempInfo) return null;

    await updateTemporaryChannelInfo(client, guild.id, voiceChannel.id, { ownerId: newOwnerId });

    const config = await getJoinToCreateConfig(client, guild.id);
    const channelOptions = config.channelOptions?.[tempInfo.triggerChannelId] || {};
    const nameTemplate =
        channelOptions.nameTemplate ||
        config.channelNameTemplate ||
        "{username} · Salon";

    const newOwner = await guild.members.fetch(newOwnerId).catch(() => null);
    const triggerChannel = guild.channels.cache.get(tempInfo.triggerChannelId);

    const newChannelName = newOwner
        ? sanitizeChannelName(formatChannelName(nameTemplate, {
            username: newOwner.user.username,
            userTag: newOwner.user.tag,
            displayName: newOwner.displayName,
            guildName: guild.name,
            channelName: triggerChannel?.name || 'Salon Vocal'
        }))
        : voiceChannel.name;

    await voiceChannel.setName(newChannelName);

    if (tempInfo.textChannelId) {
        const textChannel = await guild.channels.fetch(tempInfo.textChannelId).catch(() => null);
        if (textChannel) {
            await textChannel.setName(
                sanitizeChannelName(`${CONTROL_TEXT_PREFIX}${newChannelName}`, '🎛 Salon vocal')
            ).catch(() => {});
        }
    }

    await ensureControlOverrides(voiceChannel, tempInfo, config);

    const freshInfo = await getTemporaryChannelInfo(client, guild.id, voiceChannel.id);
    await refreshControlPanel(client, guild, voiceChannel.id, freshInfo);

    return { newOwner, newChannelName };
}

export default {
    sanitizeChannelName,
    getChannelState,
    canControlMember,
    buildControlPanel,
    createControlPanel,
    refreshControlPanel,
    ensureControlOverrides,
    setChannelLocked,
    setChannelPrivate,
    renameTemporaryChannel,
    transferTemporaryChannel
};