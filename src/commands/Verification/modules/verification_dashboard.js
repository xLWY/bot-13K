import { botConfig, getColor } from '../../../config/bot.js';
import {
    ActionRowBuilder,
    StringSelectMenuBuilder,
    StringSelectMenuOptionBuilder,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    ChannelSelectMenuBuilder,
    RoleSelectMenuBuilder,
    ButtonBuilder,
    ButtonStyle,
    ChannelType,
    MessageFlags,
    ComponentType,
    EmbedBuilder,
} from 'discord.js';
import { InteractionHelper } from '../../../utils/interactionHelper.js';
import { successEmbed } from '../../../utils/embeds.js';
import { logger } from '../../../utils/logger.js';
import { TitanBotError, ErrorTypes } from '../../../utils/errorHandler.js';
import { getGuildConfig, setGuildConfig } from '../../../services/guildConfig.js';
import { getWelcomeConfig } from '../../../utils/database.js';
import { botHasPermission } from '../../../utils/permissionGuard.js';

// ─── Live Panel Sync ──────────────────────────────────────────────────────────

async function updateLivePanel(guild, cfg) {
    if (!cfg.channelId || !cfg.messageId) return;
    try {
        const channel = guild.channels.cache.get(cfg.channelId);
        if (!channel) return;
        const msg = await channel.messages.fetch(cfg.messageId).catch(() => null);
        if (!msg) return;

        const verifyEmbed = new EmbedBuilder()
            .setTitle('✅ Vérification du serveur')
            .setDescription(cfg.message || botConfig.verification.defaultMessage)
            .setColor(getColor('success'));

        const verifyButton = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('verify_user')
                .setLabel(cfg.buttonText || botConfig.verification.defaultButtonText)
                .setStyle(ButtonStyle.Success)
                .setEmoji('✅'),
        );

        await msg.edit({ embeds: [verifyEmbed], components: [verifyButton] });
    } catch (error) {
        logger.warn('Could not update live verification panel:', error.message);
    }
}

// ─── Embed & Menu Builders ────────────────────────────────────────────────────

function buildDashboardEmbed(cfg, guild, verifiedUserCount = 0, conflictSummary = '') {
    const channel = cfg.channelId ? `<#${cfg.channelId}>` : '`Non défini`';
    const role = cfg.roleId ? `<@&${cfg.roleId}>` : '`Non défini`';
    const rawMsg = cfg.message || botConfig.verification.defaultMessage;
    const msgPreview = `\`${rawMsg.length > 60 ? rawMsg.substring(0, 60) + '…' : rawMsg}\``;
    const buttonText = cfg.buttonText || botConfig.verification.defaultButtonText;

    const embed = new EmbedBuilder()
        .setTitle('🔒 Tableau de bord du système de vérification')
        .setDescription(`Gère les paramètres de vérification pour **${guild.name}**.\nSélectionne une option ci-dessous pour modifier un paramètre.`)
        .setColor(getColor('info'))
        .addFields(
            { name: '📢 Canal de vérification', value: channel, inline: true },
            { name: '🏷️ Rôle vérifié', value: role, inline: true },
            { name: '⚙️ Statut du système', value: cfg.enabled !== false ? '✅ Activé' : '❌ Désactivé', inline: true },
            { name: '🔘 Texte du bouton', value: `\`${buttonText}\``, inline: true },
            { name: '👥 Utilisateurs vérifiés', value: `${verifiedUserCount} utilisateurs`, inline: true },
            { name: '\u200B', value: '\u200B', inline: true },
            { name: '💬 Message de vérification', value: msgPreview, inline: false },
        );

    if (conflictSummary) {
        embed.addFields({ name: '⚠️ Conflits de configuration', value: conflictSummary, inline: false });
    }

    return embed
        .setFooter({ text: 'Le tableau de bord se ferme après 10 minutes d\'inactivité' })
        .setTimestamp();
}

