import { SlashCommandBuilder, EmbedBuilder, MessageFlags, version as djsVersion } from 'discord.js';
import { getColor } from '../config/bot.js';
import { InteractionHelper } from '../utils/interactionHelper.js';
import { logger } from '../utils/logger.js';

function round(ms) {
    return Math.max(0, Math.round(ms));
}

export default {
    data: new SlashCommandBuilder()
        .setName('ping')
        .setDescription('* Affiche la latence du bot')
        .setDMPermission(true),

    category: 'general',

    async execute(interaction, config, client) {
        try {
            const sentAt = Date.now();

            await InteractionHelper.safeDefer(interaction, { flags: MessageFlags.Ephemeral });

            const message = await InteractionHelper.safeEditReply(interaction, {
                embeds: [
                    new EmbedBuilder()
                        .setColor(getColor('success'))
                        .setDescription('\u{1F3B1} Ping...')
                ],
                flags: MessageFlags.Ephemeral
            });

            const roundTrip = round((message?.createdTimestamp || sentAt) - sentAt);
            const heartbeat = round(client.ws.ping);
            const now = Date.now();

            await InteractionHelper.safeEditReply(interaction, {
                embeds: [
                    new EmbedBuilder()
                        .setColor(getColor('info'))
                        .setTitle('\u{1F4C8} Latence du bot')
                        .addFields(
                            { name: '\u{1F3E1} Websocket', value: `\`${heartbeat} ms\``, inline: true },
                            { name: '\u{23F1} Aller-retour', value: `\`${roundTrip} ms\``, inline: true },
                            { name: '\u{1F5B1}\u{FE0F} Uptime', value: `\`${formatUptime(now - client.uptime)}\``, inline: true },
                        )
                        .setFooter({ text: `discord.js v${djsVersion}` })
                        .setTimestamp()
                ],
                flags: MessageFlags.Ephemeral
            });
        } catch (error) {
            logger.error('Error in /ping:', error);
            await InteractionHelper.sendErrorNotice(interaction, 'Impossible de calculer la latence.').catch(() => {});
        }
    },
};

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