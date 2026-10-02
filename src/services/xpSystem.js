



import { logger } from '../utils/logger.js';
import { getLevelingConfig, getXpForLevel, getUserLevelData, saveUserLevelData } from './leveling.js';
import { logEvent, EVENT_TYPES } from './loggingService.js';
import { Mutex } from '../utils/mutex.js';









const DEFAULT_XP_CHANGE_LOG_THRESHOLD = 500;

function formatMilestoneValue(value) {
  if (value === null || value === undefined || value === '') return '*aucune*';
  if (typeof value === 'boolean') return value ? 'Oui' : 'Non';
  if (typeof value === 'string') {
    const roleId = /^\d{17,20}$/.test(value) ? `<@&${value}>` : value;
    return roleId;
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value);
    return entries.length
      ? entries.map(([k, v]) => `\`${k}\` : \`${v}\``).join('\n')
      : '*aucune*';
  }
  return `\`${value}\``;
}

export async function addXp(client, guild, member, xpToAdd) {
  const lockKey = `leveling:${guild.id}:${member.user.id}`;
  return await Mutex.runExclusive(lockKey, async () => {
    try {
      // XP Logic...
      if (!xpToAdd || xpToAdd <= 0) {
        return { success: false, reason: 'Invalid XP amount' };
      }

      const config = await getLevelingConfig(client, guild.id);
      
      if (!config.enabled) {
        return { success: false, reason: 'Leveling is disabled in this server' };
      }
      
      const levelData = await getUserLevelData(client, guild.id, member.user.id);
      
      levelData.xp += xpToAdd;
      levelData.totalXp += xpToAdd;
      levelData.lastMessage = Date.now();
      
      // Handle multi-level jumps
      let xpNeededForNextLevel = getXpForLevel(levelData.level);
      let didLevelUp = false;
      const initialLevel = levelData.level;

      while (levelData.xp >= xpNeededForNextLevel && levelData.level < 1000) {
        levelData.xp -= xpNeededForNextLevel;
        levelData.level += 1;
        didLevelUp = true;
        xpNeededForNextLevel = getXpForLevel(levelData.level);

        logger.info(`🎉 ${member.user.tag} leveled up to level ${levelData.level} in ${guild.name}`);

        // Award role rewards for each level if applicable
        if (config.roleRewards && config.roleRewards[levelData.level]) {
          await awardRoleReward(guild, member, config.roleRewards[levelData.level], levelData.level);
        }
      }

      if (didLevelUp) {
        // If they leveled up, we only announce once (to the highest level reached)
        if (config.announceLevelUp) {
          await sendLevelUpAnnouncement(guild, member, levelData, config);
        }

        // Log the levelup event (once for the highest level reached)
        try {
          await logEvent({
            client,
            guildId: guild.id,
            eventType: EVENT_TYPES.LEVELING_LEVELUP,
            data: {
              description: `<@${member.user.id}> a atteint le niveau ${levelData.level}`,
              userId: member.user.id,
              fields: [
                {
                  name: '👤 Membre',
                  value: `<@${member.user.id}> (${member.user.id})`,
                  inline: true
                },
                {
                  name: '📊 Nouveau niveau',
                  value: levelData.level.toString(),
                  inline: true
                },
                {
                  name: '📈 Niveaux gagnés',
                  value: (levelData.level - initialLevel).toString(),
                  inline: true
                },
                {
                  name: '✨ XP total',
                  value: levelData.totalXp.toString(),
                  inline: true
                }
              ]
            }
          });
        } catch (logError) {
          logger.debug('Failed to log leveling event:', logError.message);
        }
      }
      
      const xpChangeThreshold = Number.isFinite(config.xpChangeLogThreshold)
        ? config.xpChangeLogThreshold
        : DEFAULT_XP_CHANGE_LOG_THRESHOLD;

      if (xpToAdd >= xpChangeThreshold) {
        try {
          await logEvent({
            client,
            guildId: guild.id,
            eventType: EVENT_TYPES.LEVELING_XP_CHANGE,
            data: {
              description: `+${xpToAdd} XP attribue a <@${member.user.id}>`,
              userId: member.user.id,
              fields: [
                {
                  name: '👤 Membre',
                  value: `<@${member.user.id}> (${member.user.id})`,
                  inline: true
                },
                {
                  name: '✨ XP ajoute',
                  value: `+${xpToAdd.toLocaleString('en-US')}`,
                  inline: true
                },
                {
                  name: '📊 XP sur le niveau',
                  value: levelData.xp.toLocaleString('en-US'),
                  inline: true
                },
                {
                  name: '🏆 XP total',
                  value: levelData.totalXp.toLocaleString('en-US'),
                  inline: true
                },
                {
                  name: '📈 Niveau',
                  value: levelData.level.toString(),
                  inline: true
                },
                {
                  name: 'ℹ️ Seuil de log',
                  value: `\`${xpChangeThreshold}\` XP (l'XP de message n'est pas logue)`,
                  inline: false
                }
              ]
            }
          });
        } catch (logError) {
          logger.debug('Failed to log xp change event:', logError.message);
        }
      }

      const milestones = config.milestones && typeof config.milestones === 'object'
        ? config.milestones
        : {};

      for (const milestoneKey of Object.keys(milestones)) {
        const milestoneLevel = Number(milestoneKey);
        if (!Number.isFinite(milestoneLevel)) continue;
        if (initialLevel >= milestoneLevel || levelData.level < milestoneLevel) continue;

        try {
          await logEvent({
            client,
            guildId: guild.id,
            eventType: EVENT_TYPES.LEVELING_MILESTONE,
            data: {
              description: `<@${member.user.id}> a atteint le palier **${milestoneLevel}**`,
              userId: member.user.id,
              fields: [
                {
                  name: '👤 Membre',
                  value: `<@${member.user.id}> (${member.user.id})`,
                  inline: true
                },
                {
                  name: '🏅 Palier',
                  value: milestoneLevel.toString(),
                  inline: true
                },
                {
                  name: '📈 Niveau actuel',
                  value: levelData.level.toString(),
                  inline: true
                },
                {
                  name: '🎁 Recompense',
                  value: formatMilestoneValue(milestones[milestoneKey]),
                  inline: false
                }
              ]
            }
          });
        } catch (logError) {
          logger.debug('Failed to log leveling milestone event:', logError.message);
        }
      }

      await saveUserLevelData(client, guild.id, member.user.id, levelData);
      
      return {
        success: true,
        level: levelData.level,
        xp: levelData.xp,
        totalXp: levelData.totalXp,
        xpNeeded: getXpForLevel(levelData.level + 1),
        leveledUp: didLevelUp
      };
      
    } catch (error) {
      logger.error('Error adding XP:', error);
      return { success: false, error: error.message };
    }
  });
}