function buildSelectMenu(guildId) {
    return new StringSelectMenuBuilder()
        .setCustomId(`verif_cfg_${guildId}`)
        .setPlaceholder('Sélectionne un paramètre à configurer...')
        .addOptions(
            new StringSelectMenuOptionBuilder()
                .setLabel('Changer le canal de vérification')
                .setDescription('Définir le canal où le panneau de vérification est publié')
                .setValue('channel')
                .setEmoji('📢'),
            new StringSelectMenuOptionBuilder()
                .setLabel('Changer le rôle vérifié')
                .setDescription('Définir le rôle attribué lorsqu\'un utilisateur se vérifie')
                .setValue('role')
                .setEmoji('🏷️'),
            new StringSelectMenuOptionBuilder()
                .setLabel('Modifier le message de vérification')
                .setDescription('Personnaliser le message affiché sur l\'embed du panneau de vérification')
                .setValue('message')
                .setEmoji('💬'),
            new StringSelectMenuOptionBuilder()
                .setLabel('Modifier le texte du bouton')
                .setDescription('Changer le libellé du bouton de vérification')
                .setValue('button_text')
                .setEmoji('🔘'),
        );
}

function buildButtonRow(cfg, guildId, disabled = false) {
    const systemOn = cfg.enabled !== false;
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`verif_cfg_toggle_${guildId}`)
            .setLabel('Vérification')
            .setStyle(systemOn ? ButtonStyle.Success : ButtonStyle.Danger)
            .setEmoji('🔒')
            .setDisabled(disabled),
    );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function refreshDashboard(rootInteraction, cfg, guildId, client) {
    try {
        const selectMenu = buildSelectMenu(guildId);
        
        // Get verified user count and conflict summary
        let verifiedUserCount = 0;
        let conflictSummary = '';
        
        try {
            const verifiedRole = rootInteraction.guild.roles.cache.get(cfg.roleId);
            if (verifiedRole) {
                verifiedUserCount = verifiedRole.members.size;
            }
            
            const guildConfig = await getGuildConfig(client, guildId);
            const welcomeConfig = await getWelcomeConfig(client, guildId);
            const autoVerifyEnabled = Boolean(guildConfig.verification?.autoVerify?.enabled);
            const autoRoleConfigured = Boolean(guildConfig.autoRole) || (Array.isArray(welcomeConfig.roleIds) && welcomeConfig.roleIds.length > 0);
            
            const conflicts = [
                autoVerifyEnabled ? 'AutoVerify est activé' : null,
                autoRoleConfigured ? 'AutoRole est configuré' : null
            ].filter(Boolean);
            
            if (conflicts.length > 0) {
                conflictSummary = conflicts.join('\n');
            }
        } catch (error) {
            logger.warn('Could not fetch verification dashboard details:', error.message);
        }
        
        await InteractionHelper.safeEditReply(rootInteraction, {
            embeds: [buildDashboardEmbed(cfg, rootInteraction.guild, verifiedUserCount, conflictSummary)],
            components: [
                buildButtonRow(cfg, guildId),
                new ActionRowBuilder().addComponents(selectMenu),
            ],
            flags: MessageFlags.Ephemeral,
        });
    } catch (error) {
        logger.debug('Could not refresh verification dashboard (interaction may have expired):', error.message);
    }
}

// ─── Main Export ──────────────────────────────────────────────────────────────

