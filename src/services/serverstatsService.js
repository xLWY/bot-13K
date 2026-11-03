import { PermissionFlagsBits } from 'discord.js';
import { logger } from '../utils/logger.js';
import { logEvent, EVENT_TYPES } from './loggingService.js';

export const COUNTER_TYPE_CONFIG = {
  members: {
    label: 'Membres + bots',
    baseName: 'Membres',
    emoji: '👥'
  },
  members_only: {
    label: 'Membres uniquement',
    baseName: 'Membres',
    emoji: '👤'
  },
  bots: {
    label: 'Bots uniquement',
    baseName: 'Bots',
    emoji: '🤖'
  },
  online: {
    label: 'Membres en ligne',
    baseName: 'En ligne',
    emoji: '🌐'
  },
  voice: {
    label: 'Membres en vocal',
    baseName: 'Vocal',
    emoji: '🔊'
  }
};

function getCounterConfig(type) {
  return COUNTER_TYPE_CONFIG[type] || {
    label: 'Inconnu',
    baseName: 'Compteur',
    emoji: '❓'
  };
}

export function getCounterTypeLabel(type) {
  return getCounterConfig(type).label;
}

export function getCounterBaseName(type) {
  return getCounterConfig(type).baseName;
}

export function getCounterEmoji(type) {
  return getCounterConfig(type).emoji;
}

const memberFetchAt = new Map();
const MEMBER_FETCH_MIN_INTERVAL_MS = 10 * 60 * 1000;

export async function getGuildCounterStats(guild) {
  let memberCollection = guild.members.cache;
  const expectedMembers = typeof guild.memberCount === 'number' ? guild.memberCount : 0;
  const lastFetch = memberFetchAt.get(guild.id) ?? 0;

  // A partially filled member cache gives a wrong bot count, so refresh it
  // when possible — but never more than once every 10 minutes per guild.
  const needsMemberFetch =
    memberCollection.size === 0 ||
    (expectedMembers > 0 && memberCollection.size < expectedMembers);

  if (needsMemberFetch && Date.now() - lastFetch >= MEMBER_FETCH_MIN_INTERVAL_MS) {
    memberFetchAt.set(guild.id, Date.now());
    try {
      memberCollection = await guild.members.fetch();
    } catch (error) {
      if (process.env.NODE_ENV !== 'production') {
        logger.debug(`Failed to fetch all guild members for ${guild.id}, using cache only`, error);
      }
    }
  }

  const botCount = memberCollection.filter((member) => member.user.bot).size;
  const totalCount = typeof guild.memberCount === 'number' ? guild.memberCount : memberCollection.size;
  const humanCount = Math.max(totalCount - botCount, 0);

  const memberBasedOnline = memberCollection.filter((member) =>
    !member.user.bot && ['online', 'idle', 'dnd'].includes(member.presence?.status)
  ).size;

  const presenceBasedOnline = guild.presences.cache.filter((presence) => {
    if (!['online', 'idle', 'dnd'].includes(presence.status)) return false;
    const isBot = presence.user?.bot ?? guild.client.users.cache.get(presence.userId)?.bot ?? false;
    return !isBot;
  }).size;

  // The presence cache is authoritative when it has data; the member cache is
  // only a fallback (e.g. right after a restart).
  const onlineCount = guild.presences.cache.size > 0
    ? presenceBasedOnline
    : memberBasedOnline;

  const voiceCount = guild.voiceStates?.cache
    ? guild.voiceStates.cache.filter((state) => {
        if (!state.channelId) return false;
        const isBot = state.member?.user?.bot ?? guild.client.users.cache.get(state.id)?.bot ?? false;
        return !isBot;
      }).size
    : 0;

  return {
    totalCount,
    botCount,
    humanCount,
    onlineCount,
    voiceCount,
    presenceCacheSize: guild.presences.cache.size
  };
}

