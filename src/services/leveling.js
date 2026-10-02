




import { EmbedBuilder } from 'discord.js';
import { logger } from '../utils/logger.js';
import { getGuildConfig, setGuildConfig } from '../services/guildConfig.js';
import { TitanBotError, ErrorTypes } from '../utils/errorHandler.js';
import { addXp } from './xpSystem.js';
import { logEvent, EVENT_TYPES } from './loggingService.js';

const BASE_XP = 100;
const XP_MULTIPLIER = 1.5;
export const MAX_LEVEL = 1000;
const MIN_LEVEL = 0;

async function safeLevelLog(client, payload) {
  try {
    await logEvent({ client, ...payload });
  } catch (error) {
    logger.debug('Failed to log leveling event:', error.message);
  }
}

const CONFIG_KEY_LABELS = {
  enabled: 'Active',
  xpCooldown: 'Cooldown XP (s)',
  xpRange: 'Plage XP',
  announceLevelUp: 'Annonce montee de niveau',
  levelUpChannel: 'Salon des annonces',
  levelUpMessage: 'Message d\'annonce',
  noXpChannels: 'Salons sans XP',
  noXpRoles: 'Roles sans XP',
  roleRewards: 'Recompenses de roles',
  leaderboardChannel: 'Salon du classement',
  milestones: 'Paliers'
};

const MAX_CONFIG_DIFF_FIELDS = 10;

function formatConfigValue(value) {
  if (value === null || value === undefined) return '*non definie*';
  if (typeof value === 'boolean') return value ? 'Oui' : 'Non';
  if (Array.isArray(value)) return value.length ? value.map(v => `\`${v}\``).join('\n') : '*aucun*';
  if (typeof value === 'object') {
    const entries = Object.entries(value);
    return entries.length
      ? entries.map(([k, v]) => `\`${k}\` : \`${v}\``).join('\n')
      : '*aucun*';
  }
  return `\`${value}\``;
}

function buildConfigDiffFields(previous, next) {
  const keys = new Set([...Object.keys(previous || {}), ...Object.keys(next || {})]);
  const fields = [];

  for (const key of keys) {
    const before = previous?.[key];
    const after = next?.[key];
    if (JSON.stringify(before) === JSON.stringify(after)) continue;
    if (fields.length >= MAX_CONFIG_DIFF_FIELDS) break;
    fields.push({
      name: `⚙️ ${CONFIG_KEY_LABELS[key] ?? key}`,
      value: `**Avant :** ${formatConfigValue(before)}\n**Apres :** ${formatConfigValue(after)}`,
      inline: false
    });
  }

  if (fields.length === 0) {
    fields.push({
      name: 'ℹ️ Aucun changement',
      value: 'La configuration enregistree est identique.',
      inline: false
    });
  }

  return fields;
}

async function logLevelChange(client, guildId, userId, fromLevel, toLevel, action) {
  const direction = toLevel > fromLevel ? 'monte' : toLevel < fromLevel ? 'descente' : 'inchange';
  await safeLevelLog(client, {
    guildId,
    eventType: EVENT_TYPES.LEVELING_LEVEL_CHANGE,
    data: {
      description: `Niveau **${action}** pour <@${userId}> (${fromLevel} -> ${toLevel})`,
      userId,
      fields: [
        {
          name: '👤 Membre',
          value: `<@${userId}> (\`${userId}\`)`,
          inline: true
        },
        {
          name: '🔄 Action',
          value: action,
          inline: true
        },
        {
          name: '📉 Sens',
          value: direction,
          inline: true
        },
        {
          name: '📊 Ancien niveau',
          value: fromLevel.toString(),
          inline: true
        },
        {
          name: '📈 Nouveau niveau',
          value: toLevel.toString(),
          inline: true
        }
      ]
    }
  });
}







