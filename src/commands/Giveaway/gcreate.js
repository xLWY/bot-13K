import { SlashCommandBuilder, PermissionFlagsBits, ChannelType, MessageFlags } from 'discord.js';
import { isBotOwner } from '../../utils/ownerIds.js';
import { logger } from '../../utils/logger.js';
import { XlwyBotError, ErrorTypes, getUserMessage } from '../../utils/errorHandler.js';
import { saveGiveaway } from '../../utils/giveaways.js';
import {
    parseDuration,
    validatePrize,
    validateWinnerCount,
    createGiveawayEmbed,
    createGiveawayButtons
} from '../../services/giveawayService.js';
import { logEvent, EVENT_TYPES } from '../../services/loggingService.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { createEmbed, errorEmbed } from '../../utils/embeds.js';
import { brandFooter, discordTimestamp, formatNumber, guildIconUrl } from '../../ui/kit.js';

const FOOTER_CONTEXT = 'Création de concours';
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
    logger.error('[GCreate] command failed:', error);
    await InteractionHelper.safeReply(
        interaction,
        privatePayload(interaction, errorPayload(getUserMessage(error))),
    );
}

function buildSuccessPayload(interaction, targetChannel, giveaway, durationString) {
    const deadline = giveaway.endTime;
    const embed = createEmbed({
        title: '✅ Concours lancé',
        description: `Le concours **${giveaway.prize}** est actif dans ${targetChannel}. Les participants peuvent réagir jusqu’à la clôture.`,
        color: 'success',
        thumbnail: guildIconUrl(interaction.guild, 96),
        fields: [
            {
                name: '⏰ Clôture',
                value: `${discordTimestamp(deadline, 'F')}\n${discordTimestamp(deadline, 'R')}`,
                inline: false,
            },
            { name: '⏱️ Durée', value: `\`${durationString}\``, inline: true },
            { name: '🏆 Gagnants', value: formatNumber(giveaway.winnerCount), inline: true },
            {
                name: '📩 Message',
                value: `\`${giveaway.messageId}\` · [Ouvrir le concours](https://discord.com/channels/${interaction.guildId}/${targetChannel.id}/${giveaway.messageId})`,
                inline: false,
            },
        ],
        footer: brandFooter(FOOTER_CONTEXT),
    });

    return { embeds: [embed], components: [] };
}

export default {
    data: new SlashCommandBuilder()
        .setName("gcreate")
        .setDescription("Lancer un nouveau concours dans un salon spécifié.")
        .addStringOption((option) =>
            option
                .setName("duration")
                .setDescription(
                    "Durée du giveaway (ex: 1h, 30m, 5d).",
                )
                .setRequired(true),
        )
        .addIntegerOption((option) =>
            option
                .setName("winners")
                .setDescription("Le nombre de gagnants à tirer.")
                .setMinValue(1)
                .setMaxValue(10)
                .setRequired(true),
        )
        .addStringOption((option) =>
            option
                .setName("prize")
                .setDescription("Le prix à gagner.")
                .setRequired(true),
        )
        .addChannelOption((option) =>
            option
                .setName("channel")
                .setDescription("Le salon où envoyer le concours (par défaut le salon actuel).")
                .addChannelTypes(ChannelType.GuildText)
                .setRequired(false),
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
                    'Tu dois avoir la permission `Gérer le serveur` pour lancer un concours.',
                    { userId: interaction.user.id, guildId: interaction.guildId }
                );
            }

            logger.info(`Giveaway creation started by ${interaction.user.tag} in guild ${interaction.guildId}`);


            const durationString = interaction.options.getString("duration");
            const winnerCount = interaction.options.getInteger("winners");
            const prize = interaction.options.getString("prize");
            const targetChannel = interaction.options.getChannel("channel") || interaction.channel;


            const durationMs = parseDuration(durationString);
            validateWinnerCount(winnerCount);
            const prizeName = validatePrize(prize);


            if (!targetChannel.isTextBased()) {
                throw new XlwyBotError(
                    'Target channel is not text-based',
                    ErrorTypes.VALIDATION,
                    'Le salon doit être un salon textuel.',
                    { channelId: targetChannel.id, channelType: targetChannel.type }
                );
            }

            const endTime = Date.now() + durationMs;


            const initialGiveawayData = {
                messageId: "placeholder",
                channelId: targetChannel.id,
                guildId: interaction.guildId,
                prize: prizeName,
                hostId: interaction.user.id,
                endTime: endTime,
                endsAt: endTime,
                winnerCount: winnerCount,
                participants: [],
                isEnded: false,
                ended: false,
                createdAt: new Date().toISOString()
            };


            const embed = createGiveawayEmbed(initialGiveawayData, "active");
            const row = createGiveawayButtons(false);


            const giveawayMessage = await targetChannel.send({
                embeds: [embed],
                components: [row],
            });


            initialGiveawayData.messageId = giveawayMessage.id;
            const saved = await saveGiveaway(
                interaction.client,
                interaction.guildId,
                initialGiveawayData,
            );

            if (!saved) {
                // Sans persistance, le concours ne sera jamais tiré : on annule
                // le message et on le dit clairement au lieu de prétendre un succès.
                logger.error(`Failed to save giveaway to database: ${giveawayMessage.id}`);
                await giveawayMessage.delete().catch(() => {});
                await InteractionHelper.safeReply(
                    interaction,
                    privatePayload(interaction, errorPayload(
                        'Impossible d’enregistrer le concours pour le moment. Réessaie dans un instant.',
                    )),
                );
                return;
            }


            try {
                await logEvent({
                    client: interaction.client,
                    guildId: interaction.guildId,
                    eventType: EVENT_TYPES.GIVEAWAY_CREATE,
                    data: {
                        description: `Concours créé : ${prizeName}`,
                        channelId: targetChannel.id,
                        userId: interaction.user.id,
                        fields: [
                            {
                                name: '🎁 Prix',
                                value: prizeName,
                                inline: true
                            },
                            {
                                name: '🏆 Gagnants',
                                value: winnerCount.toString(),
                                inline: true
                            },
                            {
                                name: '⏰ Durée',
                                value: durationString,
                                inline: true
                            },
                            {
                                name: '📍 Salon',
                                value: targetChannel.toString(),
                                inline: true
                            }
                        ]
                    }
                });
            } catch (logError) {
                logger.debug('Error logging giveaway creation event:', logError);
            }

            logger.info(`Giveaway created successfully: ${giveawayMessage.id} in ${targetChannel.name}`);


            await InteractionHelper.safeReply(
                interaction,
                privatePayload(
                    interaction,
                    buildSuccessPayload(interaction, targetChannel, initialGiveawayData, durationString),
                ),
            );

        } catch (error) {
            await replyError(interaction, error);
        }
    },
};
