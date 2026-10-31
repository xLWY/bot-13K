import { Events } from 'discord.js';
import { logEvent, EVENT_TYPES } from '../services/loggingService.js';
import { logger } from '../utils/logger.js';

export default {
  name: Events.GuildMemberUpdate,
  once: false,

  async execute(oldMember, newMember) {
    try {
      if (!newMember.guild) return;

      const fields = [];

      
      fields.push({
        name: '👤 Membre',
        value: `<@${newMember.user.id}>`,
        inline: true
      });

      
      if (oldMember.nickname !== newMember.nickname) {
        fields.push({
          name: '🏷️ Ancien pseudo',
          value: oldMember.nickname || '*(aucun pseudo)*',
          inline: true
        });

        fields.push({
          name: '🏷️ Nouveau pseudo',
          value: newMember.nickname || '*(aucun pseudo)*',
          inline: true
        });

        await logEvent({
          client: newMember.client,
          guildId: newMember.guild.id,
          eventType: EVENT_TYPES.MEMBER_NAME_CHANGE,
          data: {
            description: `Le pseudo de <@${newMember.user.id}> a été modifié`,
            userId: newMember.user.id,
            fields
          }
        });

        return;
      }

    } catch (error) {
      logger.error('Error in guildMemberUpdate event:', error);
    }
  }
};
