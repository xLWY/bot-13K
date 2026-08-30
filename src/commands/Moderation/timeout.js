import { SlashCommandBuilder, PermissionFlagsBits, PermissionsBitField, ChannelType } from 'discord.js';
import { createEmbed, errorEmbed, successEmbed, infoEmbed, warningEmbed } from '../../utils/embeds.js';
import { logModerationAction } from '../../utils/moderation.js';
import { logger } from '../../utils/logger.js';
import { TitanBotError, ErrorTypes } from '../../utils/errorHandler.js';


import { InteractionHelper } from '../../utils/interactionHelper.js';
const durationChoices = [
    { name: "5 minutes", value: 5 },
    { name: "10 minutes", value: 10 },
    { name: "30 minutes", value: 30 },
    { name: "1 heure", value: 60 },
    { name: "6 heures", value: 360 },
    { name: "1 jour", value: 1440 },
    { name: "1 semaine", value: 10080 },
];
export default {
    data: new SlashCommandBuilder()
        .setName("timeout")
        .setDescription("Mettre un utilisateur en timeout pour une durée précise.")
        .addUserOption((option) =>
            option
                .setName("target")
                .setDescription("Utilisateur à mettre en timeout")
                .setRequired(true),
        )
        .addIntegerOption(
            (option) =>
                option
                    .setName("duration")
                    .setDescription("Durée du timeout")
                    .setRequired(true)
.addChoices(...durationChoices),
        )
        .addStringOption((option) =>
            option.setName("reason").setDescription("Raison du timeout"),
        )
.setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),
    category: "moderation",

    async execute(interaction, config, client) {
        const deferSuccess = await InteractionHelper.safeDefer(interaction);
        if (!deferSuccess) {
            logger.warn(`Timeout interaction defer failed`, {
                userId: interaction.user.id,
                guildId: interaction.guildId,
                commandName: 'timeout'
            });
            return;
        }

        try {
            if (!interaction.member.permissions.has(PermissionFlagsBits.ModerateMembers)) {
                throw new TitanBotError(
                    "User lacks permission",
                    ErrorTypes.PERMISSION,
                    "Tu as besoin de la permission `Modérer les membres` pour définir un timeout."
                );
            }

            const targetUser = interaction.options.getUser("target");
            const member = interaction.options.getMember("target");
            const durationMinutes = interaction.options.getInteger("duration");
            const reason = interaction.options.getString("reason") || "Aucune raison fournie";

            if (targetUser.id === interaction.user.id) {
                throw new TitanBotError(
                    "Cannot timeout self",
                    ErrorTypes.VALIDATION,
                    "Tu ne peux pas te mettre en timeout toi-même."
                );
            }
            if (targetUser.id === client.user.id) {
                throw new TitanBotError(
                    "Cannot timeout bot",
                    ErrorTypes.VALIDATION,
                    "Tu ne peux pas mettre le bot en timeout."
                );
            }
            if (!member) {
                throw new TitanBotError(
                    "Target not found",
                    ErrorTypes.USER_INPUT,
                    "L'utilisateur ciblé n'est actuellement pas dans ce serveur."
                );
            }

            if (!member.moderatable) {
                throw new TitanBotError(
                    "Cannot timeout member",
                    ErrorTypes.PERMISSION,
                    "Je ne peux pas mettre cet utilisateur en timeout. Il a peut-être un rôle plus élevé que moi ou que toi."
                );
            }

            const durationMs = durationMinutes * 60 * 1000;
            await member.timeout(durationMs, reason);

            const durationDisplay =
                durationChoices.find((c) => c.value === durationMinutes)
                    ?.name || `${durationMinutes} minutes`;

            const caseId = await logModerationAction({
                client,
                guild: interaction.guild,
                event: {
                    action: "Member Timed Out",
                    target: `${targetUser.tag} (${targetUser.id})`,
                    executor: `${interaction.user.tag} (${interaction.user.id})`,
                    reason: `${reason}\nDurée : ${durationDisplay}`,
                    duration: durationDisplay,
                    metadata: {
                        userId: targetUser.id,
                        moderatorId: interaction.user.id,
                        durationMinutes,
                        timeoutEnds: new Date(Date.now() + durationMs).toISOString()
                    }
                }
            });

            await InteractionHelper.safeEditReply(interaction, {
                embeds: [
                    successEmbed(
                        `⏳ **Timeout** ${targetUser.tag} pour une durée de ${durationDisplay}.`,
                        `**Raison :** ${reason}\n**ID de cas :** #${caseId}`,
                    ),
                ],
            });
        } catch (error) {
            logger.error('Timeout command error:', error);
            await InteractionHelper.safeEditReply(interaction, {
                embeds: [
                    errorEmbed(
                        error.userMessage || "Une erreur inattendue est survenue pendant le timeout. Vérifie mes permissions de rôle.",
                    ),
                ],
            });
        }
    }
};



