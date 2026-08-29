import { SlashCommandBuilder } from 'discord.js';
import { createEmbed } from '../../utils/embeds.js';
import {
    getGuildStatsSummary,
    formatVoiceDuration
} from '../../services/statsService.js';

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

async function resolveDisplayNames(guild, userIds) {
    const displayNames = new Map();
    await Promise.all(userIds.map(async (userId) => {
        const cached = guild.members.cache.get(userId);
        if (cached) {
            displayNames.set(userId, cached.displayName || cached.user.username);
            return;
        }
        const member = await guild.members.fetch(userId).catch(() => null);
        if (member) {
            displayNames.set(userId, member.displayName || member.user.username);
        }
    }));
    return displayNames;
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

        const displayNames = await resolveDisplayNames(
            interaction.guild,
            [...new Set([...byMessages, ...byVoice].map((u) => u.userId))]
        );

        const decoratedMessages = byMessages.map((u) => ({ ...u, displayName: displayNames.get(u.userId) }));
        const decoratedVoice = byVoice.map((u) => ({ ...u, displayName: displayNames.get(u.userId) }));

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