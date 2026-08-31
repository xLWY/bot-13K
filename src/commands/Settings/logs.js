import { SlashCommandBuilder, PermissionFlagsBits, MessageFlags, ChannelType } from 'discord.js';
import { setLoggingChannel, getLoggingStatus, EVENT_TYPES } from '../../services/loggingService.js';
import { successEmbed, infoEmbed } from '../../utils/embeds.js';
import { logger } from '../../utils/logger.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';

export default {
    data: new SlashCommandBuilder()
        .setName('logs')
        .setDescription('* Définir le canal des logs du serveur ou afficher le statut actuel')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
        .addChannelOption(option =>
            option.setName('channel')
                .setDescription('Le canal textuel qui recevra tous les logs du serveur')
                .setRequired(false)
                .addChannelTypes(ChannelType.GuildText)),

    category: 'settings',

    async execute(interaction, config, client) {
        const deferSuccess = await InteractionHelper.safeDefer(interaction, { flags: MessageFlags.Ephemeral });
        if (!deferSuccess) {
            logger.warn('Logs interaction defer failed', {
                userId: interaction.user.id,
                guildId: interaction.guildId,
                commandName: 'logs'
            });
            return;
        }

        if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
            return InteractionHelper.sendErrorNotice(interaction, 'Tu as besoin de la permission **Gérer le serveur** pour configurer les logs.');
        }

        const channel = interaction.options.getChannel('channel');

        try {
            if (channel) {
                if (channel.guildId !== interaction.guildId) {
                    return InteractionHelper.sendErrorNotice(interaction, `<#${channel.id}> n'est pas dans ce serveur.`);
                }

                const success = await setLoggingChannel(client, interaction.guild.id, channel.id);
                if (!success) {
                    return InteractionHelper.sendErrorNotice(interaction, 'Échec de la configuration du canal des logs. Veuillez réessayer.');
                }

                logger.info(`[Logs] Set logging channel to ${channel.name} (${channel.id}) in ${interaction.guild.name} (${interaction.guild.id}) by ${interaction.user.tag}`);

                await InteractionHelper.safeEditReply(interaction, {
                    embeds: [successEmbed(
                        `${channel} est désormais le **canal des logs**. La journalisation est activée pour les ${Object.keys(EVENT_TYPES).length} types d'événements (modération, messages, rôles, membres, tickets, giveaways, reaction roles, leveling...).`,
                        '📝 Logs Configurés'
                    )],
                    flags: MessageFlags.Ephemeral
                });

                try {
                    await channel.send({
                        embeds: [successEmbed('Ce canal est désormais le **canal des logs** du serveur. Tous les événements de journalisation apparaîtront ici.', '📝 Canal des Logs Actif')]
                    });
                } catch {
                    logger.warn(`[Logs] Could not send confirmation in logs channel ${channel.id} (missing Send/Embed permissions?)`);
                }
                return;
            }

            const status = await getLoggingStatus(client, interaction.guild.id);

            if (!status.enabled || !status.channelId) {
                return InteractionHelper.safeEditReply(interaction, {
                    embeds: [infoEmbed('Aucun canal de logs n\'est configuré pour le moment. Utilise `/logs <canal>` pour activer la journalisation sur ce serveur.', '📝 Statut des Logs')],
                    flags: MessageFlags.Ephemeral
                });
            }

            const logChannel = interaction.guild.channels.cache.get(status.channelId);
            const channelMention = logChannel ? logChannel.toString() : `\`${status.channelId}\``;

            const enabledCount = Object.values(EVENT_TYPES).filter(
                type => status.enabledEvents[type] !== false
            ).length;
            const totalCount = Object.keys(EVENT_TYPES).length;

            return InteractionHelper.safeEditReply(interaction, {
                embeds: [infoEmbed(
                    `Les logs sont **activés** dans ${channelMention}.\n**${enabledCount}/${totalCount}** types d'événements sont actifs.`,
                    '📝 Statut des Logs'
                )],
                flags: MessageFlags.Ephemeral
            });
        } catch (error) {
            logger.error(`[Logs] Failed to configure logging for guild ${interaction.guild.id}:`, error);
            await InteractionHelper.sendErrorNotice(interaction, 'Une erreur est survenue lors de la configuration du canal des logs. Veuillez réessayer.');
        }
    }
};