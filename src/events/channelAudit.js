import { Events, ChannelType } from 'discord.js';
import { logEvent, EVENT_TYPES } from '../services/loggingService.js';
import { logger } from '../utils/logger.js';

const CHANNEL_TYPE_NAMES = {
  [ChannelType.GuildText]: 'Texte',
  [ChannelType.GuildVoice]: 'Vocal',
  [ChannelType.GuildCategory]: 'Categorie',
  [ChannelType.GuildAnnouncement]: 'Annonces',
  [ChannelType.AnnouncementThread]: 'Fil d\'annonces',
  [ChannelType.PublicThread]: 'Fil public',
  [ChannelType.PrivateThread]: 'Fil prive',
  [ChannelType.GuildStageVoice]: 'Scene',
  [ChannelType.GuildForum]: 'Forum',
  [ChannelType.GuildMedia]: 'Media',
};

function channelTypeName(type) {
  return CHANNEL_TYPE_NAMES[type] ?? `Type ${type}`;
}

function baseChannelFields(channel) {
  return [
    { name: '📍 Salon', value: `${channel.toString()} (\`${channel.id}\`)`, inline: true },
    { name: '📂 Type', value: channelTypeName(channel.type), inline: true },
    { name: '🆔 ID', value: channel.id, inline: true },
  ];
}

function changedFields(before, after) {
  const changes = [];
  if (before.name !== after.name) {
    changes.push({ name: '📝 Nom', value: `\`${before.name}\` → \`${after.name}\``, inline: false });
  }
  if (before.parentId !== after.parentId) {
    changes.push({
      name: '📁 Categorie',
      value: `\`${before.parentId ?? 'aucune'}\` → \`${after.parentId ?? 'aucune'}\``,
      inline: true,
    });
  }
  if (before.nsfw !== after.nsfw) {
    changes.push({
      name: '🔞 NSFW',
      value: `${before.nsfw ? 'Oui' : 'Non'} → ${after.nsfw ? 'Oui' : 'Non'}`,
      inline: true,
    });
  }
  if (before.rateLimitPerUser !== after.rateLimitPerUser) {
    changes.push({
      name: '🐢 Slowmode',
      value: `${before.rateLimitPerUser ?? 0}s → ${after.rateLimitPerUser ?? 0}s`,
      inline: true,
    });
  }
  const beforePerms = before.permissionOverwrites?.cache?.size ?? 0;
  const afterPerms = after.permissionOverwrites?.cache?.size ?? 0;
  if (beforePerms !== afterPerms) {
    changes.push({
      name: '🔐 Surpermissions',
      value: `${beforePerms} → ${afterPerms}`,
      inline: true,
    });
  }
  return changes;
}

function threadFields(thread) {
  return [
    { name: '🧵 Fil', value: `${thread.toString()} (\`${thread.id}\`)`, inline: true },
    { name: '📂 Type', value: channelTypeName(thread.type), inline: true },
    {
      name: '🔒 Etat',
      value: `${thread.locked ? 'Verrouille' : 'Ouvert'}${thread.archived ? ' / archive' : ''}`,
      inline: true,
    },
  ];
}

