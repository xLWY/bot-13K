import { SlashCommandBuilder, PermissionFlagsBits, ComponentType } from 'discord.js';
import { createEmbed, errorEmbed, successEmbed } from '../../utils/embeds.js';
import { getConfirmationButtons } from '../../utils/components.js';
import { logEvent } from '../../utils/moderation.js';
import { logger } from '../../utils/logger.js';
import { getColor } from '../../config/bot.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';

export default {
    data: new SlashCommandBuilder()
        .setName('nuke')
        .setDescription('Deletes and recreates this channel identically, wiping all messages.')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),
    category: 'moderation',

    async execute(interaction, config, client) {
        const deferSuccess = await InteractionHelper.safeDefer(interaction);
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

        const confirmButtons = getConfirmationButtons('nuke');
        await InteractionHelper.safeEditReply(interaction, {
            embeds: [
                createEmbed(
                    '💣 Nuke This Channel?',
                    `This will **delete and recreate** ${channel} with the exact same settings (permissions, topic, category, slowmode...). All messages in it will be permanently lost.\n\nThis action cannot be undone.`
                ).setColor(getColor('warning'))
            ],
            components: [confirmButtons]
        });

        let collected;
        try {
            collected = await channel.awaitMessageComponent({
                filter: (i) => i.user.id === interaction.user.id && ['nuke_yes', 'nuke_no'].includes(i.customId),
                componentType: ComponentType.Button,
                time: 30000
            });
        } catch {
            await InteractionHelper.safeEditReply(interaction, {
                embeds: [errorEmbed('Nuke cancelled — no response in time.')],
                components: []
            }).catch(() => {});
            return;
        }

        if (collected.customId === 'nuke_no') {
            await collected.update({
                embeds: [successEmbed('Nuke cancelled. Nothing was changed.')],
                components: []
            });
            return;
        }

        try {
            await collected.update({
                embeds: [createEmbed('💣 Nuking...', 'Recreating the channel, one moment.').setColor(getColor('warning'))],
                components: []
            });
        } catch (error) {
            logger.warn('Failed to update nuke confirmation message:', error);
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

            await newChannel.send({
                embeds: [
                    successEmbed(
                        `This channel has been nuked by ${interaction.user}. Fresh start! 💣`,
                        '💥 Channel Nuked'
                    )
                ]
            });
        } catch (error) {
            logger.error('Nuke command error:', error);
            try {
                await channel.send({
                    embeds: [errorEmbed('An unexpected error occurred while nuking this channel. Check my permissions (I need \'Manage Channels\').', error)]
                });
            } catch {
                // Original channel may already be gone at this point; nothing more we can do.
            }
        }
    }
};
