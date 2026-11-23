import { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } from 'discord.js';
import { isBotOwner } from '../../utils/ownerIds.js';
import { logger } from '../../utils/logger.js';
import { XlwyBotError, ErrorTypes, getUserMessage } from '../../utils/errorHandler.js';
import { getGuildGiveaways, deleteGiveaway } from '../../utils/giveaways.js';
import { logEvent, EVENT_TYPES } from '../../services/loggingService.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { createEmbed, errorEmbed } from '../../utils/embeds.js';
import { brandFooter, formatNumber, guildIconUrl } from '../../ui/kit.js';

const FOOTER_CONTEXT = 'Suppression de concours';
const NO_MENTIONS = { parse: [], repliedUser: false };

/** Les réponses de gestion sont privées en serveur et ne mentionnent personne. */
function privatePayload(interaction, payload) {
    return {
        ...payload,
        allowedMentions: NO_MENTIONS,
        ...(interaction.inGuild() ? { flags: MessageFlags.Ephemeral } : {}),
    };
}

function errorPayload(text) {
    const embed = errorEmbed(text);
    embed.setFooter(brandFooter(FOOTER_CONTEXT));
    return { embeds: [embed], components: [] };
}

async function replyError(interaction, error) {
    logger.error('Error in gdelete command:', error);
    await InteractionHelper.safeReply(
        interaction,
        privatePayload(interaction, errorPayload(getUserMessage(error))),
    );
}

function cleanText(value) {
    return String(value ?? 'Inconnu').replace(/[`@]/g, '').slice(0, 80);
}

function buildSuccessPayload(interaction, giveaway, { deletedMessage, channelName, winnerIds, wasEnded }) {
    const displayChannel = channelName === 'unknown-channel'
        ? 'salon inconnu'
        : cleanText(channelName);

    const winnerStatus = winnerIds.length > 0
        ? `Ce concours avait déjà ${formatNumber(winnerIds.length)} gagnant(s).`
        : wasEnded
            ? 'Ce concours était terminé sans gagnant valide.'
            : 'Aucun gagnant n’avait été tiré avant la suppression.';

    const embed = createEmbed({
        title: '✅ Concours supprimé',
        description: `Le concours **${cleanText(giveaway.prize)}** a été retiré de la base de données. ${winnerStatus}`,
        color: 'success',
        thumbnail: guildIconUrl(interaction.guild, 96),
        fields: [
            {
                name: '🧹 Message',
                value: deletedMessage
                    ? `Supprimé dans \`#${displayChannel}\``
                    : 'Introuvable ou salon inaccessible',
                inline: false,
            },
            {
                name: '👥 Participations',
                value: formatNumber(giveaway.participants?.length ?? 0),
                inline: true,
            },
            { name: '🗂️ État', value: wasEnded ? 'Terminé' : 'Actif', inline: true },
            { name: '🆔 Identifiant', value: `\`${giveaway.messageId}\``, inline: true },
        ],
        footer: brandFooter(FOOTER_CONTEXT),
    });

    return { embeds: [embed], components: [] };
}

export default {
    data: new SlashCommandBuilder()
        .setName("gdelete")
        .setDescription(
            "Supprime un message de concours et le retire de la base de données.",
        )
        .addStringOption((option) =>
            option
                .setName("messageid")
                .setDescription("L'identifiant du message du concours à supprimer.")
                .setRequired(true),
        )
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

    deferEphemeral: true,

    async execute(interaction) {
        try {

            if (!interaction.inGuild()) {
                throw new XlwyBotError(
                    'Giveaway command used outside guild',
                    ErrorTypes.VALIDATION,
                    'Cette commande ne peut être utilisée que sur un serveur.',
                    { userId: interaction.user.id }
                );
            }


            if (!isBotOwner(interaction.member.id) && !interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
                throw new XlwyBotError(
                    'User lacks ManageGuild permission',
                    ErrorTypes.PERMISSION,
                    'Tu dois avoir la permission `Gérer le serveur` pour supprimer un concours.',
                    { userId: interaction.user.id, guildId: interaction.guildId }
                );
            }

            logger.info(`Giveaway deletion started by ${interaction.user.tag} in guild ${interaction.guildId}`);

            const messageId = interaction.options.getString("messageid");


            if (!messageId || !/^\d+$/.test(messageId)) {
                throw new XlwyBotError(
                    'Invalid message ID format',
                    ErrorTypes.VALIDATION,
                    'Fournis un identifiant de message valide.',
                    { providedId: messageId }
                );
            }

            const giveaways = await getGuildGiveaways(interaction.client, interaction.guildId);
            const giveaway = giveaways.find(g => g.messageId === messageId);

            if (!giveaway) {
                throw new XlwyBotError(
                    `Giveaway not found: ${messageId}`,
                    ErrorTypes.VALIDATION,
                    'Aucun concours n’a été trouvé avec cet identifiant de message. Vérifie l’ID et réessaie.',
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
                throw new XlwyBotError(
                    `Failed to delete giveaway from database: ${messageId}`,
                    ErrorTypes.UNKNOWN,
                    'Le concours n’a pas pu être retiré de la base de données. Réessaie dans un instant.',
                    { messageId, guildId: interaction.guildId }
                );
            }

            const giveawaysAfterDelete = await getGuildGiveaways(interaction.client, interaction.guildId);
            const stillExistsInDatabase = giveawaysAfterDelete.some(g => g.messageId === messageId);

            if (stillExistsInDatabase) {
                throw new XlwyBotError(
                    `Giveaway still exists after deletion: ${messageId}`,
                    ErrorTypes.UNKNOWN,
                    'La suppression n’a pas été enregistrée dans la base de données. Réessaie dans un instant.',
                    { messageId, guildId: interaction.guildId }
                );
            }

            const winnerIds = Array.isArray(giveaway.winnerIds) ? giveaway.winnerIds : [];
            const hasWinners = winnerIds.length > 0;
            const wasEnded = giveaway.ended === true || giveaway.isEnded === true || hasWinners;

            logger.info(`Giveaway deleted: ${messageId} in ${channelName}`);


            try {
                await logEvent({
                    client: interaction.client,
                    guildId: interaction.guildId,
                    eventType: EVENT_TYPES.GIVEAWAY_DELETE,
                    data: {
                        description: `Concours supprimé : ${giveaway.prize}`,
                        channelId: giveaway.channelId,
                        userId: interaction.user.id,
                        fields: [
                            {
                                name: '🎁 Prix',
                                value: giveaway.prize || 'Inconnu',
                                inline: true
                            },
                            {
                                name: '📊 Participations',
                                value: (giveaway.participants?.length || 0).toString(),
                                inline: true
                            }
                        ]
                    }
                });
            } catch (logError) {
                logger.debug('Error logging giveaway deletion:', logError);
            }

            return InteractionHelper.safeReply(
                interaction,
                privatePayload(
                    interaction,
                    buildSuccessPayload(interaction, giveaway, { deletedMessage, channelName, winnerIds, wasEnded }),
                ),
            );

        } catch (error) {
            await replyError(interaction, error);
        }
    },
};