export async function getCounterCount(guild, type, stats) {
  const resolvedStats = stats || await getGuildCounterStats(guild);

  switch (type) {
    case 'members':
      return resolvedStats.totalCount;
    case 'bots':
      return resolvedStats.botCount;
    case 'members_only':
      return resolvedStats.humanCount;
    case 'online':
      return resolvedStats.onlineCount;
    case 'voice':
      return resolvedStats.voiceCount;
    default:
      return null;
  }
}


function isValidCounterShape(counter) {
  if (!counter || typeof counter !== 'object') {
    return false;
  }

  const hasId = (typeof counter.id === 'string' || typeof counter.id === 'number') &&
    String(counter.id).length > 0;
  const hasChannelId = (typeof counter.channelId === 'string' || typeof counter.channelId === 'number') &&
    String(counter.channelId).length > 0;

  return Boolean(
    hasId &&
    typeof counter.type === 'string' &&
    hasChannelId
  );
}

function normalizeCounter(counter, guildId) {
  const normalized = {
    id: String(counter.id),
    type: String(counter.type),
    channelId: String(counter.channelId),
    guildId: String(counter.guildId || guildId),
    createdAt: counter.createdAt || new Date().toISOString(),
    enabled: typeof counter.enabled === 'boolean' ? counter.enabled : true
  };

  if (counter.updatedAt) {
    normalized.updatedAt = counter.updatedAt;
  }

  return normalized;
}

function sanitizeCounters(counters, guildId) {
  if (!Array.isArray(counters)) {
    return [];
  }

  return counters
    .filter(isValidCounterShape)
    .map(counter => normalizeCounter(counter, guildId));
}








export async function resolveCounterChannel(guild, channelId) {
  if (!guild || !channelId) {
    return null;
  }

  const cached = guild.channels.cache.get(channelId);
  if (cached) {
    return cached;
  }

  try {
    return await guild.channels.fetch(channelId);
  } catch (error) {
    logger.debug(`Could not fetch channel ${channelId}:`, error.message);
    return null;
  }
}

// Discord only allows 2 channel renames per 10 minutes per channel. Renaming on
// every presence/voice change therefore ends in 429 errors and stale names.
// Updates are queued per channel and applied at most once every 6 minutes
// (well under the limit), always with the latest value.
const COUNTER_MIN_RENAME_INTERVAL_MS = 6 * 60 * 1000;
const COUNTER_ERROR_BACKOFF_MS = 15 * 60 * 1000;
const COUNTER_FAILURE_LOG_INTERVAL_MS = 10 * 60 * 1000;
const counterRuntimes = new Map();

function getCounterRuntime(guildId, channelId) {
  const key = `${guildId}:${channelId}`;
  let runtime = counterRuntimes.get(key);
  if (!runtime) {
    runtime = {
      key,
      timer: null,
      inFlight: false,
      pending: null,
      nextAllowedAt: 0,
      lastFailureLogAt: 0
    };
    counterRuntimes.set(key, runtime);
  }
  return runtime;
}

function getCounterRetryDelay(error) {
  const retryAfter = error?.retryAfter ?? error?.rawError?.retry_after ?? error?.data?.retry_after;
  if (typeof retryAfter === 'number' && Number.isFinite(retryAfter)) {
    return Math.max(retryAfter * 1000, 1000);
  }
  return COUNTER_ERROR_BACKOFF_MS;
}

function scheduleCounterFlush(runtime, delayMs) {
  if (runtime.timer) {
    clearTimeout(runtime.timer);
  }
  runtime.timer = setTimeout(() => {
    runtime.timer = null;
    void flushCounter(runtime);
  }, Math.max(delayMs, 1000));
  if (typeof runtime.timer.unref === 'function') {
    runtime.timer.unref();
  }
}

async function flushCounter(runtime) {
  if (runtime.inFlight) return;
  const pending = runtime.pending;
  if (!pending) return;
  runtime.pending = null;
  await updateCounter(pending.client, pending.guild, pending.counter);
}

