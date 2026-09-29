import { getColor } from '../../config/bot.js';
import { SlashCommandBuilder, PermissionFlagsBits, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, MessageFlags, ComponentType } from 'discord.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { isBotOwner } from '../../utils/ownerIds.js';
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
import serverstatsDashboard from './modules/serverstats_dashboard.js';
import jtcDashboard from './modules/jtc_dashboard.js';
import { openReactionRolesPanel } from '../Reaction_roles/reactroles.js';

export function openPanel(interaction, client, guildId) {
    const guild = interaction.guild || client.guilds.cache.get(guildId);

    return (async () => {
        await InteractionHelper.safeDeferOrUpdate(interaction, {});
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
            ? (guild.channels.cache.get(welcomeConfig.channelId) ? `<#${welcomeConfig.channelId}>` : '`âš ï¸ Introuvable`')
            : '`Non configurÃ©`';
        const ticketStatus = guildConfig?.ticketPanelChannelId
            ? (guild.channels.cache.get(guildConfig.ticketPanelChannelId) ? `<#${guildConfig.ticketPanelChannelId}>` : '`âš ï¸ Introuvable`')
            : '`Non configurÃ©`';
        const levelingStatus = leveling?.enabled ? 'âœ… ActivÃ©' : 'âŒ DÃ©sactivÃ©';
        const jtcTriggerList = Array.isArray(jtc?.triggerChannels)
            ? jtc.triggerChannels
            : (jtc?.triggerChannels ? [jtc.triggerChannels] : []);
        const jtcStatus = (jtc?.enabled === true || jtc?.enabled === 'true') && jtcTriggerList.length
            ? `âœ… ${jtcTriggerList.length} salon(s)`
            : 'âŒ DÃ©sactivÃ©';
        const counterStatus = counterList.length ? `âœ… ${counterList.length} compteur(s)` : 'âŒ Aucun';
        const rrStatus = rrList.length ? `âœ… ${rrList.length} message(s)` : 'âŒ Aucun';

        const alerts = [];
        if (welcomeConfig?.channelId && !guild.channels.cache.get(welcomeConfig.channelId)) {
            alerts.push('âš ï¸ Le canal de bienvenue n\'existe plus â€” reconfigure via `/welcome dashboard`.');
        }
        if (welcomeConfig?.pingChannelId && !guild.channels.cache.get(welcomeConfig.pingChannelId)) {
            alerts.push('âš ï¸ Le salon de ping de bienvenue n\'existe plus.');
        }
        if (guildConfig?.ticketPanelChannelId && !guild.channels.cache.get(guildConfig.ticketPanelChannelId)) {
            alerts.push('âš ï¸ Le salon du panneau de tickets n\'existe plus.');
        }

        const embed = new EmbedBuilder()
            .setTitle(`âš™ï¸ Panneau de contrÃ´le â€” ${guild.name}`)
            .setDescription(
                alerts.length
                    ? `Voici l\'Ã©tat global du serveur. **Alerte(s)** :\n${alerts.join('\n')}\n\nUtilise les boutons ci-dessous pour ouvrir chaque module.`
                    : 'Tout est bien configurÃ©. Utilise les boutons ci-dessous pour ouvrir et modifier chaque module.',
            )
            .setColor(alerts.length ? getColor('warning') : getColor('success'))
            .addFields(
                { name: 'ðŸ·ï¸ Bienvenue / Au revoir', value: welcomeStatus, inline: true },
                { name: 'ðŸŽ« Tickets', value: ticketStatus, inline: true },
                { name: 'ðŸ“ˆ Leveling / XP', value: levelingStatus, inline: true },
                { name: 'ðŸ”Š Salon vocal', value: jtcStatus, inline: true },
                { name: 'ðŸ“Š Compteurs', value: counterStatus, inline: true },
                { name: 'ðŸŽ­ RÃ´les rÃ©action', value: rrStatus, inline: true },
                { name: 'ðŸŽ Giveaways', value: '`Via le dashboard`', inline: true },
                { name: 'ðŸª Boutique', value: '`Via le dashboard`', inline: true },
            )
            .setFooter({ text: 'RÃ©servÃ© aux administrateurs â€¢ /panel' })
            .setTimestamp();

        const modules = [
            { id: 'panel_welcome', label: 'Bienvenue', emoji: 'ðŸ·ï¸' },
            { id: 'panel_ticket', label: 'Tickets', emoji: 'ðŸŽ«' },
            { id: 'panel_leveling', label: 'Leveling', emoji: 'ðŸ“ˆ' },
            { id: 'panel_jtc', label: 'Salon vocal', emoji: 'ðŸ”Š' },
            { id: 'panel_serverstats', label: 'Compteurs', emoji: 'ðŸ“Š' },
            { id: 'panel_giveaway', label: 'Giveaways', emoji: 'ðŸŽ' },
            { id: 'panel_shop', label: 'Boutique', emoji: 'ðŸª' },
            { id: 'panel_reactionroles', label: 'RÃ´les rÃ©action', emoji: 'ðŸŽ­' },
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

        InteractionHelper.armDashboardSession(interaction);

        const collector = interaction.channel.createMessageComponentCollector({
            componentType: ComponentType.Button,
            filter: i =>
                i.user.id === interaction.user.id &&
                ['panel_welcome', 'panel_ticket', 'panel_leveling', 'panel_jtc', 'panel_serverstats', 'panel_giveaway', 'panel_shop', 'panel_reactionroles'].includes(i.customId),
                time: 300_000,
        });

        const onBack = (backInteraction) => openPanel(backInteraction, client, guildId);

        collector.on('collect', async btnInteraction => {
            InteractionHelper.armDashboardSession(interaction);
            try {
                switch (btnInteraction.customId) {
                    case 'panel_welcome':
                        return await greetDashboard.execute(btnInteraction, {}, client, onBack);
                    case 'panel_ticket':
                        return await ticketDashboard.execute(btnInteraction, guildConfig, client, onBack);
                    case 'panel_leveling':
                        return await levelingDashboard.execute(btnInteraction, guildConfig, client, onBack);
                    case 'panel_jtc':
                        return await jtcDashboard.execute(btnInteraction, {}, client, onBack);
                    case 'panel_serverstats':
                        return await serverstatsDashboard.execute(btnInteraction, {}, client, onBack);
                    case 'panel_giveaway':
                        return await giveawayDashboard.execute(btnInteraction, {}, client, onBack);
                    case 'panel_shop':
                        return await shopDashboard.execute(btnInteraction, {}, client, onBack);
                    case 'panel_reactionroles':
                        return await openReactionRolesPanel(btnInteraction, onBack);
                }
            } catch (error) {
                logger.debug(`Panel module open failed (${btnInteraction.customId}):`, error.message);
                const message = error?.userMessage || 'Impossible d\'ouvrir ce module. VÃ©rifie qu\'il est configurÃ©, puis rÃ©essaie.';
                await InteractionHelper.sendErrorNotice(btnInteraction, message).catch(() => {});
            }
        });

    })();
}

export default {
    data: new SlashCommandBuilder()
        .setName('panel')
        .setDescription('* Ouvrir le panneau de contrÃ´le global du serveur')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

    async execute(interaction) {
        try {
            const { guild, client } = interaction;

            if (!isBotOwner(interaction.user.id) && !interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
                return await InteractionHelper.sendErrorNotice(interaction, 'Tu as besoin de la permission **GÃ©rer le serveur** pour utiliser `/panel`.');
            }

            await InteractionHelper.safeDefer(interaction);
            await openPanel(interaction, client, guild.id);
        } catch (error) {
            logger.error('Error in /panel:', error);
            return await InteractionHelper.sendErrorNotice(interaction, 'Une erreur est survenue lors de l\'ouverture du panneau.');
        }
    },
};
