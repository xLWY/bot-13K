import { getColor } from '../../config/bot.js';
import { SlashCommandBuilder, PermissionFlagsBits, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, MessageFlags, ComponentType } from 'discord.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { logger } from '../../utils/logger.js';
import { getWelcomeConfig } from '../../utils/database.js';
import { getGuildConfig } from '../../services/guildConfig.js';
import { getLevelingConfig } from '../../services/leveling.js';
import { getServerCounters } from '../../services/serverstatsService.js';
import { getConfiguration as getJtcConfig } from '../../services/joinToCreateService.js';
import { getAllReactionRoleMessages } from '../../services/reactionRoleService.js';
import greetDashboard from '../Welcome/modules/greet_dashboard.js';
import ticketDashboard from '../Ticket/modules/ticket_dashboard.js';
import levelingDashboard from './modules/leveling_dashboard.js';
import giveawayDashboard from './modules/giveaway_dashboard.js';
import shopDashboard from './modules/shop_dashboard.js';

export function openPanel(interaction, client, guildId) {
    const guild = interaction.guild || client.guilds.cache.get(guildId);

    return (async () => {
        const welcomeConfig = await getWelcomeConfig(client, guildId);
        const guildConfig = await getGuildConfig(client, guildId).catch(() => ({}));

        const [levelingConfig, jtcConfig, counters, reactionRoles] = await Promise.allSettled([
            getLevelingConfig(client, guildId).catch(() => null),
            getJtcConfig(client, guildId).catch(() => null),
            getServerCounters(client, guildId).catch(() => []),
            getAllReactionRoleMessages(client, guildId).catch(() => []),
        ]);

        const leveling = levelingConfig.status === 'fulfilled' ? levelingConfig.value : null;
        const jtc = jtcConfig.status === 'fulfilled' ? jtcConfig.value : null;
        const counterList = counters.status === 'fulfilled' ? counters.value : [];
        const rrList = reactionRoles.status === 'fulfilled' ? reactionRoles.value : [];

        const welcomeStatus = welcomeConfig?.channelId
            ? (guild.channels.cache.get(welcomeConfig.channelId) ? `<#${welcomeConfig.channelId}>` : '`⚠️ Introuvable`')
            : '`Non configuré`';
        const ticketStatus = guildConfig?.ticketPanelChannelId
            ? (guild.channels.cache.get(guildConfig.ticketPanelChannelId) ? `<#${guildConfig.ticketPanelChannelId}>` : '`⚠️ Introuvable`')
            : '`Non configuré`';
        const levelingStatus = leveling?.enabled ? '✅ Activé' : '❌ Désactivé';
        const jtcStatus = jtc?.enabled && jtc?.triggerChannels?.length ? `✅ ${jtc.triggerChannels.length} salon(s)` : '❌ Désactivé';
        const counterStatus = counterList.length ? `✅ ${counterList.length} compteur(s)` : '❌ Aucun';
        const rrStatus = rrList.length ? `✅ ${rrList.length} message(s)` : '❌ Aucun';

        const alerts = [];
        if (welcomeConfig?.channelId && !guild.channels.cache.get(welcomeConfig.channelId)) {
            alerts.push('⚠️ Le canal de bienvenue n\'existe plus — reconfigure via `/welcome dashboard`.');
        }
        if (welcomeConfig?.pingChannelId && !guild.channels.cache.get(welcomeConfig.pingChannelId)) {
            alerts.push('⚠️ Le salon de ping de bienvenue n\'existe plus.');
        }
        if (guildConfig?.ticketPanelChannelId && !guild.channels.cache.get(guildConfig.ticketPanelChannelId)) {
            alerts.push('⚠️ Le salon du panneau de tickets n\'existe plus.');
        }

        const embed = new EmbedBuilder()
            .setTitle(`⚙️ Panneau de contrôle — ${guild.name}`)
            .setDescription(
                alerts.length
                    ? `Voici l\'état global du serveur. **Alerte(s)** :\n${alerts.join('\n')}\n\nUtilise les boutons ci-dessous pour ouvrir chaque module.`
                    : 'Tout est bien configuré. Utilise les boutons ci-dessous pour ouvrir et modifier chaque module.',
            )
            .setColor(alerts.length ? getColor('warning') : getColor('success'))
            .addFields(
                { name: '🏷️ Bienvenue / Au revoir', value: welcomeStatus, inline: true },
                { name: '🎫 Tickets', value: ticketStatus, inline: true },
                { name: '📈 Leveling / XP', value: levelingStatus, inline: true },
                { name: '🔊 Salon vocal', value: jtcStatus, inline: true },
                { name: '📊 Compteurs', value: counterStatus, inline: true },
                { name: '🎭 Rôles réaction', value: rrStatus, inline: true },
                { name: '🎁 Giveaways', value: '`Via le dashboard`', inline: true },
                { name: '🏪 Boutique', value: '`Via le dashboard`', inline: true },
            )
            .setFooter({ text: 'Réservé aux administrateurs • /panel' })
            .setTimestamp();

        const modules = [
            { id: 'panel_welcome', label: 'Bienvenue', emoji: '🏷️' },
            { id: 'panel_ticket', label: 'Tickets', emoji: '🎫' },
            { id: 'panel_leveling', label: 'Leveling', emoji: '📈' },
            { id: 'panel_giveaway', label: 'Giveaways', emoji: '🎁' },
            { id: 'panel_shop', label: 'Boutique', emoji: '🏪' },
        ];
        const rows = [];
        for (let i = 0; i < modules.length; i += 5) {
            const row = new ActionRowBuilder();
            modules.slice(i, i + 5).forEach(m => {
                row.addComponents(
                    new ButtonBuilder()
                        .setCustomId(m.id)
                        .setLabel(m.label)
                        .setEmoji(m.emoji)
                        .setStyle(ButtonStyle.Primary),
                );
            });
            rows.push(row);
        }

        await InteractionHelper.safeEditReply(interaction, {
            embeds: [embed],
            components: rows,
            flags: MessageFlags.Ephemeral,
        });

        const collector = interaction.channel.createMessageComponentCollector({
            componentType: ComponentType.Button,
            filter: i =>
                i.user.id === interaction.user.id &&
                ['panel_welcome', 'panel_ticket', 'panel_leveling', 'panel_giveaway', 'panel_shop'].includes(i.customId),
            time: 600_000,
        });

        const onBack = (backInteraction) => openPanel(backInteraction, client, guildId);

        collector.on('collect', async btnInteraction => {
            try {
                switch (btnInteraction.customId) {
                    case 'panel_welcome':
                        return await greetDashboard.execute(btnInteraction, {}, client, onBack);
                    case 'panel_ticket':
                        return await ticketDashboard.execute(btnInteraction, guildConfig, client, onBack);
                    case 'panel_leveling':
                        return await levelingDashboard.execute(btnInteraction, guildConfig, client, onBack);
                    case 'panel_giveaway':
                        return await giveawayDashboard.execute(btnInteraction, {}, client, onBack);
                    case 'panel_shop':
                        return await shopDashboard.execute(btnInteraction, {}, client, onBack);
                }
            } catch (error) {
                logger.debug(`Panel module open failed (${btnInteraction.customId}):`, error.message);
                await InteractionHelper.sendErrorNotice(btnInteraction, 'Impossible d\'ouvrir ce module. Vérifie qu\'il est configuré, puis réessaie.').catch(() => {});
            }
        });

        collector.on('end', async (collected, reason) => {
            if (reason === 'time') {
                try {
                    await InteractionHelper.safeEditReply(interaction, {
                        embeds: [new EmbedBuilder()
                            .setTitle('⏰ Panneau expiré')
                            .setDescription('Ce panneau a été fermé après 10 minutes d\'inactivité. Relance `/panel` pour continuer.')
                            .setColor(getColor('error'))],
                        components: [],
                        flags: MessageFlags.Ephemeral,
                    });
                } catch (error) {
                    logger.debug('Could not update panel on timeout:', error.message);
                }
            }
        });
    })();
}

export default {
    data: new SlashCommandBuilder()
        .setName('panel')
        .setDescription('* Ouvrir le panneau de contrôle global du serveur')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

    async execute(interaction) {
        try {
            const { guild, client } = interaction;

            if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
                return await InteractionHelper.sendErrorNotice(interaction, 'Tu as besoin de la permission **Gérer le serveur** pour utiliser `/panel`.');
            }

            await InteractionHelper.safeDefer(interaction);
            await openPanel(interaction, client, guild.id);
        } catch (error) {
            logger.error('Error in /panel:', error);
            return await InteractionHelper.sendErrorNotice(interaction, 'Une erreur est survenue lors de l\'ouverture du panneau.');
        }
    },
};
