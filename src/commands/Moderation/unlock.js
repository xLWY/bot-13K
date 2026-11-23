import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { errorEmbed, successEmbed, warningEmbed } from '../../utils/embeds.js';
import { brandFooter } from '../../ui/kit.js';
import { logEvent } from '../../utils/moderation.js';
import { logger } from '../../utils/logger.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { isBotOwner } from '../../utils/ownerIds.js';

const NO_MENTIONS = { parse: [], repliedUser: false };
const CONTEXT = 'Déverrouillage du salon';

function payload(embed) {
    return {
        embeds: [embed.setFooter(brandFooter(CONTEXT))],
        components: [],
        allowedMentions: NO_MENTIONS,
    };
}

export default {
    data: new SlashCommandBuilder()
        .setName('unlock')
        .setDescription("Déverrouille le salon actuel (permet à @everyone d'envoyer à nouveau des messages).")
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),
    category: 'moderation',

    async execute(interaction, config, client) {
        const deferSuccess = await InteractionHelper.safeDefer(interaction);
        if (!deferSuccess) {
            logger.warn('Unlock interaction defer failed', {
                userId: interaction.user.id,
                guildId: interaction.guildId,
                commandName: 'unlock',
            });
            return;
        }

        if (
            !isBotOwner(interaction.user.id) &&
            !interaction.member.permissions.has(PermissionFlagsBits.ManageChannels)
        ) {
            return InteractionHelper.safeEditReply(interaction, payload(
                errorEmbed('Tu as besoin de la permission **Gérer les salons** pour déverrouiller un salon.'),
            ));
        }

        const channel = interaction.channel;
        const everyoneRole = interaction.guild.roles.everyone;

        try {
            const currentPermissions = channel.permissionsFor(everyoneRole);
            if (
                currentPermissions.has(PermissionFlagsBits.SendMessages) === true ||
                currentPermissions.has(PermissionFlagsBits.SendMessages) === null
            ) {
                return InteractionHelper.safeEditReply(interaction, payload(
                    warningEmbed(`<#${channel.id}> n’est pas explicitement verrouillé. Tout le monde peut déjà y écrire.`),
                ));
            }

            await channel.permissionOverwrites.edit(
                everyoneRole,
                { SendMessages: true },
                {
                    type: 0,
                    reason: `Salon déverrouillé par ${interaction.user.tag}`,
                },
            );

            await logEvent({
                client,
                guild: interaction.guild,
                event: {
                    action: 'Channel Unlocked',
                    target: channel.toString(),
                    executor: `<@${interaction.user.id}> (${interaction.user.id})`,
                    metadata: {
                        channelId: channel.id,
                        category: channel.parent?.name || 'None',
                    },
                },
            });

            return InteractionHelper.safeEditReply(interaction, payload(
                successEmbed(`<#${channel.id}> est déverrouillé. Tu peux parler à nouveau.`, '🔓 Salon déverrouillé')
                    .addFields(
                        { name: 'Salon', value: `<#${channel.id}>`, inline: true },
                        { name: 'Permission', value: '`Envoyer des messages : autorisé`', inline: true },
                        { name: 'Modérateur', value: `<@${interaction.user.id}>`, inline: false },
                    ),
            ));
        } catch (error) {
            logger.error('Unlock command error:', error);
            return InteractionHelper.safeEditReply(interaction, payload(
                errorEmbed('Impossible de déverrouiller le salon. Vérifie que je possède « Gérer les salons ».'),
            ));
        }
    },
};
