import { ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags, SlashCommandBuilder, version as djsVersion } from 'discord.js';
import { InteractionHelper } from '../utils/interactionHelper.js';
import { errorEmbed } from '../utils/embeds.js';
import { buildBotInviteUrl, RECOMMENDED_INVITE_PERMISSIONS } from '../utils/inviteUrl.js';
import {
    brandFooter,
    brandedEmbed,
    discordTimestamp,
    formatDuration,
    formatNumber,
    plural,
    statusField,
} from '../ui/kit.js';
import { logger } from '../utils/logger.js';

const CONTEXT = 'Informations du bot';

export default {
    data: new SlashCommandBuilder()
        .setName('botinfo')
        .setDescription('Affiche les informations et l’état du bot')
        .setDMPermission(true),

    category: 'general',
    aliases: ['botstats'],

    async execute(interaction, config, client) {
        try {
            const clientId = client?.config?.bot?.clientId || process.env.CLIENT_ID || client?.user?.id;
            const inviteUrl = buildBotInviteUrl(clientId, RECOMMENDED_INVITE_PERMISSIONS);
            const isConnected = Number.isFinite(client.ws?.ping) && client.ws.ping >= 0;
            const databaseMode = client.db?.getStatus?.()?.isDegraded ? 'mémoire (dégradée)' : 'persistante';

            const embed = brandedEmbed({
                title: 'À propos de 13K',
                description: 'Bot polyvalent : modération, tickets, giveaways, stats et bienvenue.',
                color: 'info',
                fields: [
                    statusField(isConnected, 'Connexion', 'En ligne', 'Hors ligne'),
                    {
                        name: 'Serveurs',
                        value: plural(client.guilds?.cache?.size ?? 0, 'serveur'),
                        inline: true,
                    },
                    {
                        name: 'Commandes',
                        value: plural(client.commands?.size ?? 0, 'commande'),
                        inline: true,
                    },
                    {
                        name: 'Latence',
                        value: `\`${formatNumber(Math.max(0, Math.round(client.ws?.ping ?? 0)))} ms\``,
                        inline: true,
                    },
                    {
                        name: 'Disponibilité',
                        value: `\`${formatDuration(client.uptime ?? 0)}\``,
                        inline: true,
                    },
                    {
                        name: 'Base de données',
                        value: `\`${databaseMode}\``,
                        inline: true,
                    },
                    {
                        name: 'Bibliothèque',
                        value: `\`discord.js v${djsVersion}\``,
                        inline: true,
                    },
                    {
                        name: 'Démarré',
                        value: discordTimestamp(Date.now() - (client.uptime ?? 0), 'R'),
                        inline: false,
                    },
                ],
            }, client, CONTEXT);

            const components = inviteUrl
                ? [new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setLabel('Ajouter le bot')
                        .setStyle(ButtonStyle.Link)
                        .setURL(inviteUrl),
                )]
                : [];

            await InteractionHelper.safeReply(interaction, {
                embeds: [embed],
                components,
                allowedMentions: { parse: [] },
            });
        } catch (error) {
            logger.error('Error in /botinfo:', error);
            await InteractionHelper.safeReply(interaction, {
                embeds: [errorEmbed('Impossible de récupérer les informations du bot.').setFooter(brandFooter(CONTEXT))],
                flags: MessageFlags.Ephemeral,
                allowedMentions: { parse: [] },
            }).catch(() => {});
        }
    },
};
