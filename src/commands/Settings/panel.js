import { getColor } from '../config/bot.js';
import { SlashCommandBuilder, PermissionFlagsBits, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, MessageFlags, ComponentType } from 'discord.js';
import { InteractionHelper } from '../utils/interactionHelper.js';
import { logger } from '../utils/logger.js';
import { getWelcomeConfig } from '../utils/database.js';
import { getGuildConfig } from '../services/guildConfig.js';
import greetDashboard from './Welcome/modules/greet_dashboard.js';
import ticketDashboard from './Ticket/modules/ticket_dashboard.js';
import verificationDashboard from './Verification/modules/verification_dashboard.js';
import autoVerifyDashboard from './Verification/modules/autoVerifyDashboard.js';

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

            const welcomeConfig = await getWelcomeConfig(client, guild.id);
            const guildConfig = await getGuildConfig(client, guild.id).catch(() => ({}));

            const welcomeStatus = welcomeConfig?.channelId
                ? (guild.channels.cache.get(welcomeConfig.channelId) ? `<#${welcomeConfig.channelId}>` : '`⚠️ Introuvable`')
                : '`Non configuré`';
            const ticketStatus = guildConfig?.ticketPanelChannelId
                ? (guild.channels.cache.get(guildConfig.ticketPanelChannelId) ? `<#${guildConfig.ticketPanelChannelId}>` : '`⚠️ Introuvable`')
                : '`Non configuré`';
            const verificationStatus = guildConfig?.verification?.enabled ? '✅ Activée' : '❌ Désactivée';

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
                    { name: '✅ Vérification', value: verificationStatus, inline: true },
                )
                .setFooter({ text: 'Réservé aux administrateurs • /panel' })
                .setTimestamp();

            const btnRow1 = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId('panel_welcome')
                    .setLabel('Bienvenue / Au revoir')
                    .setEmoji('🏷️')
                    .setStyle(ButtonStyle.Primary),
                new ButtonBuilder()
                    .setCustomId('panel_ticket')
                    .setLabel('Tickets')
                    .setEmoji('🎫')
                    .setStyle(ButtonStyle.Primary),
                new ButtonBuilder()
                    .setCustomId('panel_verify')
                    .setLabel('Vérification')
                    .setEmoji('✅')
                    .setStyle(ButtonStyle.Primary),
                new ButtonBuilder()
                    .setCustomId('panel_autoverify')
                    .setLabel('AutoVérif.')
                    .setEmoji('🛡️')
                    .setStyle(ButtonStyle.Primary),
            );

            await InteractionHelper.safeEditReply(interaction, {
                embeds: [embed],
                components: [btnRow1],
                flags: MessageFlags.Ephemeral,
            });

            const collector = interaction.channel.createMessageComponentCollector({
                componentType: ComponentType.Button,
                filter: i =>
                    i.user.id === interaction.user.id &&
                    ['panel_welcome', 'panel_ticket', 'panel_verify', 'panel_autoverify'].includes(i.customId),
                time: 600_000,
            });

            collector.on('collect', async btnInteraction => {
                try {
                    switch (btnInteraction.customId) {
                        case 'panel_welcome':
                            return await greetDashboard.execute(btnInteraction, {}, client);
                        case 'panel_ticket':
                            return await ticketDashboard.execute(btnInteraction, guildConfig, client);
                        case 'panel_verify':
                            return await verificationDashboard.execute(btnInteraction, guildConfig, client);
                        case 'panel_autoverify':
                            return await autoVerifyDashboard.execute(btnInteraction, guildConfig, client);
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

        } catch (error) {
            logger.error('Error in /panel:', error);
            return await InteractionHelper.sendErrorNotice(interaction, 'Une erreur est survenue lors de l\'ouverture du panneau.');
        }
    },
};
