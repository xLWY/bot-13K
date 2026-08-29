import { SlashCommandBuilder } from 'discord.js';
import { createEmbed } from '../../utils/embeds.js';
import {
    getGuildStatsSummary,
    getUserStatsRecord,
    getUserRank,
    formatVoiceDuration
} from '../../services/statsService.js';

async function resolveDisplayName(guild, targetUser) {
    const member = guild.members.cache.get(targetUser.id) || (await guild.members.fetch(targetUser.id).catch(() => null));
    return member ? (member.displayName || member.user.username) : targetUser.username;
}

function formatTopChannels(guild, channels) {
    const lines = channels.slice(0, 5).map(([channelId, count]) => {
        const channel = guild.channels.cache.get(channelId) || guild.client.channels.cache.get(channelId);
        const name = channel ? `**#${channel.name}**` : '❓ Salon introuvable';
        return `${name} · ${count.toLocaleString('fr-FR')} msg`;
    });
    return lines.join('\n') || 'Aucun message enregistré.';
}

export default {
    data: new SlashCommandBuilder()
        .setName("u")
        .setDescription("Statistiques d'activité d'un membre (messages + vocal)")
        .addUserOption((option) =>
            option
                .setName("user")
                .setDescription("Le membre à consulter (défaut : vous)")
                .setRequired(false)
        ),

    async execute(interaction, guildConfig, client) {
        if (!interaction.guild) {
            await interaction.reply({ embeds: [createEmbed({ title: "📊 Statistiques", description: "Cette commande ne peut être utilisée que sur un serveur.", color: 'error' })] });
            return;
        }

        const targetUser = interaction.options.getUser("user") || interaction.user;

        const { users, startedAt } = await getGuildStatsSummary(client, interaction.guild.id);
        const record = getUserStatsRecord(users, targetUser.id);

        if (!record) {
            await interaction.reply({
                embeds: [createEmbed({
                    title: "📊 Statistiques",
                    description: `Aucune activité enregistrée pour **${targetUser.username}**. Les statistiques commencent à être collectées dès maintenant.`,
                    author: { name: `${targetUser.username}`, iconURL: targetUser.displayAvatarURL() },
                    color: 'info'
                })]
            });
            return;
        }

        const displayName = await resolveDisplayName(interaction.guild, targetUser);
        const messageRank = getUserRank(users, targetUser.id, "messages");
        const voiceRank = getUserRank(users, targetUser.id, "voiceSeconds");

        const messagesFieldValue = `**${record.messages.toLocaleString('fr-FR')}** messages\n\n**🏆 Rank messages :** #${messageRank}\n\n**Salons les plus actifs :**\n${formatTopChannels(interaction.guild, Object.entries(record.channels).sort((a, b) => b[1] - a[1]))}`;

        const voiceFieldValue = `**${formatVoiceDuration(record.voiceSeconds)}** en vocal\n\n**🏆 Rank vocal :** #${voiceRank}`;

        await interaction.reply({
            embeds: [createEmbed({
                title: `📊 ${displayName}`,
                description: `Statistiques cumulées depuis le <t:${Math.floor(startedAt / 1000)}:d>.`,
                author: { name: targetUser.username, iconURL: targetUser.displayAvatarURL() },
                color: 'primary',
                fields: [
                    { name: "✉️ Messages", value: messagesFieldValue, inline: true },
                    { name: "🎙️ Vocal", value: voiceFieldValue, inline: true }
                ]
            })]
        });
    }
};