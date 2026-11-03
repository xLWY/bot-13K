import { ChannelType, PermissionFlagsBits } from 'discord.js';
import {
    getJoinToCreateConfig, 
    registerTemporaryChannel, 
    unregisterTemporaryChannel,
    getTemporaryChannelInfo,
    updateTemporaryChannelInfo
} from '../utils/database.js';
import { sanitizeInput } from '../utils/sanitization.js';
import { logger } from '../utils/logger.js';
import {
    createControlPanel,
    refreshControlPanel,
    sanitizeChannelName,
    CONTROL_TEXT_PREFIX
} from '../services/tempVoiceService.js';
import { formatChannelName as formatJoinToCreateChannelName } from '../services/joinToCreateService.js';
import { recordVoiceSession } from '../services/statsService.js';
import { Mutex } from '../utils/mutex.js';
import { getServerCounters, updateCounter } from '../services/serverstatsService.js';

const channelCreationCooldown = new Map();
const activeVoiceSessions = new Map();
const voiceCounterDebounce = new Map();
const VOICE_CREATE_COOLDOWN_MS = 2000;
const VOICE_COUNTER_DEBOUNCE_MS = 2 * 60 * 1000;
const EMPTY_CHECK_DELAY_MS = 5000;
const emptyCheckTimers = new Map();
const DEFAULT_VOICE_BITRATE = 64000;
const MAX_VOICE_BITRATE = 384000;
const MIN_VOICE_BITRATE = 8000;
const MAX_CHANNEL_NAME_LENGTH = 100;
const FALLBACK_CHANNEL_NAME = 'Salon vocal';
const MAX_TRACKED_COOLDOWNS = 10000;
const ACTIVE_VOICE_FLUSH_MS = 60000;
let voiceFlushTimer = null;

