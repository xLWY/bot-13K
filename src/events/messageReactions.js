import { Events } from 'discord.js';
import { logEvent, EVENT_TYPES } from '../services/loggingService.js';
import { logger } from '../utils/logger.js';

// Tres bruyants : desactives par defaut (voir DEFAULT_OFF_EVENT_TYPES).
// Pour les activer : /logs puis activer reaction.add et reaction.remove.
async function sendReactionLog(client, eventType, reaction, user, clientArg, removed) {
  try {
    if (!reaction.message.guild) return;

    const guild = reaction.message.guild;
    const emoji = reaction.emoji.toString();

    await logEvent({
      client: clientArg ?? reaction.client,
      guildId: guild.id,
      eventType,
      data: {
        description: removed
          ? `${user} a retire ${emoji} dans ${reaction.message.channel.toString()}`
          : `${user} a ajoute ${emoji} dans ${reaction.message.channel.toString()}`,
        userId: user.id,
        channelId: reaction.message.channel.id,
        fields: [
          { name: '😀 Emoji', value: emoji, inline: true },
          { name: '🧑 Utilisateur', value: `<@${user.id}>`, inline: true },
          { name: '📍 Salon', value: reaction.message.channel.toString(), inline: true },
          {
            name: '💬 Message',
            value: `<#${reaction.message.channelId}>\n\`${(reaction.message.content || '*(vide)*').substring(0, 300)}\``,
            inline: false,
          },
        ],
      },
    });
  } catch (error) {
    logger.error('Error in reaction log event:', error);
  }
}

export default [
  {
    name: Events.MessageReactionAdd,
    once: false,

    async execute(reaction, user, clientArg) {
      if (!user || user.bot) return;
      await sendReactionLog(null, EVENT_TYPES.MESSAGE_REACTION_ADD, reaction, user, clientArg, false);
    },
  },

  {
    name: Events.MessageReactionRemove,
    once: false,

    async execute(reaction, user, clientArg) {
      if (!user || user.bot) return;
      await sendReactionLog(null, EVENT_TYPES.MESSAGE_REACTION_REMOVE, reaction, user, clientArg, true);
    },
  },
];
