/**
 * Centralized Error Handling System
 * 
 * This module provides structured error handling for the TitanBot application.
 * 
 * PHILOSOPHY:
 * - All errors are categorized by type for consistent handling
 * - User-facing errors display friendly messages
 * - System errors are logged with full context
 * - Errors contain context information for debugging
 * 
 * USAGE:
 * - Throw TitanBotError for application-specific errors
 * - Use handleInteractionError for interaction errors
 * - Errors are automatically formatted and sent to user
 * 
 * ERROR TYPES:
 * - VALIDATION: Invalid user input
 * - PERMISSION: Missing access permissions
 * - CONFIGURATION: Missing/invalid configuration
 * - DATABASE: Database operation failure
 * - NETWORK: Network/external service failure
 * - DISCORD_API: Discord API error
 * - USER_INPUT: User input processing error
 * - RATE_LIMIT: Rate limit exceeded
 * - UNKNOWN: Unclassified error
 */

import { logger } from './logger.js';
import { createEmbed } from './embeds.js';
import { MessageFlags } from 'discord.js';
import { getErrorMetadata, getDefaultErrorCodeByType, resolveErrorCode, ErrorCodes } from './errorRegistry.js';




export const ErrorTypes = {
    VALIDATION: 'validation',
    PERMISSION: 'permission',
    CONFIGURATION: 'configuration',
    DATABASE: 'database',
    NETWORK: 'network',
    DISCORD_API: 'discord_api',
    USER_INPUT: 'user_input',
    RATE_LIMIT: 'rate_limit',
    UNKNOWN: 'unknown'
};




export class TitanBotError extends Error {
    constructor(message, type = ErrorTypes.UNKNOWN, userMessage = null, context = {}) {
        super(message);
        this.name = 'TitanBotError';
        this.type = type;
        this.userMessage = userMessage;
        this.context = context;
        this.code = context?.errorCode || getDefaultErrorCodeByType(type);
        this.timestamp = new Date().toISOString();
    }
}




export function categorizeError(error) {
    if (error instanceof TitanBotError) {
        return error.type;
    }

    const message = error.message?.toLowerCase() || '';
    const code = error.code;

    if (code >= 10000 && code < 20000) {
        return ErrorTypes.DISCORD_API;
    }

    if (message.includes('rate limit') || code === 50001) {
        return ErrorTypes.RATE_LIMIT;
    }

    if (message.includes('permission') || message.includes('missing') || code === 50013) {
        return ErrorTypes.PERMISSION;
    }

    if (message.includes('database') || message.includes('connection') || message.includes('timeout')) {
        return ErrorTypes.DATABASE;
    }

    if (message.includes('network') || message.includes('fetch') || message.includes('enotconn')) {
        return ErrorTypes.NETWORK;
    }

    if (message.includes('config') || message.includes('not found') || message.includes('invalid')) {
        return ErrorTypes.CONFIGURATION;
    }

    if (message.includes('validation') || message.includes('invalid') || message.includes('required')) {
        return ErrorTypes.VALIDATION;
    }

    return ErrorTypes.UNKNOWN;
}




