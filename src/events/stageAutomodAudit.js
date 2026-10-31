import { Events } from 'discord.js';
import { logEvent, EVENT_TYPES } from '../services/loggingService.js';
import { logger } from '../utils/logger.js';

function truncate(value, max = 800) {
  const str = String(value ?? '');
  return str.length > max ? `${str.substring(0, max - 3)}...` : str;
}

const STAGE_PRIVACY_LABELS = {
  1: 'Publique',
  2: 'Privée',
};

const AUTOMOD_TRIGGER_LABELS = {
  1: 'Mot-clé',
  3: 'Spam',
  4: 'Préréglage de mots-clés',
  5: 'Mention spam',
  6: 'Profil de membre',
};

const AUTOMOD_ACTION_LABELS = {
  1: 'Bloquer le message',
  2: 'Envoyer une alerte',
  3: 'Exclusion temporaire',
};

function stagePrivacyLabel(level) {
  return STAGE_PRIVACY_LABELS[level] ?? 'Inconnu';
}

function automodTriggerLabel(type) {
  return AUTOMOD_TRIGGER_LABELS[type] ?? 'Inconnu';
}

function automodActionLabel(type) {
  return AUTOMOD_ACTION_LABELS[type] ?? 'Inconnue';
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
            description: `Scène créée : ${stage.channel?.toString() ?? 'salon inconnu'}`,
            channelId: stage.channelId,
            fields: [
              { name: '📍 Salon', value: stage.channel ? stage.channel.toString() : `<#${stage.channelId}>`, inline: true },
              { name: '📝 Sujet', value: truncate(stage.topic || '*aucun*', 200), inline: false },
              { name: '🔒 Mode', value: stagePrivacyLabel(stage.privacyLevel), inline: true },
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
            value: `${stagePrivacyLabel(before.privacyLevel)} → ${stagePrivacyLabel(after.privacyLevel)}`,
            inline: true,
          });
        }
        if (changes.length === 0) return;
        await logEvent({
          client: client ?? after.client,
          guildId: after.guild.id,
          eventType: EVENT_TYPES.STAGE_UPDATE,
          data: {
            description: `Scène modifiée : ${after.channel?.toString() ?? 'salon inconnu'}`,
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
            description: `Scène terminée : ${stage.channel?.toString() ?? 'salon inconnu'}`,
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
            description: `Règle AutoMod créée : **${rule.name}**`,
            fields: [
              { name: '🛡️ Règle', value: rule.name, inline: true },
              { name: '🔢 Déclencheur', value: automodTriggerLabel(rule.triggerType), inline: true },
              { name: '📍 Salon', value: rule.channelId ? `<#${rule.channelId}>` : '*tous*', inline: true },
              { name: '🚫 Action', value: automodActionLabel(rule.actionType), inline: true },
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
            description: `Règle AutoMod modifiée : **${after.name}**`,
            fields: [
              { name: '🛡️ Règle', value: after.name, inline: true },
              { name: '🔢 Déclencheur', value: `${automodTriggerLabel(before.triggerType)} → ${automodTriggerLabel(after.triggerType)}`, inline: true },
              { name: '🚫 Action', value: `${automodActionLabel(before.actionType)} → ${automodActionLabel(after.actionType)}`, inline: true },
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
            description: `Règle AutoMod supprimée : **${rule.name}**`,
            fields: [
              { name: '🛡️ Règle', value: rule.name, inline: true },
              { name: '🔢 Déclencheur', value: automodTriggerLabel(rule.triggerType), inline: true },
            ],
          },
        });
      } catch (error) {
        logger.error('Error in autoModerationRuleDelete event:', error);
      }
    },
  },
];
