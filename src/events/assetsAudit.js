import { Events } from 'discord.js';
import { logEvent, EVENT_TYPES } from '../services/loggingService.js';
import { logger } from '../utils/logger.js';

function truncate(value, max = 500) {
  const str = String(value ?? '');
  return str.length > max ? `${str.substring(0, max - 3)}...` : str;
}

export default [
  {
    name: Events.EmojiCreate,
    once: false,
    async execute(emoji, client) {
      try {
        if (!emoji.guild) return;
        await logEvent({
          client: client ?? emoji.client,
          guildId: emoji.guild.id,
          eventType: EVENT_TYPES.EMOJI_CREATE,
          data: {
            description: `Emoji ajoute : ${emoji.toString()}`,
            fields: [
              { name: '😀 Nom', value: emoji.name, inline: true },
              { name: '🆔 ID', value: emoji.id, inline: true },
              { name: '🔗 Animated', value: emoji.animated ? 'Oui' : 'Non', inline: true },
            ],
          },
        });
      } catch (error) {
        logger.error('Error in emojiCreate event:', error);
      }
    },
  },

  {
    name: Events.EmojiUpdate,
    once: false,
    async execute(before, after, client) {
      try {
        if (!after.guild) return;
        const changes = [];
        if (before.name !== after.name) {
          changes.push({ name: '😀 Nom', value: `\`${before.name}\` → \`${after.name}\``, inline: true });
        }
        if (before.roles.cache.size !== after.roles.cache.size) {
          changes.push({
            name: '🎭 Roles autorises',
            value: `${before.roles.cache.size} → ${after.roles.cache.size}`,
            inline: true,
          });
        }
        if (changes.length === 0) return;
        await logEvent({
          client: client ?? after.client,
          guildId: after.guild.id,
          eventType: EVENT_TYPES.EMOJI_UPDATE,
          data: {
            description: `Emoji modifie : ${after.toString()}`,
            fields: [{ name: '🆔 ID', value: after.id, inline: true }, ...changes],
          },
        });
      } catch (error) {
        logger.error('Error in emojiUpdate event:', error);
      }
    },
  },

  {
    name: Events.EmojiDelete,
    once: false,
    async execute(emoji, client) {
      try {
        if (!emoji.guild) return;
        await logEvent({
          client: client ?? emoji.client,
          guildId: emoji.guild.id,
          eventType: EVENT_TYPES.EMOJI_DELETE,
          data: {
            description: `Emoji supprime : ${emoji.name}`,
            fields: [
              { name: '😀 Nom', value: emoji.name, inline: true },
              { name: '🆔 ID', value: emoji.id, inline: true },
            ],
          },
        });
      } catch (error) {
        logger.error('Error in emojiDelete event:', error);
      }
    },
  },

  {
    name: Events.StickerCreate,
    once: false,
    async execute(sticker, client) {
      try {
        if (!sticker.guild) return;
        await logEvent({
          client: client ?? sticker.client,
          guildId: sticker.guild.id,
          eventType: EVENT_TYPES.STICKER_CREATE,
          data: {
            description: `Sticker ajoute : ${sticker.name}`,
            fields: [
              { name: '🏷️ Nom', value: sticker.name, inline: true },
              { name: '📝 Description', value: truncate(sticker.description || '*aucune*'), inline: false },
              { name: '🏷️ Tags', value: truncate(sticker.tags || '*aucun*', 200), inline: false },
            ],
          },
        });
      } catch (error) {
        logger.error('Error in stickerCreate event:', error);
      }
    },
  },

  {
    name: Events.StickerUpdate,
    once: false,
    async execute(before, after, client) {
      try {
        if (!after.guild) return;
        await logEvent({
          client: client ?? after.client,
          guildId: after.guild.id,
          eventType: EVENT_TYPES.STICKER_UPDATE,
          data: {
            description: `Sticker modifie : ${after.name}`,
            fields: [
              { name: '🏷️ Nom', value: after.name, inline: true },
              { name: '📝 Description', value: truncate(after.description || '*aucune*'), inline: false },
            ],
          },
        });
      } catch (error) {
        logger.error('Error in stickerUpdate event:', error);
      }
    },
  },

  {
    name: Events.StickerDelete,
    once: false,
    async execute(sticker, client) {
      try {
        if (!sticker.guild) return;
        await logEvent({
          client: client ?? sticker.client,
          guildId: sticker.guild.id,
          eventType: EVENT_TYPES.STICKER_DELETE,
          data: {
            description: `Sticker supprime : ${sticker.name}`,
            fields: [{ name: '🏷️ Nom', value: sticker.name, inline: true }],
          },
        });
      } catch (error) {
        logger.error('Error in stickerDelete event:', error);
      }
    },
  },

  {
    name: Events.InviteCreate,
    once: false,
    async execute(invite, client) {
      try {
        if (!invite.guild) return;
        await logEvent({
          client: client ?? invite.client,
          guildId: invite.guild.id,
          eventType: EVENT_TYPES.INVITE_CREATE,
          data: {
            description: `Invitation creee : ${invite.code}`,
            fields: [
              { name: '🔗 Code', value: `\`${invite.code}\``, inline: true },
              {
                name: '📍 Salon',
                value: invite.channel ? `${invite.channel.toString()}` : '*inconnu*',
                inline: true,
              },
              { name: '⏱️ Expiration', value: invite.expiresAt ? `<t:${Math.floor(invite.expiresTimestamp / 1000)}:R>` : '*jamais*', inline: true },
              { name: '🔢 Utilisations max', value: invite.maxUses ? invite.maxUses.toString() : '*illimite*', inline: true },
            ],
          },
        });
      } catch (error) {
        logger.error('Error in inviteCreate event:', error);
      }
    },
  },

  {
    name: Events.InviteDelete,
    once: false,
    async execute(invite, client) {
      try {
        if (!invite.guild) return;
        await logEvent({
          client: client ?? invite.client,
          guildId: invite.guild.id,
          eventType: EVENT_TYPES.INVITE_DELETE,
          data: {
            description: `Invitation supprimee : ${invite.code}`,
            fields: [
              { name: '🔗 Code', value: `\`${invite.code}\``, inline: true },
              {
                name: '📍 Salon',
                value: invite.channel ? `${invite.channel.toString()}` : '*inconnu*',
                inline: true,
              },
              { name: '🔢 Utilisations', value: (invite.uses ?? 0).toString(), inline: true },
            ],
          },
        });
      } catch (error) {
        logger.error('Error in inviteDelete event:', error);
      }
    },
  },

  {
    name: Events.WebhookUpdate,
    once: false,
    async execute(webhook, client) {
      try {
        if (!webhook.guild) return;
        await logEvent({
          client: client ?? webhook.client,
          guildId: webhook.guild.id,
          eventType: EVENT_TYPES.WEBHOOK_UPDATE,
          data: {
            description: `Webhook modifie : ${webhook.name}`,
            channelId: webhook.channelId,
            fields: [
              { name: '🪝 Nom', value: webhook.name, inline: true },
              { name: '🆔 ID', value: webhook.id, inline: true },
              { name: '📍 Salon', value: `<#${webhook.channelId}>`, inline: true },
              { name: '🔗 URL', value: truncate(webhook.url, 200), inline: false },
            ],
          },
        });
      } catch (error) {
        logger.error('Error in webhookUpdate event:', error);
      }
    },
  },

  {
    name: Events.GuildUpdate,
    once: false,
    async execute(before, after, client) {
      try {
        const changes = [];
        if (before.name !== after.name) {
          changes.push({ name: '📝 Nom du serveur', value: `\`${before.name}\` → \`${after.name}\``, inline: false });
        }
        if (before.ownerId !== after.ownerId) {
          changes.push({
            name: '👑 Proprietaire',
            value: `<@${before.ownerId}> → <@${after.ownerId}>`,
            inline: false,
          });
        }
        if (before.verificationLevel !== after.verificationLevel) {
          changes.push({
            name: '🛡️ Verification',
            value: `${before.verificationLevel} → ${after.verificationLevel}`,
            inline: true,
          });
        }
        if (before.afkChannelId !== after.afkChannelId) {
          changes.push({
            name: '💤 Salon AFK',
            value: `${before.afkChannelId ? `<#${before.afkChannelId}>` : '*aucun*'} → ${after.afkChannelId ? `<#${after.afkChannelId}>` : '*aucun*'}`,
            inline: true,
          });
        }
        if (before.premiumTier !== after.premiumTier) {
          changes.push({
            name: '💎 Boost',
            value: `${before.premiumTier} → ${after.premiumTier}`,
            inline: true,
          });
        }
        if (changes.length === 0) return;

        await logEvent({
          client: client ?? after.client,
          guildId: after.id,
          eventType: EVENT_TYPES.GUILD_UPDATE,
          data: {
            description: 'Informations du serveur modifiees.',
            fields: changes,
          },
        });
      } catch (error) {
        logger.error('Error in guildUpdate event:', error);
      }
    },
  },

  {
    name: Events.GuildIntegrationsUpdate,
    once: false,
    async execute(guild, client) {
      try {
        if (!guild) return;
        await logEvent({
          client: client ?? guild.client,
          guildId: guild.id,
          eventType: EVENT_TYPES.GUILD_INTEGRATION_UPDATE,
          data: {
            description: 'Les integrations du serveur ont ete modifiees.',
            fields: [{ name: '🏛️ Serveur', value: `${guild.name} (\`${guild.id}\`)`, inline: false }],
          },
        });
      } catch (error) {
        logger.error('Error in guildIntegrationsUpdate event:', error);
      }
    },
  },
];