export default {
    name: 'voiceStateUpdate',
    async execute(oldState, newState, client) {
        let member = newState.member ?? oldState.member;

        // In large guilds the member may not be cached yet. Without this fetch
        // the handler used to throw before Join to Create could do anything.
        if (!member && newState.id) {
            member = await newState.guild.members.fetch(newState.id).catch(() => null);
        }

        if (!member || member.user?.bot) return;

        const guildId = newState.guild.id;
        const userId = member.id;
        const cooldownKey = `${guildId}-${userId}`;
        const channelChanged = (oldState.channelId ?? null) !== (newState.channelId ?? null);

        // Mute/deafen updates are irrelevant for Join to Create and counters.
        if (!channelChanged) return;

        cleanupCooldownEntries();

        await trackVoiceStats(oldState, newState, client, member);
        // Never block channel creation on counter updates (which can wait on
        // the Discord API / rate limits). The service handles throttling.
        void updateVoiceCounters(client, newState.guild);

        try {
            const config = await getJoinToCreateConfig(client, guildId);
            const hasTriggers = config.enabled &&
                Array.isArray(config.triggerChannels) &&
                config.triggerChannels.length > 0;

            if (hasTriggers && !oldState.channel && newState.channel) {
                await handleVoiceJoin(client, newState, config, member);
            }

            if (oldState.channel && !newState.channel) {
                await handleVoiceLeave(client, oldState, config, member);
            }

            if (oldState.channel && newState.channel && oldState.channel.id !== newState.channel.id) {
                await handleVoiceMove(client, oldState, newState, config, member);
            }

        } catch (error) {
            logger.error(`Error in voiceStateUpdate for guild ${guildId}:`, error);
        }

        async function handleVoiceJoin(client, state, config, member) {
            const { channel } = state;

            if (!config.triggerChannels.includes(channel.id)) {
                return;
            }

            const now = Date.now();

            const existingTempChannel = Object.keys(config.temporaryChannels || {}).find(
                tempChannelId => {
                    const tempInfo = config.temporaryChannels[tempChannelId];
                    return tempInfo && tempInfo.ownerId === member.id;
                }
            );

            if (existingTempChannel) {
                const tempChannel = state.guild.channels.cache.get(existingTempChannel);
                if (tempChannel) {
                    try {
                        await member.voice.setChannel(tempChannel);
                        return;
                    } catch (error) {
                        logger.warn(`Impossible de déplacer ${member.user.tag} vers son salon existant :`, error.message);
                    }
                }
            }

            if (channelCreationCooldown.has(cooldownKey)) {
                const lastCreation = channelCreationCooldown.get(cooldownKey);
                if (now - lastCreation < VOICE_CREATE_COOLDOWN_MS) {
                    logger.debug(`Création de salon vocal en cooldown pour ${member.user.tag}`);
                    return;
                }
            }

            if (member.voice.channel?.id !== channel.id) {
                return;
            }

            channelCreationCooldown.set(cooldownKey, now);
            trimCooldownMapIfNeeded();

            await createTemporaryChannel(client, state, config, member);
        }

        async function handleVoiceLeave(client, state, config, member) {
            const { channel } = state;

            const tempChannelInfo = config.temporaryChannels?.[channel.id];

            if (!tempChannelInfo) {
                return;
            }

            const humanMembers = channel.members.filter(
                (channelMember) => channelMember.id !== member.id && !channelMember.user.bot
            );

            if (humanMembers.size === 0) {
                await deleteTemporaryChannel(client, channel, state.guild.id);
            } else if (tempChannelInfo.ownerId === member.id) {
                const nextMember = humanMembers.first();
                if (nextMember) {
                    await transferChannelOwnership(client, channel, state.guild.id, nextMember.id);
                }
            }

            scheduleEmptyCheck(client, channel, state.guild.id);
        }

        function scheduleEmptyCheck(client, channel, guildId) {
            if (emptyCheckTimers.has(channel.id)) return;

            const timer = setTimeout(async () => {
                emptyCheckTimers.delete(channel.id);
                try {
                    const freshChannel = await channel.guild.channels.fetch(channel.id).catch(() => null);
                    if (!freshChannel || freshChannel.type !== ChannelType.GuildVoice) return;

                    const tempInfo = await getTemporaryChannelInfo(client, guildId, freshChannel.id);
                    if (!tempInfo) return;

                    const humanMembers = freshChannel.members.filter((channelMember) => !channelMember.user.bot);
                    if (humanMembers.size === 0) {
                        await deleteTemporaryChannel(client, freshChannel, guildId);
                        logger.info(`Salon vocal temporaire vide supprimé après vérification : ${freshChannel.name}`);
                    }
                } catch (error) {
                    logger.warn(`Scheduled empty check failed for channel ${channel.id}:`, error.message);
                }
            }, EMPTY_CHECK_DELAY_MS);

            emptyCheckTimers.set(channel.id, timer);
        }

        async function handleVoiceMove(client, oldState, newState, config, member) {
            if (oldState.channel) {
                const tempChannelInfo = config.temporaryChannels?.[oldState.channel.id];
                
                if (tempChannelInfo) {
                    const humanMembers = oldState.channel.members.filter(
                        (channelMember) => channelMember.id !== member.id && !channelMember.user.bot
                    );

                    if (humanMembers.size === 0) {
                        await deleteTemporaryChannel(client, oldState.channel, oldState.guild.id);
                    } else if (tempChannelInfo.ownerId === member.id) {
                        const nextMember = humanMembers.first();
                        if (nextMember) {
                            await transferChannelOwnership(client, oldState.channel, oldState.guild.id, nextMember.id);
                        }
                    }
                    scheduleEmptyCheck(client, oldState.channel, oldState.guild.id);
                }
            }

            if (newState.channel && config.triggerChannels.includes(newState.channel.id) &&
                !config.triggerChannels.includes(oldState.channel?.id)) {
                await handleVoiceJoin(client, newState, config, member);
            }
        }

        async function createTemporaryChannel(client, state, config, member) {
            const { channel: triggerChannel, guild } = state;
            let tempChannel = null;

            try {
                const me = guild.members.me;
                if (!me) {
                    logger.warn(`Bot member cache unavailable while creating temporary channel in guild ${guild.id}`);
                    channelCreationCooldown.delete(cooldownKey);
                    return;
                }

                const triggerPermissions = triggerChannel.permissionsFor(me);
                if (!triggerPermissions?.has([PermissionFlagsBits.ManageChannels, PermissionFlagsBits.MoveMembers])) {
                    logger.warn(`Permissions manquantes pour créer un salon temporaire dans le serveur ${guild.name}`);
                    channelCreationCooldown.delete(cooldownKey);
                    await member.send({
                        content: '❌ Le bot n\'a pas les permissions nécessaires pour créer ton salon vocal. Demande à un administrateur de lui donner **Gérer les salons** et **Déplacer des membres**.'
                    }).catch(() => {});
                    return;
                }

                const channelOptions = config.channelOptions?.[triggerChannel.id] || {};
                const nameTemplate = channelOptions.nameTemplate || config.channelNameTemplate || "{username} · Salon";
                
                let userLimit = channelOptions.userLimit ?? config.userLimit ?? 0;
                const bitrate = clampVoiceBitrate(channelOptions.bitrate ?? config.bitrate ?? DEFAULT_VOICE_BITRATE);

                userLimit = Math.max(0, Math.min(99, userLimit || 0));

                logger.info(`Creating temporary channel for user ${member.user.tag} with user limit: ${userLimit}`);

                let channelName;
                try {
                    channelName = sanitizeVoiceChannelName(formatJoinToCreateChannelName(nameTemplate, {
                        username: member.user.username,
                        userTag: member.user.tag,
                        displayName: member.displayName,
                        guildName: guild.name,
                        channelName: triggerChannel.name
                    }));
                } catch (formatError) {
                    logger.warn(`Modèle de nom de salon invalide, utilisation du nom par défaut :`, formatError.message);
                    channelName = sanitizeVoiceChannelName(`${member.user.username} · Salon`);
                }

                if (!member.voice?.channel || member.voice.channel.id !== triggerChannel.id) {
                    logger.debug(`Member ${member.user.tag} no longer in trigger channel, aborting temporary channel creation`);
                    channelCreationCooldown.delete(cooldownKey);
                    return;
                }

                tempChannel = await guild.channels.create({
                    name: channelName,
                    type: ChannelType.GuildVoice,
                    parent: triggerChannel.parentId,
                    userLimit: userLimit === 0 ? undefined : userLimit,
                    bitrate: bitrate,
                    permissionOverwrites: [
                        {
                            id: member.id,
                            allow: ['ViewChannel', 'Connect', 'Speak', 'PrioritySpeaker', 'MoveMembers']
                        },
                        {
                            id: guild.id,
                            allow: ['Connect', 'Speak']
                        }
                    ]
                });

                const registered = await registerTemporaryChannel(client, guild.id, tempChannel.id, member.id, triggerChannel.id);
                if (!registered) {
                    throw new Error('Impossible d\'enregistrer le salon temporaire en base de données');
                }

                if (!member.voice?.channel || member.voice.channel.id !== triggerChannel.id) {
                    logger.debug(`Membre parti avant le déplacement, suppression du salon temporaire ${tempChannel.id}`);
                    await unregisterTemporaryChannel(client, guild.id, tempChannel.id).catch(() => {});
                    await tempChannel.delete('Membre parti avant le déplacement').catch(() => {});
                    tempChannel = null;
                    channelCreationCooldown.delete(cooldownKey);
                    return;
                }

                await member.voice.setChannel(tempChannel);

                logger.info(`Salon vocal temporaire créé : ${tempChannel.name} pour ${member.user.tag}`);

                // The panel is created after the move: a slow or failing panel
                // must never prevent the member from getting their channel.
                createControlPanel(client, guild, tempChannel).catch((error) => {
                    logger.warn(`Impossible de créer le panneau de contrôle du salon ${tempChannel.id} :`, error.message);
                });

            } catch (error) {
                logger.error(`Échec de la création d'un salon temporaire pour ${member.user.tag} :`, error);
                
                channelCreationCooldown.delete(cooldownKey);

                if (tempChannel) {
                    await unregisterTemporaryChannel(client, guild.id, tempChannel.id).catch(() => {});
                    await tempChannel.delete('Échec de la création du salon temporaire').catch(() => {});
                }
                
                try {
                    await member.send({
                        content: `❌ Impossible de créer votre salon vocal temporaire. Contactez un administrateur du serveur.`
                    });
                } catch (dmError) {
                    logger.debug(`Unable to send temporary channel failure DM to user ${member.user.tag}:`, dmError.message);
                }
            }
        }

        async function deleteTemporaryChannel(client, channel, guildId) {
            try {
                const tempInfo = await getTemporaryChannelInfo(client, guildId, channel.id);

                if (tempInfo?.textChannelId && tempInfo.textChannelId !== channel.id) {
                    const textChannel = await channel.guild.channels
                        .fetch(tempInfo.textChannelId)
                        .catch(() => null);
                    if (textChannel) {
                        await textChannel.delete('Salon temporaire vide - suppression du salon textuel lié').catch(() => {});
                    }
                }

                await unregisterTemporaryChannel(client, guildId, channel.id);

                await channel.delete('Salon vocal temporaire vide');

                logger.info(`Salon vocal temporaire supprimé : ${channel.name}`);

            } catch (error) {
                logger.error(`Impossible de supprimer le salon temporaire ${channel.name} :`, error.message);
            }
        }

        async function transferChannelOwnership(client, channel, guildId, newOwnerId) {
            try {
                const config = await getJoinToCreateConfig(client, guildId);
                const tempChannelInfo = config.temporaryChannels[channel.id];
                
                if (!tempChannelInfo) return;

                const updated = await updateTemporaryChannelInfo(client, guildId, channel.id, {
                    ownerId: newOwnerId
                });
                if (!updated) return;

                const newOwner = await channel.guild.members.fetch(newOwnerId).catch(() => null);
                if (newOwner) {
                    const channelOptions = config.channelOptions?.[tempChannelInfo.triggerChannelId] || {};
                    const nameTemplate = channelOptions.nameTemplate || config.channelNameTemplate || '{username} · Salon';

                    let newChannelName;
                    try {
                        newChannelName = sanitizeVoiceChannelName(formatJoinToCreateChannelName(nameTemplate, {
                            username: newOwner.user.username,
                            userTag: newOwner.user.tag,
                            displayName: newOwner.displayName,
                            guildName: channel.guild.name,
                            channelName: channel.guild.channels.cache.get(tempChannelInfo.triggerChannelId)?.name || 'Salon vocal'
                        }));
                    } catch (formatError) {
                        logger.warn('Modèle de nom de salon invalide lors du transfert, utilisation du nom par défaut :', formatError.message);
                        newChannelName = sanitizeVoiceChannelName(`${newOwner.user.username} · Salon`);
                    }

                    await channel.setName(newChannelName);

                    if (tempChannelInfo?.textChannelId && tempChannelInfo.textChannelId !== channel.id) {
                        const textChannel = await channel.guild.channels
                            .fetch(tempChannelInfo.textChannelId)
                            .catch(() => null);
                        if (textChannel) {
                            await textChannel.setName(
                                sanitizeChannelName(`${CONTROL_TEXT_PREFIX}${newChannelName}`, 'Salon vocal')
                            ).catch(() => {});
                        }
                    }

                    await refreshControlPanel(client, channel.guild, channel.id, {
                        ...tempChannelInfo,
                        ownerId: newOwnerId
                    });
                }

                logger.info(`Propriété du salon temporaire transférée à ${newOwner?.user?.tag ?? 'un membre'}`);

            } catch (error) {
                logger.error(`Failed to transfer ownership of channel ${channel.id}:`, error);
            }
        }
    }
};

