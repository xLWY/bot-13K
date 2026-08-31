




import { PermissionFlagsBits } from 'discord.js';
import { logger } from './logger.js';
import { InteractionHelper } from './interactionHelper.js';






export function isAdmin(member) {
  if (!member) return false;
  return member.permissions.has(PermissionFlagsBits.Administrator);
}






export function isModerator(member) {
  if (!member) return false;
  return member.permissions.has([
    PermissionFlagsBits.Administrator,
    PermissionFlagsBits.ManageGuild
  ]);
}







export function hasPermission(member, permissions) {
  if (!member) return false;
  return member.permissions.has(permissions);
}







export function botHasPermission(channel, permissions) {
  if (!channel || !channel.guild) return false;
  const botMember = channel.guild.members.me;
  if (!botMember) return false;
  return channel.permissionsFor(botMember).has(permissions);
}








export async function checkUserPermissions(
  interaction,
  requiredPermissions,
  errorMessage = 'Tu n\'as pas la permission d\'utiliser cette commande.'
) {
  const member = interaction.member;
  
  if (!member.permissions.has(requiredPermissions)) {
    await InteractionHelper.sendErrorNotice(interaction, errorMessage);

    logger.warn(
      `[PERMISSION_DENIED] User ${member.id} attempted command ${interaction.commandName} in guild ${interaction.guildId}`
    );
    return false;
  }
  
  return true;
}








export async function checkBotPermissions(
  interaction,
  requiredPermissions,
  channel = null
) {
  const targetChannel = channel || interaction.channel;
  
  if (!targetChannel || !targetChannel.guild) {
    await InteractionHelper.sendErrorNotice(interaction, "impossible de déterminer le salon.");
    return false;
  }
  
  const botMember = targetChannel.guild.members.me;
  if (!botMember) {
    await InteractionHelper.sendErrorNotice(interaction, "membre du bot introuvable dans ce serveur.");
    return false;
  }
  
  const permissions = targetChannel.permissionsFor(botMember);
  const missingPerms = [];
  
  const permArray = Array.isArray(requiredPermissions) ? requiredPermissions : [requiredPermissions];
  for (const perm of permArray) {
    if (!permissions.has(perm)) {
      missingPerms.push(perm);
    }
  }
  
  if (missingPerms.length > 0) {
    await InteractionHelper.sendErrorNotice(
      interaction,
      `permissions manquantes dans ${targetChannel} : ${missingPerms.join(', ')}`
    );
    
    logger.warn(
      `[BOT_PERMISSION_DENIED] Bot missing permissions [${missingPerms.join(', ')}] in channel ${targetChannel.id}`
    );
    return false;
  }
  
  return true;
}






function hashUserId(userId) {
  
  let hash = 0;
  for (let i = 0; i < userId.length; i++) {
    const char = userId.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; 
  }
  return Math.abs(hash).toString(16).substring(0, 8);
}








export function auditPermissionCheck(userId, action, allowed, reason = null) {
  
  const userHash = hashUserId(userId);
  
  
  if (allowed) {
    logger.debug('[PERMISSION_AUDIT] Permission granted', { action, userHash });
  } else {
    const denyReason = reason || 'insufficient_permissions';
    logger.warn('[PERMISSION_AUDIT] Permission denied', { action, userHash, reason: denyReason });
  }
}

export default {
  isAdmin,
  isModerator,
  hasPermission,
  botHasPermission,
  checkUserPermissions,
  checkBotPermissions,
  auditPermissionCheck
};


