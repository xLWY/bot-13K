import { SlashCommandBuilder, MessageFlags, PermissionFlagsBits, version as djsVersion } from 'discord.js';
import { InteractionHelper } from '../utils/interactionHelper.js';
import { createEmbed, errorEmbed, infoEmbed } from '../utils/embeds.js';
import { logger } from '../utils/logger.js';
import { brandFooter, formatNumber } from '../ui/kit.js';

const CONTEXT = 'Latence';

function round(ms) {
    return Math.max(0, Math.round(ms));
}

function errorPage(message) {
    return errorEmbed(message).setFooter(brandFooter(CONTEXT));
}

async function sendError(interaction, message) {
    await InteractionHelper.safeEditReply(interaction, {
        embeds: [errorPage(message)],
        components: [],
        allowedMentions: { parse: [], repliedUser: false },
    });
}

export default {
    data: new SlashCommandBuilder()
        .setName('ping')
        .setDescription('Affiche la latence du bot')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .setDMPermission(true),

    category: 'general',

    async execute(interaction, config, client) {
        try {
            const sentAt = Date.now();

            if (!(await InteractionHelper.safeDefer(interaction, { flags: MessageFlags.Ephemeral }))) return;

            const waiting = infoEmbed('Calcul de la latence en cours…', 'ℹ️ Ping')
                .setFooter(brandFooter(CONTEXT));
            const message = await InteractionHelper.safeEditReply(interaction, { embeds: [waiting] });

            const roundTrip = round((message?.createdTimestamp || sentAt) - sentAt);
            const heartbeat = round(client.ws.ping);
            const isConnected = Number.isFinite(client.ws.ping) && client.ws.ping >= 0;
            const status = isConnected ? '🟢 Connexion active' : '🔴 Websocket indisponible';

            const embed = createEmbed({
                title: 'Latence du bot',
                description: 'Mesures relevées à l’instant.',
                color: 'info',
                fields: [
                    { name: 'État', value: status, inline: false },
                    { name: 'Websocket', value: `\`${formatNumber(heartbeat)} ms\``, inline: true },
                    { name: 'Aller-retour', value: `\`${formatNumber(roundTrip)} ms\``, inline: true },
                    { name: 'Disponibilité', value: `\`${formatUptime(client.uptime ?? 0)}\``, inline: true },
                    { name: 'Bibliothèque', value: `\`discord.js v${djsVersion}\``, inline: true },
                ],
                footer: brandFooter(CONTEXT),
            });

            await InteractionHelper.safeEditReply(interaction, {
                embeds: [embed],
                allowedMentions: { parse: [], repliedUser: false },
            });
        } catch (error) {
            logger.error('Error in /ping:', error);
            await sendError(interaction, 'Impossible de calculer la latence. Réessaie dans un instant.');
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