export default {
    async execute(interaction, config, client) {
        try {
            const guildId = interaction.guild.id;
            const guildConfig = await getGuildConfig(client, guildId);
            const cfg = guildConfig.verification;

            if (!cfg?.channelId) {
                throw new TitanBotError(
                    'Verification not configured',
                    ErrorTypes.CONFIGURATION,
                    'Le système de vérification n\'a pas encore été configuré. Exécute `/verification setup` d\'abord.',
                );
            }

            await InteractionHelper.safeDefer(interaction, { flags: MessageFlags.Ephemeral });

            const selectMenu = buildSelectMenu(guildId);

            // Get verified user count and conflict summary
            let verifiedUserCount = 0;
            let conflictSummary = '';
            
            try {
                const verifiedRole = interaction.guild.roles.cache.get(cfg.roleId);
                if (verifiedRole) {
                    verifiedUserCount = verifiedRole.members.size;
                }
                
                const welcomeConfig = await getWelcomeConfig(client, guildId);
                const autoVerifyEnabled = Boolean(guildConfig.verification?.autoVerify?.enabled);
                const autoRoleConfigured = Boolean(guildConfig.autoRole) || (Array.isArray(welcomeConfig.roleIds) && welcomeConfig.roleIds.length > 0);
                
                const conflicts = [
                    autoVerifyEnabled ? 'AutoVerify is enabled' : null,
                    autoRoleConfigured ? 'AutoRole is configured' : null
                ].filter(Boolean);
                
                if (conflicts.length > 0) {
                    conflictSummary = conflicts.join('\n');
                }
            } catch (error) {
                logger.warn('Could not fetch verification dashboard details:', error.message);
            }

            await InteractionHelper.safeEditReply(interaction, {
                embeds: [buildDashboardEmbed(cfg, interaction.guild, verifiedUserCount, conflictSummary)],
                components: [
                    buildButtonRow(cfg, guildId),
                    new ActionRowBuilder().addComponents(selectMenu),
                ],
                flags: MessageFlags.Ephemeral,
            });

            const collector = interaction.channel.createMessageComponentCollector({
                componentType: ComponentType.StringSelect,
                filter: i =>
                    i.user.id === interaction.user.id && i.customId === `verif_cfg_${guildId}`,
                time: 600_000,
            });

            collector.on('collect', async selectInteraction => {
                const selectedOption = selectInteraction.values[0];
                try {
                    switch (selectedOption) {
                        case 'channel':
                            await handleChannel(selectInteraction, interaction, cfg, guildId, client);
                            break;
                        case 'role':
                            await handleRole(selectInteraction, interaction, cfg, guildId, client);
                            break;
                        case 'message':
                            await handleMessage(selectInteraction, interaction, cfg, guildId, client);
                            break;
                        case 'button_text':
                            await handleButtonText(selectInteraction, interaction, cfg, guildId, client);
                            break;
                    }
                } catch (error) {
                    if (error instanceof TitanBotError) {
                        logger.debug(`Verification config validation error: ${error.message}`);
                    } else {
                        logger.error('Unexpected verification dashboard error:', error);
                    }

                    const errorMessage =
                        error instanceof TitanBotError
                            ? error.userMessage || 'Une erreur est survenue lors du traitement de ta sélection.'
                            : 'Une erreur inattendue est survenue lors de la mise à jour de la configuration.';

                    if (!selectInteraction.replied && !selectInteraction.deferred) {
                        await selectInteraction.deferUpdate().catch(() => {});
                    }

                    await InteractionHelper.sendErrorNotice(selectInteraction, errorMessage);
                }
            });

            // ── Button collector for toggle ──────────────────────────────────
            const btnCollector = interaction.channel.createMessageComponentCollector({
                componentType: ComponentType.Button,
                filter: i =>
                    i.user.id === interaction.user.id &&
                    i.customId === `verif_cfg_toggle_${guildId}`,
                time: 600_000,
            });

            btnCollector.on('collect', async btnInteraction => {
                try {
                    await btnInteraction.deferUpdate().catch(() => null);
                } catch (err) {
                    logger.debug('Button interaction already expired:', err.message);
                    return;
                }
                
                const wasEnabled = cfg.enabled !== false;
                const autoVerifyEnabled = Boolean(guildConfig.verification?.autoVerify?.enabled);

                // Prevent enabling Verification if AutoVerify is enabled
                if (!wasEnabled && autoVerifyEnabled) {
                    await InteractionHelper.sendErrorNotice(btnInteraction, "AutoVerify est actuellement activé. Désactive d'abord AutoVerify avant d'activer le système de vérification manuelle. Exécute `/autoverify` pour accéder au tableau de bord AutoVerify.");
                    return;
                }

                cfg.enabled = !wasEnabled;

                // Disabling — remove the live panel message from the channel
                if (!cfg.enabled && cfg.channelId && cfg.messageId) {
                    const channel = interaction.guild.channels.cache.get(cfg.channelId);
                    if (channel) {
                        try {
                            const msg = await channel.messages.fetch(cfg.messageId).catch(() => null);
                            if (msg) await msg.delete();
                        } catch {
                            // already gone
                        }
                    }
                }

                // Re-enabling — re-post the verification panel in the configured channel
                if (cfg.enabled && cfg.channelId) {
                    const channel = interaction.guild.channels.cache.get(cfg.channelId);
                    if (channel) {
                        try {
                            const verifyEmbed = new EmbedBuilder()
                                .setTitle('✅ Vérification du serveur')
                                .setDescription(cfg.message || botConfig.verification.defaultMessage)
                                .setColor(getColor('success'));

                            const verifyButton = new ActionRowBuilder().addComponents(
                                new ButtonBuilder()
                                    .setCustomId('verify_user')
                                    .setLabel(cfg.buttonText || botConfig.verification.defaultButtonText)
                                    .setStyle(ButtonStyle.Success)
                                    .setEmoji('✅'),
                            );

                            const newMsg = await channel.send({ embeds: [verifyEmbed], components: [verifyButton] });
                            cfg.messageId = newMsg.id;
                        } catch (error) {
                            logger.warn('Could not re-post verification panel on re-enable:', error.message);
                        }
                    }
                }

                const latestConfig = await getGuildConfig(client, guildId);
                latestConfig.verification = cfg;
                await setGuildConfig(client, guildId, latestConfig);

                await btnInteraction.followUp({
                    embeds: [
                        successEmbed(
                            '✅ Système mis à jour',
                            `Le système de vérification est désormais **${cfg.enabled ? 'activé' : 'désactivé'}**.`,
                        ),
                    ],
                    flags: MessageFlags.Ephemeral,
                });

                await refreshDashboard(interaction, cfg, guildId, client);
            });

            collector.on('end', async (collected, reason) => {
                if (reason === 'time') {
                    btnCollector.stop();
                    try {
                        await InteractionHelper.safeEditReply(interaction, {
                            embeds: [
                                new EmbedBuilder()
                                    .setTitle('⏰ Tableau de bord expiré')
                                    .setDescription('Ce tableau de bord a été fermé en raison d\'une inactivité. Relance la commande pour continuer.')
                                    .setColor(getColor('error'))
                            ],
                            components: [],
                            flags: MessageFlags.Ephemeral,
                        });
                    } catch (error) {
                        logger.debug('Could not update dashboard on timeout:', error.message);
                    }
                }
            });
        } catch (error) {
            if (error instanceof TitanBotError) throw error;
            logger.error('Unexpected error in verification_dashboard:', error);
            throw new TitanBotError(
                `Verification dashboard failed: ${error.message}`,
                ErrorTypes.UNKNOWN,
                'Impossible d\'ouvrir le tableau de bord de vérification.',
            );
        }
    },
};

