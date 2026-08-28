import { SlashCommandBuilder, PermissionFlagsBits, MessageFlags, ChannelType } from 'discord.js';
import { setLoggingChannel, getLoggingStatus, EVENT_TYPES } from '../../services/loggingService.js';
import { errorEmbed, successEmbed, infoEmbed } from '../../utils/embeds.js';
import { logger } from '../../utils/logger.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';

export default {
    data: new SlashCommandBuilder()
        .setName('logs')
        .setDescription('Set the server\'s logs channel or view the current logging status')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
        .addChannelOption(option =>
            option.setName('channel')
                .setDescription('The text channel that will receive all server logs')
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
            return InteractionHelper.safeEditReply(interaction, {
                embeds: [errorEmbed('You need the **Manage Server** permission to configure logs.')],
                flags: MessageFlags.Ephemeral
            });
        }

        const channel = interaction.options.getChannel('channel');

        try {
            if (channel) {
                if (channel.guildId !== interaction.guildId) {
                    return InteractionHelper.safeEditReply(interaction, {
                        embeds: [errorEmbed(`<#${channel.id}> is not in this server.`)]
                    });
                }

                const success = await setLoggingChannel(client, interaction.guild.id, channel.id);
                if (!success) {
                    return InteractionHelper.safeEditReply(interaction, {
                        embeds: [errorEmbed('Failed to configure the logs channel. Please try again.')],
                        flags: MessageFlags.Ephemeral
                    });
                }

                logger.info(`[Logs] Set logging channel to ${channel.name} (${channel.id}) in ${interaction.guild.name} (${interaction.guild.id}) by ${interaction.user.tag}`);

                await InteractionHelper.safeEditReply(interaction, {
                    embeds: [successEmbed(
                        `${channel} is now the **logs channel**. Logging is enabled for all ${Object.keys(EVENT_TYPES).length} event types (moderation, messages, roles, members, tickets, giveaways, reaction roles, leveling...).`,
                        '📝 Logs Configured'
                    )],
                    flags: MessageFlags.Ephemeral
                });

                try {
                    await channel.send({
                        embeds: [successEmbed('This channel is now the server\'s **logs channel**. All logging events will appear here.', '📝 Logs Channel Active')]
                    });
                } catch {
                    logger.warn(`[Logs] Could not send confirmation in logs channel ${channel.id} (missing Send/Embed permissions?)`);
                }
                return;
            }

            const status = await getLoggingStatus(client, interaction.guild.id);

            if (!status.enabled || !status.channelId) {
                return InteractionHelper.safeEditReply(interaction, {
                    embeds: [infoEmbed('No logs channel is configured yet. Use `/logs <channel>` to enable logging for this server.', '📝 Logs Status')],
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
                    `Logs are **enabled** in ${channelMention}.\n**${enabledCount}/${totalCount}** event types are active.`,
                    '📝 Logs Status'
                )],
                flags: MessageFlags.Ephemeral
            });
        } catch (error) {
            logger.error(`[Logs] Failed to configure logging for guild ${interaction.guild.id}:`, error);
            await InteractionHelper.safeEditReply(interaction, {
                embeds: [errorEmbed('An error occurred while configuring the logs channel. Please try again.', error, { showDetails: true })],
                flags: MessageFlags.Ephemeral
            });
        }
    }
};