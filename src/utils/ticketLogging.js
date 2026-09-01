import { EmbedBuilder, ChannelType } from 'discord.js';
import { getGuildConfig } from '../services/guildConfig.js';
import { EVENT_TYPES } from '../services/loggingService.js';
import { logger } from './logger.js';


















export async function logTicketEvent({ client, guildId, event }) {
  try {
    const guild = client.guilds.cache.get(guildId) || await client.guilds.fetch(guildId).catch(() => null);
    if (!guild) {
      logger.warn(`logTicketEvent invoked without valid guild: ${guildId}`);
      return;
    }

    const config = await getGuildConfig(client, guildId);

    const logChannelId = getLogChannelForEventType(config, event.type);
    if (!logChannelId) {
      return;
    }

    const channel = guild.channels.cache.get(logChannelId) || await guild.channels.fetch(logChannelId).catch(() => null);
    if (!channel) {
      logger.warn(`Ticket log channel not found: ${logChannelId} for event type: ${event.type}`);
      return;
    }

    const permissions = channel.permissionsFor(guild.members.me);
    if (!permissions.has(['SendMessages', 'EmbedLinks'])) {
      logger.warn(`Missing permissions in ticket log channel: ${logChannelId}`);
      return;
    }

    const embed = await createTicketLogEmbed(guild, event);
    
    const messageOptions = { embeds: [embed] };
    
    if (event.attachments && event.attachments.length > 0) {
      messageOptions.files = event.attachments;
    }

    await channel.send(messageOptions);
    logger.info(`Ticket event logged: ${event.type} in guild ${guildId}`);

  } catch (error) {
    logger.error('Error logging ticket event:', error);
  }
}







function getLogChannelForEventType(config, eventType) {
  switch (eventType) {
    case 'transcript':
      return config.ticketTranscriptChannelId || null;

    case 'open':
    case 'close':
    case 'delete':
    case 'claim':
    case 'unclaim':
    case 'priority':
      return config.ticketLogsChannelId || null;

    default:
      return null;
  }
}

function mapTicketEventType(eventType) {
  switch (eventType) {
    case 'open':
      return EVENT_TYPES.TICKET_CREATE;
    case 'close':
      return EVENT_TYPES.TICKET_CLOSE;
    case 'delete':
      return EVENT_TYPES.TICKET_DELETE;
    case 'claim':
    case 'unclaim':
      return EVENT_TYPES.TICKET_CLAIM;
    case 'priority':
      return EVENT_TYPES.TICKET_PRIORITY;
    case 'transcript':
      return EVENT_TYPES.TICKET_TRANSCRIPT;
    default:
      return null;
  }
}