export function getXpForLevel(level) {
  if (!Number.isInteger(level) || level < 0 || level > MAX_LEVEL) {
    throw new TitanBotError(
      `Invalid level: ${level}. Must be between ${MIN_LEVEL} and ${MAX_LEVEL}`,
      ErrorTypes.VALIDATION,
      'Le niveau doit être un nombre valide.'
    );
  }
  return 5 * Math.pow(level, 2) + 50 * level + 50;
}






export function getLevelFromXp(xp) {
  if (!Number.isInteger(xp) || xp < 0) {
    throw new TitanBotError(
      `Invalid XP: ${xp}`,
      ErrorTypes.VALIDATION,
      'XP doit être un nombre positif ou nul.'
    );
  }

  let level = 0;
  let xpNeeded = 0;
  
  while (xp >= getXpForLevel(level) && level < MAX_LEVEL) {
    xpNeeded = getXpForLevel(level);
    xp -= xpNeeded;
    level++;
  }
  
  return {
    level: Math.min(level, MAX_LEVEL),
    currentXp: xp,
    xpNeeded: getXpForLevel(Math.min(level, MAX_LEVEL))
  };
}








/**
 * Calculate the total XP required for a specific level and current XP
 * @param {number} level - The target level
 * @param {number} currentXp - Current XP progress towards next level
 * @returns {number} Total accumulated XP
 */
export function calculateTotalXp(level, currentXp = 0) {
  let total = currentXp;
  for (let i = 0; i < level; i++) {
    total += getXpForLevel(i);
  }
  return total;
}

export async function getLeaderboard(client, guildId, limit = 10) {
  try {
    
    if (!guildId || typeof guildId !== 'string') {
      throw new TitanBotError(
        'Invalid guild ID',
        ErrorTypes.VALIDATION,
        'L\'ID du serveur est requis.'
      );
    }

    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      limit = Math.min(Math.max(limit, 1), 100);
    }

    const guild = client.guilds.cache.get(guildId);
    if (!guild) {
      logger.warn(`Guild ${guildId} not found in cache`);
      return [];
    }
    
    const members = await guild.members.fetch().catch(error => {
      logger.error(`Failed to fetch members for guild ${guildId}:`, error);
      return new Map();
    });

    const leaderboard = [];
    
    for (const [userId, member] of members) {
      if (member.user.bot) continue;
      
      const data = await getUserLevelData(client, guildId, userId);
      if (data && (data.totalXp > 0 || data.level > 0)) {
        leaderboard.push({
          userId,
          username: member.user.username,
          discriminator: member.user.discriminator,
          ...data
        });
      }
    }
    
    leaderboard.sort((a, b) => b.totalXp - a.totalXp);
    
    leaderboard.forEach((entry, index) => {
      entry.rank = index + 1;
    });
    
    return leaderboard.slice(0, limit);
    
  } catch (error) {
    logger.error('Error getting leaderboard:', error);
    if (error instanceof TitanBotError) throw error;
    throw new TitanBotError(
      `Failed to fetch leaderboard: ${error.message}`,
      ErrorTypes.DATABASE,
      'Impossible de récupérer le classement pour le moment.'
    );
  }
}







export function createLeaderboardEmbed(leaderboard, guild) {
  const embed = new EmbedBuilder()
    .setTitle(`🏆 Classement de ${guild.name}`)
    .setColor('#2ecc71')
    .setTimestamp();
    
  if (!leaderboard || leaderboard.length === 0) {
    embed.setDescription('Aucun utilisateur dans le classement pour l\'instant !');
    return embed;
  }
  
  const top3 = leaderboard.slice(0, 3);
  const rest = leaderboard.slice(3);
  
  const top3Text = top3.map((user, index) => {
    const medal = ['🥇', '🥈', '🥉'][index];
    return `${medal} **#${user.rank}** ${user.username} - Niveau ${user.level} (${user.totalXp} XP)`;
  }).join('\n');
  
  const restText = rest.map(user => {
    return `**#${user.rank}** ${user.username} - Niveau ${user.level} (${user.totalXp} XP)`;
  }).join('\n');
  
  embed.setDescription(
    `**Meilleurs membres**\n${top3Text}${restText ? '\n\n' + restText : ''}`
  );
  
  return embed;
}