function sanitizeVoiceChannelName(inputName) {
    const safeName = sanitizeInput(String(inputName || ''), MAX_CHANNEL_NAME_LENGTH)
        .replace(/[\r\n\t]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

    return safeName || FALLBACK_CHANNEL_NAME;
}

function clampVoiceBitrate(value) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
        return DEFAULT_VOICE_BITRATE;
    }

    return Math.max(MIN_VOICE_BITRATE, Math.min(MAX_VOICE_BITRATE, Math.floor(parsed)));
}

function cleanupCooldownEntries() {
    const now = Date.now();
    for (const [key, timestamp] of channelCreationCooldown.entries()) {
        if (now - timestamp >= VOICE_CREATE_COOLDOWN_MS) {
            channelCreationCooldown.delete(key);
        }
    }
}

function trimCooldownMapIfNeeded() {
    if (channelCreationCooldown.size <= MAX_TRACKED_COOLDOWNS) {
        return;
    }

    const entries = [...channelCreationCooldown.entries()].sort((a, b) => a[1] - b[1]);
    const removeCount = channelCreationCooldown.size - MAX_TRACKED_COOLDOWNS;
    for (let index = 0; index < removeCount; index += 1) {
        channelCreationCooldown.delete(entries[index][0]);
    }
}

async function trackVoiceStats(oldState, newState, client, member) {
    try {
        const guildId = newState.guild?.id || oldState.guild?.id;
        if (!guildId) return;

        const userId = member?.id;
        if (!userId) return;

        const sessionKey = `${guildId}:${userId}`;
        const joined = Boolean(newState.channel);
        const wasJoined = Boolean(oldState.channel);

        if (joined && !wasJoined) {
            if (!activeVoiceSessions.has(sessionKey)) {
                activeVoiceSessions.set(sessionKey, { joinedAt: Date.now() });
            }
            return;
        }

        if (!joined && wasJoined) {
            await closeVoiceSession(client, sessionKey);
        }
    } catch (error) {
        logger.warn('Error tracking voice stats session:', error.message);
    }
}

