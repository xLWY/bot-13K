import { SlashCommandBuilder, PermissionFlagsBits, MessageFlags, ChannelType } from 'discord.js';
import { setLoggingChannel, getLoggingStatus, EVENT_TYPES } from '../../services/loggingService.js';
import { successEmbed, infoEmbed } from '../../utils/embeds.js';
import { logger } from '../../utils/logger.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';

export default {
    data: new SlashCommandBuilder()
        .setName('logs')
        .setDescription('* Les logs sont envoyes en MP au proprietaire du bot. Definit un canal de secours')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
        .addChannelOption(option =>
            option.setName('channel')
                .setDescription('Canal textuel de secours, utilise seulement si le MP echoue')
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
                        `${channel} est désormais le **canal de secours** des logs. Les logs sont envoyes en **message prive au proprietaire du bot** ; ils ne tomberont dans ce salon que si le DM est impossible.\n\n${Object.keys(EVENT_TYPES).length} types d'evenements sont actifs (moderation, messages, roles, membres, tickets, giveaways, reaction roles, leveling...).`,
                        '\u{1F4DD} Logs Configures'
                    )],
                    flags: MessageFlags.Ephemeral
                });

                try {
                    await channel.send({
                        embeds: [successEmbed('Ce canal est desormais le **canal de secours** du bot. Les logs partent en message prive au proprietaire ; ce salon ne recoit les logs quen cas dechec du DM.', '\u{1F4DD} Canal de Secours Actif')]
                    });
                } catch {
                    logger.warn(`[Logs] Could not send confirmation in logs channel ${channel.id} (missing Send/Embed permissions?)`);
                }
                return;
            }

            const status = await getLoggingStatus(client, interaction.guild.id);

            const enabledCount = Object.values(EVENT_TYPES).filter(
                type => status.enabledEvents[type] !== false
            ).length;
            const totalCount = Object.keys(EVENT_TYPES).length;

            const fallbackLine = status.channelId
                ? (() => {
                    const ch = interaction.guild.channels.cache.get(status.channelId);
                    return `Canal de secours : ${ch ? ch.toString() : `\`${status.channelId}\``}.`;
                })()
                : 'Aucun canal de secours configure.';

            return InteractionHelper.safeEditReply(interaction, {
                embeds: [infoEmbed(
                    `Les logs sont envoyes en **message prive** aux proprietaires du bot.\n${fallbackLine}\n**${enabledCount}/${totalCount}** types d'evenements sont actifs.`,
                    '\u{1F4DD} Statut des Logs'
                )],
                flags: MessageFlags.Ephemeral
            });
        } catch (error) {
            logger.error(`[Logs] Failed to configure logging for guild ${interaction.guild.id}:`, error);
            await InteractionHelper.sendErrorNotice(interaction, 'Une erreur est survenue lors de la configuration du canal des logs. Veuillez réessayer.');
        }
    }
};