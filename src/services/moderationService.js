import { PermissionFlagsBits } from 'discord.js';
import { logger } from '../utils/logger.js';
import { TitanBotError, ErrorTypes } from '../utils/errorHandler.js';
import { logModerationAction } from '../utils/moderation.js';





export class ModerationService {
  






  static validateHierarchy(moderator, target, action) {
    if (!moderator || !target) {
      return { valid: false, error: 'Modérateur ou cible invalide' };
    }

    
    if (moderator.guild.ownerId === moderator.id) {
      return { valid: true };
    }

    
    if (moderator.roles.highest.position <= target.roles.highest.position) {
      return {
        valid: false,
        error: `Tu ne peux pas ${action} un utilisateur avec un rôle égal ou supérieur au tien.`
      };
    }

    return { valid: true };
  }

  






  static validateBotHierarchy(client, target, action) {
    if (!client || !target) {
      return { valid: false, error: 'Client ou cible invalide' };
    }

    const botMember = target.guild.members.me;
    if (!botMember) {
      return { valid: false, error: 'Le bot n\'est pas sur le serveur' };
    }

    
    if (botMember.roles.highest.position <= target.roles.highest.position) {
      return {
        valid: false,
        error: `Je ne peux pas ${action} un utilisateur avec un rôle égal ou supérieur au mien.`
      };
    }

    return { valid: true };
  }

  




  static async banUser({
    guild,
    user,
    moderator,
    reason = 'Aucun motif fourni',
    deleteDays = 0
  }) {
    try {
      if (!guild || !user || !moderator) {
        throw new TitanBotError(
          'Missing required parameters',
          ErrorTypes.VALIDATION,
          'Le serveur, l\'utilisateur et le modérateur sont requis'
        );
      }

      
      let targetMember = null;
      try {
        targetMember = await guild.members.fetch(user.id).catch(() => null);
      } catch (err) {
        logger.debug('Target not in guild, proceeding with ban');
      }

      // Hierarchy check
      if (targetMember) {
        const botCheck = this.validateBotHierarchy(guild.client, targetMember, 'ban');
        if (!botCheck.valid) {
          throw new TitanBotError(botCheck.error, ErrorTypes.PERMISSION, botCheck.error);
        }

        const modCheck = this.validateHierarchy(moderator, targetMember, 'ban');
        if (!modCheck.valid) {
          throw new TitanBotError(modCheck.error, ErrorTypes.PERMISSION, modCheck.error);
        }
      } else {
        // If target is not in guild, we can't check their roles easily.
        // As a safety measure, only allow users with ManageGuild or Administrator to ban non-members.
        const isOwner = guild.ownerId === moderator.id;
        const hasHighPerms = moderator.permissions.has([
            PermissionFlagsBits.ManageGuild,
            PermissionFlagsBits.Administrator
        ]);

        if (!isOwner && !hasHighPerms) {
            throw new TitanBotError(
                'You do not have sufficient permissions to ban users who are not in the server.',
                ErrorTypes.PERMISSION,
                'Tu as besoin des permissions "Gérer le serveur" ou "Administrateur" pour bannir des utilisateurs qui ne sont pas actuellement sur le serveur.'
            );
        }
      }


      
      await guild.members.ban(user.id, { reason });

      
      const caseId = await logModerationAction({
        client: guild.client,
        guild,
        event: {
          action: 'Member Banned',
          target: `${user.tag} (${user.id})`,
          executor: `${moderator.user.tag} (${moderator.id})`,
          reason,
          metadata: {
            userId: user.id,
            moderatorId: moderator.id,
            permanent: true,
            deleteDays
          }
        }
      });

      logger.info(`User banned: ${user.tag} by ${moderator.user.tag} in ${guild.name}`);
      
      return {
        success: true,
        caseId,
        user: user.tag,
        reason
      };
    } catch (error) {
      logger.error('Error banning user:', error);
      throw error;
    }
  }

  




  static async kickUser({
    guild,
    member,
    moderator,
    reason = 'Aucun motif fourni'
  }) {
    try {
      if (!guild || !member || !moderator) {
        throw new TitanBotError(
          'Missing required parameters',
          ErrorTypes.VALIDATION,
          'Le serveur, le membre et le modérateur sont requis'
        );
      }

      
      const botCheck = this.validateBotHierarchy(guild.client, member, 'kick');
      if (!botCheck.valid) {
        throw new TitanBotError(botCheck.error, ErrorTypes.PERMISSION, botCheck.error);
      }

      const modCheck = this.validateHierarchy(moderator, member, 'kick');
      if (!modCheck.valid) {
        throw new TitanBotError(modCheck.error, ErrorTypes.PERMISSION, modCheck.error);
      }

      
      if (!member.kickable) {
        throw new TitanBotError(
          'Cannot kick member',
          ErrorTypes.PERMISSION,
          'Je n\'ai pas la permission d\'expulser ce membre'
        );
      }

      
      await member.kick(reason);

      
      const caseId = await logModerationAction({
        client: guild.client,
        guild,
        event: {
          action: 'Member Kicked',
          target: `${member.user.tag} (${member.id})`,
          executor: `${moderator.user.tag} (${moderator.id})`,
          reason,
          metadata: {
            userId: member.id,
            moderatorId: moderator.id
          }
        }
      });

      logger.info(`User kicked: ${member.user.tag} by ${moderator.user.tag} in ${guild.name}`);
      
      return {
        success: true,
        caseId,
        user: member.user.tag,
        reason
      };
    } catch (error) {
      logger.error('Error kicking user:', error);
      throw error;
    }
  }

  




