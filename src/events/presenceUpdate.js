import { Events } from 'discord.js';
import { logger } from '../utils/logger.js';
import { getServerCounters, updateCounter } from '../services/serverstatsService.js';

const onlineDebounce = new Map();
const ONLINE_DEBOUNCE_MS = 60 * 1000;
const ONLINE_STATUSES = new Set(['online', 'idle', 'dnd']);

export default {
    name: Events.PresenceUpdate,
    async execute(oldPresence, newPresence, client) {
        if (!newPresence?.guild || newPresence.user?.bot) return;

        // Activity/avatar updates also fire PresenceUpdate; only react when the
        // member actually becomes online or goes offline.
        const wasOnline = ONLINE_STATUSES.has(oldPresence?.status);
        const isOnline = ONLINE_STATUSES.has(newPresence.status);
        if (wasOnline === isOnline) return;

        const guild = newPresence.guild;
        const guildId = guild.id;

        const lastRun = onlineDebounce.get(guildId) || 0;
        const now = Date.now();
        if (now - lastRun < ONLINE_DEBOUNCE_MS) return;
        onlineDebounce.set(guildId, now);

        try {
            const counters = await getServerCounters(client, guildId);
            for (const counter of counters) {
                if (counter.type === 'online' && counter.enabled !== false) {
                    await updateCounter(client, guild, counter);
                }
            }
        } catch (error) {
            logger.debug(`Failed to update online counters for guild ${guildId}:`, error.message);
        }
    }
};