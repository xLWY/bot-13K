import { EmbedBuilder } from 'discord.js';
import { getTicketData, saveTicketData } from '../../utils/database.js';
import { logger } from '../../utils/logger.js';
import { getColor } from '../../config/bot.js';
import { getGuildConfig } from '../../services/guildConfig.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';

const STAR_LABELS = {
    '1': '⭐ 1 — Mauvaise',
    '2': '⭐⭐ 2 — Moyenne',
    '3': '⭐⭐⭐ 3 — Correcte',
    '4': '⭐⭐⭐⭐ 4 — Bonne',
    '5': '⭐⭐⭐⭐⭐ 5 — Excellente',
};

const feedbackHandler = {
    name: 'ticket_feedback',

    async execute(interaction, client, args) {
        // args = [guildId, channelId, rating]
        const [guildId, channelId, ratingStr] = args;

        if (!guildId || !channelId || !ratingStr) {
            await InteractionHelper.sendErrorNotice(interaction, 'Ce lien de sondage semble invalide.');
            return;
        }

        let ticketData;
        try {
            ticketData = await getTicketData(guildId, channelId);
        } catch (err) {
            logger.warn('ticketFeedback: failed to load ticket data', { guildId, channelId, error: err.message });
        }

        if (!ticketData) {
            await InteractionHelper.sendErrorNotice(interaction, 'Impossible de trouver le ticket associé à ce sondage.');
            return;
        }

        if (interaction.user.id !== ticketData.userId) {
            await InteractionHelper.sendErrorNotice(interaction, 'Seul le créateur du ticket peut donner son avis pour ce ticket.');
            return;
        }

        if (ticketData.feedback?.rating) {
            await interaction.update({
                embeds: [
                    new EmbedBuilder()
                        .setTitle('✅ Déjà répondu')
                        .setDescription(`Vous avez déjà noté ce ticket **${STAR_LABELS[String(ticketData.feedback.rating)]}**.\nMerci pour votre avis !`)
                        .setColor(getColor('success')),
                ],
                components: [],
            });
            return;
        }

        const rating = parseInt(ratingStr, 10);
        const ratingLabel = STAR_LABELS[String(rating)] ?? `${rating} étoiles`;

        try {
            ticketData.feedback = {
                rating,
                submittedAt: new Date().toISOString(),
            };
            await saveTicketData(guildId, channelId, ticketData);
        } catch (err) {
            logger.error('ticketFeedback: failed to save feedback', { guildId, channelId, rating, error: err.message });
        }

        // Send feedback to logs channel
        try {
            const guildConfig = await getGuildConfig(interaction.client, guildId);
            if (guildConfig.ticketLogsChannelId) {
                const logsChannel = await interaction.client.channels.fetch(guildConfig.ticketLogsChannelId).catch(() => null);
                if (logsChannel && logsChannel.isSendable()) {
                    const feedbackEmbed = new EmbedBuilder()
                        .setTitle('📋 Avis reçu')
                        .setDescription('L\'utilisateur a donné son avis sur un ticket')
                        .setColor(getColor('info'))
                        .addFields(
                            { name: 'ID du ticket', value: `\`${channelId}\``, inline: true },
                            { name: 'Note', value: ratingLabel, inline: true },
                            { name: 'Utilisateur', value: `<@${interaction.user.id}>`, inline: true },
                            { name: 'Envoyé le', value: `<t:${Math.floor(Date.now() / 1000)}:R>`, inline: true },
                        )
                        .setThumbnail(interaction.user.displayAvatarURL())
                        .setFooter({ text: `ID utilisateur : ${interaction.user.id}` })
                        .setTimestamp();

                    await logsChannel.send({ embeds: [feedbackEmbed] });
                }
            }
        } catch (err) {
            logger.warn('ticketFeedback: failed to send log', { guildId, channelId, error: err.message });
        }

        await interaction.update({
            embeds: [
                new EmbedBuilder()
                    .setTitle('✅ Merci pour votre avis !')
                    .setDescription(`Vous avez noté votre expérience **${ratingLabel}**.\n\nVotre avis a bien été enregistré et nous aide à nous améliorer !`)
                    .setColor(getColor('success'))
                    .setFooter({ text: 'Merci d\'avoir utilisé notre support.' })
                    .setTimestamp(),
            ],
            components: [],
        });

        logger.info('Ticket feedback submitted', {
            guildId,
            channelId,
            userId: interaction.user.id,
            rating,
        });
    },
};

const declineHandler = {
    name: 'ticket_feedback_decline',

    async execute(interaction) {
        await interaction.update({
            embeds: [
                new EmbedBuilder()
                    .setTitle('👋 Pas de souci !')
                    .setDescription('Vous pouvez nous recontacter à tout moment si vous avez besoin d\'aide.')
                    .setColor(getColor('default')),
            ],
            components: [],
        });
    },
};

export default [feedbackHandler, declineHandler];
