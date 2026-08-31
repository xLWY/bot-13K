import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { errorEmbed } from '../../utils/embeds.js';
import { logEvent } from '../../utils/moderation.js';
import { logger } from '../../utils/logger.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';

export default {
    data: new SlashCommandBuilder()
        .setName('nuke')
        .setDescription('* Supprime et recrée ce salon à l\'identique, effaçant tous les messages.')
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
            return await InteractionHelper.sendErrorNotice(interaction, 'Tu as besoin de la permission `Gérer les salons` pour détruire un salon.');
        }

        const channel = interaction.channel;

        if (!channel || !channel.guild || typeof channel.clone !== 'function') {
            return await InteractionHelper.sendErrorNotice(interaction, 'Cette commande ne peut être utilisée que dans un salon de serveur.');
        }

        try {
            const position = channel.rawPosition ?? channel.position;

            const newChannel = await channel.clone({
                reason: `Salon détruit par ${interaction.user.tag}`
            });

            await newChannel.setPosition(position).catch((err) => {
                logger.warn('Could not restore exact channel position after nuke:', err);
            });

            await channel.delete(`Salon détruit par ${interaction.user.tag}`);

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

            const nukeMessage = await newChannel.send(`💥 Salon détruit avec succès, ${interaction.user} !`);
            setTimeout(() => nukeMessage.delete().catch(() => {}), 3000);
        } catch (error) {
            logger.error('Nuke command error:', error);
            try {
                await channel.send({
                    embeds: [errorEmbed('Une erreur inattendue est survenue lors de la destruction de ce salon. Vérifie mes permissions (il me faut \'Gérer les salons\').')]
                });
            } catch {
                // Original channel may already be gone at this point; nothing more we can do.
            }
        }
    }
};