function queueCounterRename(client, guild, counter, runtime, channel, newName, count) {
  const workItem = { client, guild, counter };
  runtime.pending = workItem;

  if (runtime.inFlight) return true;

  const now = Date.now();
  if (now < runtime.nextAllowedAt) {
    scheduleCounterFlush(runtime, runtime.nextAllowedAt - now);
    return true;
  }

  runtime.inFlight = true;
  return performCounterRename(runtime, channel, workItem, newName, count);
}

async function performCounterRename(runtime, channel, workItem, newName, count) {
  const { client, guild, counter } = workItem;
  const previousName = channel.name;

  try {
    await channel.setName(newName, 'Mise à jour du compteur');
    runtime.nextAllowedAt = Date.now() + COUNTER_MIN_RENAME_INTERVAL_MS;

    if (runtime.pending === workItem) {
      runtime.pending = null;
    }

    if (process.env.NODE_ENV !== 'production') {
      logger.debug(`Updated channel name to: "${newName}"`);
    }

    // Counter renames happen on every presence/voice change. Only log them
    // when explicitly requested (LOG_COUNTER_UPDATES=true) to avoid spam.
    if (process.env.LOG_COUNTER_UPDATES === 'true') {
      try {
        await logEvent({
          client,
          guildId: guild.id,
          eventType: EVENT_TYPES.COUNTER_UPDATE,
          data: {
            description: `Compteur **${getCounterTypeLabel(counter.type)}** mis à jour dans ${channel.toString()}`,
            channelId: channel.id,
            fields: [
              {
                name: '📊 Compteur',
                value: `${getCounterEmoji(counter.type)} ${getCounterTypeLabel(counter.type)}`,
                inline: true
              },
              {
                name: '🔢 Nouvelle valeur',
                value: String(count),
                inline: true
              },
              {
                name: '📍 Salon',
                value: channel.toString(),
                inline: true
              },
              {
                name: '🔄 Ancien nom',
                value: `\`${previousName}\``,
                inline: false
              },
              {
                name: '🆕 Nouveau nom',
                value: `\`${newName}\``,
                inline: false
              }
            ]
          }
        });
      } catch (logError) {
        logger.debug('Failed to log counter update:', logError.message);
      }
    }

    return true;
  } catch (error) {
    const delay = getCounterRetryDelay(error);
    runtime.nextAllowedAt = Date.now() + delay;
    if (!runtime.pending) {
      runtime.pending = workItem;
    }

    const now = Date.now();
    if (now - runtime.lastFailureLogAt >= COUNTER_FAILURE_LOG_INTERVAL_MS) {
      runtime.lastFailureLogAt = now;
      logger.warn(
        `Renommage du compteur ${counter.type} impossible dans #${channel.name} ` +
        `(nouvelle tentative dans ${Math.round(delay / 60000)} min) : ${error.message}`
      );
    }

    return false;
  } finally {
    runtime.inFlight = false;
    if (runtime.pending) {
      const delay = Math.max(runtime.nextAllowedAt - Date.now(), 1000);
      scheduleCounterFlush(runtime, delay);
    }
  }
}