async function awardRoleReward(guild, member, roleId, level) {
  try {
    const role = guild.roles.cache.get(roleId);
    
    if (!role) {
      logger.warn(`Role ${roleId} not found for level ${level} reward in guild ${guild.id}`);
      return;
    }

    
    if (member.roles.cache.has(roleId)) {
      return;
    }

    await member.roles.add(role, `Level ${level} reward`);
    logger.info(`✅ Awarded role ${role.name} to ${member.user.tag} for reaching level ${level}`);
  } catch (error) {
    logger.error(`Failed to award role reward to ${member.user.id}:`, error);
  }
}










async function sendLevelUpAnnouncement(guild, member, levelData, config) {
  try {
    const levelUpChannel = config.levelUpChannel 
      ? guild.channels.cache.get(config.levelUpChannel) 
      : guild.systemChannel;
    
    if (!levelUpChannel || !levelUpChannel.isTextBased()) {
      return;
    }

    
    const permissions = levelUpChannel.permissionsFor(guild.members.me);
    if (!permissions || !permissions.has(['SendMessages', 'EmbedLinks'])) {
      logger.warn(`Missing permissions to send levelup message in ${levelUpChannel.id}`);
      return;
    }

    const message = config.levelUpMessage
      .replace(/{user}/g, member.toString())
      .replace(/{level}/g, levelData.level)
      .replace(/{xp}/g, levelData.xp)
      .replace(/{xpNeeded}/g, getXpForLevel(levelData.level + 1));
    
    await levelUpChannel.send(message).catch(error => {
      logger.error(`Failed to send level up message in channel ${levelUpChannel.id}:`, error);
    });
  } catch (error) {
    logger.error('Error sending level up announcement:', error);
  }
}


