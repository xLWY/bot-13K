





import {
    getJoinToCreateConfig,
    saveJoinToCreateConfig,
    updateJoinToCreateConfig,
    getTemporaryChannelInfo,
    formatChannelName as formatChannelNameUtil
} from '../utils/database.js';
import { logger } from '../utils/logger.js';
import { TitanBotError, ErrorTypes } from '../utils/errorHandler.js';
import { logEvent, EVENT_TYPES } from './loggingService.js';
import { ChannelType, PermissionFlagsBits } from 'discord.js';

const CHANNEL_NAME_MAX_LENGTH = 100;
const CHANNEL_VARIABLE_MAX_LENGTH = 32;
const CONTROL_AND_INVISIBLE_CHARS_REGEX = /[\x00-\x1F\x7F\u200B-\u200D\uFEFF]/g;
const ALLOWED_TEMPLATE_PLACEHOLDERS = new Set([
    '{username}',
    '{user_tag}',
    '{displayName}',
    '{display_name}',
    '{guildName}',
    '{guild_name}',
    '{channelName}',
    '{channel_name}'
]);







export function validateChannelNameTemplate(template) {
    if (!template || typeof template !== 'string') {
        throw new TitanBotError(
            'Invalid channel template: must be a non-empty string',
            ErrorTypes.VALIDATION,
            'Le modèle de nom de salon doit être un texte valide.'
        );
    }

    // Remove only control characters, keep emojis and punctuation for templates
    const normalizedTemplate = template.normalize('NFKC').replace(CONTROL_AND_INVISIBLE_CHARS_REGEX, '').trim();

    if (normalizedTemplate.length > CHANNEL_NAME_MAX_LENGTH) {
        throw new TitanBotError(
            'Channel template exceeds maximum length',
            ErrorTypes.VALIDATION,
            `Le modèle de nom de salon ne peut pas dépasser ${CHANNEL_NAME_MAX_LENGTH} caractères.`
        );
    }

    // Check for Discord-forbidden channel name characters (only @#: and backticks are problematic)
    if (/[@#:`]/.test(normalizedTemplate)) {
        throw new TitanBotError(
            'Channel template contains forbidden characters',
            ErrorTypes.VALIDATION,
            'Le modèle de salon ne peut pas contenir les caractères @, #, : ou les accents grave.'
        );
    }

    const placeholders = normalizedTemplate.match(/\{[^}]+\}/g) || [];
    for (const placeholder of placeholders) {
        if (!ALLOWED_TEMPLATE_PLACEHOLDERS.has(placeholder)) {
            throw new TitanBotError(
                'Channel template contains unknown placeholders',
                ErrorTypes.VALIDATION,
                `Placeholder inconnu : ${placeholder}. Les placeholders autorisés sont ${Array.from(ALLOWED_TEMPLATE_PLACEHOLDERS).join(', ')}`
            );
        }
    }

    return true;
}







export function validateBitrate(bitrate) {
    const bitrateNum = parseInt(bitrate);

    if (isNaN(bitrateNum)) {
        throw new TitanBotError(
            'Bitrate must be a valid number',
            ErrorTypes.VALIDATION,
            'Veuillez saisir un nombre valide pour le débit binaire.'
        );
    }

    if (bitrateNum < 8 || bitrateNum > 384) {
        throw new TitanBotError(
            'Bitrate out of valid range',
            ErrorTypes.VALIDATION,
            'Le débit binaire doit être compris entre 8 et 384 kbps.'
        );
    }

    return true;
}







export function validateUserLimit(limit) {
    const limitNum = parseInt(limit);

    if (isNaN(limitNum)) {
        throw new TitanBotError(
            'User limit must be a valid number',
            ErrorTypes.VALIDATION,
            'Veuillez saisir un nombre valide pour la limite d\'utilisateurs.'
        );
    }

    if (limitNum < 0 || limitNum > 99) {
        throw new TitanBotError(
            'User limit out of valid range',
            ErrorTypes.VALIDATION,
            'La limite d\'utilisateurs doit être comprise entre 0 (aucune limite) et 99.'
        );
    }

    return true;
}








