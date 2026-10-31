import { Events } from 'discord.js';
import { logEvent, EVENT_TYPES } from '../services/loggingService.js';
import { logger } from '../utils/logger.js';
import { cacheMessage, getCachedMessage } from '../utils/messageCache.js';

const MAX_LOGGED_EDIT_CONTENT_LENGTH = 512;

export default {
  name: Events.MessageUpdate,
  once: false,

  async execute(oldMessage, newMessage) {
    try {
      if (!newMessage.guild || newMessage.author?.bot) return;

      // Evenement partiel (embed modifie, message non cache) : pas de contenu
      // exploitable, on evite de logguer une fausse edition.
      if (typeof newMessage.content !== 'string') return;

      const cachedOld = getCachedMessage(newMessage.id);
      const oldContentRaw = oldMessage.content || cachedOld?.content || '';

      if (oldContentRaw === newMessage.content) {
        cacheMessage(newMessage);
        return;
      }

      const fields = [];

      
      if (newMessage.author) {
        fields.push({
          name: '👤 Auteur',
          value: `<@${newMessage.author.id}>`,
          inline: true
        });
      }

      
      fields.push({
        name: '💬 Salon',
        value: newMessage.channel.toString(),
        inline: true
      });

      
      const oldContent = oldContentRaw || '*(message vide)*';
      const oldContentTruncated = oldContent.length > MAX_LOGGED_EDIT_CONTENT_LENGTH 
        ? oldContent.substring(0, MAX_LOGGED_EDIT_CONTENT_LENGTH - 3) + '...' 
        : oldContent;
      fields.push({
        name: '📝 Ancien contenu',
        value: oldContentTruncated,
        inline: false
      });

      
      const newContent = newMessage.content || '*(message vide)*';
      const newContentTruncated = newContent.length > MAX_LOGGED_EDIT_CONTENT_LENGTH 
        ? newContent.substring(0, MAX_LOGGED_EDIT_CONTENT_LENGTH - 3) + '...' 
        : newContent;
      fields.push({
        name: '📝 Nouveau contenu',
        value: newContentTruncated,
        inline: false
      });

      await logEvent({
        client: newMessage.client,
        guildId: newMessage.guild.id,
        eventType: EVENT_TYPES.MESSAGE_EDIT,
        data: {
          description: `Un message a été modifié dans ${newMessage.channel.toString()}`,
          userId: newMessage.author?.id,
          channelId: newMessage.channel.id,
          fields
        }
      });

      // Garde le contenu edite pour un futur log de suppression.
      cacheMessage(newMessage);

    } catch (error) {
      logger.error('Error in messageUpdate event:', error);
    }
  }
};