export async function getLevelingConfig(client, guildId) {
  try {
    const guildConfig = await getGuildConfig(client, guildId);
    return guildConfig.leveling || {
      enabled: true,
      xpPerMessage: { min: 15, max: 25 },
      xpCooldown: 20,
      levelUpMessage: '{user} est passé au niveau {level} !',
      levelUpChannel: null,
      ignoredChannels: [],
      ignoredRoles: [],
      blacklistedUsers: [],
      roleRewards: {},
      announceLevelUp: true,
      xpMultiplier: 1
    };
  } catch (error) {
    logger.error(`Error getting leveling config for guild ${guildId}:`, error);
    return {
      enabled: true,
      xpPerMessage: { min: 15, max: 25 },
      xpCooldown: 20,
      levelUpMessage: '{user} est passé au niveau {level} !',
      levelUpChannel: null,
      ignoredChannels: [],
      ignoredRoles: [],
      blacklistedUsers: [],
      roleRewards: {},
      announceLevelUp: true,
      xpMultiplier: 1
    };
  }
}








export async function getUserLevelData(client, guildId, userId) {
  try {
    if (!guildId || !userId) {
      throw new TitanBotError(
        'Guild ID and User ID are required',
        ErrorTypes.VALIDATION
      );
    }

    const key = `${guildId}:leveling:users:${userId}`;
    const data = await client.db.get(key);
    
    if (!data) {
      return {
        xp: 0,
        level: 0,
        totalXp: 0,
        lastMessage: 0,
        rank: 0
      };
    }
    
    return {
      xp: Math.max(0, data.xp || 0),
      level: Math.max(0, Math.min(data.level || 0, MAX_LEVEL)),
      totalXp: Math.max(0, data.totalXp || 0),
      lastMessage: data.lastMessage || 0,
      rank: data.rank || 0
    };
  } catch (error) {
    logger.error(`Error getting user level data for ${userId}:`, error);
    if (error instanceof TitanBotError) throw error;
    throw new TitanBotError(
      `Failed to fetch user data: ${error.message}`,
      ErrorTypes.DATABASE,
      'Impossible de récupérer les données de niveau pour le moment.'
    );
  }
}









export async function saveUserLevelData(client, guildId, userId, data) {
  try {
    if (!guildId || !userId) {
      throw new TitanBotError(
        'Guild ID and User ID are required',
        ErrorTypes.VALIDATION
      );
    }

    
    if (!data || typeof data !== 'object') {
      throw new TitanBotError(
        'Invalid user level data',
        ErrorTypes.VALIDATION
      );
    }

    
    const sanitizedData = {
      xp: Math.max(0, Number(data.xp) || 0),
      level: Math.max(0, Math.min(Number(data.level) || 0, MAX_LEVEL)),
      totalXp: Math.max(0, Number(data.totalXp) || 0),
      lastMessage: Number(data.lastMessage) || 0,
      rank: Number(data.rank) || 0
    };

    const key = `${guildId}:leveling:users:${userId}`;
    await client.db.set(key, sanitizedData);
  } catch (error) {
    logger.error(`Error saving user level data for ${userId}:`, error);
    if (error instanceof TitanBotError) throw error;
    throw new TitanBotError(
      `Failed to save user data: ${error.message}`,
      ErrorTypes.DATABASE,
      'Impossible d\'enregistrer les données de niveau pour le moment.'
    );
  }
}