// ─── Change Verification Channel ─────────────────────────────────────────────

async function handleChannel(selectInteraction, rootInteraction, cfg, guildId, client) {
    await selectInteraction.deferUpdate();

    const channelSelect = new ChannelSelectMenuBuilder()
        .setCustomId('verif_cfg_channel')
        .setPlaceholder('Sélectionne un canal texte...')
        .addChannelTypes(ChannelType.GuildText)
        .setMaxValues(1);

    await selectInteraction.followUp({
        embeds: [
            new EmbedBuilder()
                .setTitle('📢 Changer le canal de vérification')
                .setDescription(
                    `**Actuel :** ${cfg.channelId ? `<#${cfg.channelId}>` : '`Non défini`'}\n\nSélectionne le canal où le panneau de vérification sera publié.\n\n> ⚠️ Le panneau existant sera supprimé et republié dans le nouveau canal.`,
                )
                .setColor(getColor('info')),
        ],
        components: [new ActionRowBuilder().addComponents(channelSelect)],
        flags: MessageFlags.Ephemeral,
    });

    const chanCollector = rootInteraction.channel.createMessageComponentCollector({
        componentType: ComponentType.ChannelSelect,
        filter: i =>
            i.user.id === selectInteraction.user.id && i.customId === 'verif_cfg_channel',
        time: 60_000,
        max: 1,
    });

    chanCollector.on('collect', async chanInteraction => {
        await chanInteraction.deferUpdate();
        const newChannel = chanInteraction.channels.first();

        if (!botHasPermission(newChannel, ['ViewChannel', 'SendMessages', 'EmbedLinks'])) {
            await InteractionHelper.sendErrorNotice(chanInteraction, `J'ai besoin des permissions **Voir le canal**, **Envoyer des messages** et **Intégrer des liens** dans ${newChannel}.`);
            return;
        }

        // Delete old panel if it exists
        if (cfg.channelId && cfg.messageId) {
            const oldChannel = rootInteraction.guild.channels.cache.get(cfg.channelId);
            if (oldChannel) {
                try {
                    const oldMsg = await oldChannel.messages.fetch(cfg.messageId).catch(() => null);
                    if (oldMsg) await oldMsg.delete();
                } catch {
                    // already gone
                }
            }
        }

        // Post new panel in the new channel (only if system is enabled)
        if (cfg.enabled !== false) {
            try {
                const verifyEmbed = new EmbedBuilder()
                    .setTitle('✅ Vérification du serveur')
                    .setDescription(cfg.message || botConfig.verification.defaultMessage)
                    .setColor(getColor('success'));

                const verifyButton = new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setCustomId('verify_user')
                        .setLabel(cfg.buttonText || botConfig.verification.defaultButtonText)
                        .setStyle(ButtonStyle.Success)
                        .setEmoji('✅'),
                );

                const newMsg = await newChannel.send({ embeds: [verifyEmbed], components: [verifyButton] });
                cfg.messageId = newMsg.id;
            } catch (error) {
                logger.warn('Could not post verification panel in new channel:', error.message);
            }
        }

        cfg.channelId = newChannel.id;
        const latestConfig = await getGuildConfig(client, guildId);
        latestConfig.verification = cfg;
        await setGuildConfig(client, guildId, latestConfig);

        await chanInteraction.followUp({
            embeds: [successEmbed('✅ Canal mis à jour', `Panneau de vérification déplacé vers ${newChannel}.`)],
            flags: MessageFlags.Ephemeral,
        });

        await refreshDashboard(rootInteraction, cfg, guildId, client);
    });

    chanCollector.on('end', (collected, reason) => {
        if (reason === 'time' && collected.size === 0) {
            InteractionHelper.sendErrorNotice(selectInteraction, 'Aucun canal n\'a été sélectionné. Le paramètre n\'a pas été modifié.');
        }
    });
}

