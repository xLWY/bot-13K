import { getColor } from '../../../config/bot.js';
import { EmbedBuilder, MessageFlags } from 'discord.js';
import { getWelcomeConfig, updateWelcomeConfig } from '../../../utils/database.js';
import { logger } from '../../../utils/logger.js';
import { InteractionHelper } from '../../../utils/interactionHelper.js';
import { getGuildConfig } from '../../../services/guildConfig.js';

function roleInfoEmbed(description) {
    return new EmbedBuilder()
        .setColor(getColor('primary'))
        .setDescription(description)
        .setFooter({ text: new Date().toLocaleString() });
}

async function hasVerificationConflict(client, guildId) {
    const guildConfig = await getGuildConfig(client, guildId);
    return Boolean(guildConfig.verification?.enabled) || Boolean(guildConfig.verification?.autoVerify?.enabled);
}

export default {
    async execute(interaction, client) {
        const { options, guild } = interaction;
        const subcommand = options.getSubcommand();

        if (subcommand === 'add') {
            const role = options.getRole('role');

            if (await hasVerificationConflict(client, guild.id)) {
                return await InteractionHelper.sendErrorNotice(interaction, 'Impossible d\'activer AutoRole pendant que la vérification ou AutoVerify est activé. Désactive-les d\'abord.');
            }

            if (role.position >= guild.members.me.roles.highest.position) {
                logger.warn(`[WelcomeRole] User ${interaction.user.tag} tried to add role ${role.name} (${role.id}) higher than bot's highest role in ${guild.name}`);
                return await InteractionHelper.sendErrorNotice(interaction, 'Je ne peux pas attribuer des rôles plus hauts que mon rôle le plus haut.');
            }

            const config = await getWelcomeConfig(client, guild.id);
            const existingRoles = Array.isArray(config.roleIds) ? config.roleIds : [];

            if (existingRoles.includes(role.id)) {
                logger.info(`[WelcomeRole] User ${interaction.user.tag} tried to add duplicate role ${role.name} (${role.id}) in ${guild.name}`);
                return await InteractionHelper.sendErrorNotice(interaction, 'Ce rôle est déjà configuré comme auto-attribué.');
            }

            const updatedRoles = [...existingRoles, role.id];
            await updateWelcomeConfig(client, guild.id, { roleIds: updatedRoles });

            logger.info(`[WelcomeRole] Added auto-role ${role.name} (${role.id}) in ${guild.name} by ${interaction.user.tag}`);
            return await InteractionHelper.safeEditReply(interaction, {
                embeds: [roleInfoEmbed(`✅ Auto-role configuré : ${role}.`)],
                flags: MessageFlags.Ephemeral,
            });
        }

        if (subcommand === 'remove') {
            const role = options.getRole('role');
            const config = await getWelcomeConfig(client, guild.id);
            const existingRoles = Array.isArray(config.roleIds) ? config.roleIds : [];

            if (!existingRoles.includes(role.id)) {
                logger.info(`[WelcomeRole] User ${interaction.user.tag} tried to remove non-existent role ${role.name} (${role.id}) in ${guild.name}`);
                return await InteractionHelper.sendErrorNotice(interaction, `Le rôle ${role} n'est pas configuré comme auto-attribué.`);
            }

            const updatedRoles = existingRoles.filter(id => id !== role.id);
            await updateWelcomeConfig(client, guild.id, { roleIds: updatedRoles });

            logger.info(`[WelcomeRole] Removed role ${role.name} (${role.id}) from auto-assign in ${guild.name} by ${interaction.user.tag}`);
            return await InteractionHelper.safeEditReply(interaction, {
                embeds: [roleInfoEmbed(`✅ ${role} retiré des rôles auto-attribués.`)],
                flags: MessageFlags.Ephemeral,
            });
        }

        if (subcommand === 'list') {
            const config = await getWelcomeConfig(client, guild.id);
            const autoRoles = Array.isArray(config.roleIds) ? config.roleIds : [];

            if (autoRoles.length === 0) {
                return InteractionHelper.safeEditReply(interaction, {
                    embeds: [roleInfoEmbed('ℹ️ Aucun rôle n\'est configuré comme auto-attribué.')],
                    flags: MessageFlags.Ephemeral,
                });
            }

            const roles = await guild.roles.fetch();
            const validRoles = [];
            const invalidRoleIds = [];

            for (const roleId of autoRoles) {
                const role = roles.get(roleId);
                if (role) validRoles.push(role);
                else invalidRoleIds.push(roleId);
            }

            if (invalidRoleIds.length > 0) {
                logger.info(`[WelcomeRole] Cleaning up ${invalidRoleIds.length} invalid role(s) from guild ${guild.name}`);
                await updateWelcomeConfig(client, guild.id, {
                    roleIds: autoRoles.filter(id => !invalidRoleIds.includes(id)),
                });
            }

            if (validRoles.length === 0) {
                return InteractionHelper.safeEditReply(interaction, {
                    embeds: [roleInfoEmbed('ℹ️ Aucun auto-role valide. Les rôles invalides ont été retirés.')],
                    flags: MessageFlags.Ephemeral,
                });
            }

            const embed = new EmbedBuilder()
                .setColor(getColor('info'))
                .setTitle('Rôles auto-attribués')
                .setDescription(validRoles.join('\n'))
                .setFooter({ text: 'Utilise /welcome role add ou role remove pour modifier ces rôles.' });

            return await InteractionHelper.safeEditReply(interaction, {
                embeds: [embed],
                flags: MessageFlags.Ephemeral,
            });
        }
    },
};