export async function updateCounter(client, guild, counter, stats) {
  try {
    if (!counter || !counter.type || !counter.channelId) {
      logger.warn('Skipping invalid counter in updateCounter:', counter);
      return false;
    }
    
    const { type, channelId } = counter;
    const channel = await resolveCounterChannel(guild, channelId);
    if (!channel) {
        logger.error('Salon du compteur introuvable');
        return false;
    }

    const count = await getCounterCount(guild, type, stats);
    if (count === null) {
      logger.error('Unknown counter type:', type);
      return false;
    }

    if (channel.isVoiceBased && channel.isVoiceBased()) {
      const currentOverwrite = channel.permissionOverwrites.cache.get(guild.id);
      const alreadyUnjoinable = Boolean(
        currentOverwrite &&
        currentOverwrite.allow.has(PermissionFlagsBits.ViewChannel) &&
        currentOverwrite.deny.has(PermissionFlagsBits.Connect)
      );
      if (!alreadyUnjoinable) {
        try {
          await channel.permissionOverwrites.edit(guild.id, {
            ViewChannel: true,
            Connect: false,
            Speak: null,
            Stream: null
          });
        } catch (error) {
          logger.debug(`Failed to enforce unjoinable overrides on voice counter ${channel.id}:`, error.message);
        }
      }
    }

    const baseName = getCounterBaseName(type);
    if (process.env.NODE_ENV !== 'production') {
      logger.debug(`Base name: "${baseName}", Current name: "${channel.name}"`);
    }
    
    const newName = `${getCounterEmoji(type)}・${baseName} : ${count.toLocaleString('en-US')}`;
    if (process.env.NODE_ENV !== 'production') {
      logger.debug(`New name would be: "${newName}"`);
    }
    
    if (channel.name === newName) {
      const runtime = getCounterRuntime(guild.id, channelId);
      if (runtime.pending && runtime.pending.counter?.id === counter.id) {
        runtime.pending = null;
        if (runtime.timer) {
          clearTimeout(runtime.timer);
          runtime.timer = null;
        }
      }
      if (process.env.NODE_ENV !== 'production') {
        logger.debug('Channel name already correct, no update needed');
      }
      return true;
    }

    const runtime = getCounterRuntime(guild.id, channelId);
    return queueCounterRename(client, guild, counter, runtime, channel, newName, count);
  } catch (error) {
    logger.error("Error updating counter:", error);
    return false;
  }
}







export async function getServerCounters(client, guildId) {
  try {
    if (!client || !client.db) {
      logger.warn('Database not available for getServerCounters');
      return [];
    }
    
    const data = await client.db.get(`counters:${guildId}`);
    
    let counters = [];
    
    if (data && typeof data === 'object' && data.ok && Array.isArray(data.value)) {
      counters = data.value;
    } else if (Array.isArray(data)) {
      counters = data;
    } else if (typeof data === 'string') {
      try {
        const parsed = JSON.parse(data);
        counters = Array.isArray(parsed) ? parsed : [];
      } catch {
        counters = [];
      }
    } else if (data && typeof data === 'object' && !data.ok && isValidCounterShape(data)) {
      counters = [data];
    } else {
      if (process.env.NODE_ENV !== 'production') {
        logger.debug('No counter data found, returning empty array');
      }
      return [];
    }

    const sanitized = sanitizeCounters(counters, guildId);

    if (counters.length > 0 && sanitized.length === 0) {
      logger.error(
        `All ${counters.length} counter(s) for guild ${guildId} were rejected by validation. Raw data is still in the database and was NOT deleted. Sample: ${JSON.stringify(counters[0]).substring(0, 300)}`,
      );
    } else if (counters.length > sanitized.length) {
      logger.warn(
        `Dropped ${counters.length - sanitized.length} malformed counter(s) for guild ${guildId} on read. They remain in the database but are not usable.`,
      );
    }

    return sanitized;
  } catch (error) {
    logger.error("Error getting server counters:", error);
    return [];
  }
}








export async function saveServerCounters(client, guildId, counters) {
  try {
    if (!client || !client.db) {
      logger.warn('Database not available for saveServerCounters');
      return false;
    }
    
    const sanitizedCounters = sanitizeCounters(counters, guildId);

    if (sanitizedCounters.length === 0 && Array.isArray(counters) && counters.length > 0) {
      logger.error(
        `Refusing to overwrite counters for guild ${guildId} with an empty list: all ${counters.length} provided counter(s) failed validation.`,
      );
      return false;
    }

    if (process.env.NODE_ENV !== 'production') {
      logger.debug(`Saving ${sanitizedCounters.length} counters for guild ${guildId}:`, sanitizedCounters);
    }

    const persisted = await client.db.set(`counters:${guildId}`, sanitizedCounters);

    if (persisted === false) {
      logger.error(`Database rejected counter save for guild ${guildId} (set() returned false)`);
      return false;
    }

    if (process.env.NODE_ENV !== 'production') {
      logger.debug('Counters saved successfully');
    }
    return true;
  } catch (error) {
    logger.error("Error saving server counters:", error);
    return false;
  }
}