// ─── Change Verified Role ─────────────────────────────────────────────────────

async function handleRole(selectInteraction, rootInteraction, cfg, guildId, client) {
    await selectInteraction.deferUpdate();

    const roleSelect = new RoleSelectMenuBuilder()
        .setCustomId('verif_cfg_role')
        .setPlaceholder('Sélectionne un rôle...')
        .setMaxValues(1);

    await selectInteraction.followUp({
        embeds: [
            new EmbedBuilder()
                .setTitle('🏷️ Changer le rôle vérifié')
                .setDescription(
                    `**Actuel :** ${cfg.roleId ? `<@&${cfg.roleId}>` : '`Non défini`'}\n\nSélectionne le rôle à attribuer lorsqu\'un utilisateur se vérifie.`,
                )
                .setColor(getColor('info')),
        ],
        components: [new ActionRowBuilder().addComponents(roleSelect)],
        flags: MessageFlags.Ephemeral,
    });

    const roleCollector = rootInteraction.channel.createMessageComponentCollector({
        componentType: ComponentType.RoleSelect,
        filter: i =>
            i.user.id === selectInteraction.user.id && i.customId === 'verif_cfg_role',
        time: 60_000,
        max: 1,
    });

    roleCollector.on('collect', async roleInteraction => {
        await roleInteraction.deferUpdate();
        const role = roleInteraction.roles.first();
        const guild = rootInteraction.guild;
        const botMember = guild.members.me;

        if (role.id === guild.id || role.managed) {
            await InteractionHelper.sendErrorNotice(roleInteraction, 'Veuillez choisir un rôle attribuable normal (pas @everyone ni un rôle géré par un bot).');
            return;
        }

        if (role.position >= botMember.roles.highest.position) {
            await InteractionHelper.sendErrorNotice(roleInteraction, 'Le rôle vérifié doit se situer en dessous de mon rôle le plus haut dans la hiérarchie des rôles du serveur.');
            return;
        }

        cfg.roleId = role.id;
        const latestConfig = await getGuildConfig(client, guildId);
        latestConfig.verification = cfg;
        await setGuildConfig(client, guildId, latestConfig);

        await roleInteraction.followUp({
            embeds: [successEmbed('✅ Rôle mis à jour', `Rôle vérifié défini sur ${role}.`)],
            flags: MessageFlags.Ephemeral,
        });

        await refreshDashboard(rootInteraction, cfg, guildId, client);
    });

    roleCollector.on('end', (collected, reason) => {
        if (reason === 'time' && collected.size === 0) {
            InteractionHelper.sendErrorNotice(selectInteraction, 'Aucun rôle n\'a été sélectionné. Le paramètre n\'a pas été modifié.');
        }
    });
}

