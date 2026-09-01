import { getColor } from '../../config/bot.js';
import { SlashCommandBuilder, PermissionFlagsBits, PermissionsBitField, ChannelType } from 'discord.js';
import { createEmbed, errorEmbed, successEmbed, infoEmbed, warningEmbed } from '../../utils/embeds.js';
import { logEvent } from '../../utils/moderation.js';
import { logger } from '../../utils/logger.js';
import { WarningService } from '../../services/warningService.js';
import { handleInteractionError } from '../../utils/errorHandler.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
export default {
    data: new SlashCommandBuilder()
        .setName("warnings")
        .setDescription("* Voir tous les avertissements d'un utilisateur")
        .addUserOption((o) =>
            o
                .setName("target")
                .setRequired(true)
                .setDescription("Utilisateur dont il faut consulter les avertissements"),
        )
        .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),
    category: "moderation",

    async execute(interaction, config, client) {
        const deferSuccess = await InteractionHelper.safeDefer(interaction);
        if (!deferSuccess) {
            logger.warn(`Warnings interaction defer failed`, {
                userId: interaction.user.id,
                guildId: interaction.guildId,
                commandName: 'warnings'
            });
            return;
        }

        try {
            const target = interaction.options.getUser("target");
            const guildId = interaction.guildId;

            
            const validWarnings = await WarningService.getWarnings(guildId, target.id);
            const totalWarns = validWarnings.length;

            if (totalWarns === 0) {
                await InteractionHelper.safeEditReply(interaction, {
                    embeds: [
                        createEmbed({ 
                            title: `Avertissements : ${target.tag}`, 
                            description: "✅ Cet utilisateur n'a aucun avertissement enregistré." 
                        }).setColor(getColor('success')),
                    ],
                });
                return;
            }

            const embed = createEmbed({ 
                title: `Avertissements : ${target.tag}`, 
                description: `Total d'avertissements : **${totalWarns}**` 
            }).setColor(getColor('warning'));

            const warningFields = validWarnings
                .map((w, i) => {
                    const discordTimestamp = Math.floor(w.timestamp / 1000);
                    return {
                        name: `[#${i + 1}] Raison : ${w.reason.substring(0, 100)}`,
                        value: `**Modérateur :** <@${w.moderatorId}>\n**Date :** <t:${discordTimestamp}:F> (<t:${discordTimestamp}:R>)`,
                        inline: false,
                    };
                })
                .slice(0, 25);

            embed.addFields(warningFields);

            await logEvent({
                client,
                guild: interaction.guild,
                event: {
                    action: "Warnings Viewed",
                    target: `<@${target.id}> (${target.id})`,
                    executor: `<@${interaction.user.id}> (${interaction.user.id})`,
                    reason: `Consultation de ${totalWarns} avertissements`,
                    metadata: {
                        userId: target.id,
                        moderatorId: interaction.user.id,
                        totalWarnings: totalWarns
                    }
                }
            });

            await InteractionHelper.safeEditReply(interaction, { embeds: [embed] });
        } catch (error) {
            logger.error('Warnings command error:', error);
            await handleInteractionError(interaction, error, { subtype: 'warnings_view_failed' });
        }
    }
};



