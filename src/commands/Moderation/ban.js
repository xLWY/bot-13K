import { SlashCommandBuilder, PermissionFlagsBits, PermissionsBitField, ChannelType } from 'discord.js';
import { createEmbed, errorEmbed, successEmbed, infoEmbed, warningEmbed } from '../../utils/embeds.js';
import { logModerationAction } from '../../utils/moderation.js';
import { logger } from '../../utils/logger.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { ModerationService } from '../../services/moderationService.js';
import { handleInteractionError } from '../../utils/errorHandler.js';
export default {
    data: new SlashCommandBuilder()
        .setName("ban")
        .setDescription("* Bannir un utilisateur du serveur")
        .addUserOption((option) =>
            option
                .setName("target")
                .setDescription("L'utilisateur à bannir")
                .setRequired(true),
        )
        .addStringOption((option) =>
            option.setName("reason").setDescription("Raison du bannissement"),
        )
.setDefaultMemberPermissions(PermissionFlagsBits.BanMembers),
    category: "moderation",

    async execute(interaction, config, client) {
        try {
            const user = interaction.options.getUser("target");
            const reason = interaction.options.getString("reason") || "Aucune raison fournie";

            if (user.id === interaction.user.id) {
                throw new Error("Tu ne peux pas te bannir toi-même.");
            }
            if (user.id === client.user.id) {
                throw new Error("Tu ne peux pas bannir le bot.");
            }

            
            const result = await ModerationService.banUser({
                guild: interaction.guild,
                user,
                moderator: interaction.member,
                reason
            });

            await InteractionHelper.universalReply(interaction, {
                embeds: [
                    successEmbed(
                        `🚫 **Banni** ${user.tag}`,
                        `**Raison :** ${reason}\n**ID de cas :** #${result.caseId}`,
                    ),
                ],
            });
        } catch (error) {
            logger.error('Ban command error:', error);
            await handleInteractionError(interaction, error, { subtype: 'ban_failed' });
        }
    },
};



