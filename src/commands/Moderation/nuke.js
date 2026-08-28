import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { errorEmbed } from '../../utils/embeds.js';
import { logEvent } from '../../utils/moderation.js';
import { logger } from '../../utils/logger.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';

export default {
    data: new SlashCommandBuilder()
        .setName('nuke')
        .setDescription('Deletes and recreates this channel identically, wiping all messages.')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),
    category: 'moderation',

    async execute(interaction, config, client) {
        const deferSuccess = await InteractionHelper.safeDefer(interaction, { ephemeral: true });
        if (!deferSuccess) {
            logger.warn('Nuke interaction defer failed', {
                userId: interaction.user.id,
                guildId: interaction.guildId,
                commandName: 'nuke'
            });
            return;
        }

        if (!interaction.member.permissions.has(PermissionFlagsBits.ManageChannels)) {
            return await InteractionHelper.safeEditReply(interaction, {
                embeds: [errorEmbed('You need the `Manage Channels` permission to nuke a channel.')]
            });
        }

        const channel = interaction.channel;

        if (!channel || !channel.guild || typeof channel.clone !== 'function') {
            return await InteractionHelper.safeEditReply(interaction, {
                embeds: [errorEmbed('This command can only be used in a server channel.')]
            });
        }

        try {
            const position = channel.rawPosition ?? channel.position;

            const newChannel = await channel.clone({
                reason: `Channel nuked by ${interaction.user.tag}`
            });

            await newChannel.setPosition(position).catch((err) => {
                logger.warn('Could not restore exact channel position after nuke:', err);
            });

            await channel.delete(`Channel nuked by ${interaction.user.tag}`);

            await logEvent({
                client,
                guild: interaction.guild,
                event: {
                    action: 'Channel Nuked',
                    target: newChannel.toString(),
                    executor: `${interaction.user.tag} (${interaction.user.id})`,
                    metadata: {
                        newChannelId: newChannel.id,
                        oldChannelId: channel.id,
                        category: newChannel.parent?.name || 'None',
                        moderatorId: interaction.user.id
                    }
                }
            });

            await newChannel.send(`💥 Channel nuked successfully, ${interaction.user}!`);
        } catch (error) {
            logger.error('Nuke command error:', error);
            try {
                await channel.send({
                    embeds: [errorEmbed('An unexpected error occurred while nuking this channel. Check my permissions (I need \'Manage Channels\').')]
                });
            } catch {
                // Original channel may already be gone at this point; nothing more we can do.
            }
        }
    }
};