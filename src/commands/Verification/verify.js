import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import { infoEmbed, successEmbed } from '../../utils/embeds.js';
import { withErrorHandling } from '../../utils/errorHandler.js';
import { verifyUser } from '../../services/verificationService.js';
import { logger } from '../../utils/logger.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';

export default {
    data: new SlashCommandBuilder()
        .setName('verify')
        .setDescription('Te vérifier et obtenir l\'accès au serveur'),

    async execute(interaction, config, client) {
        const wrappedExecute = withErrorHandling(async () => {
            const guild = interaction.guild;

            const result = await verifyUser(client, guild.id, interaction.user.id, {
                source: 'command_self',
                moderatorId: null
            });

            if (!result.success) {
                if (result.alreadyVerified) {
                    return await InteractionHelper.safeReply(interaction, {
                        embeds: [infoEmbed("Déjà vérifié", "Tu es déjà vérifié.")],
                        flags: MessageFlags.Ephemeral
                    });
                }

                return await InteractionHelper.sendErrorNotice(interaction, "Une erreur est survenue lors de la vérification. Réessaie ou contacte un administrateur.");
            }

            await InteractionHelper.safeReply(interaction, {
                embeds: [successEmbed(
                    "Vérification terminée",
                    `Tu as été vérifié et tu as reçu le rôle **${result.roleName}** ! Bienvenue sur le serveur ! 🎉`
                )],
                flags: MessageFlags.Ephemeral
            });
        }, { command: 'verify' });

        return await wrappedExecute(interaction, config, client);
    }
};
