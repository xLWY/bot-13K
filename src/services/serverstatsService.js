import { PermissionFlagsBits } from 'discord.js';
import { logger } from '../utils/logger.js';

export const COUNTER_TYPE_CONFIG = {
  members: {
    label: 'Members + Bots',
    baseName: 'Membres',
    emoji: '👥'
  },
  members_only: {
    label: 'Members Only',
    baseName: 'Membres',
    emoji: '👤'
  },
  bots: {
    label: 'Bots Only',
    baseName: 'Bots',
    emoji: '🤖'
  },
  online: {
    label: 'Online Members',
    baseName: 'En ligne',
    emoji: '🌐'
  },
  voice: {
    label: 'In Voice',
    baseName: 'Vocal',
    emoji: '🔊'
  }
};

function getCounterConfig(type) {
  return COUNTER_TYPE_CONFIG[type] || {
    label: 'Unknown',
    baseName: 'Counter',
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

export async function getGuildCounterStats(guild) {
  let memberCollection = guild.members.cache;

  if (memberCollection.size === 0) {
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
  const onlineCount = memberCollection.filter((member) =>
    !member.user.bot && ['online', 'idle', 'dnd'].includes(member.presence?.status)
  ).size;
  const voiceCount = guild.channels.cache
    .filter((channel) => channel.isVoiceBased && channel.isVoiceBased())
    .reduce((total, channel) => total + (channel.members?.size || 0), 0);

  return {
    totalCount,
    botCount,
    humanCount,
    onlineCount,
    voiceCount
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
  return Boolean(
    counter &&
    typeof counter === 'object' &&
    typeof counter.id === 'string' &&
    counter.id.length > 0 &&
    typeof counter.type === 'string' &&
    typeof counter.channelId === 'string' &&
    counter.channelId.length > 0
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








export async function updateCounter(client, guild, counter, stats) {
  try {
    if (!counter || !counter.type || !counter.channelId) {
      logger.warn('Skipping invalid counter in updateCounter:', counter);
      return false;
    }
    
    const { type, channelId } = counter;
    const channel = guild.channels.cache.get(channelId);
    if (!channel) {
      logger.error('Channel not found for counter:', channelId);
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
    
    if (channel.name !== newName) {
      try {
        await channel.setName(newName);
        if (process.env.NODE_ENV !== 'production') {
          logger.debug(`Updated channel name to: "${newName}"`);
        }
      } catch (error) {
        logger.error(`Failed to update channel name for ${channel.id}:`, error);
        return false;
      }
    } else {
      if (process.env.NODE_ENV !== 'production') {
        logger.debug('Channel name already correct, no update needed');
      }
    }
    return true;
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

    return sanitizeCounters(counters, guildId);
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

    if (process.env.NODE_ENV !== 'production') {
      logger.debug(`Saving ${sanitizedCounters.length} counters for guild ${guildId}:`, sanitizedCounters);
    }

    await client.db.set(`counters:${guildId}`, sanitizedCounters);
    if (process.env.NODE_ENV !== 'production') {
      logger.debug('Counters saved successfully');
    }
    return true;
  } catch (error) {
    logger.error("Error saving server counters:", error);
    return false;
  }
}


