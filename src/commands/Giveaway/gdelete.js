import { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } from 'discord.js';
import { isBotOwner } from '../../utils/ownerIds.js';
import { errorEmbed, successEmbed } from '../../utils/embeds.js';
import { logger } from '../../utils/logger.js';
import { TitanBotError, ErrorTypes, handleInteractionError } from '../../utils/errorHandler.js';
import { getGuildGiveaways, deleteGiveaway } from '../../utils/giveaways.js';
import { logEvent, EVENT_TYPES } from '../../services/loggingService.js';

import { InteractionHelper } from '../../utils/interactionHelper.js';
export default {
    data: new SlashCommandBuilder()
        .setName("gdelete")
        .setDescription(
            "* Supprime un message de concours et le retire de la base de donnÃ©es.",
        )
        .addStringOption((option) =>
            option
                .setName("messageid")
                .setDescription("L'identifiant du message du concours Ã  supprimer.")
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
                    "Vous devez avoir la permission `GÃ©rer le serveur` pour supprimer un concours.",
                    { userId: interaction.user.id, guildId: interaction.guildId }
                );
            }

            logger.info(`Giveaway deletion started by ${interaction.user.tag} in guild ${interaction.guildId}`);

            const messageId = interaction.options.getString("messageid");

            
            if (!messageId || !/^\d+$/.test(messageId)) {
                throw new TitanBotError(
                    'Invalid message ID format',
                    ErrorTypes.VALIDATION,
                    'Veuillez fournir un identifiant de message valide.',
                    { providedId: messageId }
                );
            }

            const giveaways = await getGuildGiveaways(interaction.client, interaction.guildId);
            const giveaway = giveaways.find(g => g.messageId === messageId);

            if (!giveaway) {
                throw new TitanBotError(
                    `Giveaway not found: ${messageId}`,
                    ErrorTypes.VALIDATION,
                    "Aucun concours n'a Ã©tÃ© trouvÃ© avec cet identifiant de message.",
                    { messageId, guildId: interaction.guildId }
                );
            }

            let deletedMessage = false;
            let channelName = "Unknown Channel";

            const tryDeleteFromChannel = async (channel) => {
                if (!channel || !channel.isTextBased() || !channel.messages?.fetch) {
                    return false;
                }

                const message = await channel.messages.fetch(messageId).catch(() => null);
                if (!message) {
                    return false;
                }

                await message.delete();
                channelName = channel.name || 'unknown-channel';
                deletedMessage = true;
                return true;
            };

            
            try {
                const channel = await interaction.client.channels.fetch(giveaway.channelId).catch(() => null);
                if (await tryDeleteFromChannel(channel)) {
                    logger.debug(`Deleted giveaway message ${messageId} from channel ${channelName}`);
                }

                if (!deletedMessage && interaction.guild) {
                    const textChannels = interaction.guild.channels.cache.filter(
                        ch => ch.id !== giveaway.channelId && ch.isTextBased() && ch.messages?.fetch
                    );

                    for (const [, guildChannel] of textChannels) {
                        const foundAndDeleted = await tryDeleteFromChannel(guildChannel).catch(() => false);
                        if (foundAndDeleted) {
                            logger.debug(`Deleted giveaway message ${messageId} via fallback lookup in #${channelName}`);
                            break;
                        }
                    }
                }
            } catch (error) {
                logger.warn(`Could not delete giveaway message: ${error.message}`);
            }

            
            const removedFromDatabase = await deleteGiveaway(
                interaction.client,
                interaction.guildId,
                messageId,
            );

            if (!removedFromDatabase) {
                throw new TitanBotError(
                    `Failed to delete giveaway from database: ${messageId}`,
                    ErrorTypes.UNKNOWN,
                    "Le concours n'a pas pu Ãªtre retirÃ© de la base de donnÃ©es. Veuillez rÃ©essayer.",
                    { messageId, guildId: interaction.guildId }
                );
            }

            const giveawaysAfterDelete = await getGuildGiveaways(interaction.client, interaction.guildId);
            const stillExistsInDatabase = giveawaysAfterDelete.some(g => g.messageId === messageId);

            if (stillExistsInDatabase) {
                throw new TitanBotError(
                    `Giveaway still exists after deletion: ${messageId}`,
                    ErrorTypes.UNKNOWN,
                    "La suppression n'a pas Ã©tÃ© enregistrÃ©e dans la base de donnÃ©es. Veuillez rÃ©essayer.",
                    { messageId, guildId: interaction.guildId }
                );
            }

            const statusMsg = deletedMessage
                ? `et le message a Ã©tÃ© supprimÃ© de #${channelName}`
                : `mais le message Ã©tait dÃ©jÃ  supprimÃ© ou le salon Ã©tait inaccessible.`;

            const winnerIds = Array.isArray(giveaway.winnerIds) ? giveaway.winnerIds : [];
            const hasWinners = winnerIds.length > 0;
            const wasEnded = giveaway.ended === true || giveaway.isEnded === true || hasWinners;

            const winnerStatusMsg = hasWinners
                ? `Ce concours avait dÃ©jÃ  ${winnerIds.length} gagnant(s) sÃ©lectionnÃ©(s).`
                : wasEnded
                    ? 'Ce concours Ã©tait terminÃ© sans gagnant valide.'
                    : "Aucun gagnant n'avait Ã©tÃ© tirÃ© avant la suppression.";

            logger.info(`Giveaway deleted: ${messageId} in ${channelName}`);

            
            try {
                await logEvent({
                    client: interaction.client,
                    guildId: interaction.guildId,
                    eventType: EVENT_TYPES.GIVEAWAY_DELETE,
                    data: {
                        description: `Concours supprimÃ© : ${giveaway.prize}`,
                        channelId: giveaway.channelId,
                        userId: interaction.user.id,
                        fields: [
                            {
                                name: 'ðŸŽ Prix',
                                value: giveaway.prize || 'Inconnu',
                                inline: true
                            },
                            {
                                name: 'ðŸ“Š Participations',
                                value: (giveaway.participants?.length || 0).toString(),
                                inline: true
                            }
                        ]
                    }
                });
            } catch (logError) {
                logger.debug('Error logging giveaway deletion:', logError);
            }

            return InteractionHelper.safeReply(interaction, {
                embeds: [
                    successEmbed(
                        "Concours supprimÃ©",
                        `Concours supprimÃ© pour **${giveaway.prize}** ${statusMsg}. ${winnerStatusMsg}`,
                    ),
                ],
                flags: MessageFlags.Ephemeral,
            });

        } catch (error) {
            logger.error('Error in gdelete command:', error);
            await handleInteractionError(interaction, error, {
                type: 'command',
                commandName: 'gdelete',
                context: 'giveaway_deletion'
            });
        }
    },
};