async function createTicketLogEmbed(guild, event) {
  const embed = new EmbedBuilder();
  
  const eventColors = {
  open: 0x2ecc71,
  close: 0xe74c3c,
  delete: 0x8b0000,
  claim: 0x3498db,
  unclaim: 0xf39c12,
  priority: 0x9b59b6,
  transcript: 0x1abc9c
  };
  
  embed.setColor(eventColors[event.type] || 0x95a5a6);
  
  const eventInfo = getEventDisplayInfo(event);
  embed.setTitle(eventInfo.title);
  embed.setDescription(eventInfo.description);
  
  embed.setTimestamp();
  
  if (event.ticketId || event.ticketNumber) {
    embed.setFooter({ 
      text: `Ticket ID: ${event.ticketNumber || event.ticketId || 'Inconnu'}` 
    });
  }
  
  const fields = [];
  
  if (event.userId) {
    fields.push({
      name: '👤 Utilisateur',
      value: `<@${event.userId}> (${event.userId})`,
      inline: true
    });
  }
  
  if (event.executorId) {
    fields.push({
      name: '🔨 Exécuté par',
      value: `<@${event.executorId}> (${event.executorId})`,
      inline: true
    });
  }
  
  if (event.priority) {
    const priorityEmojis = {
      none: '⚪',
      low: '🟢',
      medium: '🟡',
      high: '🔴',
      urgent: '🚨'
    };
    
    fields.push({
      name: '🎯 Priorité',
      value: `${priorityEmojis[event.priority] || '⚪'} ${event.priority.charAt(0).toUpperCase() + event.priority.slice(1)}`,
      inline: true
    });
  }
  
  if (event.metadata) {
    const skipKeys = new Set(['ticketType', 'claimedAt', 'previousClaimer']);
    Object.entries(event.metadata).forEach(([key, value]) => {
      if (skipKeys.has(key)) return;
      if (value !== undefined && value !== null) {
        const knownLabels = {
          channelId: 'Salon',
          categoryName: 'Catégorie',
          ticketType: 'Type',
          dmSent: 'MP envoyé',
          closedAt: 'Fermé le',
          openedAt: 'Ouvert le',
          movedToClosedCategory: 'Déplacé',
          claimedAt: 'Réclamé le',
          previousClaimer: 'Ancien réclamant',
          previousPriority: 'Priorité précédente',
          updatedAt: 'Mis à jour le',
          deletedAt: 'Supprimé le',
          isPinned: 'Épinglé',
          newChannelName: 'Nouveau nom',
        };
        fields.push({
          name: `📊 ${knownLabels[key] || key.charAt(0).toUpperCase() + key.slice(1)}`,
          value: String(value),
          inline: true
        });
      }
    });
  }
  
  embed.addFields(fields);
  
  return embed;
}






function getEventDisplayInfo(event) {
  const ticketRef = event.ticketNumber ? `#${event.ticketNumber}` : event.ticketId ? `<#${event.ticketId}>` : 'Inconnu';
  
  const eventMessages = {
    open: {
      title: '🎫 Ticket Ouvert',
      description: `Un nouveau ticket a été créé : ${ticketRef}`
    },
    close: {
      title: '🔒 Ticket Fermé',
      description: `Le ticket ${ticketRef} a été fermé`
    },
    delete: {
      title: '🗑️ Ticket Supprimé',
      description: `Le ticket ${ticketRef} a été supprimé définitivement`
    },
    claim: {
      title: '🙋 Ticket Réclamé',
      description: `Le ticket ${ticketRef} a été réclamé`
    },
    unclaim: {
      title: '🔓 Ticket Non Réclamé',
      description: `Le ticket ${ticketRef} n'est plus réclamé`
    },
    priority: {
      title: '🎯 Priorité Mise à Jour',
      description: `Priorité modifiée pour le ticket ${ticketRef}`
    },
    transcript: {
      title: '📜 Transcript Créé',
      description: `Transcript généré pour le ticket ${ticketRef}`
    }
  };
  
  return eventMessages[event.type] || {
    title: '🎫 Événement de ticket',
    description: `Un événement s'est produit pour le ticket ${ticketRef}`
  };
}







export async function getTicketLoggingConfig(client, guildId) {
  const config = await getGuildConfig(client, guildId);
  return {
    enabled: !!(config.ticketLogsChannelId || config.ticketTranscriptChannelId),
    lifecycleChannelId: config.ticketLogsChannelId || null,
    transcriptChannelId: config.ticketTranscriptChannelId || null,
  };
}







export function validateLogChannel(channel, botMember) {
  if (!channel || channel.type !== ChannelType.GuildText) {
    return {
      valid: false,
      error: 'Le salon doit être un salon textuel.'
    };
  }
  
  const permissions = channel.permissionsFor(botMember);
  const requiredPermissions = ['SendMessages', 'EmbedLinks'];
  
  const missing = requiredPermissions.filter(perm => !permissions.has(perm));
  
  if (missing.length > 0) {
    return {
      valid: false,
      error: `Permissions manquantes : ${missing.join(', ')}`
    };
  }
  
  return { valid: true };
}