export default [
  {
    name: Events.ChannelCreate,
    once: false,

    async execute(channel, client) {
      try {
        if (!channel.guild) return;
        await logEvent({
          client: client ?? channel.client,
          guildId: channel.guild.id,
          eventType: EVENT_TYPES.CHANNEL_CREATE,
          data: {
            description: `Salon cree : ${channel.toString()}`,
            channelId: channel.id,
            fields: baseChannelFields(channel),
          },
        });
      } catch (error) {
        logger.error('Error in channelCreate event:', error);
      }
    },
  },

  {
    name: Events.ChannelUpdate,
    once: false,

    async execute(before, after, client) {
      try {
        if (!after.guild) return;
        const changes = changedFields(before, after);
        if (changes.length === 0) return;

        await logEvent({
          client: client ?? after.client,
          guildId: after.guild.id,
          eventType: EVENT_TYPES.CHANNEL_UPDATE,
          data: {
            description: `Salon modifie : ${after.toString()}`,
            channelId: after.id,
            fields: [...changes, ...baseChannelFields(after)].slice(0, 25),
          },
        });
      } catch (error) {
        logger.error('Error in channelUpdate event:', error);
      }
    },
  },

  {
    name: Events.ChannelPinsUpdate,
    once: false,

    async execute(channel, pinnedMessage, client) {
      try {
        if (!channel.guild) return;
        await logEvent({
          client: client ?? channel.client,
          guildId: channel.guild.id,
          eventType: EVENT_TYPES.CHANNEL_PINS_UPDATE,
          data: {
            description: pinnedMessage
              ? `Message epingle dans ${channel.toString()}`
              : `Message de-ingle dans ${channel.toString()}`,
            channelId: channel.id,
            fields: [
              { name: '📍 Salon', value: `${channel.toString()} (\`${channel.id}\`)`, inline: true },
              {
                name: '📌 Message',
                value: pinnedMessage
                  ? `<#${pinnedMessage.id}>\n\`${(pinnedMessage.content || '*(vide)*').substring(0, 500)}\``
                  : '*message de-ingle*',
                inline: false,
              },
            ],
          },
        });
      } catch (error) {
        logger.error('Error in channelPinsUpdate event:', error);
      }
    },
  },

  {
    name: Events.ThreadCreate,
    once: false,

    async execute(thread, client) {
      try {
        if (!thread.guild) return;
        await logEvent({
          client: client ?? thread.client,
          guildId: thread.guild.id,
          eventType: EVENT_TYPES.THREAD_CREATE,
          data: {
            description: `Fil cree : ${thread.toString()}`,
            channelId: thread.id,
            fields: threadFields(thread),
          },
        });
      } catch (error) {
        logger.error('Error in threadCreate event:', error);
      }
    },
  },

  {
    name: Events.ThreadUpdate,
    once: false,

    async execute(before, after, client) {
      try {
        if (!after.guild) return;
        const changes = [];
        if (before.name !== after.name) {
          changes.push({ name: '📝 Nom', value: `\`${before.name}\` → \`${after.name}\``, inline: false });
        }
        if (before.locked !== after.locked) {
          changes.push({
            name: '🔒 Verrouillage',
            value: `${before.locked ? 'Oui' : 'Non'} → ${after.locked ? 'Oui' : 'Non'}`,
            inline: true,
          });
        }
        if (before.archived !== after.archived) {
          changes.push({
            name: '📦 Archivage',
            value: `${before.archived ? 'Oui' : 'Non'} → ${after.archived ? 'Oui' : 'Non'}`,
            inline: true,
          });
        }
        if (changes.length === 0) return;

        await logEvent({
          client: client ?? after.client,
          guildId: after.guild.id,
          eventType: EVENT_TYPES.THREAD_UPDATE,
          data: {
            description: `Fil modifie : ${after.toString()}`,
            channelId: after.id,
            fields: [...changes, ...threadFields(after)].slice(0, 25),
          },
        });
      } catch (error) {
        logger.error('Error in threadUpdate event:', error);
      }
    },
  },

  {
    name: Events.ThreadDelete,
    once: false,

    async execute(thread, client) {
      try {
        if (!thread.guild) return;
        await logEvent({
          client: client ?? thread.client,
          guildId: thread.guild.id,
          eventType: EVENT_TYPES.THREAD_DELETE,
          data: {
            description: `Fil supprime : ${thread.name ?? 'Fil inconnu'}`,
            channelId: thread.id,
            fields: [
              { name: '📝 Nom', value: thread.name ?? '*inconnu*', inline: true },
              { name: '🆔 ID', value: thread.id, inline: true },
              { name: '💬 Messages', value: (thread.messageCount ?? 0).toString(), inline: true },
            ],
          },
        });
      } catch (error) {
        logger.error('Error in threadDelete event:', error);
      }
    },
  },
];