// ─── Edit Verification Message ────────────────────────────────────────────────

async function handleMessage(selectInteraction, rootInteraction, cfg, guildId, client) {
    try {
        const modal = new ModalBuilder()
            .setCustomId('verif_cfg_message')
            .setTitle('Modifier le message de vérification')
            .addComponents(
                new ActionRowBuilder().addComponents(
                    new TextInputBuilder()
                        .setCustomId('message_input')
                        .setLabel('Message affiché sur l\'embed du panneau de vérification')
                        .setStyle(TextInputStyle.Paragraph)
                        .setValue(cfg.message || botConfig.verification.defaultMessage)
                        .setMaxLength(2000)
                        .setMinLength(1)
                        .setRequired(true),
                ),
            );

        await selectInteraction.showModal(modal);

        const submitted = await selectInteraction
            .awaitModalSubmit({
                filter: i =>
                    i.customId === 'verif_cfg_message' && i.user.id === selectInteraction.user.id,
                time: 120_000,
            })
            .catch(() => null);

        if (!submitted) return;

        cfg.message = submitted.fields.getTextInputValue('message_input').trim();

        const latestConfig = await getGuildConfig(client, guildId);
        latestConfig.verification = cfg;
        await setGuildConfig(client, guildId, latestConfig);

        await updateLivePanel(rootInteraction.guild, cfg);

        await submitted.reply({
            embeds: [successEmbed('✅ Message mis à jour', 'Le panneau de vérification a été mis à jour avec le nouveau message.')],
            flags: MessageFlags.Ephemeral,
        });

        await refreshDashboard(rootInteraction, cfg, guildId, client);
    } catch (error) {
        logger.error('Error in handleMessage:', error);
        // Silently fail - modal display failed, user can try again
    }
}

// ─── Edit Button Text ─────────────────────────────────────────────────────────

async function handleButtonText(selectInteraction, rootInteraction, cfg, guildId, client) {
    try {
        const modal = new ModalBuilder()
            .setCustomId('verif_cfg_button_text')
            .setTitle('Modifier le texte du bouton')
            .addComponents(
                new ActionRowBuilder().addComponents(
                    new TextInputBuilder()
                        .setCustomId('button_text_input')
                        .setLabel('Libellé du bouton (80 caractères max)')
                        .setStyle(TextInputStyle.Short)
                        .setValue(cfg.buttonText || botConfig.verification.defaultButtonText)
                        .setMaxLength(80)
                        .setMinLength(1)
                        .setRequired(true),
                ),
            );

        await selectInteraction.showModal(modal);

        const submitted = await selectInteraction
            .awaitModalSubmit({
                filter: i =>
                    i.customId === 'verif_cfg_button_text' && i.user.id === selectInteraction.user.id,
                time: 120_000,
            })
            .catch(() => null);

        if (!submitted) return;

        cfg.buttonText = submitted.fields.getTextInputValue('button_text_input').trim();

        const latestConfig = await getGuildConfig(client, guildId);
        latestConfig.verification = cfg;
        await setGuildConfig(client, guildId, latestConfig);

        await updateLivePanel(rootInteraction.guild, cfg);

        await submitted.reply({
            embeds: [successEmbed('✅ Texte du bouton mis à jour', `Le bouton de vérification affiche désormais **${cfg.buttonText}**.`)],
            flags: MessageFlags.Ephemeral,
        });

        await refreshDashboard(rootInteraction, cfg, guildId, client);
    } catch (error) {
        logger.error('Error in handleButtonText:', error);
        // Silently fail - modal display failed, user can try again
    }
}
