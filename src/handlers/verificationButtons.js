import { MessageFlags } from 'discord.js';
import { successEmbed } from '../utils/embeds.js';
import { verifyUser } from '../services/verificationService.js';
import { handleInteractionError } from '../utils/errorHandler.js';
import { logger } from '../utils/logger.js';
import { InteractionHelper } from '../utils/interactionHelper.js';








export async function handleVerificationButton(interaction, client) {
    try {
        await InteractionHelper.safeDefer(interaction, { flags: MessageFlags.Ephemeral });

        if (!interaction.guild) {
            return await InteractionHelper.sendErrorNotice(interaction, "Ce bouton ne peut être utilisé que dans un serveur.");
        }

        const guild = interaction.guild;
        const userId = interaction.user.id;

        logger.debug('User clicked verify button', {
            guildId: guild.id,
            userId,
            userTag: interaction.user.tag
        });

        
        const result = await verifyUser(client, guild.id, userId, {
            source: 'button_click',
            moderatorId: null
        });

        if (!result.success) {
            if (result.alreadyVerified) {
                return await InteractionHelper.sendErrorNotice(interaction, "Tu es déjà vérifié et tu as accès à tous les salons du serveur.");
            }

            return await InteractionHelper.sendErrorNotice(interaction, "Une erreur est survenue lors de la vérification. Réessaie ou contacte un administrateur.");
        }

        
        logger.info('User verified via button', {
            guildId: guild.id,
            userId,
            roleName: result.roleName
        });

        await InteractionHelper.safeEditReply(interaction, {
            embeds: [successEmbed(
                "✅ Vérification réussie !",
                `Tu as été vérifié et tu as reçu le rôle **${result.roleName}** !\n\nTu as maintenant accès à tous les salons et fonctionnalités du serveur. Bienvenue ! 🎉`
            )],
        });

    } catch (error) {
        logger.error('Error in verification button handler', {
            error: error.message,
            guildId: interaction.guild?.id,
            userId: interaction.user.id
        });

        
        await handleInteractionError(
            interaction,
            error,
            { command: 'verify_button', action: 'verification' }
        );
    }
}

export default {
    customId: "verify_user",
    execute: handleVerificationButton
};
