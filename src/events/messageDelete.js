import { Events } from 'discord.js';
import { logEvent, EVENT_TYPES } from '../services/loggingService.js';
import { logger } from '../utils/logger.js';
import { getReactionRoleMessage, deleteReactionRoleMessage } from '../services/reactionRoleService.js';
import { getCachedMessage, isMessageDeletionSilent } from '../utils/messageCache.js';

const MAX_LOGGED_MESSAGE_CONTENT_LENGTH = 1024;

function truncate(value, max = MAX_LOGGED_MESSAGE_CONTENT_LENGTH) {
  const str = String(value ?? '');
  return str.length > max ? `${str.substring(0, max - 3)}...` : str;
}

export default {
  name: Events.MessageDelete,
  once: false,

  async execute(message) {
    try {
      if (!message.guild) return;

      try {
        const reactionRoleData = await getReactionRoleMessage(message.client, message.guild.id, message.id);
        if (reactionRoleData) {
          await deleteReactionRoleMessage(message.client, message.guild.id, message.id);
          logger.info(`Cleaned up reaction role database entry for manually deleted message ${message.id} in guild ${message.guild.id}`);

          try {
            await logEvent({
              client: message.client,
              guildId: message.guild.id,
              eventType: EVENT_TYPES.REACTION_ROLE_DELETE,
              data: {
                description: `Le message de rôles par réaction a été supprimé manuellement et retiré de la base de données.`,
                channelId: message.channel?.id,
                fields: [
                  {
                    name: '📍 Salon',
                    value: message.channel ? message.channel.toString() : 'Inconnu',
                    inline: true
                  }
                ]
              }
            });
          } catch (logCleanupError) {
            logger.warn('Failed to log reaction role cleanup after manual message deletion:', logCleanupError);
          }
        }
      } catch (reactionRoleCleanupError) {
        logger.warn(`Failed to clean up reaction role data for deleted message ${message.id}:`, reactionRoleCleanupError);
      }

      // Les commandes prefixe sont supprimees automatiquement apres execution.
      // On ne les journalise pas comme des suppressions de messages.
      if (isMessageDeletionSilent(message.id)) return;

      const cached = getCachedMessage(message.id);
      const authorIsBot = message.author?.bot ?? cached?.authorBot ?? false;
      if (authorIsBot) return;

      const authorId = message.author?.id ?? cached?.authorId ?? null;
      const channelId = message.channelId ?? message.channel?.id ?? cached?.channelId ?? null;
      const channelLabel = channelId ? `<#${channelId}>` : 'salon inconnu';

      const fields = [];

      
      if (authorId) {
        fields.push({
          name: '👤 Auteur',
          value: `<@${authorId}>`,
          inline: true
        });
      }

      
      fields.push({
        name: '💬 Salon',
        value: channelId ? channelLabel : '*inconnu*',
        inline: true
      });

      
      const rawContent = (typeof message.content === 'string' && message.content.length > 0)
        ? message.content
        : (cached?.content ?? '');

      fields.push({
        name: '📝 Contenu',
        value: rawContent
          ? truncate(rawContent)
          : '*pas de texte — embed/pièce jointe, ou message antérieur au démarrage du bot*',
        inline: false
      });

      
      const createdTimestamp = message.createdTimestamp ?? cached?.createdTimestamp ?? null;
      if (createdTimestamp) {
        fields.push({
          name: '📅 Créé',
          value: `<t:${Math.floor(createdTimestamp / 1000)}:R>`,
          inline: true
        });
      }

      
      const attachmentList = message.attachments?.size
        ? [...message.attachments.values()].map(a => ({ name: a.name ?? 'fichier', url: a.url }))
        : (cached?.attachments ?? []);

      if (attachmentList.length > 0) {
        const shown = attachmentList
          .slice(0, 5)
          .map(a => (a.url ? `[${truncate(a.name, 60)}](${a.url})` : truncate(a.name, 60)));
        const extra = attachmentList.length > 5 ? `\n... +${attachmentList.length - 5}` : '';
        fields.push({
          name: `📎 Pièces jointes (${attachmentList.length})`,
          value: truncate(`${shown.join('\n')}${extra}`),
          inline: false
        });
      }

      await logEvent({
        client: message.client,
        guildId: message.guild.id,
        eventType: EVENT_TYPES.MESSAGE_DELETE,
        data: {
          description: `Un message a été supprimé dans ${channelLabel}`,
          userId: authorId ?? undefined,
          channelId: channelId ?? undefined,
          fields
        }
      });

    } catch (error) {
      logger.error('Error in messageDelete event:', error);
    }
  }
};
