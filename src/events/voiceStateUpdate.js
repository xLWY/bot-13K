import { ChannelType, PermissionFlagsBits } from 'discord.js';
import {
    getJoinToCreateConfig, 
    registerTemporaryChannel, 
    unregisterTemporaryChannel,
    getTemporaryChannelInfo,
    formatChannelName
} from '../utils/database.js';
import { sanitizeInput } from '../utils/sanitization.js';
import { logger } from '../utils/logger.js';
import {
    createControlPanel,
    refreshControlPanel,
    sanitizeChannelName,
    CONTROL_TEXT_PREFIX
} from '../services/tempVoiceService.js';
import { recordVoiceSession } from '../services/statsService.js';
import { Mutex } from '../utils/mutex.js';
import { getServerCounters, updateCounter } from '../services/serverstatsService.js';

const channelCreationCooldown = new Map();
const activeVoiceSessions = new Map();
const voiceCounterDebounce = new Map();
const VOICE_CREATE_COOLDOWN_MS = 2000;
const VOICE_COUNTER_DEBOUNCE_MS = 30000;
const DEFAULT_VOICE_BITRATE = 64000;
const MAX_VOICE_BITRATE = 384000;
const MIN_VOICE_BITRATE = 8000;
const MAX_CHANNEL_NAME_LENGTH = 100;
const FALLBACK_CHANNEL_NAME = 'Voice Room';
const MAX_TRACKED_COOLDOWNS = 10000;
const ACTIVE_VOICE_FLUSH_MS = 60000;
let voiceFlushTimer = null;