export async function saveLevelingConfig(client, guildId, config) {
  try {
    if (!guildId || !config) {
      throw new TitanBotError(
        'Guild ID and config are required',
        ErrorTypes.VALIDATION
      );
    }

    const guildConfig = await getGuildConfig(client, guildId);
    const previousConfig = guildConfig.leveling || {};
    
    
    if (config.xpCooldown && (config.xpCooldown < 0 || config.xpCooldown > 3600)) {
      throw new TitanBotError(
        'XP cooldown must be between 0 and 3600 seconds',
        ErrorTypes.VALIDATION,
        'Le temps de recharge doit être compris entre 0 et 3600 secondes.'
      );
    }

    if (config.xpRange && (config.xpRange.min < 1 || config.xpRange.max < 1 || config.xpRange.min > config.xpRange.max)) {
      throw new TitanBotError(
        'Invalid XP range configuration',
        ErrorTypes.VALIDATION,
        'Le XP minimum doit être inférieur au XP maximum, et les deux doivent être positifs.'
      );
    }

    guildConfig.leveling = config;
    const persisted = await setGuildConfig(client, guildId, guildConfig);

    if (persisted === false) {
      throw new TitanBotError(
        `Failed to persist leveling config for guild ${guildId}`,
        ErrorTypes.DATABASE,
        'Impossible d\'enregistrer la configuration. Vérifie la base de données, puis réessaie.'
      );
    }

    logger.info(`Leveling config updated for guild ${guildId}`);

    await safeLevelLog(client, {
      guildId,
      eventType: EVENT_TYPES.LEVELING_CONFIG_UPDATE,
      data: {
        description: 'La configuration du systeme de niveaux a ete modifiee.',
        fields: buildConfigDiffFields(previousConfig, config)
      }
    });
  } catch (error) {
    logger.error(`Error saving leveling config for guild ${guildId}:`, error);
    if (error instanceof TitanBotError) throw error;
    throw new TitanBotError(
      `Failed to save config: ${error.message}`,
      ErrorTypes.DATABASE,
      'Impossible d\'enregistrer la configuration pour le moment.'
    );
  }
}









export async function addLevels(client, guildId, userId, levels) {
  try {
    const levelingConfig = await getLevelingConfig(client, guildId);
    if (!levelingConfig?.enabled) {
      throw new TitanBotError(
        'Leveling system is disabled on this server',
        ErrorTypes.CONFIGURATION,
        'Le système de niveaux est actuellement désactivé sur ce serveur.'
      );
    }

    
    if (!Number.isInteger(levels) || levels <= 0) {
      throw new TitanBotError(
        `Invalid level amount: ${levels}`,
        ErrorTypes.VALIDATION,
        'Tu dois ajouter un nombre de niveaux positif.'
      );
    }

    const userData = await getUserLevelData(client, guildId, userId);
    const previousLevel = userData.level;
    const newLevel = userData.level + levels;

    if (newLevel > MAX_LEVEL) {
      throw new TitanBotError(
        `Level ${newLevel} exceeds maximum level ${MAX_LEVEL}`,
        ErrorTypes.VALIDATION,
        `Le niveau maximal est ${MAX_LEVEL}.`
      );
    }

    const newXp = 0;
    const newTotalXp = calculateTotalXp(newLevel, newXp);

    userData.level = newLevel;
    userData.xp = newXp;
    userData.totalXp = newTotalXp;

    await saveUserLevelData(client, guildId, userId, userData);
    
    logger.info(`Added ${levels} levels to user ${userId} in guild ${guildId}`);
    await logLevelChange(client, guildId, userId, previousLevel, newLevel, `+${levels} niveaux`);
    return userData;
  } catch (error) {
    logger.error(`Error adding levels for user ${userId}:`, error);
    if (error instanceof TitanBotError) throw error;
    throw new TitanBotError(
      `Failed to add levels: ${error.message}`,
      ErrorTypes.DATABASE,
      'Impossible d\'ajouter les niveaux pour le moment.'
    );
  }
}









