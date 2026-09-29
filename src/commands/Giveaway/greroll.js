import { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } from 'discord.js';
import { isBotOwner } from '../../utils/ownerIds.js';
import { errorEmbed, successEmbed } from '../../utils/embeds.js';
import { logger } from '../../utils/logger.js';
import { TitanBotError, ErrorTypes, handleInteractionError } from '../../utils/errorHandler.js';
import { getGuildGiveaways, saveGiveaway } from '../../utils/giveaways.js';
import { 
    selectWinners,
    createGiveawayEmbed, 
    createGiveawayButtons 
} from '../../services/giveawayService.js';
import { logEvent, EVENT_TYPES } from '../../services/loggingService.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';

export default {
    data: new SlashCommandBuilder()
        .setName("greroll")
        .setDescription("* Relance le tirage des gagnants d'un concours terminÃ©.")
        .addStringOption((option) =>
            option
                .setName("messageid")
                .setDescription("L'identifiant du message du concours terminÃ©.")
                .setRequired(true),
        )
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

    async execute(interaction) {
        try {
            
            if (!interaction.inGuild()) {
                throw new TitanBotError(
                    'Giveaway command used outside guild',
                    ErrorTypes.VALIDATION,
                    'Cette commande ne peut Ãªtre utilisÃ©e que sur un serveur.',
                    { userId: interaction.user.id }
                );
            }

            
            if (!isBotOwner(interaction.member.id) && !interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
                throw new TitanBotError(
                    'User lacks ManageGuild permission',
                    ErrorTypes.PERMISSION,
                    "Vous devez avoir la permission `GÃ©rer le serveur` pour relancer le tirage d'un concours.",
                    { userId: interaction.user.id, guildId: interaction.guildId }
                );
            }

            logger.info(`Giveaway reroll initiated by ${interaction.user.tag} in guild ${interaction.guildId}`);

            const messageId = interaction.options.getString("messageid");

            
            if (!messageId || !/^\d+$/.test(messageId)) {
                throw new TitanBotError(
                    'Invalid message ID format',
                    ErrorTypes.VALIDATION,
                    'Veuillez fournir un identifiant de message valide.',
                    { providedId: messageId }
                );
            }

            const giveaways = await getGuildGiveaways(
                interaction.client,
                interaction.guildId,
            );

            
            const giveaway = giveaways.find(g => g.messageId === messageId);

            if (!giveaway) {
                throw new TitanBotError(
                    `Giveaway not found: ${messageId}`,
                    ErrorTypes.VALIDATION,
                    "Aucun concours n'a Ã©tÃ© trouvÃ© avec cet identifiant de message dans la base de donnÃ©es.",
                    { messageId, guildId: interaction.guildId }
                );
            }

            
            if (!giveaway.isEnded && !giveaway.ended) {
                throw new TitanBotError(
                    `Giveaway still active: ${messageId}`,
                    ErrorTypes.VALIDATION,
                    "Ce concours est encore actif. Utilisez `/gend` pour le terminer d'abord.",
                    { messageId, status: 'active' }
                );
            }

            const participants = giveaway.participants || [];
            
            if (participants.length < giveaway.winnerCount) {
                throw new TitanBotError(
                    `Insufficient participants for reroll: ${participants.length} < ${giveaway.winnerCount}`,
                    ErrorTypes.VALIDATION,
                    "Pas assez de participations pour tirer le nombre de gagnants requis.",
                    { participantsCount: participants.length, winnersNeeded: giveaway.winnerCount }
                );
            }

            
            const newWinners = selectWinners(
                participants,
                giveaway.winnerCount,
            );

            
            const updatedGiveaway = {
                ...giveaway,
                winnerIds: newWinners,
                rerolledAt: new Date().toISOString(),
                rerolledBy: interaction.user.id
            };

            
            const channel = await interaction.client.channels.fetch(
                giveaway.channelId,
            ).catch(err => {
                logger.warn(`Could not fetch channel ${giveaway.channelId}:`, err.message);
                return null;
            });

            if (!channel || !channel.isTextBased()) {
                
                await saveGiveaway(
                    interaction.client,
                    interaction.guildId,
                    updatedGiveaway,
                );
                
                logger.warn(`Could not find channel for giveaway ${messageId}, but saved new winners to database`);
                
                return InteractionHelper.safeReply(interaction, {
                    embeds: [
                        successEmbed(
                            "Relance terminÃ©e",
                            "Les nouveaux gagnants ont Ã©tÃ© sÃ©lectionnÃ©s et enregistrÃ©s dans la base de donnÃ©es. Impossible de trouver le salon pour l'annoncer.",
                        ),
                    ],
                    flags: MessageFlags.Ephemeral,
                });
            }

            
            const message = await channel.messages
                .fetch(messageId)
                .catch(err => {
                    logger.warn(`Could not fetch message ${messageId}:`, err.message);
                    return null;
                });

            if (!message) {
                
                await saveGiveaway(
                    interaction.client,
                    interaction.guildId,
                    updatedGiveaway,
                );

                const winnerMentions = newWinners
                    .map((id) => `<@${id}>`)
                    .join(", ");
                
                // Edit the original winner ping if it still exists, otherwise send a new one
                const existingPingMsg = giveaway.winnerPingMessageId
                    ? await channel.messages.fetch(giveaway.winnerPingMessageId).catch(() => null)
                    : null;
                if (existingPingMsg) {
                    await existingPingMsg.edit({
                        content: `ðŸ”„ Nouveau tirage ! FÃ©licitations ${winnerMentions} ! Tu as gagnÃ© le concours **${giveaway.prize || 'Concours mystÃ¨re'}** ! CrÃ©e un ticket pour rÃ©cupÃ©rer ton lot ðŸŽ`,
                    });
                } else {
                    const newPingMsg = await channel.send({
                        content: `ðŸ”„ Nouveau tirage ! FÃ©licitations ${winnerMentions} ! Tu as gagnÃ© le concours **${giveaway.prize || 'Concours mystÃ¨re'}** ! CrÃ©e un ticket pour rÃ©cupÃ©rer ton lot ðŸŽ`,
                    });
                    updatedGiveaway.winnerPingMessageId = newPingMsg.id;
                }

                logger.info(`Giveaway rerolled (message not found, but announced): ${messageId}`);

                try {
                    await logEvent({
                        client: interaction.client,
                        guildId: interaction.guildId,
                        eventType: EVENT_TYPES.GIVEAWAY_REROLL,
                        data: {
                            description: `Tirage relancÃ© : ${giveaway.prize}`,
                            channelId: giveaway.channelId,
                            userId: interaction.user.id,
                            fields: [
                                {
                                    name: 'ðŸŽ Prix',
                                    value: giveaway.prize || 'Concours mystÃ¨re !',
                                    inline: true
                                },
                                {
                                    name: 'ðŸ† Nouveaux gagnants',
                                    value: winnerMentions,
                                    inline: false
                                },
                                {
                                    name: 'ðŸ‘¥ Participations totales',
                                    value: participants.length.toString(),
                                    inline: true
                                }
                            ]
                        }
                    });
                } catch (logError) {
                    logger.debug('Error logging giveaway reroll:', logError);
                }

                return InteractionHelper.safeReply(interaction, {
                    embeds: [
                        successEmbed(
                            "Relance terminÃ©e",
                            `Les nouveaux gagnants ont Ã©tÃ© annoncÃ©s dans ${channel}. (Message d'origine introuvable).`,
                        ),
                    ],
                    flags: MessageFlags.Ephemeral,
                });
            }

            
            await saveGiveaway(
                interaction.client,
                interaction.guildId,
                updatedGiveaway,
            );

            const newEmbed = createGiveawayEmbed(updatedGiveaway, "reroll", newWinners);
            const newRow = createGiveawayButtons(true);

            await message.edit({
                content: "",
                embeds: [newEmbed],
                components: [newRow],
            });

            const winnerMentions = newWinners
                .map((id) => `<@${id}>`)
                .join(", ");
            
            // Edit the original winner ping if it still exists, otherwise send a new one
            const existingPingMsg = giveaway.winnerPingMessageId
                ? await channel.messages.fetch(giveaway.winnerPingMessageId).catch(() => null)
                : null;
            if (existingPingMsg) {
                await existingPingMsg.edit({
                    content: `ðŸ”„ Nouveau tirage ! FÃ©licitations ${winnerMentions} ! Tu as gagnÃ© le concours **${giveaway.prize || 'Concours mystÃ¨re'}** ! CrÃ©e un ticket pour rÃ©cupÃ©rer ton lot ðŸŽ`,
                });
            } else {
                const newPingMsg = await channel.send({
                    content: `ðŸ”„ Nouveau tirage ! FÃ©licitations ${winnerMentions} ! Tu as gagnÃ© le concours **${giveaway.prize || 'Concours mystÃ¨re'}** ! CrÃ©e un ticket pour rÃ©cupÃ©rer ton lot ðŸŽ`,
                });
                updatedGiveaway.winnerPingMessageId = newPingMsg.id;
            }

            logger.info(`Giveaway successfully rerolled: ${messageId} with ${newWinners.length} new winners`);

            try {
                await logEvent({
                    client: interaction.client,
                    guildId: interaction.guildId,
                    eventType: EVENT_TYPES.GIVEAWAY_REROLL,
                    data: {
                        description: `Tirage relancÃ© : ${giveaway.prize}`,
                        channelId: giveaway.channelId,
                        userId: interaction.user.id,
                        fields: [
                            {
                                name: 'ðŸŽ Prix',
                                value: giveaway.prize || 'Concours mystÃ¨re !',
                                inline: true
                            },
                            {
                                name: 'ðŸ† Nouveaux gagnants',
                                value: winnerMentions,
                                inline: false
                            },
                            {
                                name: 'ðŸ‘¥ Participations totales',
                                value: participants.length.toString(),
                                inline: true
                            }
                        ]
                    }
                });
            } catch (logError) {
                logger.debug('Error logging giveaway reroll event:', logError);
            }

            return InteractionHelper.safeReply(interaction, {
                embeds: [
                    successEmbed(
                        "Relance rÃ©ussie âœ…",
                        `Tirage relancÃ© avec succÃ¨s pour **${giveaway.prize}** dans ${channel}. ${newWinners.length} nouveau(x) gagnant(s) sÃ©lectionnÃ©(s).`,
                    ),
                ],
                flags: MessageFlags.Ephemeral,
            });

        } catch (error) {
            logger.error('Error in greroll command:', error);
            await handleInteractionError(interaction, error, {
                type: 'command',
                commandName: 'greroll',
                context: 'giveaway_reroll'
            });
        }
    },
};



