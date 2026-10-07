import { SlashCommandBuilder, EmbedBuilder, MessageFlags, version as djsVersion } from 'discord.js';
import { getColor } from '../config/bot.js';
import { InteractionHelper } from '../utils/interactionHelper.js';
import { logger } from '../utils/logger.js';
import { isBotOwner, getBotOwnerIds } from '../utils/ownerIds.js';
import { ownerDmHealth } from '../utils/ownerLogRelay.js';

function formatUptime(ms) {
    const totalSeconds = Math.floor(ms / 1000);
    const days = Math.floor(totalSeconds / 86400);
    const hours = Math.floor((totalSeconds % 86400) / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    const parts = [];
    if (days) parts.push(`${days}j`);
    if (hours) parts.push(`${hours}h`);
    if (minutes) parts.push(`${minutes}m`);
    parts.push(`${seconds}s`);
    return parts.join(' ');
}

export default {
    data: new SlashCommandBuilder()
        .setName('diag')
        .setDescription('* Diagnostic du bot (owner)')
        .setDMPermission(true),

    category: 'debug',
    hiddenFromSlash: false,

    async execute(interaction, config, client) {
        if (!isBotOwner(interaction.user.id)) {
            await InteractionHelper.safeReply(interaction, {
                content: '`diag` est reserve au owner du bot.',
                flags: MessageFlags.Ephemeral
            });
            return;
        }

        try {
            const isDm = !interaction.guildId;
            const globalCount = client.application?.commands?.cache?.size ?? -1;
            const guildCommandCount = interaction.guild?.commands?.cache?.size ?? -1;

            const embed = new EmbedBuilder()
                .setColor(getColor('info'))
                .setTitle('\u{1F9EA} Diagnostic LW Bot')
                .addFields(
                    {
                        name: 'Contexte',
                        value: [
                            `Salon : \`${isDm ? 'PRIVE (DM)' : 'serveur'}\``,
                            `Guild ID : \`${interaction.guildId ?? 'null'}\``,
                            `Tu es owner : \`${isBotOwner(interaction.user.id)}\``
                        ].join('\n'),
                        inline: false
                    },
                    {
                        name: 'Connexe',
                        value: [
                            `Pret : \`${client.isReady()}\``,
                            `Uptime : \`${formatUptime(client.uptime ?? 0)}\``,
                            `Websocket : \`${Math.max(0, Math.round(client.ws?.ping ?? -1))} ms\``,
                            `Serveurs : \`${client.guilds?.cache?.size ?? -1}\``
                        ].join('\n'),
                        inline: false
                    },
                    {
                        name: 'Commandes',
                        value: [
                            `Chargees en memoire : \`${client.commands?.size ?? -1}\``,
                            `Globales enregistrees : \`${globalCount}\``,
                            `Du serveur : \`${guildCommandCount}\``
                        ].join('\n'),
inline: false
                    },
                    {
                        name: 'Logs owner (DM)',
                        value: (() => {
                            const health = ownerDmHealth();
                            if (health.length === 0) {
                                return getBotOwnerIds().length === 0
                                    ? '`Aucun owner configure`'
                                    : '`Aucun envoi effectue pour l instant`';
                            }
                            return health.map(h => {
                                const last = h.lastSent ? `<t:${Math.floor(h.lastSent / 1000)}:R>` : 'jamais';
                                const flag = h.failures > 0 ? '\u{1F534}' : '\u{1F7E2}';
                                return `${flag} \`${h.ownerId}\`\nerreurs : \`${h.failures}\` | dernier : ${last}`;
                            }).join('\n');
                        })(),
                        inline: false
                    }
                )
                .setFooter({ text: `discord.js v${djsVersion} - owner only` })
                .setTimestamp();

            await InteractionHelper.safeReply(interaction, { embeds: [embed], flags: MessageFlags.Ephemeral });
        } catch (error) {
            logger.error('Error in diag:', error);
            await InteractionHelper.sendErrorNotice(interaction, 'Erreur pendant le diagnostic.').catch(() => {});
        }
    },
};
