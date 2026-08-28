import { EmbedBuilder } from 'discord.js';
import { getTicketData, saveTicketData } from '../../utils/database.js';
import { logger } from '../../utils/logger.js';
import { getColor } from '../../config/bot.js';
import { getGuildConfig } from '../../services/guildConfig.js';

const STAR_LABELS = {
    '1': '⭐ 1 — Mauvaise',
    '2': '⭐⭐ 2 — Moyenne',
    '3': '⭐⭐⭐ 3 — Correcte',
    '4': '⭐⭐⭐⭐ 4 — Bonne',
    '5': '⭐⭐⭐⭐⭐ 5 — Excellente',
};

export default {
    name: 'ticket_feedback',

    async execute(interaction, client, args) {
        // args = [guildId, channelId] from the customId split on ':'
        const [guildId, channelId] = args;

        if (!guildId || !channelId) {
            await interaction.update({
                embeds: [
                    new EmbedBuilder()
                        .setTitle('⚠️ Lien de sondage invalide')
                        .setDescription('Ce lien de sondage semble invalide.')
                        .setColor(getColor('error')),
                ],
                components: [],
            });
            return;
        }

        // Seul le créateur du ticket peut répondre
        let ticketData;
        try {
            ticketData = await getTicketData(guildId, channelId);
        } catch (err) {
            logger.warn('ticketFeedback: failed to load ticket data', { guildId, channelId, error: err.message });
        }

        if (!ticketData) {
            await interaction.update({
                embeds: [
                    new EmbedBuilder()
                        .setTitle('⚠️ Ticket introuvable')
                        .setDescription('Impossible de trouver le ticket associé à ce sondage.')
                        .setColor(getColor('error')),
                ],
                components: [],
            });
            return;
        }

        if (interaction.user.id !== ticketData.userId) {
            await interaction.reply({
                embeds: [
                    new EmbedBuilder()
                        .setTitle('❌ Non autorisé')
                        .setDescription('Seul le créateur du ticket peut donner son avis pour ce ticket.')
                        .setColor(getColor('error')),
                ],
                ephemeral: true,
            });
            return;
        }

        // Évite les réponses en double
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

        const rating = parseInt(interaction.values[0], 10);
        const ratingLabel = STAR_LABELS[String(rating)] ?? `${rating} étoiles`;

        // Persist the feedback
        try {
            ticketData.feedback = {
                rating,
                submittedAt: new Date().toISOString(),
            };
            await saveTicketData(guildId, channelId, ticketData);
        } catch (err) {
            logger.error('ticketFeedback: failed to save feedback', { guildId, channelId, rating, error: err.message });
        }

        // Envoyer l'avis au salon de logs
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
                            { name: 'Envoyé le', value: `<t:${Math.floor(Date.now() / 1000)}:R>`, inline: true }
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

        // Modifier le MP pour retirer le menu et afficher les remerciements
        const thankYouEmbed = new EmbedBuilder()
            .setTitle('✅ Merci pour votre avis !')
            .setDescription(`Vous avez noté votre expérience **${ratingLabel}**.\n\nVotre avis a bien été enregistré et nous aide à nous améliorer !`)
            .setColor(getColor('success'))
            .setFooter({ text: 'Merci d\'avoir utilisé notre support.' })
            .setTimestamp();

        await interaction.update({
            embeds: [thankYouEmbed],
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
