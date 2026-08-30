import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { createEmbed, errorEmbed, successEmbed, infoEmbed, warningEmbed } from '../../utils/embeds.js';
import { logModerationAction } from '../../utils/moderation.js';
import { logger } from '../../utils/logger.js';
import { ModerationService } from '../../services/moderationService.js';
import { handleInteractionError } from '../../utils/errorHandler.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
export default {
    data: new SlashCommandBuilder()
        .setName("unban")
        .setDescription("* Débannir un utilisateur du serveur")
        .addUserOption(option =>
            option
                .setName("target")
                .setDescription("L'utilisateur à débannir (peut être un ID ou une mention)")
                .setRequired(true)
        )
        .addStringOption(option =>
            option.setName("reason")
                .setDescription("Raison du débannissement")
                .setRequired(false)
        )
        .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers),
    category: "moderation",

    async execute(interaction, config, client) {
        const deferSuccess = await InteractionHelper.safeDefer(interaction);
        if (!deferSuccess) {
            logger.warn(`Unban interaction defer failed`, {
                userId: interaction.user.id,
                guildId: interaction.guildId,
                commandName: 'unban'
            });
            return;
        }

        try {
                const targetUser = interaction.options.getUser("target");
                const reason = interaction.options.getString("reason") || "Aucune raison fournie";

                
                const result = await ModerationService.unbanUser({
                    guild: interaction.guild,
                    user: targetUser,
                    moderator: interaction.member,
                    reason
                });

                await InteractionHelper.safeEditReply(interaction, {
                    embeds: [
                        successEmbed(
                            "✅ Utilisateur débanni",
                            `**${targetUser.tag}** a bien été débanni du serveur.\n\n**Raison :** ${reason}\n**ID de cas :** #${result.caseId}`
                        )
                    ]
                });
        } catch (error) {
            logger.error('Unban command error:', error);
            await handleInteractionError(interaction, error, { subtype: 'unban_failed' });
        }
    }
};



