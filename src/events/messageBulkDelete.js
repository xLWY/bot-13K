import { Events } from 'discord.js';
import { logEvent, EVENT_TYPES } from '../services/loggingService.js';
import { logger } from '../utils/logger.js';

const SAMPLE_SIZE = 5;
const MAX_CONTENT_LENGTH = 250;

export default {
  name: Events.MessageBulkDelete,
  once: false,

  async execute(messages, channelId) {
    try {
      if (!messages || messages.size === 0) return;

      const client = messages.first()?.client
        ?? messages.filter(m => m.client).first()?.client;
      if (!client) return;

      let guildId = null;
      for (const message of messages.values()) {
        if (message.guildId) {
          guildId = message.guildId;
          break;
        }
      }
      if (!guildId) return;

      const guild = client.guilds.cache.get(guildId);
      if (!guild) return;

      const channel = messages.first()?.channel ?? guild.channels.cache.get(channelId);
      const channelLabel = channel ? channel.toString() : `\`${channelId}\``;

      const sampled = [];
      for (const message of messages.values()) {
        if (sampled.length >= SAMPLE_SIZE) break;
        const content = message.content
          ? (message.content.length > MAX_CONTENT_LENGTH
            ? `${message.content.substring(0, MAX_CONTENT_LENGTH - 3)}...`
            : message.content)
          : '*(vide)*';
        sampled.push(`**${message.author?.tag ?? 'inconnu'}** : ${content}`);
      }

      const fields = [
        {
          name: '🔢 Nombre de messages',
          value: messages.size.toString(),
          inline: true
        },
        {
          name: '📍 Salon',
          value: `${channelLabel} (\`${channelId}\`)`,
          inline: true
        },
        {
          name: '👥 Auteurs distincts',
          value: new Set([...messages.values()].map(m => m.author?.id)).size.toString(),
          inline: true
        }
      ];

      if (sampled.length > 0) {
        fields.push({
          name: `📝 Échantillon (${sampled.length}/${messages.size})`,
          value: sampled.join('\n'),
          inline: false
        });
      }

      await logEvent({
        client,
        guildId,
        eventType: EVENT_TYPES.MESSAGE_BULK_DELETE,
        data: {
          description: `Suppression en masse de ${messages.size} message(s) dans ${channelLabel}`,
          channelId,
          fields
        }
      });
    } catch (error) {
      logger.error('Error in messageBulkDelete event:', error);
    }
  }
};
