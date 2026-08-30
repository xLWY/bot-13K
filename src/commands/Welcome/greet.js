import { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } from 'discord.js';
import { errorEmbed } from '../../utils/embeds.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { logger } from '../../utils/logger.js';
import { handleInteractionError, TitanBotError } from '../../utils/errorHandler.js';
import greetDashboard from './modules/greet_dashboard.js';

export default {
    data: new SlashCommandBuilder()
        .setName('greet')
        .setDescription('* Gérer les paramètres de bienvenue et d\'au revoir')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
        .addSubcommand(subcommand =>
            subcommand
                .setName('dashboard')
                .setDescription('Ouvrir le tableau de bord de configuration de bienvenue et d\'au revoir'),
        ),

    async execute(interaction, config, client) {
        try {
            if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
                return await InteractionHelper.safeReply(interaction, {
                    embeds: [
                        errorEmbed(
                            'Permissions manquantes',
                            'Tu as besoin de la permission **Gérer le serveur** pour utiliser `/greet`.',
                        ),
                    ],
                    flags: MessageFlags.Ephemeral,
                });
            }

            const subcommand = interaction.options.getSubcommand();

            switch (subcommand) {
                case 'dashboard':
                    return await greetDashboard.execute(interaction, config, client);
                default:
                    logger.warn(`Unknown /greet subcommand: ${subcommand}`);
            }
        } catch (error) {
            if (error instanceof TitanBotError) {
                return await InteractionHelper.safeReply(interaction, {
                    embeds: [errorEmbed('Erreur de configuration', error.userMessage || 'Une erreur est survenue.')],
                    flags: MessageFlags.Ephemeral,
                });
            }
            await handleInteractionError(interaction, error, { command: 'greet' });
        }
    },
};
