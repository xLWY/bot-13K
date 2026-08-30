



















import { logger } from '../utils/logger.js';
import { createError, ErrorTypes } from '../utils/errorHandler.js';
import { PermissionFlagsBits } from 'discord.js';


const inviteCreationLimits = new Map();
const INVITE_CREATION_COOLDOWN = 5 * 1000; 


const ACTIVITIES = {
    'youtube': {
        id: '880218394199220334',
        name: 'YouTube Together',
        description: 'Regarder des vidéos YouTube ensemble',
        icon: '🎥'
    },
    'poker': {
        id: '755827207812677713',
        name: 'Poker Night',
        description: 'Jouer au poker avec des amis',
        icon: '🃏'
    },
    'chess': {
        id: '832012774040141894',
        name: 'Chess in the Park',
        description: 'Jouer aux échecs en compétition',
        icon: '♟️'
    },
    'checkers': {
        id: '832013003968348200',
        name: 'Checkers in the Park',
        description: 'Jouer aux dames',
        icon: '🔲'
    },
    'letter-league': {
        id: '879863686565621790',
        name: 'Letter League',
        description: 'Compétition de mots',
        icon: '📝'
    },
    'spellcast': {
        id: '852509694341283871',
        name: 'SpellCast',
        description: 'Jeu de mots magique',
        icon: '✨'
    },
    'sketch': {
        id: '902271654783242291',
        name: 'Sketch Heads',
        description: 'Jeu de dessin façon Pictionary',
        icon: '🎨'
    },
    'blazing8s': {
        id: '832025144389533716',
        name: 'Blazing 8s',
        description: 'Jeu de cartes rapide',
        icon: '🔥'
    },
    'puttparty': {
        id: '945737671223947305',
        name: 'Putt Party',
        description: 'Compétition de mini-golf',
        icon: '⛳'
    },
    'landio': {
        id: '903769130790969345',
        name: 'Land-io',
        description: 'Jeu de conquête de territoire',
        icon: '🗺️'
    },
    'bobble': {
        id: '947957217959759964',
        name: 'Bobble League',
        description: 'Jeu de chaîne de mots',
        icon: '🎯'
    },
    'knowwhat': {
        id: '976052223358406656',
        name: 'Know What I Mean',
        description: 'Jeu de devinettes',
        icon: '🤔'
    }
};

const INVITE_CONFIG = {
    max_age: 86400, 
    temporary: false,
    unique: false
};

class VoiceService {

    
    static REQUIRED_PERMISSION = PermissionFlagsBits.CreateInstantInvite;
    static INVITE_CREATION_RETRIES = 3;
    static INVITE_CREATION_RETRY_DELAY = 1000;

    




    static getActivityMetadata(activityType) {
        return ACTIVITIES[activityType] || null;
    }

    



    static getAllActivities() {
        return ACTIVITIES;
    }

    




    static async validateActivityType(activityType) {
        logger.debug(`[VOICE_SERVICE] Validating activity type`, { activityType });

        if (!activityType || typeof activityType !== 'string') {
            throw createError(
                'Invalid activity type',
                ErrorTypes.VALIDATION,
                'Le type d\'activité doit être une chaîne non vide.',
                { provided: typeof activityType }
            );
        }

        const activity = this.getActivityMetadata(activityType.toLowerCase());
        if (!activity) {
            const validActivities = Object.keys(ACTIVITIES).join(', ');
            throw createError(
                'Unknown activity',
                ErrorTypes.VALIDATION,
                `L'activité **${activityType}** n'existe pas. Activités disponibles : ${validActivities}`,
                { activityType, validActivities: Object.keys(ACTIVITIES) }
            );
        }

        return true;
    }

    




    static async validateVoiceChannel(member) {
        logger.debug(`[VOICE_SERVICE] Validating voice channel`, {
            userId: member.id,
            voiceChannelId: member.voice?.channel?.id
        });

        if (!member.voice?.channel) {
            throw createError(
                'Not in voice channel',
                ErrorTypes.VALIDATION,
                'Tu dois être dans un salon vocal pour lancer une activité.',
                { userId: member.id }
            );
        }

        const channel = member.voice.channel;

        if (!channel.isVoiceBased?.()) {
            throw createError(
                'Invalid channel type',
                ErrorTypes.VALIDATION,
                'Tu dois être dans un salon vocal ou de scène.',
                { channelId: channel.id, channelType: channel.type }
            );
        }

        return {
            channelId: channel.id,
            channelName: channel.name,
            guildId: channel.guildId,
            isValid: true
        };
    }

    





    static async verifyBotPermissions(botMember, voiceChannel) {
        logger.debug(`[VOICE_SERVICE] Verifying bot permissions`, {
            channelId: voiceChannel.id,
            botId: botMember.id
        });

        if (!botMember) {
            throw createError(
                'Bot not found',
                ErrorTypes.VALIDATION,
                'Je ne suis pas présent sur ce serveur.',
                { guildId: voiceChannel.guildId }
            );
        }

        const permissions = voiceChannel.permissionsFor(botMember);

        if (!permissions) {
            throw createError(
                'Cannot check permissions',
                ErrorTypes.VALIDATION,
                'Je ne peux pas déterminer les permissions de ce salon.',
                { channelId: voiceChannel.id }
            );
        }

        const hasCreateInvite = permissions.has(this.REQUIRED_PERMISSION);
        const hasViewChannel = permissions.has(PermissionFlagsBits.ViewChannel);
        const hasConnect = permissions.has(PermissionFlagsBits.Connect);

        if (!hasCreateInvite) {
            logger.warn(`[VOICE_SERVICE] Missing CreateInstantInvite permission`, {
                channelId: voiceChannel.id,
                botId: botMember.id
            });

            throw createError(
                'Missing permission',
                ErrorTypes.VALIDATION,
                'J\'ai besoin de la permission **Créer une invitation** dans ce salon vocal pour lancer une activité.',
                {
                    channelId: voiceChannel.id,
                    missingPermission: 'CreateInstantInvite'
                }
            );
        }

        return {
            channelId: voiceChannel.id,
            hasCreateInvite,
            hasViewChannel,
            hasConnect,
            allRequiredPermissions: hasCreateInvite && hasViewChannel && hasConnect
        };
    }

    




