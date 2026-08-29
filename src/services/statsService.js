import { logger } from '../utils/logger.js';
import { Mutex } from '../utils/mutex.js';

export const getStatsStorageKey = (guildId) => `guild:${guildId}:stats`;

function emptyGuildStats() {
    return {
        startedAt: Date.now(),
        users: {}
    };
}

function parseGuildStats(raw) {
    if (raw && typeof raw === 'object' && raw.users && typeof raw.users === 'object') {
        return {
            startedAt: Number.isFinite(raw.startedAt) ? raw.startedAt : Date.now(),
            users: raw.users
        };
    }
    return emptyGuildStats();
}

async function getGuildStats(client, guildId) {
    if (!client?.db) return null;
    try {
        const raw = await client.db.get(getStatsStorageKey(guildId));
        return parseGuildStats(raw);
    } catch (error) {
        logger.error(`Error reading stats for guild ${guildId}:`, error);
        return null;
    }
}

async function saveGuildStats(client, guildId, stats) {
    if (!client?.db) return;
    try {
        await client.db.set(getStatsStorageKey(guildId), stats);
    } catch (error) {
        logger.error(`Error saving stats for guild ${guildId}:`, error);
    }
}

function ensureUser(stats, userId) {
    if (!stats.users[userId]) {
        stats.users[userId] = { messages: 0, voiceSeconds: 0, channels: {} };
    }
    return stats.users[userId];
}

/**
 * Records one guild message for the given user/channel.
 * @param {import('discord.js').Client} client
 * @param {string} guildId
 * @param {string} userId
 * @param {string} channelId
 */
export async function recordMessage(client, guildId, userId, channelId) {
    if (!client?.db || !guildId || !userId || !channelId) return;
    await Mutex.runExclusive(`stats:${guildId}`, async () => {
        const stats = await getGuildStats(client, guildId);
        if (!stats) return;
        const user = ensureUser(stats, userId);
        user.messages += 1;
        user.channels[channelId] = (user.channels[channelId] || 0) + 1;
        await saveGuildStats(client, guildId, stats);
    });
}

/**
 * Adds voice time (in seconds) for a user.
 * @param {import('discord.js').Client} client
 * @param {string} guildId
 * @param {string} userId
 * @param {number} seconds
 */
export async function recordVoiceSession(client, guildId, userId, seconds) {
    if (!client?.db || !guildId || !userId) return;
    const wholeSeconds = Math.floor(Number(seconds) || 0);
    if (wholeSeconds <= 0) return;
    await Mutex.runExclusive(`stats:${guildId}`, async () => {
        const stats = await getGuildStats(client, guildId);
        if (!stats) return;
        const user = ensureUser(stats, userId);
        user.voiceSeconds += wholeSeconds;
        await saveGuildStats(client, guildId, stats);
    });
}

function normalizeUserRecord(data) {
    return {
        messages: Math.max(0, data.messages || 0),
        voiceSeconds: Math.max(0, data.voiceSeconds || 0),
        channels: data.channels || {}
    };
}

/**
 * Returns the whole guild stats summary (message/voice totals per user).
 * @param {import('discord.js').Client} client
 * @param {string} guildId
 */
export async function getGuildStatsSummary(client, guildId) {
    const stats = await getGuildStats(client, guildId);
    if (!stats) return { users: [], startedAt: Date.now() };

    const users = Object.entries(stats.users || {})
        .map(([userId, data]) => ({
            userId,
            ...normalizeUserRecord(data)
        }))
        .filter((u) => u.messages > 0 || u.voiceSeconds > 0);

    return { users, startedAt: stats.startedAt };
}

/**
 * Returns the record for a single user, or null if no activity.
 * @param {Array} users Summary list from getGuildStatsSummary
 * @param {string} userId
 */
export function getUserStatsRecord(users, userId) {
    return users.find((u) => u.userId === userId) || null;
}

/**
 * 1-based rank of a user for a given field ("messages" | "voiceSeconds"),
 * 0 when the user is not tracked.
 */
export function getUserRank(users, userId, field) {
    const sorted = [...users].sort((a, b) => b[field] - a[field]);
    const index = sorted.findIndex((u) => u.userId === userId);
    return index === -1 ? 0 : index + 1;
}

/**
 * Formats a duration in French, e.g. "12 h 34 min" or "45 min".
 * @param {number} totalSeconds
 */
export function formatVoiceDuration(totalSeconds) {
    const seconds = Math.max(0, Math.floor(Number(totalSeconds) || 0));
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    if (hours > 0) {
        return `${hours} h ${minutes.toString().padStart(2, '0')} min`;
    }
    return `${minutes} min`;
}