export default {
    name: 'voiceStateUpdate',
    async execute(oldState, newState, client) {
        if (newState.member.user.bot) return;

        const guildId = newState.guild.id;
        const userId = newState.member.id;
        const cooldownKey = `${guildId}-${userId}`;
        cleanupCooldownEntries();

        await trackVoiceStats(oldState, newState, client);
        await updateVoiceCounters(client, newState.guild);

        try {
            const config = await getJoinToCreateConfig(client, guildId);

            if (!config.enabled || config.triggerChannels.length === 0) {
                return;
            }

            if (!oldState.channel && newState.channel) {
                await handleVoiceJoin(client, newState, config);
            }

            if (oldState.channel && !newState.channel) {
                await handleVoiceLeave(client, oldState, config);
            }

            if (oldState.channel && newState.channel && oldState.channel.id !== newState.channel.id) {
                await handleVoiceMove(client, oldState, newState, config);
            }

        } catch (error) {
            logger.error(`Error in voiceStateUpdate for guild ${guildId}:`, error);
        }

        async function handleVoiceJoin(client, state, config) {
            const { channel, member } = state;

            if (!config.triggerChannels.includes(channel.id)) {
                return;
            }

            const now = Date.now();
            if (channelCreationCooldown.has(cooldownKey)) {
                const lastCreation = channelCreationCooldown.get(cooldownKey);
if (now - lastCreation < VOICE_CREATE_COOLDOWN_MS) {
                    logger.warn(`User ${member.id} is on cooldown for channel creation`);
                    return;
                }
            }

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
                        logger.warn(`Failed to move user ${member.id} to existing channel ${existingTempChannel}:`, error);
                    }
                }
            }

            if (member.voice.channel?.id !== channel.id) {
                return;
            }

            channelCreationCooldown.set(cooldownKey, now);
            trimCooldownMapIfNeeded();

            await createTemporaryChannel(client, state, config);
        }

        async function handleVoiceLeave(client, state, config) {
            const { channel, member } = state;

            const tempChannelInfo = await getTemporaryChannelInfo(client, state.guild.id, channel.id);
            
            if (!tempChannelInfo) {
                return;
            }

            if (channel.members.size === 0) {
                await deleteTemporaryChannel(client, channel, state.guild.id);
            } else if (tempChannelInfo.ownerId === member.id) {
                const nextMember = channel.members.first();
                if (nextMember) {
                    await transferChannelOwnership(client, channel, state.guild.id, nextMember.id);
                }
            }
        }

        async function handleVoiceMove(client, oldState, newState, config) {
            if (oldState.channel) {
                const tempChannelInfo = await getTemporaryChannelInfo(client, oldState.guild.id, oldState.channel.id);
                
                if (tempChannelInfo) {
                    if (oldState.channel.members.size === 0) {
                        await deleteTemporaryChannel(client, oldState.channel, oldState.guild.id);
                    } else if (tempChannelInfo.ownerId === oldState.member.id) {
                        const nextMember = oldState.channel.members.first();
                        if (nextMember) {
                            await transferChannelOwnership(client, oldState.channel, oldState.guild.id, nextMember.id);
                        }
                    }
                }
            }

            if (config.triggerChannels.includes(newState.channel.id) && 
                !config.triggerChannels.includes(oldState.channel?.id)) {
                await handleVoiceJoin(client, newState, config);
            }
        }

        async function createTemporaryChannel(client, state, config) {
            const { channel: triggerChannel, member, guild } = state;

            try {
                const me = guild.members.me;
                if (!me) {
                    logger.warn(`Bot member cache unavailable while creating temporary channel in guild ${guild.id}`);
                    channelCreationCooldown.delete(cooldownKey);
                    return;
                }

                const triggerPermissions = triggerChannel.permissionsFor(me);
                if (!triggerPermissions?.has([PermissionFlagsBits.ManageChannels, PermissionFlagsBits.MoveMembers, PermissionFlagsBits.Connect])) {
                    logger.warn(`Missing required permissions for temporary channel creation in guild ${guild.id} (trigger channel ${triggerChannel.id})`);
                    channelCreationCooldown.delete(cooldownKey);
                    return;
                }

                const channelOptions = config.channelOptions?.[triggerChannel.id] || {};
                const nameTemplate = channelOptions.nameTemplate || config.channelNameTemplate || "{username} · Salon";
                
                let userLimit = channelOptions.userLimit ?? config.userLimit ?? 0;
                const bitrate = clampVoiceBitrate(channelOptions.bitrate ?? config.bitrate ?? DEFAULT_VOICE_BITRATE);

                userLimit = Math.max(0, Math.min(99, userLimit || 0));

                logger.info(`Creating temporary channel for user ${member.id} with user limit: ${userLimit}`);

                const channelName = sanitizeVoiceChannelName(formatChannelName(nameTemplate, {
                    username: member.user.username,
                    userTag: member.user.tag,
                    displayName: member.displayName,
                    guildName: guild.name,
                    channelName: triggerChannel.name
                }));

                if (!member.voice?.channel || member.voice.channel.id !== triggerChannel.id) {
                    logger.debug(`Member ${member.id} no longer in trigger channel ${triggerChannel.id}, aborting temporary channel creation`);
                    channelCreationCooldown.delete(cooldownKey);
                    return;
                }

                const tempChannel = await guild.channels.create({
                    name: channelName,
type: ChannelType.GuildVoice,
                    parent: triggerChannel.parentId,
userLimit: userLimit === 0 ? undefined : userLimit,
                    bitrate: bitrate,
                    permissionOverwrites: [
                        {
                            id: member.id,
                            allow: ['Connect', 'Speak', 'PrioritySpeaker', 'MoveMembers']
                        },
                        {
                            id: guild.id,
                            allow: ['Connect', 'Speak']
                        }
                    ]
                });

                await registerTemporaryChannel(client, guild.id, tempChannel.id, member.id, triggerChannel.id);

                await createControlPanel(client, guild, tempChannel);

                if (member.voice?.channel?.id === triggerChannel.id) {
                    await member.voice.setChannel(tempChannel);
                } else {
                    logger.debug(`Skipped moving ${member.id} to temporary channel ${tempChannel.id} because voice state changed`);
                }

                logger.info(`Created temporary voice channel ${tempChannel.name} (${tempChannel.id}) for user ${member.user.tag} in guild ${guild.name} with user limit ${userLimit}`);

            } catch (error) {
                logger.error(`Failed to create temporary channel for user ${member.user.tag} in guild ${guild.name}:`, error);
                
                channelCreationCooldown.delete(cooldownKey);
                
                try {
                    await member.send({
                        content: `❌ Impossible de créer votre salon vocal temporaire. Contactez un administrateur du serveur.`
                    });
                } catch (dmError) {
                    logger.debug(`Unable to send temporary channel failure DM to user ${member.id}:`, dmError);
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
                        await textChannel.delete('Salon temporaire vide - suppression du salon textuel lie').catch(() => {});
                    }
                }

                await unregisterTemporaryChannel(client, guildId, channel.id);

                await channel.delete('Temporary voice channel - empty');

                logger.info(`Deleted temporary voice channel ${channel.name} (${channel.id}) in guild ${channel.guild.name}`);

            } catch (error) {
                logger.error(`Failed to delete temporary channel ${channel.id}:`, error);
            }
        }

        async function transferChannelOwnership(client, channel, guildId, newOwnerId) {
            try {
                const config = await getJoinToCreateConfig(client, guildId);
                const tempChannelInfo = config.temporaryChannels[channel.id];
                
                if (!tempChannelInfo) return;

                config.temporaryChannels[channel.id].ownerId = newOwnerId;
                await client.db.set(`guild:${guildId}:jointocreate`, config);

                const newOwner = await channel.guild.members.fetch(newOwnerId);
                if (newOwner) {
                    const channelOptions = config.channelOptions?.[tempChannelInfo.triggerChannelId] || {};
                    const nameTemplate = channelOptions.nameTemplate || config.channelNameTemplate;
                    
                    const newChannelName = sanitizeVoiceChannelName(formatChannelName(nameTemplate, {
                        username: newOwner.user.username,
                        userTag: newOwner.user.tag,
                        displayName: newOwner.displayName,
                        guildName: channel.guild.name,
                        channelName: channel.guild.channels.cache.get(tempChannelInfo.triggerChannelId)?.name || 'Voice Channel'
                    }));

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

                    await refreshControlPanel(client, channel.guild, channel.id, tempChannelInfo);
                }

                logger.info(`Transferred ownership of temporary channel ${channel.id} to user ${newOwnerId}`);

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

async function trackVoiceStats(oldState, newState, client) {
    try {
        const guildId = newState.guild?.id || oldState.guild?.id;
        if (!guildId) return;

        const userId = (newState.member || oldState.member)?.id;
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



