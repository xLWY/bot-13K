import { Events } from 'discord.js';
import { logEvent, EVENT_TYPES } from '../services/loggingService.js';
import { logger } from '../utils/logger.js';
import { getCachedMessage } from '../utils/messageCache.js';

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
      const authorIds = new Set();
      for (const message of messages.values()) {
        const cached = getCachedMessage(message.id);
        const authorId = message.author?.id ?? cached?.authorId ?? null;
        if (authorId) authorIds.add(authorId);

        if (sampled.length >= SAMPLE_SIZE) continue;

        const rawContent = message.content || cached?.content || '';
        const content = rawContent
          ? (rawContent.length > MAX_CONTENT_LENGTH
            ? `${rawContent.substring(0, MAX_CONTENT_LENGTH - 3)}...`
            : rawContent)
          : '*(vide / non disponible)*';
        const authorTag = message.author?.tag ?? cached?.authorTag ?? 'inconnu';
        sampled.push(`**${authorTag}** : ${content}`);
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
          value: authorIds.size.toString(),
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