    static async verifyUserPermissions(member) {
        logger.debug(`[VOICE_SERVICE] Verifying user permissions`, { userId: member.id });

        if (!member.voice?.channel) {
            return false;
        }

        const hasConnect = member.permissions.has(PermissionFlagsBits.Connect);
        const hasPermission = member.voice.channel.permissionsFor(member).has(PermissionFlagsBits.Connect);

        return hasConnect && hasPermission;
    }

    







    static async createActivityInvite(client, channelId, activityId, activityName) {
        logger.info(`[VOICE_SERVICE] Creating activity invite`, {
            channelId,
            activityId,
            activityName
        });

        
        const now = Date.now();
        const lastInvite = inviteCreationLimits.get(channelId);

        if (lastInvite && (now - lastInvite) < INVITE_CREATION_COOLDOWN) {
            const remaining = INVITE_CREATION_COOLDOWN - (now - lastInvite);
            logger.warn(`[VOICE_SERVICE] Invite creation rate limited`, {
                channelId,
                remaining
            });

            throw createError(
                'Rate limited',
                ErrorTypes.RATE_LIMIT,
                `Veuillez patienter **${Math.ceil(remaining / 1000)}** secondes avant de créer une autre invitation d'activité.`,
                { remaining, cooldown: INVITE_CREATION_COOLDOWN }
            );
        }

        let lastError = null;

        
        for (let attempt = 1; attempt <= this.INVITE_CREATION_RETRIES; attempt++) {
            try {
                logger.debug(`[VOICE_SERVICE] Invite creation attempt ${attempt}`, {
                    channelId,
                    activityId
                });

                const invite = await client.rest.post(
                    `/channels/${channelId}/invites`,
                    {
                        body: {
                            max_age: INVITE_CONFIG.max_age,
                            target_type: 2, 
                            target_application_id: activityId,
                            temporary: INVITE_CONFIG.temporary,
                            unique: INVITE_CONFIG.unique
                        }
                    }
                );

                
                inviteCreationLimits.set(channelId, now);

                logger.info(`[VOICE_SERVICE] Activity invite created successfully`, {
                    channelId,
                    activityId,
                    activityName,
                    inviteCode: invite.code,
                    attempts: attempt
                });

                return {
                    code: invite.code,
                    url: `https://discord.gg/${invite.code}`,
                    activity: activityName,
                    expiresAt: new Date(now + INVITE_CONFIG.max_age * 1000),
                    createdAt: new Date().toISOString()
                };
            } catch (error) {
                lastError = error;

                if (attempt === this.INVITE_CREATION_RETRIES) {
                    logger.error(`[VOICE_SERVICE] Failed to create invite after ${this.INVITE_CREATION_RETRIES} attempts`, error, {
                        channelId,
                        activityId
                    });
                    break;
                }

                
                await new Promise(resolve => setTimeout(resolve, this.INVITE_CREATION_RETRY_DELAY));
            }
        }

        
        throw createError(
            'Failed to create activity',
            ErrorTypes.DISCORD_API_ERROR,
            `Impossible de créer l'activité **${activityName}**. Réessaie dans un instant.`,
            {
                channelId,
                activityId,
                error: lastError?.message
            }
        );
    }

    






    static async startActivity(client, member, activityType) {
        logger.info(`[VOICE_SERVICE] Starting activity`, {
            userId: member.id,
            activityType,
            guildId: member.guild.id
        });

        
        await this.validateActivityType(activityType);
        const activity = this.getActivityMetadata(activityType.toLowerCase());

        
        const voiceStatus = await this.validateVoiceChannel(member);

        
        const userHasPerms = await this.verifyUserPermissions(member);
        if (!userHasPerms) {
            throw createError(
                'Permission denied',
                ErrorTypes.VALIDATION,
                'Tu n\'as pas la permission de te connecter à ce salon vocal.',
                { channelId: voiceStatus.channelId }
            );
        }

        
        const botMember = member.guild.members.me;
        const channel = member.guild.channels.cache.get(voiceStatus.channelId);
        await this.verifyBotPermissions(botMember, channel);

        
        const invite = await this.createActivityInvite(
            client,
            voiceStatus.channelId,
            activity.id,
            activity.name
        );

        logger.info(`[VOICE_SERVICE] Activity started successfully`, {
            userId: member.id,
            guildId: member.guild.id,
            activityType,
            channelId: voiceStatus.channelId,
            activityName: activity.name,
            inviteCode: invite.code,
            timestamp: invite.createdAt
        });

        return {
            success: true,
            activity: activity.name,
            icon: activity.icon,
            description: activity.description,
            channel: voiceStatus.channelName,
            inviteUrl: invite.url,
            inviteCode: invite.code,
            expiresAt: invite.expiresAt
        };
    }

    



    static getActivitySuggestions() {
        return Object.entries(ACTIVITIES).map(([key, activity]) => ({
            key,
            name: activity.name,
            icon: activity.icon,
            description: activity.description
        }));
    }

    



    static formatActivityList() {
        return Object.entries(ACTIVITIES)
            .map(([key, activity]) => `${activity.icon} **${activity.name}** (\`${key}\`) - ${activity.description}`)
            .join('\n');
    }
}

export default VoiceService;
