import { EmbedBuilder, MessageFlags } from 'discord.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { logger } from '../../utils/logger.js';
import { handleInteractionError, createError, ErrorTypes } from '../../utils/errorHandler.js';
import { getColor } from '../../config/bot.js';
import { logEvent, EVENT_TYPES } from '../../services/loggingService.js';
import { getReactionRoleMessage } from '../../services/reactionRoleService.js';

export async function handleReactionRolesSelectMenu(interaction, client) {
    try {
        const deferSuccess = await InteractionHelper.safeDefer(interaction, { flags: MessageFlags.Ephemeral });
        if (!deferSuccess) return;

        if (!interaction.inGuild() || !interaction.guild || !interaction.member) {
            throw createError(
                'Reaction role interaction used outside a guild context',
                ErrorTypes.VALIDATION,
                'Ce menu de rôles de réaction ne peut être utilisé que dans un serveur.',
                { userId: interaction.user.id }
            );
        }

        logger.debug(`Reaction role select menu interaction by ${interaction.user.tag} on message ${interaction.message.id}`);

        const reactionRoleData = await getReactionRoleMessage(client, interaction.guildId, interaction.message.id);

        if (!reactionRoleData) {
            logger.warn(`Reaction role data not found for message ${interaction.message.id} in guild ${interaction.guildId}`);
            return await InteractionHelper.sendErrorNotice(interaction, 'Ce message de rôles de réaction n\'est plus actif.');
        }

        const member = interaction.member;
        const selectedRoleIds = interaction.values;

        const me = interaction.guild.members.me ?? await interaction.guild.members.fetchMe().catch(() => null);

        if (!me) {
            throw createError(
                'Unable to fetch bot member for permission validation',
                ErrorTypes.PERMISSION,
                'Je n\'ai pas pu vérifier mes permissions sur le serveur. Réessaie.',
                { guildId: interaction.guildId }
            );
        }

        if (!me.permissions.has('ManageRoles')) {
            throw createError(
                'Bot missing ManageRoles permission',
                ErrorTypes.PERMISSION,
                'Je n\'ai pas la permission de gérer les rôles sur ce serveur.',
                { guildId: interaction.guildId }
            );
        }

        const botRolePosition = me.roles.highest.position;

        const availableRoleIds = Array.isArray(reactionRoleData.roles)
            ? reactionRoleData.roles
            : (typeof reactionRoleData.roles === 'object' ? Object.values(reactionRoleData.roles) : []);

        const addedRoles = [];
        const removedRoles = [];
        const skippedRoles = [];

        for (const roleId of selectedRoleIds) {
            if (!availableRoleIds.includes(roleId)) {
                logger.warn(`Role ${roleId} not in available roles for message ${interaction.message.id}`);
                continue;
            }

            const role = interaction.guild.roles.cache.get(roleId);
            if (!role) {
                logger.warn(`Role ${roleId} not found in guild ${interaction.guildId}`);
                skippedRoles.push(roleId);
                continue;
            }

            const roleHasDangerousPermissions = role.permissions.has([
                'Administrator',
                'ManageGuild',
                'ManageRoles',
                'ManageChannels',
                'ManageWebhooks',
                'BanMembers',
                'KickMembers',
                'MentionEveryone'
            ]);

            if (role.managed || roleHasDangerousPermissions) {
                logger.warn(`Blocked self-assignment for protected role ${role.name} (${roleId})`);
                skippedRoles.push(role.name);
                continue;
            }

            if (role.position >= botRolePosition) {
                logger.warn(`Cannot assign role ${role.name} (${roleId}), hierarchy issue`);
                skippedRoles.push(role.name);
                continue;
            }

            if (!member.roles.cache.has(roleId)) {
                try {
                    await member.roles.add(role);
                    addedRoles.push(role.name);
                    logger.debug(`Added role ${role.name} to ${member.user.tag}`);
                } catch (roleError) {
                    logger.error(`Failed to add role ${role.name} to ${member.user.tag}:`, roleError);
                    skippedRoles.push(role.name);
                }
            }
        }

        for (const roleId of availableRoleIds) {
            if (selectedRoleIds.includes(roleId)) continue;

            const role = interaction.guild.roles.cache.get(roleId);
            if (!role) continue;

            if (role.position >= botRolePosition) continue;

            if (member.roles.cache.has(roleId)) {
                try {
                    await member.roles.remove(role);
                    removedRoles.push(role.name);
                    logger.debug(`Removed role ${role.name} from ${member.user.tag}`);
                } catch (roleError) {
                    logger.error(`Failed to remove role ${role.name} from ${member.user.tag}:`, roleError);
                }
            }
        }

        let description = '🎭 **Rôles mis à jour avec succès !**\n\n';

        if (addedRoles.length > 0) {
            description += `✅ **Ajoutés :** ${addedRoles.map(name => `**${name}**`).join(', ')}\n`;
        }

        if (removedRoles.length > 0) {
            description += `❌ **Retirés :** ${removedRoles.map(name => `**${name}**`).join(', ')}\n`;
        }

        if (addedRoles.length === 0 && removedRoles.length === 0) {
            description += 'Aucun changement n\'a été apporté à tes rôles.';
        }

        if (skippedRoles.length > 0) {
            description += `\n⚠️ **Ignorés :** ${skippedRoles.length} rôle${skippedRoles.length !== 1 ? 's' : ''} (problèmes de permission)`;
        }

        const responseEmbed = new EmbedBuilder()
            .setDescription(description)
            .setColor(getColor('success'))
            .setTimestamp();

        await interaction.editReply({ content: '\u200B', components: [] });

        if (addedRoles.length > 0 || removedRoles.length > 0) {
            try {
                await logEvent({
                    client,
                    guildId: interaction.guildId,
                    eventType: EVENT_TYPES.REACTION_ROLE_UPDATE,
                    data: {
                        description: `Rôles de réaction mis à jour pour ${member.user.tag}`,
                        userId: member.user.id,
                        channelId: interaction.channelId,
                        fields: [
                            {
                                name: '👤 Membre',
                                value: `${member.user.tag} (${member.user.id})`,
                                inline: false
                            },
                            ...(addedRoles.length > 0 ? [{
                                name: '✅ Rôles ajoutés',
                                value: addedRoles.join(', '),
                                inline: false
                            }] : []),
                            ...(removedRoles.length > 0 ? [{
                                name: '❌ Rôles retirés',
                                value: removedRoles.join(', '),
                                inline: false
                            }] : [])
                        ]
                    }
                });
            } catch (logError) {
                logger.warn('Failed to log reaction role update:', logError);
            }
        }

        logger.info(`Reaction roles updated for ${member.user.tag}: +${addedRoles.length}, -${removedRoles.length}`);

    } catch (error) {
        await handleInteractionError(interaction, error, {
            type: 'select_menu',
            customId: 'reaction_roles'
        });
    }
}
