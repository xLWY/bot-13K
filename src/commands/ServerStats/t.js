import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import { createEmbed, errorEmbed, infoEmbed } from '../../utils/embeds.js';
import {
    brandFooter,
    discordTimestamp,
    formatNumber,
    guildIconUrl,
    progressBar,
} from '../../ui/kit.js';
import { logger } from '../../utils/logger.js';
import {
    getGuildStatsSummary,
    formatVoiceDuration
} from '../../services/statsService.js';
import { renderTopImage } from '../../services/statsImage.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';

const MAX_DISPLAY = 25;
const DEFAULT_DISPLAY = 10;
const MENTION_OPTIONS = { parse: [] };

function medalForIndex(index) {
    if (index === 0) return '🥇';
    if (index === 1) return '🥈';
    if (index === 2) return '🥉';
    return `${index + 1}.`;
}

function formatTopLines(entries, formatter) {
    return entries
        .map((entry, index) => `${medalForIndex(index)} **${entry.displayName || 'Utilisateur inconnu'}** — ${formatter(entry)}`)
        .join('\n');
}

function withFooter(embed, context = 'Classement d’activité') {
    embed.setFooter(brandFooter(context));
    return embed;
}

function truncate(value, max = 1000) {
    const text = String(value ?? '');
    return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

async function resolveMembers(guild, userIds) {
    const members = new Map();
    await Promise.all(userIds.map(async (userId) => {
        const cached = guild.members.cache.get(userId);
        const member = cached || (await guild.members.fetch(userId).catch(() => null));
        if (member) {
            members.set(userId, {
                name: member.displayName || member.user.username,
                username: member.user.username,
                avatarUrl: member.user.displayAvatarURL({ extension: 'png', size: 128 })
            });
        }
    }));
    return members;
}

export default {
    data: new SlashCommandBuilder()
        .setName("t")
        .setDescription("Classement des membres les plus actifs (messages + vocal)")
        .addIntegerOption((option) =>
            option
                .setName("limit")
                .setDescription("Nombre de membres à afficher (défaut 10, max 25)")
                .setMinValue(3)
                .setMaxValue(MAX_DISPLAY)
                .setRequired(false)
        ),

    async execute(interaction, guildConfig, client) {
        if (!interaction.guild) {
            const embed = withFooter(errorEmbed(
                'Cette commande ne peut être utilisée que sur un serveur.',
            ), 'Classement d’activité');
            await InteractionHelper.safeReply(interaction, {
                embeds: [embed],
                flags: MessageFlags.Ephemeral,
                allowedMentions: MENTION_OPTIONS,
            });
            return;
        }

        const limitRaw = interaction.options.getInteger("limit");
        const limit = Math.min(MAX_DISPLAY, Math.max(3, limitRaw || DEFAULT_DISPLAY));

        let summary;
        try {
            summary = await getGuildStatsSummary(client, interaction.guild.id);
        } catch (error) {
            logger.error('Failed to load activity ranking:', error);
            const embed = withFooter(errorEmbed(
                'Impossible de charger le classement. Réessaie dans un instant.',
            ), 'Classement d’activité');
            await InteractionHelper.safeReply(interaction, {
                embeds: [embed],
                flags: MessageFlags.Ephemeral,
                allowedMentions: MENTION_OPTIONS,
            });
            return;
        }

        const { users, startedAt } = summary;

        if (users.length === 0) {
            const embed = withFooter(infoEmbed(
                'Aucune donnée pour le moment. Les statistiques commencent à être collectées dès maintenant.',
                '📊 Classement d’activité',
            ));
            await InteractionHelper.safeReply(interaction, {
                embeds: [embed],
                allowedMentions: MENTION_OPTIONS,
            });
            return;
        }

        const byMessages = [...users]
            .filter((u) => u.messages > 0)
            .sort((a, b) => b.messages - a.messages)
            .slice(0, limit);
        const byVoice = [...users]
            .filter((u) => u.voiceSeconds > 0)
            .sort((a, b) => b.voiceSeconds - a.voiceSeconds)
            .slice(0, limit);

        const members = await resolveMembers(
            interaction.guild,
            [...new Set([...byMessages, ...byVoice].map((u) => u.userId))]
        );

        const messageEntries = byMessages.map((u) => ({
            name: members.get(u.userId)?.name || 'Membre',
            username: members.get(u.userId)?.username || null,
            avatarUrl: members.get(u.userId)?.avatarUrl || null,
            value: u.messages
        }));
        const voiceEntries = byVoice.map((u) => ({
            name: members.get(u.userId)?.name || 'Membre',
            username: members.get(u.userId)?.username || null,
            avatarUrl: members.get(u.userId)?.avatarUrl || null,
            value: u.voiceSeconds
        }));

        const decoratedMessages = byMessages.map((u) => ({ ...u, displayName: members.get(u.userId)?.name }));
        const decoratedVoice = byVoice.map((u) => ({ ...u, displayName: members.get(u.userId)?.name }));

        const messagesText = decoratedMessages.length > 0
            ? formatTopLines(decoratedMessages, (u) => `${formatNumber(u.messages)} msg`)
            : 'Aucun message enregistré.';
        const voiceText = decoratedVoice.length > 0
            ? formatTopLines(decoratedVoice, (u) => formatVoiceDuration(u.voiceSeconds))
            : 'Aucune activité vocale enregistrée.';

        const totalMessages = users.reduce((sum, u) => sum + u.messages, 0);
        const totalVoiceSeconds = users.reduce((sum, u) => sum + u.voiceSeconds, 0);
        const topMessages = byMessages.reduce((sum, u) => sum + u.messages, 0);
        const topVoiceSeconds = byVoice.reduce((sum, u) => sum + u.voiceSeconds, 0);

        const summaryEmbed = createEmbed({
            title: '📊 Classement d’activité',
            description: [
                `${formatNumber(users.length)} membre(s) suivi(s) • Top ${formatNumber(limit)}`,
                `Statistiques collectées depuis le ${discordTimestamp(startedAt, 'd')}`,
            ].join('\n'),
            color: 'info',
            thumbnail: guildIconUrl(interaction.guild, 128),
            fields: [
                {
                    name: '✉️ Messages',
                    value: [
                        `\`${progressBar(topMessages, totalMessages, 10)}\` ${formatNumber(topMessages)} / ${formatNumber(totalMessages)}`,
                        truncate(messagesText),
                    ].join('\n'),
                    inline: false,
                },
                {
                    name: '🎙️ Vocal',
                    value: [
                        `\`${progressBar(topVoiceSeconds, totalVoiceSeconds, 10)}\` ${formatVoiceDuration(topVoiceSeconds)} / ${formatVoiceDuration(totalVoiceSeconds)}`,
                        truncate(voiceText),
                    ].join('\n'),
                    inline: false,
                },
            ],
            footer: brandFooter('Top activité'),
        });

        try {
            const imageBuffer = await renderTopImage({
                guildName: interaction.guild.name,
                guildIconUrl: guildIconUrl(interaction.guild, 128),
                startedAt,
                memberCount: users.length,
                messageEntries,
                voiceEntries,
                totalMessages,
                totalVoiceSeconds
            });
            await InteractionHelper.safeReply(interaction, {
                embeds: [summaryEmbed],
                files: [{ attachment: imageBuffer, name: 'top.png' }],
                allowedMentions: MENTION_OPTIONS,
            });
            return;
        } catch (imageError) {
            // Le rendu image échoue parfois (police manquante, mémoire) : on garde
            // le classement lisible, sans jamais exposer la pile d’erreur.
            logger.warn('Failed to render top image, falling back to embed:', imageError);
            await InteractionHelper.safeReply(interaction, {
                embeds: [summaryEmbed],
                allowedMentions: MENTION_OPTIONS,
            });
            return;
        }
    }
};
