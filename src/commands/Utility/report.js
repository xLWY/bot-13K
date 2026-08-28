import { SlashCommandBuilder, ChannelType } from 'discord.js';
import { errorEmbed } from '../../utils/embeds.js';
import { logger } from '../../utils/logger.js';
import { handleInteractionError } from '../../utils/errorHandler.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';

import report from './modules/report.js';
import reportSetchannel from './modules/report_setchannel.js';

export default {
    data: new SlashCommandBuilder()
        .setName('report')
        .setDescription('Signaler un utilisateur au staff du serveur ou configurer où les signalements sont envoyés.')
        .setDMPermission(false)
        .addSubcommand(subcommand =>
            subcommand
                .setName('file')
                .setDescription('Signaler un utilisateur à l\'équipe de modération du serveur.')
                .addUserOption(option =>
                    option
                        .setName('user')
                        .setDescription('L\'utilisateur que vous souhaitez signaler.')
                        .setRequired(true),
                )
                .addStringOption(option =>
                    option
                        .setName('reason')
                        .setDescription('La raison du signalement (soyez détaillé).')
                        .setRequired(true)
                        .setMaxLength(500),
                ),
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('setchannel')
                .setDescription('Définir le canal où les signalements sont envoyés. (Gérer le serveur requis)')
                .addChannelOption(option =>
                    option
                        .setName('channel')
                        .setDescription('Le canal textuel pour recevoir les signalements.')
                        .addChannelTypes(ChannelType.GuildText)
                        .setRequired(true),
                ),
        ),
    category: 'Utility',

    async execute(interaction, config, client) {
        try {
            const subcommand = interaction.options.getSubcommand();

            if (subcommand === 'file') {
                return await report.execute(interaction, config, client);
            }

            if (subcommand === 'setchannel') {
                return await reportSetchannel.execute(interaction, config, client);
            }

            return InteractionHelper.safeReply(interaction, {
                embeds: [errorEmbed('Error', 'Unknown subcommand.')],
                ephemeral: true,
            });
        } catch (error) {
            logger.error('report command error:', error);
            await handleInteractionError(interaction, error, { commandName: 'report', source: 'report_command' });
        }
    },
};