import { SlashCommandBuilder, PermissionFlagsBits, PermissionsBitField, ChannelType } from 'discord.js';
import { createEmbed, successEmbed } from '../../utils/embeds.js';
import { logEvent } from '../../utils/moderation.js';
import { logger } from '../../utils/logger.js';
import { getColor } from '../../config/bot.js';

import { InteractionHelper } from '../../utils/interactionHelper.js';
export default {
    data: new SlashCommandBuilder()
        .setName("unlock")
        .setDescription(
            "* Déverrouille le salon actuel (permet à @everyone d'envoyer à nouveau des messages).",
        )
.setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),
    category: "moderation",

    async execute(interaction, config, client) {
        const deferSuccess = await InteractionHelper.safeDefer(interaction);
        if (!deferSuccess) {
            logger.warn(`Unlock interaction defer failed`, {
                userId: interaction.user.id,
                guildId: interaction.guildId,
                commandName: 'unlock'
            });
            return;
        }

        if (
            !interaction.member.permissions.has(
                PermissionFlagsBits.ManageChannels,
            )
        )
            return await InteractionHelper.sendErrorNotice(interaction, "Tu as besoin de la permission `Gérer les salons` pour déverrouiller des salons.");

        const channel = interaction.channel;
        const everyoneRole = interaction.guild.roles.everyone;

        try {
            const currentPermissions = channel.permissionsFor(everyoneRole);
            if (
                currentPermissions.has(PermissionFlagsBits.SendMessages) ===
                    true ||
                currentPermissions.has(PermissionFlagsBits.SendMessages) ===
                    null
            ) {
                return await InteractionHelper.sendErrorNotice(interaction, `${channel} n'est pas explicitement verrouillé (tout le monde peut déjà y envoyer des messages).`);
            }

            await channel.permissionOverwrites.edit(
                everyoneRole,
                { SendMessages: true },
                {
                    type: 0,
                    reason: `Salon déverrouillé par ${interaction.user.tag}`,
},
            );

            const unlockEmbed = createEmbed(
                "🔓 Salon déverrouillé (Journal d'actions)",
                `${channel} a été déverrouillé par ${interaction.user}.`,
            )
.setColor(getColor('success'))
                .addFields(
                    {
                        name: "Salon",
                        value: channel.toString(),
                        inline: true,
                    },
                    {
                        name: "Modérateur",
                        value: `${interaction.user.tag} (${interaction.user.id})`,
                        inline: true,
                    },
                );

            await logEvent({
                client,
                guild: interaction.guild,
                event: {
                    action: "Channel Unlocked",
                    target: channel.toString(),
                    executor: `<@${interaction.user.id}> (${interaction.user.id})`,
                    metadata: {
                        channelId: channel.id,
                        category: channel.parent?.name || 'None'
                    }
                }
            });

            await InteractionHelper.safeEditReply(interaction, {
                embeds: [
                    successEmbed(
                        `🔓 **Salon déverrouillé**`,
                        `${channel} est maintenant déverrouillé. Tu peux parler à nouveau.`,
                    ),
                ],
            });
        } catch (error) {
            logger.error('Unlock command error:', error);
            return await InteractionHelper.sendErrorNotice(interaction, "Une erreur inattendue est survenue en essayant de déverrouiller le salon. Vérifie mes permissions (j'ai besoin de « Gérer les salons »).");
        }
    }
};