const UserMessages = {
    [ErrorTypes.VALIDATION]: {
        default: "Veuillez vérifier votre saisie et réessayer.",
        missing_required: "Il manque des informations obligatoires. Vérifiez les options de la commande.",
        invalid_format: "Le format fourni est incorrect. Réessayez."
    },
    [ErrorTypes.PERMISSION]: {
        default: "Je n'ai pas la permission de faire cela. Vérifiez mes permissions sur le serveur.",
        user_permission: "Vous n'avez pas la permission d'utiliser cette commande.",
        bot_permission: "J'ai besoin de permissions supplémentaires pour effectuer cette action."
    },
    [ErrorTypes.CONFIGURATION]: {
        default: "Quelque chose n'est pas correctement configuré. Contactez un administrateur.",
        missing_config: "Cette fonctionnalité n'a pas encore été configurée. Contactez un administrateur.",
        invalid_config: "La configuration est invalide. Contactez un administrateur."
    },
    [ErrorTypes.DATABASE]: {
        default: "J'ai un problème avec ma base de données. Réessayez dans un instant.",
        connection_failed: "J'ai du mal à me connecter à ma base de données. Réessayez plus tard.",
        timeout: "L'opération a pris trop de temps. Réessayez."
    },
    [ErrorTypes.NETWORK]: {
        default: "J'ai des problèmes de réseau. Réessayez dans un instant.",
        timeout: "La requête a expiré. Réessayez.",
        unreachable: "Je n'arrive pas à joindre le service pour le moment. Réessayez plus tard."
    },
    [ErrorTypes.DISCORD_API]: {
        default: "J'ai un souci avec Discord. Réessayez dans un instant.",
        rate_limit: "Vous allez trop vite. Patientez un instant avant de réessayer.",
        forbidden: "Je n'ai pas le droit de faire cela. Vérifiez mes permissions."
    },
    [ErrorTypes.USER_INPUT]: {
        default: "Il y a un problème avec votre demande. Réessayez.",
        invalid_user: "Je n'ai pas trouvé cet utilisateur. Vérifiez la mention ou l'ID.",
        invalid_channel: "Je n'ai pas trouvé ce salon. Vérifiez la mention ou l'ID."
    },
    [ErrorTypes.RATE_LIMIT]: {
        default: "Vous allez trop vite. Patientez un moment avant de réessayer.",
        command_cooldown: "Cette commande est en temps de recharge. Patientez avant de réessayer.",
        global_rate_limit: "Discord vous limite actuellement. Patientez un moment."
    },
    [ErrorTypes.UNKNOWN]: {
        default: "Quelque chose s'est mal passé. Réessayez dans un instant.",
        unexpected: "Une erreur inattendue est survenue. Réessayez plus tard."
    }
};




export function getUserMessage(error, context = {}) {
    const type = categorizeError(error);
    const messages = UserMessages[type] || UserMessages[ErrorTypes.UNKNOWN];
    
    if (error.userMessage) {
        return error.userMessage;
    }

    if (context.subtype && messages[context.subtype]) {
        return messages[context.subtype];
    }

    return messages.default;
}




export async function handleInteractionError(interaction, error, context = {}) {
    const errorType = categorizeError(error);
    const userMessage = getUserMessage(error, context);
    const resolvedErrorCode = resolveErrorCode({ error, errorType, context });
    const errorMetadata = getErrorMetadata(resolvedErrorCode);
    const traceId = context.traceId || interaction?.traceContext?.traceId || interaction?.traceId || error?.context?.traceId;
    
    
    
    
    const isUserError = [
        ErrorTypes.VALIDATION,
        ErrorTypes.RATE_LIMIT,
        ErrorTypes.USER_INPUT,
        ErrorTypes.PERMISSION
    ].includes(errorType);
    const isExpectedError = Boolean(error?.context?.expected === true || error?.context?.suppressErrorLog === true);
    
    const logData = {
        event: 'interaction.error',
        errorCode: resolvedErrorCode,
        remediationHint: errorMetadata.remediation,
        severity: errorMetadata.severity,
        retryable: errorMetadata.retryable,
        error: error.message,
        type: errorType,
        traceId,
        guildId: interaction.guildId,
        userId: interaction.user.id,
        command: interaction.commandName || context.command,
        interaction: {
            type: interaction.type,
            commandName: interaction.commandName,
            customId: interaction.customId,
            userId: interaction.user.id,
            guildId: interaction.guildId,
            channelId: interaction.channelId
        },
        context
    };
    
    if (isUserError || isExpectedError) {
        if (errorType !== ErrorTypes.RATE_LIMIT) {
            logger.debug(`User Error [${errorType.toUpperCase()}]: ${error.message}`, logData);
        }
    } else {
        // System errors (database, network, etc.) - unexpected failures
        logger.error(`System Error [${errorType.toUpperCase()}]`, {
            ...logData,
            stack: error.stack
        });
    }

    const embed = createEmbed({
        title: getErrorTitle(errorType),
        description: userMessage,
        color: 'error',
        timestamp: true
    });

    if (errorType === ErrorTypes.RATE_LIMIT) {
        embed.addFields({
            name: "💡 Astuce",
            value: "Les limites de débit aident à lutter contre le spam. Patientez un instant avant de réessayer."
        });
    } else if (errorType === ErrorTypes.PERMISSION) {
        embed.addFields({
            name: "🔧 Besoin d'aide ?",
            value: "Contactez un administrateur du serveur si vous pensez qu'il s'agit d'une erreur."
        });
    } else if (errorType === ErrorTypes.CONFIGURATION) {
        embed.addFields({
            name: "📋 Configuration",
            value: "Cette fonctionnalité doit être configurée par un administrateur du serveur."
        });
    }

    try {
        
        if (!interaction || !interaction.id) {
            logger.warn('Interaction was null or invalid when handling error', {
                event: 'interaction.error.invalid_interaction',
                errorCode: ErrorCodes.INTERACTION_INVALID,
                remediationHint: getErrorMetadata(ErrorCodes.INTERACTION_INVALID).remediation,
                traceId
            });
            return;
        }

        
        if (interaction.createdTimestamp && (Date.now() - interaction.createdTimestamp) > 14 * 60 * 1000) {
            logger.warn('Interaction expired before error handler could send response', {
                event: 'interaction.error.expired',
                errorCode: ErrorCodes.INTERACTION_EXPIRED,
                remediationHint: getErrorMetadata(ErrorCodes.INTERACTION_EXPIRED).remediation,
                traceId,
                guildId: interaction.guildId,
                userId: interaction.user.id,
                command: interaction.commandName || context.command
            });
            return;
        }

        const errorMessage = { 
            embeds: [embed]
        };
        
        if (!interaction.deferred && !interaction.replied) {
            errorMessage.flags = MessageFlags.Ephemeral;
        }
        
        if (interaction.deferred || interaction.replied) {
            await interaction.editReply(errorMessage);
        } else {
            await interaction.reply(errorMessage);
        }
    } catch (replyError) {
        
        if (replyError.code === 40060 || replyError.code === 10062) {
            logger.warn('Interaction already acknowledged or expired, cannot send error response:', {
                event: 'interaction.error.response_unavailable',
                errorCode: String(replyError.code),
                traceId,
                guildId: interaction.guildId,
                userId: interaction.user.id,
                command: interaction.commandName || context.command,
                code: replyError.code
            });
            return;
        }
        logger.error('Failed to send error response:', {
            event: 'interaction.error.response_failed',
            errorCode: String(replyError.code || ErrorCodes.INTERACTION_RESPONSE_FAILED),
            remediationHint: getErrorMetadata(ErrorCodes.INTERACTION_RESPONSE_FAILED).remediation,
            traceId,
            guildId: interaction.guildId,
            userId: interaction.user.id,
            command: interaction.commandName || context.command,
            error: replyError
        });
    }
}




