import { SlashCommandBuilder, MessageFlags, PermissionFlagsBits, version as djsVersion } from 'discord.js';
import { InteractionHelper } from '../utils/interactionHelper.js';
import { createEmbed, errorEmbed } from '../utils/embeds.js';
import { logger } from '../utils/logger.js';
import { isBotOwner, getBotOwnerIds } from '../utils/ownerIds.js';
import { ownerDmHealth } from '../utils/ownerLogRelay.js';
import { brandFooter, discordTimestamp, formatNumber } from '../ui/kit.js';

const CONTEXT = 'Diagnostic';

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

function errorPage(message) {
    return errorEmbed(message).setFooter(brandFooter(CONTEXT));
}

async function sendError(interaction, message) {
    await InteractionHelper.safeReply(interaction, {
        embeds: [errorPage(message)],
        flags: MessageFlags.Ephemeral,
        allowedMentions: { parse: [], repliedUser: false },
    });
}

function buildHealthField() {
    const health = ownerDmHealth();
    if (health.length === 0) {
        return getBotOwnerIds().length === 0
            ? 'Aucun propriétaire configuré.'
            : 'Aucun envoi effectué pour l’instant.';
    }

    const visible = health.slice(0, 8);
    const lines = visible.map((entry) => {
        const status = entry.failures > 0 ? '🔴' : '🟢';
        return [
            `${status} \`${entry.ownerId}\``,
            `erreurs : \`${formatNumber(entry.failures)}\``,
            `dernier ${discordTimestamp(entry.lastSent, 'R')}`,
        ].join(' • ');
    });
    if (health.length > visible.length) lines.push('…');
    return lines.join('\n');
}

function buildDiagnosticEmbed(interaction, client) {
    const isDm = !interaction.guildId;
    const globalCount = client.application?.commands?.cache?.size ?? -1;
    const guildCommandCount = interaction.guild?.commands?.cache?.size ?? -1;

    return createEmbed({
        title: 'Diagnostic du bot',
        description: 'État du bot au moment de la requête. Ces informations sont privées.',
        color: 'info',
        fields: [
            {
                name: 'Contexte',
                value: [
                    `Salon : \`${isDm ? 'privé (MP)' : 'serveur'}\``,
                    `ID du serveur : \`${interaction.guildId ?? 'aucun'}\``,
                    `Propriétaire du bot : \`${isBotOwner(interaction.user.id) ? 'oui' : 'non'}\``,
                ].join('\n'),
                inline: false,
            },
            {
                name: 'Connexion',
                value: [
                    `Prêt : \`${client.isReady()}\``,
                    `Disponibilité : \`${formatUptime(client.uptime ?? 0)}\``,
                    `Websocket : \`${formatNumber(Math.max(0, Math.round(client.ws?.ping ?? -1)))} ms\``,
                    `Serveurs : \`${formatNumber(client.guilds?.cache?.size ?? -1)}\``,
                ].join('\n'),
                inline: false,
            },
            {
                name: 'Commandes',
                value: [
                    `En mémoire : \`${formatNumber(client.commands?.size ?? -1)}\``,
                    `Globales enregistrées : \`${formatNumber(globalCount)}\``,
                    `Sur ce serveur : \`${formatNumber(guildCommandCount)}\``,
                    `discord.js : \`v${djsVersion}\``,
                ].join('\n'),
                inline: false,
            },
            {
                name: 'Journaux en MP',
                value: buildHealthField(),
                inline: false,
            },
        ],
        footer: brandFooter(CONTEXT),
    });
}

export default {
    data: new SlashCommandBuilder()
        .setName('diag')
        .setDescription('Diagnostic du bot (owner)')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .setDMPermission(true),

    category: 'debug',
    ownerOnly: true,
    hiddenFromSlash: false,

    async execute(interaction, config, client) {
        if (!isBotOwner(interaction.user.id)) {
            await sendError(interaction, 'Cette commande est réservée au propriétaire du bot.');
            return;
        }

        try {
            await InteractionHelper.safeReply(interaction, {
                embeds: [buildDiagnosticEmbed(interaction, client)],
                flags: MessageFlags.Ephemeral,
                allowedMentions: { parse: [], repliedUser: false },
            });
        } catch (error) {
            logger.error('Error in diag:', error);
            await sendError(interaction, 'Impossible de terminer le diagnostic. Réessaie dans un instant.');
        }
    },
};
