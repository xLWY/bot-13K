import { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } from 'discord.js';
import { isBotOwner } from '../../utils/ownerIds.js';
import { logEvent } from '../../utils/moderation.js';
import { logger } from '../../utils/logger.js';
import { errorEmbed, successEmbed } from '../../utils/embeds.js';
import { brandFooter } from '../../ui/kit.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';

const NO_MENTIONS = { parse: [], repliedUser: false };
const CONTEXT = 'Recréation du salon';

function payload(embed) {
    return {
        embeds: [embed.setFooter(brandFooter(CONTEXT))],
        components: [],
        allowedMentions: NO_MENTIONS,
    };
}

export default {
    data: new SlashCommandBuilder()
        .setName('nuke')
        .setDescription('Supprime et recrée ce salon à l’identique, effaçant tous les messages.')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),
    category: 'moderation',

    async execute(interaction, config, client) {
        const deferSuccess = await InteractionHelper.safeDefer(interaction, { flags: MessageFlags.Ephemeral });
        if (!deferSuccess) {
            logger.warn('Nuke interaction defer failed', {
                userId: interaction.user.id,
                guildId: interaction.guildId,
                commandName: 'nuke',
            });
            return;
        }

        if (!isBotOwner(interaction.member.id) && !interaction.member.permissions.has(PermissionFlagsBits.ManageChannels)) {
            return InteractionHelper.safeEditReply(interaction, payload(
                errorEmbed('Tu as besoin de la permission **Gérer les salons** pour détruire un salon.'),
            ));
        }

        const channel = interaction.channel;

        if (!channel || !channel.guild || typeof channel.clone !== 'function') {
            return InteractionHelper.safeEditReply(interaction, payload(
                errorEmbed('Cette commande ne peut être utilisée que dans un salon de serveur.'),
            ));
        }

        try {
            const position = channel.rawPosition ?? channel.position;

            const newChannel = await channel.clone({
                reason: `Salon détruit par ${interaction.user.tag}`,
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
                    executor: `<@${interaction.user.id}> (${interaction.user.id})`,
                    metadata: {
                        newChannelId: newChannel.id,
                        oldChannelId: channel.id,
                        category: newChannel.parent?.name || 'None',
                        moderatorId: interaction.user.id,
                    },
                },
            });

            const nukeMessage = await newChannel.send(`💥 Salon détruit avec succès, ${interaction.user} !`);
            setTimeout(() => nukeMessage.delete().catch(() => {}), 3000);

            return InteractionHelper.safeEditReply(interaction, payload(
                successEmbed(`Le salon a été recréé : <#${newChannel.id}>. Tous les anciens messages ont été effacés.`, '💥 Salon recréé')
                    .addFields(
                        { name: 'Nouveau salon', value: `<#${newChannel.id}>`, inline: true },
                        { name: 'Ancien salon', value: `\`${channel.id}\``, inline: true },
                        { name: 'Catégorie', value: newChannel.parent?.name || 'Aucune', inline: false },
                        { name: 'Modérateur', value: `<@${interaction.user.id}>`, inline: false },
                    ),
            ));
        } catch (error) {
            logger.error('Nuke command error:', error);
            const message = payload(errorEmbed(
                'Impossible de recréer le salon. Vérifie que je possède « Gérer les salons » et la permission de créer des salons.',
            ));
            const delivered = await InteractionHelper.safeEditReply(interaction, message);
            if (!delivered) {
                await channel.send(message).catch(() => {});
            }
        }
    },
};
