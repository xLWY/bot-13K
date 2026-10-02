import { Events, AuditLogEvent } from 'discord.js';
import { logEvent, EVENT_TYPES } from '../services/loggingService.js';
import { logger } from '../utils/logger.js';

const AUDIT_ACTIONS = new Set([
  AuditLogEvent.ChannelCreate,
  AuditLogEvent.ChannelUpdate,
  AuditLogEvent.ChannelDelete,
  AuditLogEvent.ChannelOverwriteCreate,
  AuditLogEvent.ChannelOverwriteUpdate,
  AuditLogEvent.ChannelOverwriteDelete,
  AuditLogEvent.MemberBan,
  AuditLogEvent.MemberUnban,
  AuditLogEvent.MemberKick,
  AuditLogEvent.MemberRoleUpdate,
  AuditLogEvent.MemberMove,
  AuditLogEvent.MemberDisconnect,
  AuditLogEvent.RoleCreate,
  AuditLogEvent.RoleUpdate,
  AuditLogEvent.RoleDelete,
  AuditLogEvent.InviteCreate,
  AuditLogEvent.InviteDelete,
  AuditLogEvent.WebhookCreate,
  AuditLogEvent.WebhookUpdate,
  AuditLogEvent.WebhookDelete,
  AuditLogEvent.EmojiCreate,
  AuditLogEvent.EmojiUpdate,
  AuditLogEvent.EmojiDelete,
  AuditLogEvent.IntegrationCreate,
  AuditLogEvent.IntegrationUpdate,
  AuditLogEvent.IntegrationDelete,
  AuditLogEvent.AutoModerationRuleCreate,
  AuditLogEvent.AutoModerationRuleUpdate,
  AuditLogEvent.AutoModerationRuleDelete,
  AuditLogEvent.MessagePin,
  AuditLogEvent.MessageUnpin,
]);

function truncate(value, max = 900) {
  const str = String(value ?? '');
  return str.length > max ? `${str.substring(0, max - 3)}...` : str;
}

export default [
  {
    name: Events.GuildBanAdd,
    once: false,

    async execute(ban, client) {
      try {
        if (!ban.guild) return;
        await logEvent({
          client: client ?? ban.client,
          guildId: ban.guild.id,
          eventType: EVENT_TYPES.GUILD_BAN,
          data: {
            description: `<@${ban.user.id}> a ete banni du serveur`,
            userId: ban.user.id,
            fields: [
              { name: '👤 Membre', value: `<@${ban.user.id}> (${ban.user.id})`, inline: true },
              { name: '📛 Pseudo', value: truncate(`${ban.user.tag}`, 100), inline: true },
              { name: '🔨 Raison', value: truncate(ban.reason || '*non precisee*', 500), inline: false },
            ],
          },
        });
      } catch (error) {
        logger.error('Error in guildBanAdd event:', error);
      }
    },
  },

  {
    name: Events.GuildBanRemove,
    once: false,

    async execute(ban, client) {
      try {
        if (!ban.guild) return;
        await logEvent({
          client: client ?? ban.client,
          guildId: ban.guild.id,
          eventType: EVENT_TYPES.GUILD_UNBAN,
          data: {
            description: `<@${ban.user.id}> a ete debanni du serveur`,
            userId: ban.user.id,
            fields: [
              { name: '👤 Membre', value: `<@${ban.user.id}> (${ban.user.id})`, inline: true },
              { name: '📛 Pseudo', value: truncate(`${ban.user.tag}`, 100), inline: true },
            ],
          },
        });
      } catch (error) {
        logger.error('Error in guildBanRemove event:', error);
      }
    },
  },

  {
    name: Events.GuildAuditLogEntryCreate,
    once: false,

    async execute(entry, guild, client) {
      try {
        if (!guild || !entry) return;
        if (!AUDIT_ACTIONS.has(entry.action)) return;

        await logEvent({
          client: client ?? guild.client,
          guildId: guild.id,
          eventType: EVENT_TYPES.AUDIT_LOG,
          data: {
            description: `Action d'administration : **${AuditLogEvent[entry.action] ?? entry.action}**`,
            userId: entry.executor?.id,
            fields: [
              {
                name: '🧑‍⚖️ Executant',
                value: entry.executor ? `<@${entry.executor.id}>` : '*inconnu*',
                inline: true,
              },
              {
                name: '🔢 Code action',
                value: `\`${entry.action}\``,
                inline: true,
              },
              {
                name: '🎯 Cible',
                value: entry.targetId ? `\`${entry.targetId}\`` : '*aucune*',
                inline: true,
              },
              {
                name: '📋 Modifications',
                value: truncate(
                  entry.changes && entry.changes.length
                    ? entry.changes
                        .map(c => `**${c.key}** : \`${truncate(JSON.stringify(c.new_value ?? c.old_value), 200)}\``)
                        .join('\n')
                    : '*aucune*',
                ),
                inline: false,
              },
              {
                name: '🔨 Raison',
                value: truncate(entry.reason || '*non precisee*', 300),
                inline: false,
              },
            ],
          },
        });
      } catch (error) {
        logger.error('Error in guildAuditLogEntryCreate event:', error);
      }
    },
  },
];