function getErrorTitle(errorType) {
    const titles = {
        [ErrorTypes.VALIDATION]: "❌ Entrée invalide",
        [ErrorTypes.PERMISSION]: "🚫 Permission refusée",
        [ErrorTypes.CONFIGURATION]: "⚙️ Erreur de configuration",
        [ErrorTypes.DATABASE]: "🗄️ Erreur de base de données",
        [ErrorTypes.NETWORK]: "🌐 Erreur réseau",
        [ErrorTypes.DISCORD_API]: "🔌 Erreur API Discord",
        [ErrorTypes.USER_INPUT]: "💬 Erreur de saisie",
        [ErrorTypes.RATE_LIMIT]: "⏱️ Trop rapide !",
        [ErrorTypes.UNKNOWN]: "❓ Erreur inattendue"
    };
    
    return titles[errorType] || titles[ErrorTypes.UNKNOWN];
}




export function withErrorHandling(fn, context = {}) {
    return async (...args) => {
        try {
            return await fn(...args);
        } catch (error) {
            const interaction = args.find(arg => 
                arg && typeof arg === 'object' && 
                (arg.isCommand || arg.isButton || arg.isModalSubmit || arg.isStringSelectMenu || arg.isChatInputCommand)
            );
            
            if (interaction) {
                await handleInteractionError(interaction, error, context);
            } else {
                logger.error('Error in non-interaction context:', error);
            }
            
            return null;
        }
    };
}




export function createError(message, type = ErrorTypes.UNKNOWN, userMessage = null, context = {}) {
    const normalizedContext = {
        ...context,
        errorCode: context?.errorCode || getDefaultErrorCodeByType(type)
    };

    return new TitanBotError(message, type, userMessage, normalizedContext);
}

export default {
    ErrorTypes,
    TitanBotError,
    categorizeError,
    getUserMessage,
    handleInteractionError,
    withErrorHandling,
    createError
};




