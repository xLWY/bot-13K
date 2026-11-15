import { PermissionFlagsBits } from 'discord.js';
import { getGuildConfig } from '../services/guildConfig.js';
import { getTicketData } from './database.js';
import { isBotOwner } from './ownerIds.js';
import { getTicketStaffRoleIds } from './ticketStaffRoles.js';

export async function getTicketPermissionContext({ client, interaction }) {
  const guildId = interaction.guildId;
  const channelId = interaction.channelId;

  const [config, ticketData] = await Promise.all([
    getGuildConfig(client, guildId),
    getTicketData(guildId, channelId)
  ]);

  const hasManageChannels = isBotOwner(interaction.user.id)
    || Boolean(interaction.member?.permissions?.has(PermissionFlagsBits.ManageChannels));
  const staffRoleIds = getTicketStaffRoleIds(config);
  const hasTicketStaffRole = Boolean(
    interaction.member?.roles?.cache &&
    staffRoleIds.some((roleId) => interaction.member.roles.cache.has(roleId))
  );
  const isTicketCreator = Boolean(ticketData?.userId && ticketData.userId === interaction.user.id);

  return {
    config,
    ticketData,
    hasManageChannels,
    hasTicketStaffRole,
    isTicketCreator,
    canManageTicket: hasManageChannels || hasTicketStaffRole,
    canCloseTicket: hasManageChannels || hasTicketStaffRole || isTicketCreator,
  };
}
