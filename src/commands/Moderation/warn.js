import { SlashCommandBuilder, PermissionFlagsBits, PermissionsBitField, ChannelType, MessageFlags } from 'discord.js';
import { createEmbed, errorEmbed, successEmbed, infoEmbed, warningEmbed } from '../../utils/embeds.js';
import { logModerationAction } from '../../utils/moderation.js';
import { logger } from '../../utils/logger.js';
import { WarningService } from '../../services/warningService.js';
import { handleInteractionError } from '../../utils/errorHandler.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
export default {
    data: new SlashCommandBuilder()
        .setName("warn")
        .setDescription("* Avertir un utilisateur")
        .addUserOption((o) =>
            o
                .setName("target")
                .setRequired(true)
                .setDescription("Utilisateur à avertir"),
        )
        .addStringOption((o) =>
            o
                .setName("reason")
                .setRequired(true)
                .setDescription("Raison de l'avertissement"),
        )
        .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),
    category: "moderation",

    async execute(interaction, config, client) {
        const deferSuccess = await InteractionHelper.safeDefer(interaction);
        if (!deferSuccess) {
            logger.warn(`Warn interaction defer failed`, {
                userId: interaction.user.id,
                guildId: interaction.guildId,
                commandName: 'warn'
            });
            return;
        }

        try {
                if (!interaction.member.permissions.has(PermissionFlagsBits.ModerateMembers)) {
                    throw new Error("Tu as besoin de la permission `Modérer les membres` pour émettre des avertissements.");
                }

                const target = interaction.options.getUser("target");
                const member = interaction.options.getMember("target");
                const reason = interaction.options.getString("reason");
                const moderator = interaction.user;
                const guildId = interaction.guildId;

                if (!member) {
                    throw new Error("L'utilisateur ciblé n'est actuellement pas dans ce serveur.");
                }

                
                const result = await WarningService.addWarning({
                    guildId,
                    userId: target.id,
                    moderatorId: moderator.id,
                    reason,
                    timestamp: Date.now()
                });

                if (!result.success) {
                    throw new Error("Échec de l'enregistrement de l'avertissement en base de données");
                }

                const totalWarns = result.totalCount;

                await logModerationAction({
                    client,
                    guild: interaction.guild,
                    event: {
                        action: "User Warned",
                        target: `${target.tag} (${target.id})`,
                        executor: `${moderator.tag} (${moderator.id})`,
                        reason,
                        metadata: {
                            userId: target.id,
                            moderatorId: moderator.id,
                            totalWarns,
                            warningNumber: totalWarns,
                            warningId: result.id
                        }
                    }
                });

                await InteractionHelper.safeEditReply(interaction, {
                    embeds: [
                        successEmbed(
                            `⚠️ **Averti** ${target.tag}`,
                            `**Raison :** ${reason}\n**Total d'avertissements :** ${totalWarns}`,
                        ),
                    ],
                });
        } catch (error) {
            logger.error('Warn command error:', error);
            await handleInteractionError(interaction, error, { subtype: 'warn_failed' });
        }
    }
};