async function updateVoiceCounters(client, guild) {
    const guildId = guild.id;
    const lastRun = voiceCounterDebounce.get(guildId) || 0;
    const now = Date.now();
    if (now - lastRun < VOICE_COUNTER_DEBOUNCE_MS) return;
    voiceCounterDebounce.set(guildId, now);

    try {
        const counters = await getServerCounters(client, guildId);
        for (const counter of counters) {
            if (counter.type === 'voice' && counter.enabled !== false) {
                await updateCounter(client, guild, counter);
            }
        }
    } catch (error) {
        logger.debug(`Failed to update voice counters for guild ${guildId}:`, error.message);
    }
}

export function seedActiveVoiceSessions(client) {
    let seeded = 0;
    for (const guild of client.guilds.cache.values()) {
        for (const state of guild.voiceStates.cache.values()) {
            if (!state.channelId) continue;
            const member = state.member;
            if (!member || member.user.bot) continue;
            const sessionKey = `${guild.id}:${state.id}`;
            if (!activeVoiceSessions.has(sessionKey)) {
                activeVoiceSessions.set(sessionKey, { joinedAt: Date.now() });
                seeded += 1;
            }
        }
    }
    if (seeded > 0) {
        logger.info(`Seeded ${seeded} active voice session(s) from voice states on startup`);
    }
    if (!voiceFlushTimer) {
        voiceFlushTimer = setInterval(() => {
            flushAllVoiceSessions(client);
        }, ACTIVE_VOICE_FLUSH_MS);
        if (voiceFlushTimer.unref) voiceFlushTimer.unref();
        logger.info('Started active voice stats flusher');
    }
    return seeded;
}

