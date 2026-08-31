import { botConfig, getColor } from '../../../config/bot.js';
import {
    ActionRowBuilder,
    StringSelectMenuBuilder,
    StringSelectMenuOptionBuilder,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    RoleSelectMenuBuilder,
    ButtonBuilder,
    ButtonStyle,
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
import { validateAutoVerifyCriteria } from '../../../services/verificationService.js';
import { botHasPermission } from '../../../utils/permissionGuard.js';

const autoVerifyDefaults = botConfig.verification?.autoVerify || {};
const minAccountAgeDays = autoVerifyDefaults.minAccountAge ?? 1;
const maxAccountAgeDays = autoVerifyDefaults.maxAccountAge ?? 365;
const defaultAccountAgeDays = autoVerifyDefaults.defaultAccountAgeDays ?? 7;

// ─── Embed & Menu Builders ────────────────────────────────────────────────────

function buildDashboardEmbed(cfg, guild, conflictSummary = '') {
    const autoVerify = cfg.verification?.autoVerify;
    const autoVerifyRole = autoVerify?.roleId ? guild.roles.cache.get(autoVerify.roleId) : null;
    
    let criteriaDescription = "`Non configuré`";
    if (autoVerify?.criteria) {
        switch (autoVerify.criteria) {
            case "account_age":
                criteriaDescription = `\`Âge du compte\` - \`${autoVerify.accountAgeDays} jours\``;
                break;
            case "none":
                criteriaDescription = `\`Aucun critère\``;
                break;
        }
    }

    const embed = new EmbedBuilder()
        .setTitle('🤖 Tableau de bord de vérification automatique')
        .setDescription(`Gère les paramètres de vérification automatique pour **${guild.name}**.\nSélectionne une option ci-dessous pour modifier un paramètre.`)
        .setColor(getColor('info'))
        .addFields(
            { name: '⚙️ Statut du système', value: autoVerify?.enabled ? '✅ Activé' : '❌ Désactivé', inline: true },
            { name: '🏷️ Rôle cible', value: autoVerifyRole ? autoVerifyRole.toString() : '`Non défini`', inline: true },
            { name: '🎯 Critères', value: criteriaDescription, inline: true },
            { name: '📅 Âge du compte', value: autoVerify?.accountAgeDays ? `\`${autoVerify.accountAgeDays}\` jours` : '`N/A`', inline: true },
            { name: '\u200B', value: '\u200B', inline: true },
            { name: '\u200B', value: '\u200B', inline: true },
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
        .setCustomId(`autoverify_cfg_${guildId}`)
        .setPlaceholder('Sélectionne un paramètre à configurer...')
        .addOptions(
            new StringSelectMenuOptionBuilder()
                .setLabel('Changer le rôle')
                .setDescription('Sélectionner le rôle à attribuer automatiquement')
                .setValue('role')
                .setEmoji('🏷️'),
            new StringSelectMenuOptionBuilder()
                .setLabel('Modifier l\'âge minimum du compte')
                .setDescription('Définir l\'âge minimum du compte en jours')
                .setValue('account_age')
                .setEmoji('📅'),
        );
}

function buildButtonRow(cfg, guildId, disabled = false) {
    const autoVerifyOn = cfg.verification?.autoVerify?.enabled === true;
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`autoverify_cfg_criteria_${guildId}`)
            .setLabel('Changer les critères')
            .setStyle(ButtonStyle.Primary)
            .setEmoji('🎯')
            .setDisabled(disabled),
        new ButtonBuilder()
            .setCustomId(`autoverify_cfg_toggle_${guildId}`)
            .setLabel('Vérification automatique')
            .setStyle(autoVerifyOn ? ButtonStyle.Success : ButtonStyle.Danger)
            .setEmoji('🤖')
            .setDisabled(disabled),
    );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function refreshDashboard(rootInteraction, cfg, guildId, client) {
    try {
        const selectMenu = buildSelectMenu(guildId);
        
        // Get conflict summary
        let conflictSummary = '';
        try {
            const welcomeConfig = await getWelcomeConfig(client, guildId);
            const verificationEnabled = Boolean(cfg.verification?.enabled);
            const autoRoleConfigured = Boolean(cfg.autoRole) || (Array.isArray(welcomeConfig.roleIds) && welcomeConfig.roleIds.length > 0);
            
            const conflicts = [
                verificationEnabled ? 'Le système de vérification est activé' : null,
                autoRoleConfigured ? 'AutoRole est configuré' : null
            ].filter(Boolean);
            
            if (conflicts.length > 0) {
                conflictSummary = conflicts.join('\n');
            }
        } catch (error) {
            logger.warn('Could not fetch autoverify dashboard conflicts:', error.message);
        }
        
        await InteractionHelper.safeEditReply(rootInteraction, {
            embeds: [buildDashboardEmbed(cfg, rootInteraction.guild, conflictSummary)],
            components: [
                buildButtonRow(cfg, guildId),
                new ActionRowBuilder().addComponents(selectMenu),
            ],
            flags: MessageFlags.Ephemeral,
        });
    } catch (error) {
        logger.debug('Could not refresh autoverify dashboard (interaction may have expired):', error.message);
    }
}

// ─── Main Export ──────────────────────────────────────────────────────────────

export default {
    async execute(interaction, config, client) {
        try {
            const guildId = interaction.guild.id;
            const guildConfig = await getGuildConfig(client, guildId);

            // Check if auto-verification is configured
            if (!guildConfig.verification?.autoVerify?.enabled) {
                // Check for blocking systems
                const welcomeConfig = await getWelcomeConfig(client, guildId);
                const verificationEnabled = Boolean(guildConfig.verification?.enabled);
                const autoRoleConfigured = Boolean(guildConfig.autoRole) || (Array.isArray(welcomeConfig.roleIds) && welcomeConfig.roleIds.length > 0);
                
                const blockingMessage = [];
                if (verificationEnabled) blockingMessage.push('Le système de vérification est activé');
                if (autoRoleConfigured) blockingMessage.push('AutoRole est configuré');

                const blockingText = blockingMessage.length > 0 
                    ? `\n\n⚠️ **Pour activer AutoVerify, tu dois d\'abord désactiver :**\n${blockingMessage.map(msg => `• ${msg}`).join('\n')}`
                    : '';

                return await InteractionHelper.safeReply(interaction, {
                    embeds: [
                        new EmbedBuilder()
                            .setTitle('🤖 Tableau de bord de vérification automatique')
                            .setDescription(`La vérification automatique n\'est pas encore configurée.${blockingText}\n\nUtilise \`/autoverify setup\` pour la configurer.`)
                            .setColor(getColor('warning'))
                            .setFooter({ text: 'Le tableau de bord se ferme après 10 minutes d\'inactivité' })
                            .setTimestamp()
                    ],
                    flags: MessageFlags.Ephemeral
                });
            }

            await InteractionHelper.safeDefer(interaction, { ephemeral: true });

            const selectMenu = buildSelectMenu(guildId);
            
            // Get conflict summary
            let conflictSummary = '';
            try {
                const welcomeConfig = await getWelcomeConfig(client, guildId);
                const verificationEnabled = Boolean(guildConfig.verification?.enabled);
                const autoRoleConfigured = Boolean(guildConfig.autoRole) || (Array.isArray(welcomeConfig.roleIds) && welcomeConfig.roleIds.length > 0);
                
                const conflicts = [
                    verificationEnabled ? 'Verification system is enabled' : null,
                    autoRoleConfigured ? 'AutoRole is configured' : null
                ].filter(Boolean);
                
                if (conflicts.length > 0) {
                    conflictSummary = conflicts.join('\n');
                }
            } catch (error) {
                logger.warn('Could not fetch autoverify dashboard conflicts:', error.message);
            }

            await InteractionHelper.safeEditReply(interaction, {
                embeds: [buildDashboardEmbed(guildConfig, interaction.guild, conflictSummary)],
                components: [
                    buildButtonRow(guildConfig, guildId),
                    new ActionRowBuilder().addComponents(selectMenu),
                ],
                flags: MessageFlags.Ephemeral,
            });

            // ── Select collector ──────────────────────────────────────────────
            const collector = interaction.channel.createMessageComponentCollector({
                componentType: ComponentType.StringSelect,
                filter: i =>
                    i.user.id === interaction.user.id && i.customId === `autoverify_cfg_${guildId}`,
                time: 600_000,
            });

            collector.on('collect', async selectInteraction => {
                const selectedOption = selectInteraction.values[0];
                try {
                    switch (selectedOption) {
                        case 'role':
                            await handleRole(selectInteraction, interaction, guildConfig, guildId, client);
                            break;
                        case 'account_age':
                            await handleAccountAge(selectInteraction, interaction, guildConfig, guildId, client);
                            break;
                    }
                } catch (error) {
                    if (error instanceof TitanBotError) {
                        logger.debug(`Autoverify config validation error: ${error.message}`);
                    } else {
                        logger.error('Unexpected autoverify dashboard error:', error);
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

            // ── Button collector for buttons ─────────────────────────────────────
            const btnCollector = interaction.channel.createMessageComponentCollector({
                componentType: ComponentType.Button,
                filter: i =>
                    i.user.id === interaction.user.id && 
                    (i.customId === `autoverify_cfg_toggle_${guildId}` || i.customId === `autoverify_cfg_criteria_${guildId}`),
                time: 600_000,
            });

            btnCollector.on('collect', async btnInteraction => {
                try {
                    if (btnInteraction.customId === `autoverify_cfg_criteria_${guildId}`) {
                        await handleCriteria(btnInteraction, interaction, guildConfig, guildId, client);
                    } else if (btnInteraction.customId === `autoverify_cfg_toggle_${guildId}`) {
                        await btnInteraction.deferUpdate().catch(() => null);
                        guildConfig.verification.autoVerify.enabled = !guildConfig.verification.autoVerify.enabled;
                        await setGuildConfig(client, guildId, guildConfig);
                        
                        await btnInteraction.followUp({
                            embeds: [
                                successEmbed(
                                    '✅ Statut mis à jour',
                                    `La vérification automatique est désormais **${guildConfig.verification.autoVerify.enabled ? 'activée' : 'désactivée'}**.`,
                                ),
                            ],
                            flags: MessageFlags.Ephemeral,
                        });

                        await refreshDashboard(interaction, guildConfig, guildId, client);
                    }
                } catch (err) {
                    logger.debug('Button interaction error:', err.message);
                }
            });

            collector.on('end', async (collected, reason) => {
                if (reason === 'time') {
                    btnCollector.stop();
                    try {
                        const timeoutEmbed = new EmbedBuilder()
                            .setTitle('⏰ Tableau de bord expiré')
                            .setDescription('Ce tableau de bord a été fermé en raison d\'une inactivité. Relance la commande pour continuer.')
                            .setColor(getColor('error'));
                        await InteractionHelper.safeEditReply(interaction, {
                            embeds: [timeoutEmbed],
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
            logger.error('Unexpected error in autoverify_dashboard:', error);
            throw new TitanBotError(
                `Auto-verification dashboard failed: ${error.message}`,
                ErrorTypes.UNKNOWN,
                'Impossible d\'ouvrir le tableau de bord de vérification automatique.',
            );
        }
    },
};

// ─── Handle Criteria ──────────────────────────────────────────────────────────

async function handleCriteria(selectInteraction, rootInteraction, guildConfig, guildId, client) {
    // Defer the interaction if it's a button, otherwise it was already deferred by select menu
    if (!selectInteraction.deferred) {
        await selectInteraction.deferUpdate().catch(() => null);
    }
    
    const criteriaEmbed = new EmbedBuilder()
        .setTitle('🎯 Sélectionner les critères de vérification')
        .setDescription('Choisis les critères de la vérification automatique')
        .setColor(getColor('info'));

    const criteriaMenu = new StringSelectMenuBuilder()
        .setCustomId('autoverify_criteria_select')
        .setPlaceholder('Sélectionne les critères...')
        .addOptions(
            new StringSelectMenuOptionBuilder()
                .setLabel(`Âge du compte (plus de ${defaultAccountAgeDays} jours)`)
                .setDescription('Les utilisateurs aux comptes plus anciens seront auto-vérifiés')
                .setValue('account_age'),
            new StringSelectMenuOptionBuilder()
                .setLabel('Aucun critère (vérifier tout le monde)')
                .setDescription('Tous les utilisateurs reçoivent le rôle immédiatement')
                .setValue('none'),
        );

    await selectInteraction.followUp({
        embeds: [criteriaEmbed],
        components: [new ActionRowBuilder().addComponents(criteriaMenu)],
        flags: MessageFlags.Ephemeral,
    });

    const criteriaCollector = rootInteraction.channel.createMessageComponentCollector({
        componentType: ComponentType.StringSelect,
        filter: i =>
            i.user.id === selectInteraction.user.id && i.customId === 'autoverify_criteria_select',
        time: 60_000,
        max: 1,
    });

    criteriaCollector.on('collect', async criteriaInteraction => {
        await criteriaInteraction.deferUpdate();
        const newCriteria = criteriaInteraction.values[0];

        guildConfig.verification.autoVerify.criteria = newCriteria;
        
        // Reset age-related fields if not using them
        if (newCriteria !== 'account_age') {
            guildConfig.verification.autoVerify.accountAgeDays = null;
        } else if (!guildConfig.verification.autoVerify.accountAgeDays) {
            guildConfig.verification.autoVerify.accountAgeDays = defaultAccountAgeDays;
        }

        await setGuildConfig(client, guildId, guildConfig);

        let criteriaDisplay = '';
        switch (newCriteria) {
            case 'account_age':
                criteriaDisplay = `Âge du compte (${guildConfig.verification.autoVerify.accountAgeDays} jours)`;
                break;
            case 'none':
                criteriaDisplay = 'Aucun critère';
                break;
        }

        await criteriaInteraction.followUp({
            embeds: [successEmbed('✅ Critères mis à jour', `Les critères de vérification automatique sont passés à **${criteriaDisplay}**.`)],
            flags: MessageFlags.Ephemeral,
        });

        await refreshDashboard(rootInteraction, guildConfig, guildId, client);
    });

    criteriaCollector.on('end', (collected, reason) => {
        if (reason === 'time' && collected.size === 0) {
            InteractionHelper.sendErrorNotice(selectInteraction, 'Aucun critère sélectionné. Le paramètre n\'a pas été modifié.');
        }
    });
}

// ─── Handle Role ──────────────────────────────────────────────────────────────

async function handleRole(selectInteraction, rootInteraction, guildConfig, guildId, client) {
    await selectInteraction.deferUpdate();

    const roleSelect = new RoleSelectMenuBuilder()
        .setCustomId('autoverify_role_select')
        .setPlaceholder('Sélectionne un rôle...')
        .setMaxValues(1);

    await selectInteraction.followUp({
        embeds: [
            new EmbedBuilder()
                .setTitle('🏷️ Rôle de vérification automatique')
                .setDescription('Sélectionne le rôle à attribuer aux utilisateurs auto-vérifiés.')
                .setColor(getColor('info')),
        ],
        components: [new ActionRowBuilder().addComponents(roleSelect)],
        flags: MessageFlags.Ephemeral,
    });

    const roleCollector = rootInteraction.channel.createMessageComponentCollector({
        componentType: ComponentType.RoleSelect,
        filter: i =>
            i.user.id === selectInteraction.user.id && i.customId === 'autoverify_role_select',
        time: 60_000,
        max: 1,
    });

    roleCollector.on('collect', async roleInteraction => {
        await roleInteraction.deferUpdate();
        const role = roleInteraction.roles.first();

        if (role.id === rootInteraction.guild.id || role.managed) {
            await InteractionHelper.sendErrorNotice(roleInteraction, 'Veuillez choisir un rôle attribuable normal (pas @everyone ni un rôle géré par un bot).');
            return;
        }

        const botMember = rootInteraction.guild.members.me;
        if (role.position >= botMember.roles.highest.position) {
            await InteractionHelper.sendErrorNotice(roleInteraction, 'Le rôle sélectionné doit se situer en dessous de mon rôle le plus haut dans la hiérarchie des rôles du serveur.');
            return;
        }

        guildConfig.verification.autoVerify.roleId = role.id;
        await setGuildConfig(client, guildId, guildConfig);

        await roleInteraction.followUp({
            embeds: [successEmbed('✅ Rôle mis à jour', `Rôle de vérification automatique défini sur ${role}.`)],
            flags: MessageFlags.Ephemeral,
        });

        await refreshDashboard(rootInteraction, guildConfig, guildId, client);
    });

    roleCollector.on('end', (collected, reason) => {
        if (reason === 'time' && collected.size === 0) {
            InteractionHelper.sendErrorNotice(selectInteraction, 'Aucun rôle n\'a été sélectionné. Le paramètre n\'a pas été modifié.');
        }
    });
}

// ─── Handle Account Age ────────────────────────────────────────────────────────

async function handleAccountAge(selectInteraction, rootInteraction, guildConfig, guildId, client) {
    const modal = new ModalBuilder()
        .setCustomId('autoverify_account_age_modal')
        .setTitle('Définir l\'exigence d\'âge du compte')
        .addComponents(
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('age_input')
                    .setLabel('Âge minimum du compte (jours)')
                    .setStyle(TextInputStyle.Short)
                    .setPlaceholder(`Entre ${minAccountAgeDays} et ${maxAccountAgeDays}`)
                    .setValue((guildConfig.verification.autoVerify.accountAgeDays || defaultAccountAgeDays).toString())
                    .setRequired(true),
            ),
        );

    await selectInteraction.showModal(modal);

    const submitted = await selectInteraction
        .awaitModalSubmit({
            filter: i =>
                i.customId === 'autoverify_account_age_modal' && i.user.id === selectInteraction.user.id,
            time: 120_000,
        })
        .catch(() => null);

    if (!submitted) return;

    const inputValue = submitted.fields.getTextInputValue('age_input').trim();
    const days = parseInt(inputValue, 10);

    if (isNaN(days) || days < minAccountAgeDays || days > maxAccountAgeDays) {
        await InteractionHelper.sendErrorNotice(submitted, `Veuillez saisir un nombre entre ${minAccountAgeDays} et ${maxAccountAgeDays}.`);
        return;
    }

    guildConfig.verification.autoVerify.accountAgeDays = days;
    await setGuildConfig(client, guildId, guildConfig);

    await submitted.reply({
        embeds: [successEmbed('✅ Âge du compte mis à jour', `Exigence d\'âge minimum du compte définie sur **${days} jours**.`)],
        flags: MessageFlags.Ephemeral,
    });

    await refreshDashboard(rootInteraction, guildConfig, guildId, client);
}

// ─── Handle Member Duration ────────────────────────────────────────────────────


