import { SlashCommandBuilder } from 'discord.js';
import { createEmbed } from '../../utils/embeds.js';
import { logger } from '../../utils/logger.js';
import {
    getGuildStatsSummary,
    formatVoiceDuration
} from '../../services/statsService.js';
import { renderTopImage } from '../../services/statsImage.js';

const MAX_DISPLAY = 25;
const DEFAULT_DISPLAY = 10;

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

async function resolveMembers(guild, userIds) {
    const members = new Map();
    await Promise.all(userIds.map(async (userId) => {
        const cached = guild.members.cache.get(userId);
        const member = cached || (await guild.members.fetch(userId).catch(() => null));
        if (member) {
            members.set(userId, {
                name: member.displayName || member.user.username,
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
            await interaction.reply({ embeds: [createEmbed({ title: "📊 Classement d'activité", description: "Cette commande ne peut être utilisée que sur un serveur.", color: 'error' })] });
            return;
        }

        const limitRaw = interaction.options.getInteger("limit");
        const limit = Math.min(MAX_DISPLAY, Math.max(3, limitRaw || DEFAULT_DISPLAY));

        const { users, startedAt } = await getGuildStatsSummary(client, interaction.guild.id);

        if (users.length === 0) {
            await interaction.reply({
                embeds: [createEmbed({
                    title: "📊 Classement d'activité",
                    description: "Aucune donnée pour le moment. Les statistiques commencent à être collectées dès maintenant.",
                    color: 'info'
                })]
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
            avatarUrl: members.get(u.userId)?.avatarUrl || null,
            value: u.messages
        }));
        const voiceEntries = byVoice.map((u) => ({
            name: members.get(u.userId)?.name || 'Membre',
            avatarUrl: members.get(u.userId)?.avatarUrl || null,
            value: u.voiceSeconds
        }));

        try {
            const imageBuffer = await renderTopImage({
                guildName: interaction.guild.name,
                guildIconUrl: interaction.guild.iconURL({ extension: 'png', size: 128 }),
                startedAt,
                memberCount: users.length,
                messageEntries,
                voiceEntries
            });
            await interaction.reply({ files: [{ attachment: imageBuffer, name: 'top.png' }] });
            return;
        } catch (imageError) {
            logger.warn('Failed to render top image, falling back to embed:', imageError.message);
        }

        const decoratedMessages = byMessages.map((u) => ({ ...u, displayName: members.get(u.userId)?.name }));
        const decoratedVoice = byVoice.map((u) => ({ ...u, displayName: members.get(u.userId)?.name }));

        const messagesText = decoratedMessages.length > 0
            ? formatTopLines(decoratedMessages, (u) => `${u.messages.toLocaleString('fr-FR')} msg`)
            : 'Aucun message enregistré.';
        const voiceText = decoratedVoice.length > 0
            ? formatTopLines(decoratedVoice, (u) => formatVoiceDuration(u.voiceSeconds))
            : 'Aucune activité vocale enregistrée.';

        const embed = createEmbed({
            title: "📊 Top activité",
            description: `Statistiques cumulées depuis le <t:${Math.floor(startedAt / 1000)}:d> — ${users.length} membre(s) suivi(s).`,
            color: 'primary',
            fields: [
                {
                    name: "✉️ Messages",
                    value: messagesText,
                    inline: true
                },
                {
                    name: "🎙️ Vocal",
                    value: voiceText,
                    inline: true
                }
            ]
        });

        await interaction.reply({ embeds: [embed] });
    }
};