  static async timeoutUser({
    guild,
    member,
    moderator,
    durationMs,
    reason = 'Aucun motif fourni'
  }) {
    try {
      if (!guild || !member || !moderator || !durationMs) {
        throw new TitanBotError(
          'Missing required parameters',
          ErrorTypes.VALIDATION,
          'Le serveur, le membre, le modérateur et la durée sont requis'
        );
      }

      
      const botCheck = this.validateBotHierarchy(guild.client, member, 'timeout');
      if (!botCheck.valid) {
        throw new TitanBotError(botCheck.error, ErrorTypes.PERMISSION, botCheck.error);
      }

      const modCheck = this.validateHierarchy(moderator, member, 'timeout');
      if (!modCheck.valid) {
        throw new TitanBotError(modCheck.error, ErrorTypes.PERMISSION, modCheck.error);
      }

      
      if (!member.moderatable) {
        throw new TitanBotError(
          'Cannot timeout member',
          ErrorTypes.PERMISSION,
          'Je ne peux pas mettre ce membre en timeout'
        );
      }

      
      await member.timeout(durationMs, reason);

      
      const durationMinutes = Math.floor(durationMs / 60000);
      const caseId = await logModerationAction({
        client: guild.client,
        guild,
        event: {
          action: 'Member Timed Out',
          target: `${member.user.tag} (${member.id})`,
          executor: `${moderator.user.tag} (${moderator.id})`,
          reason,
          duration: `${durationMinutes} minutes`,
          metadata: {
            userId: member.id,
            moderatorId: moderator.id,
            durationMs
          }
        }
      });

      logger.info(`User timed out: ${member.user.tag} by ${moderator.user.tag} in ${guild.name}`);
      
      return {
        success: true,
        caseId,
        user: member.user.tag,
        duration: durationMinutes,
        reason
      };
    } catch (error) {
      logger.error('Error timing out user:', error);
      throw error;
    }
  }

  




  static async removeTimeoutUser({
    guild,
    member,
    moderator,
    reason = 'Timeout retiré par un modérateur'
  }) {
    try {
      if (!guild || !member || !moderator) {
        throw new TitanBotError(
          'Missing required parameters',
          ErrorTypes.VALIDATION,
          'Le serveur, le membre et le modérateur sont requis'
        );
      }

      
      if (!member.moderatable) {
        throw new TitanBotError(
          'Cannot modify member',
          ErrorTypes.PERMISSION,
          'Je ne peux pas modifier ce membre'
        );
      }

      
      if (!member.isCommunicationDisabled()) {
        throw new TitanBotError(
          'User not timed out',
          ErrorTypes.VALIDATION,
          `${member.user.tag} n'est actuellement pas en timeout`
        );
      }

      
      await member.timeout(null, reason);

      
      await logModerationAction({
        client: guild.client,
        guild,
        event: {
          action: 'Member Untimeouted',
          target: `${member.user.tag} (${member.id})`,
          executor: `${moderator.user.tag} (${moderator.id})`,
          reason,
          metadata: {
            userId: member.id,
            moderatorId: moderator.id
          }
        }
      });

      logger.info(`Timeout removed: ${member.user.tag} by ${moderator.user.tag} in ${guild.name}`);
      
      return {
        success: true,
        user: member.user.tag
      };
    } catch (error) {
      logger.error('Error removing timeout:', error);
      throw error;
    }
  }

  




  static async unbanUser({
    guild,
    user,
    moderator,
    reason = 'Aucun motif fourni'
  }) {
    try {
      if (!guild || !user || !moderator) {
        throw new TitanBotError(
          'Missing required parameters',
          ErrorTypes.VALIDATION,
          'Le serveur, l\'utilisateur et le modérateur sont requis'
        );
      }

      
      const bans = await guild.bans.fetch();
      const banInfo = bans.get(user.id);

      if (!banInfo) {
        throw new TitanBotError(
          'User not banned',
          ErrorTypes.VALIDATION,
          `${user.tag} n'est actuellement pas banni de ce serveur`
        );
      }

      
      await guild.members.unban(user.id, reason);

      
      const caseId = await logModerationAction({
        client: guild.client,
        guild,
        event: {
          action: 'Member Unbanned',
          target: `${user.tag} (${user.id})`,
          executor: `${moderator.user.tag} (${moderator.id})`,
          reason,
          metadata: {
            userId: user.id,
            moderatorId: moderator.id
          }
        }
      });

      logger.info(`User unbanned: ${user.tag} by ${moderator.user.tag} in ${guild.name}`);
      
      return {
        success: true,
        caseId,
        user: user.tag,
        reason
      };
    } catch (error) {
      logger.error('Error unbanning user:', error);
      throw error;
    }
  }
}
