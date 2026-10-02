import { Events } from 'discord.js';
import { logEvent, EVENT_TYPES } from '../services/loggingService.js';
import { logger } from '../utils/logger.js';

function truncate(value, max = 800) {
  const str = String(value ?? '');
  return str.length > max ? `${str.substring(0, max - 3)}...` : str;
}

export default [
  {
    name: Events.StageInstanceCreate,
    once: false,
    async execute(stage, client) {
      try {
        if (!stage.guild) return;
        await logEvent({
          client: client ?? stage.client,
          guildId: stage.guild.id,
          eventType: EVENT_TYPES.STAGE_CREATE,
          data: {
            description: `Scene creee : ${stage.channel?.toString() ?? stage.channelId}`,
            channelId: stage.channelId,
            fields: [
              { name: '📍 Salon', value: stage.channel ? stage.channel.toString() : `<#${stage.channelId}>`, inline: true },
              { name: '📝 Sujet', value: truncate(stage.topic || '*aucun*', 200), inline: false },
              { name: '🔒 Mode', value: stage.privacyLevel === 2 ? 'Publique' : 'Privee', inline: true },
            ],
          },
        });
      } catch (error) {
        logger.error('Error in stageInstanceCreate event:', error);
      }
    },
  },

  {
    name: Events.StageInstanceUpdate,
    once: false,
    async execute(before, after, client) {
      try {
        if (!after.guild) return;
        const changes = [];
        if (before.topic !== after.topic) {
          changes.push({ name: '📝 Sujet', value: truncate(after.topic || '*aucun*', 200), inline: false });
        }
        if (before.privacyLevel !== after.privacyLevel) {
          changes.push({
            name: '🔒 Mode',
            value: `${before.privacyLevel === 2 ? 'Publique' : 'Privee'} → ${after.privacyLevel === 2 ? 'Publique' : 'Privee'}`,
            inline: true,
          });
        }
        if (changes.length === 0) return;
        await logEvent({
          client: client ?? after.client,
          guildId: after.guild.id,
          eventType: EVENT_TYPES.STAGE_UPDATE,
          data: {
            description: `Scene modifiee : ${after.channel?.toString() ?? after.channelId}`,
            channelId: after.channelId,
            fields: changes,
          },
        });
      } catch (error) {
        logger.error('Error in stageInstanceUpdate event:', error);
      }
    },
  },

  {
    name: Events.StageInstanceDelete,
    once: false,
    async execute(stage, client) {
      try {
        if (!stage.guild) return;
        await logEvent({
          client: client ?? stage.client,
          guildId: stage.guild.id,
          eventType: EVENT_TYPES.STAGE_DELETE,
          data: {
            description: `Scene terminee : ${stage.channel?.toString() ?? stage.channelId}`,
            channelId: stage.channelId,
            fields: [
              { name: '📝 Sujet', value: truncate(stage.topic || '*aucun*', 200), inline: false },
            ],
          },
        });
      } catch (error) {
        logger.error('Error in stageInstanceDelete event:', error);
      }
    },
  },

  {
    name: Events.AutoModerationRuleCreate,
    once: false,
    async execute(rule, client) {
      try {
        if (!rule.guild) return;
        await logEvent({
          client: client ?? rule.client,
          guildId: rule.guild.id,
          eventType: EVENT_TYPES.AUTOMOD_RULE_CREATE,
          data: {
            description: `Regle AutoMod creee : **${rule.name}**`,
            fields: [
              { name: '🛡️ Regle', value: rule.name, inline: true },
              { name: '🔢 Declencheur', value: `${rule.triggerType}`, inline: true },
              { name: '📍 Salon', value: rule.channelId ? `<#${rule.channelId}>` : '*tous*', inline: true },
              { name: '🚫 Action', value: `${rule.actionType}`, inline: true },
            ],
          },
        });
      } catch (error) {
        logger.error('Error in autoModerationRuleCreate event:', error);
      }
    },
  },

  {
    name: Events.AutoModerationRuleUpdate,
    once: false,
    async execute(before, after, client) {
      try {
        if (!after.guild) return;
        await logEvent({
          client: client ?? after.client,
          guildId: after.guild.id,
          eventType: EVENT_TYPES.AUTOMOD_RULE_UPDATE,
          data: {
            description: `Regle AutoMod modifiee : **${after.name}**`,
            fields: [
              { name: '🛡️ Regle', value: after.name, inline: true },
              { name: '🔢 Declencheur', value: `${before.triggerType} → ${after.triggerType}`, inline: true },
              { name: '🚫 Action', value: `${before.actionType} → ${after.actionType}`, inline: true },
            ],
          },
        });
      } catch (error) {
        logger.error('Error in autoModerationRuleUpdate event:', error);
      }
    },
  },

  {
    name: Events.AutoModerationRuleDelete,
    once: false,
    async execute(rule, client) {
      try {
        if (!rule.guild) return;
        await logEvent({
          client: client ?? rule.client,
          guildId: rule.guild.id,
          eventType: EVENT_TYPES.AUTOMOD_RULE_DELETE,
          data: {
            description: `Regle AutoMod supprimee : **${rule.name}**`,
            fields: [
              { name: '🛡️ Regle', value: rule.name, inline: true },
              { name: '🔢 Declencheur', value: `${rule.triggerType}`, inline: true },
            ],
          },
        });
      } catch (error) {
        logger.error('Error in autoModerationRuleDelete event:', error);
      }
    },
  },
];