export async function removeLevels(client, guildId, userId, levels) {
  try {
    const levelingConfig = await getLevelingConfig(client, guildId);
    if (!levelingConfig?.enabled) {
      throw new TitanBotError(
        'Leveling system is disabled on this server',
        ErrorTypes.CONFIGURATION,
        'Le système de niveaux est actuellement désactivé sur ce serveur.'
      );
    }

    
    if (!Number.isInteger(levels) || levels <= 0) {
      throw new TitanBotError(
        `Invalid level amount: ${levels}`,
        ErrorTypes.VALIDATION,
        'Tu dois retirer un nombre de niveaux positif.'
      );
    }

    const userData = await getUserLevelData(client, guildId, userId);
    const previousLevel = userData.level;
    const newLevel = Math.max(MIN_LEVEL, userData.level - levels);

    const newXp = 0;
    const newTotalXp = calculateTotalXp(newLevel, newXp);

    userData.level = newLevel;
    userData.xp = newXp;
    userData.totalXp = newTotalXp;

    await saveUserLevelData(client, guildId, userId, userData);
    
    logger.info(`Removed ${levels} levels from user ${userId} in guild ${guildId}`);
    await logLevelChange(client, guildId, userId, previousLevel, newLevel, `-${levels} niveaux`);
    return userData;
  } catch (error) {
    logger.error(`Error removing levels for user ${userId}:`, error);
    if (error instanceof TitanBotError) throw error;
    throw new TitanBotError(
      `Failed to remove levels: ${error.message}`,
      ErrorTypes.DATABASE,
      'Impossible de retirer les niveaux pour le moment.'
    );
  }
}









export async function setUserLevel(client, guildId, userId, level) {
  try {
    const levelingConfig = await getLevelingConfig(client, guildId);
    if (!levelingConfig?.enabled) {
      throw new TitanBotError(
        'Leveling system is disabled on this server',
        ErrorTypes.CONFIGURATION,
        'Le système de niveaux est actuellement désactivé sur ce serveur.'
      );
    }

    
    if (!Number.isInteger(level) || level < MIN_LEVEL || level > MAX_LEVEL) {
      throw new TitanBotError(
        `Invalid level: ${level}`,
        ErrorTypes.VALIDATION,
        `Le niveau doit être compris entre ${MIN_LEVEL} et ${MAX_LEVEL}.`
      );
    }

    const userData = await getUserLevelData(client, guildId, userId);
    const previousLevel = userData.level;
    
    const newXp = 0;
    const newTotalXp = calculateTotalXp(level, newXp);

    userData.level = level;
    userData.xp = newXp;
    userData.totalXp = newTotalXp;

    await saveUserLevelData(client, guildId, userId, userData);
    
    logger.info(`Set level for user ${userId} to ${level} in guild ${guildId}`);
    if (previousLevel !== level) {
      await logLevelChange(client, guildId, userId, previousLevel, level, 'niveau defini');
    }
    return userData;
  } catch (error) {
    logger.error(`Error setting level for user ${userId}:`, error);
    if (error instanceof TitanBotError) throw error;
    throw new TitanBotError(
      `Failed to set level: ${error.message}`,
      ErrorTypes.DATABASE,
      'Impossible de définir le niveau pour le moment.'
    );
  }
}




export async function deleteUserLevelData(client, guildId, userId) {
  try {
    if (!guildId || !userId) {
      throw new TitanBotError(
        'Guild ID and User ID are required',
        ErrorTypes.VALIDATION
      );
    }

    const key = `${guildId}:leveling:users:${userId}`;
    await client.db.delete(key);
    
    logger.debug(`Deleted level data for user ${userId} in guild ${guildId}`);
  } catch (error) {
    logger.error(`Error deleting level data for user ${userId}:`, error);
    if (error instanceof TitanBotError) throw error;
    logger.warn(`Could not delete level data for user ${userId} in guild ${guildId}`);
  }
}