export function formatChannelName(template, variables) {
    try {
        const safeTemplate = template.normalize('NFKC').replace(CONTROL_AND_INVISIBLE_CHARS_REGEX, '').trim();
        validateChannelNameTemplate(safeTemplate);

        if (!variables || typeof variables !== 'object') {
            throw new TitanBotError(
                'Invalid variables object for channel formatting',
                ErrorTypes.VALIDATION
            );
        }

        // Sanitize each variable to prevent injection and ensure Discord compatibility
        const sanitized = {};
        for (const [key, value] of Object.entries(variables)) {
            if (value === null || value === undefined) {
                sanitized[key] = 'Inconnu';
            } else {
                // Remove dangerous and Discord-incompatible characters
                sanitized[key] = String(value)
                    .normalize('NFKC')
                    .replace(CONTROL_AND_INVISIBLE_CHARS_REGEX, '')
                    .replace(/[@#:`\n\r\t]/g, '') // Remove Discord-forbidden chars
                    .trim()
                    .substring(0, CHANNEL_VARIABLE_MAX_LENGTH);
            }
        }

        const replacements = {
            '{username}': sanitized.username || 'Utilisateur',
            '{user_tag}': sanitized.userTag || 'Utilisateur#0000',
            '{displayName}': sanitized.displayName || 'Utilisateur',
            '{display_name}': sanitized.displayName || 'Utilisateur',
            '{guildName}': sanitized.guildName || 'Serveur',
            '{guild_name}': sanitized.guildName || 'Serveur',
            '{channelName}': sanitized.channelName || 'Salon vocal',
            '{channel_name}': sanitized.channelName || 'Salon vocal',
        };

        let formatted = safeTemplate;
        for (const [placeholder, value] of Object.entries(replacements)) {
            formatted = formatted.replace(new RegExp(placeholder.replace(/[{}]/g, '\\$&'), 'g'), value);
        }

        // Final sanitization: preserve emojis but remove Discord-forbidden characters
        // Discord allows emojis but not @#:` and control characters
        formatted = formatted
            .normalize('NFKC')
            .replace(CONTROL_AND_INVISIBLE_CHARS_REGEX, '')
            .replace(/[@#:`\n\r\t]/g, '') // Remove only Discord-forbidden chars, keep emojis
            .replace(/\s+/g, ' ')
            .trim();

        
        if (formatted.length === 0) {
            formatted = 'Salon vocal';
        } else if (formatted.length > CHANNEL_NAME_MAX_LENGTH) {
            formatted = formatted.substring(0, CHANNEL_NAME_MAX_LENGTH);
        }

        logger.debug(`Formatted channel name: "${formatted}" from template "${template}"`);
        return formatted;

    } catch (error) {
        logger.error('Error formatting channel name:', error);
        throw error;
    }
}









export async function initializeJoinToCreate(client, guildId, channelId, options = {}) {
    try {
        if (!client || !client.db) {
            throw new TitanBotError(
                'Database service not available',
                ErrorTypes.DATABASE,
                'Une erreur système est survenue. Réessaie.'
            );
        }

        if (!guildId || !channelId) {
            throw new TitanBotError(
                'Missing required guild or channel ID',
                ErrorTypes.VALIDATION,
                'Informations de serveur ou de salon invalides.'
            );
        }

        
        if (options.nameTemplate) {
            validateChannelNameTemplate(options.nameTemplate);
        }
        if (options.bitrate) {
            validateBitrate(options.bitrate / 1000); 
        }
        if (options.userLimit !== undefined) {
            validateUserLimit(options.userLimit);
        }

        const config = await getJoinToCreateConfig(client, guildId);

        if (config.triggerChannels.includes(channelId)) {
            throw new TitanBotError(
                'Channel already configured as Join to Create trigger',
                ErrorTypes.VALIDATION,
                'Ce salon est déjà configuré comme déclencheur Join to Create.'
            );
        }

        if (Array.isArray(config.triggerChannels) && config.triggerChannels.length > 0) {
            throw new TitanBotError(
                'Guild already has a Join to Create trigger configured',
                ErrorTypes.VALIDATION,
                'Ce serveur a déjà un canal Join to Create configuré. Utilise `/jointocreate dashboard` pour le modifier, ou retire-le avant d\'en créer un nouveau.',
                {
                    guildId,
                    existingTriggerChannelId: config.triggerChannels[0],
                    expected: true,
                    suppressErrorLog: true
                }
            );
        }

        config.triggerChannels.push(channelId);
        config.enabled = true;

        if (Object.keys(options).length > 0) {
            if (!config.channelOptions) {
                config.channelOptions = {};
            }
            config.channelOptions[channelId] = {
                nameTemplate: options.nameTemplate || config.channelNameTemplate,
                userLimit: options.userLimit !== undefined ? options.userLimit : config.userLimit,
                bitrate: options.bitrate || config.bitrate,
                categoryId: options.categoryId || null,
                moderatorRoleId: options.moderatorRoleId || null,
                createdAt: Date.now()
            };
        }

        await saveJoinToCreateConfig(client, guildId, config);

        logger.info(`Initialized Join to Create for guild ${guildId} with trigger channel ${channelId}`);

        return config;

    } catch (error) {
        if (error instanceof TitanBotError) {
            throw error;
        }
        throw new TitanBotError(
            `Failed to initialize Join to Create: ${error.message}`,
            ErrorTypes.DATABASE,
            'Échec de la configuration du système Join to Create.'
        );
    }
}









export async function updateChannelConfig(client, guildId, channelId, updates) {
    try {
        if (!client || !client.db) {
            throw new TitanBotError(
                'Database service not available',
                ErrorTypes.DATABASE,
                'Le service de base de données est actuellement indisponible. Réessaie plus tard.'
            );
        }

        const config = await getJoinToCreateConfig(client, guildId);

        if (!config.triggerChannels.includes(channelId)) {
            throw new TitanBotError(
                'Channel is not configured as a Join to Create trigger',
                ErrorTypes.VALIDATION,
                'Ce salon n\'est pas configuré comme déclencheur Join to Create.'
            );
        }

        
        if (updates.nameTemplate) {
            validateChannelNameTemplate(updates.nameTemplate);
        }
        if (updates.bitrate !== undefined) {
            validateBitrate(updates.bitrate / 1000);
        }
        if (updates.userLimit !== undefined) {
            validateUserLimit(updates.userLimit);
        }

        if (!config.channelOptions) {
            config.channelOptions = {};
        }

        config.channelOptions[channelId] = {
            ...config.channelOptions[channelId],
            ...updates,
            updatedAt: Date.now()
        };

        await saveJoinToCreateConfig(client, guildId, config);

        logger.info(`Updated Join to Create config for channel ${channelId} in guild ${guildId}`, {
            updates: Object.keys(updates)
        });

        return config.channelOptions[channelId];

    } catch (error) {
        if (error instanceof TitanBotError) {
            throw error;
        }
        throw new TitanBotError(
            `Failed to update channel config: ${error.message}`,
            ErrorTypes.DATABASE,
            'Échec de la mise à jour de la configuration.'
        );
    }
}








export async function removeTriggerChannel(client, guildId, channelId) {
    try {
        if (!client || !client.db) {
            throw new TitanBotError(
                'Database service not available',
                ErrorTypes.DATABASE,
                'Le service de base de données est actuellement indisponible. Réessaie plus tard.'
            );
        }

        const config = await getJoinToCreateConfig(client, guildId);

        const index = config.triggerChannels.indexOf(channelId);
        if (index === -1) {
            throw new TitanBotError(
                'Channel not found in Join to Create triggers',
                ErrorTypes.VALIDATION,
                'This channel is not configured as a Join to Create trigger.'
            );
        }

        config.triggerChannels.splice(index, 1);
        config.enabled = config.triggerChannels.length > 0;

        if (config.channelOptions && config.channelOptions[channelId]) {
            delete config.channelOptions[channelId];
        }

        
        if (config.temporaryChannels) {
            for (const [tempChannelId, tempInfo] of Object.entries(config.temporaryChannels)) {
                if (tempInfo.triggerChannelId === channelId) {
                    delete config.temporaryChannels[tempChannelId];
                }
            }
        }

        await saveJoinToCreateConfig(client, guildId, config);

        logger.info(`Removed Join to Create trigger channel ${channelId} from guild ${guildId}`);

        return true;

    } catch (error) {
        if (error instanceof TitanBotError) {
            throw error;
        }
        throw new TitanBotError(
            `Failed to remove trigger channel: ${error.message}`,
            ErrorTypes.DATABASE,
            'Échec de la suppression du salon déclencheur.'
        );
    }
}








export async function getConfiguration(client, guildId) {
    try {
        if (!client || !client.db) {
            throw new TitanBotError(
                'Database service not available',
                ErrorTypes.DATABASE,
                'Le service de base de données est actuellement indisponible. Réessaie plus tard.'
            );
        }

        return await getJoinToCreateConfig(client, guildId);

    } catch (error) {
        if (error instanceof TitanBotError) {
            throw error;
        }
        throw new TitanBotError(
            `Failed to retrieve configuration: ${error.message}`,
            ErrorTypes.DATABASE,
            'Échec de la récupération des paramètres.'
        );
    }
}








export async function isTriggerChannel(client, guildId, channelId) {
    try {
        const config = await getConfiguration(client, guildId);
        return config.triggerChannels.includes(channelId);
    } catch (error) {
        logger.error(`Error checking if channel is trigger: ${error.message}`);
        return false;
    }
}









export async function getChannelConfiguration(client, guildId, channelId) {
    try {
        const config = await getConfiguration(client, guildId);

        if (!config.triggerChannels || !Array.isArray(config.triggerChannels) || !config.triggerChannels.includes(channelId)) {
            throw new TitanBotError(
                'Channel is not a valid Join to Create trigger',
                ErrorTypes.VALIDATION,
                'Ce salon n\'est pas configuré comme déclencheur Join to Create.'
            );
        }

        return {
            ...config,
            channelConfig: config.channelOptions?.[channelId] || {}
        };

    } catch (error) {
        if (error instanceof TitanBotError) {
            throw error;
        }
        throw new TitanBotError(
            `Failed to get channel configuration: ${error.message}`,
            ErrorTypes.DATABASE,
            'Échec de la récupération de la configuration du salon. Réessaie.'
        );
    }
}






export function hasManageGuildPermission(member) {
    try {
        if (!member || !member.permissions) {
            return false;
        }
        return member.permissions.has(PermissionFlagsBits.ManageGuild);
    } catch (error) {
        logger.error('Error checking ManageGuild permission:', error);
        return false;
    }
}









export async function logConfigurationChange(client, guildId, userId, action, details) {
    try {
        await logEvent({
            client,
            guildId,
            eventType: EVENT_TYPES.CONFIGURATION_CHANGE,
            data: {
                description: `Join to Create: ${action}`,
                userId,
                action,
                details,
                timestamp: new Date().toISOString()
            }
        });
    } catch (error) {
        logger.warn(`Failed to log Join to Create configuration change: ${error.message}`);
    }
}









export async function createTemporaryChannel(guild, member, options = {}) {
    try {
        if (!guild || !member) {
            throw new TitanBotError(
                'Invalid guild or member',
                ErrorTypes.VALIDATION
            );
        }

        const {
            nameTemplate,
            userLimit,
            bitrate,
            parentId
        } = options;

        
        if (nameTemplate) {
            validateChannelNameTemplate(nameTemplate);
        }
        if (userLimit !== undefined) {
            validateUserLimit(userLimit);
        }
        if (bitrate !== undefined) {
            validateBitrate(bitrate / 1000);
        }

        
        const channelName = formatChannelName(nameTemplate || '{username} · Salon vocal', {
            username: member.user.username,
            displayName: member.displayName,
            userTag: member.user.tag,
            guildName: guild.name
        });

        
        const tempChannel = await guild.channels.create({
            name: channelName,
            type: ChannelType.GuildVoice,
            parent: parentId,
            userLimit: userLimit === 0 ? undefined : userLimit,
            bitrate: bitrate || 64000,
            permissionOverwrites: [
                {
                    id: member.id,
                    allow: [PermissionFlagsBits.Connect, PermissionFlagsBits.Speak, PermissionFlagsBits.PrioritySpeaker, PermissionFlagsBits.MoveMembers]
                },
                {
                    id: guild.id,
                    allow: [PermissionFlagsBits.Connect, PermissionFlagsBits.Speak]
                }
            ]
        });

        logger.info(`Created temporary voice channel ${tempChannel.name} (${tempChannel.id}) for user ${member.user.tag}`);

        return {
            id: tempChannel.id,
            name: tempChannel.name,
            ownerId: member.id
        };

    } catch (error) {
        if (error instanceof TitanBotError) {
            throw error;
        }
        throw new TitanBotError(
            `Failed to create temporary channel: ${error.message}`,
            ErrorTypes.DISCORD_API,
            'Impossible de créer ton salon vocal temporaire. Contacte un administrateur.'
        );
    }
}

export default {
    validateChannelNameTemplate,
    validateBitrate,
    validateUserLimit,
    formatChannelName,
    initializeJoinToCreate,
    updateChannelConfig,
    removeTriggerChannel,
    getConfiguration,
    isTriggerChannel,
    getChannelConfiguration,
    hasManageGuildPermission,
    logConfigurationChange,
    createTemporaryChannel
};