async function closeVoiceSession(client, sessionKey) {
    try {
        const [guildId, userId] = sessionKey.split(':');
        await Mutex.runExclusive(`voice:${sessionKey}`, async () => {
            const session = activeVoiceSessions.get(sessionKey);
            if (!session) return;
            activeVoiceSessions.delete(sessionKey);
            const elapsedSec = Math.floor((Date.now() - session.joinedAt) / 1000);
            if (elapsedSec > 0) {
                await recordVoiceSession(client, guildId, userId, elapsedSec);
            }
        });
    } catch (error) {
        logger.warn('Error closing voice session:', error.message);
    }
}

async function flushAllVoiceSessions(client) {
    const keys = [...activeVoiceSessions.keys()];
    await Promise.all(keys.map((key) => flushVoiceSession(client, key)));
}

async function flushVoiceSession(client, sessionKey) {
    try {
        const [guildId, userId] = sessionKey.split(':');
        await Mutex.runExclusive(`voice:${sessionKey}`, async () => {
            const session = activeVoiceSessions.get(sessionKey);
            if (!session) return;
            const now = Date.now();
            const elapsedSec = Math.floor((now - session.joinedAt) / 1000);
            session.joinedAt = now;
            if (elapsedSec > 0) {
                await recordVoiceSession(client, guildId, userId, elapsedSec);
            }
        });
    } catch (error) {
        logger.warn('Error flushing voice session:', error.message);
    }
}



