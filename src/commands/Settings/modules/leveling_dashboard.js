import { getColor } from '../../../config/bot.js';
import {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ChannelSelectMenuBuilder,
    ChannelType,
    ComponentType,
    EmbedBuilder,
    MessageFlags,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
} from 'discord.js';
import { InteractionHelper } from '../../../utils/interactionHelper.js';
import { successEmbed, warningEmbed } from '../../../utils/embeds.js';
import { logger } from '../../../utils/logger.js';
import { TitanBotError } from '../../../utils/errorHandler.js';
import { getLevelingConfig, saveLevelingConfig } from '../../../services/leveling.js';

const DASHBOARD_TIME = 300_000;
const FLOW_TIME = 300_000;

function resolveXpRange(cfg) {
    const range = cfg?.xpRange || cfg?.xpPerMessage;
    return {
        min: Number(range?.min) || 15,
        max: Number(range?.max) || 25,
    };
}

function buildDashboardEmbed(cfg, guild) {
    const xpRange = resolveXpRange(cfg);
    const roleRewards = cfg.roleRewards && Object.keys(cfg.roleRewards).length > 0
        ? Object.entries(cfg.roleRewards)
            .map(([level, roleId]) => `Niveau ${level} → <@&${roleId}>`)
            .join('\n')
        : '`Aucun`';

    return new EmbedBuilder()
        .setTitle('📈 Tableau de bord du Leveling / XP')
        .setDescription(
            `Gère le système d'XP et de niveaux pour **${guild.name}**.\nUtilise les boutons ci-dessous pour configurer chaque paramètre.`,
        )
        .setColor(getColor('info'))
        .addFields(
            { name: '⚙️ Statut', value: cfg.enabled ? '✅ Activé' : '❌ Désactivé', inline: true },
            { name: '💎 XP par message', value: `${xpRange.min} - ${xpRange.max}`, inline: true },
            { name: '⏱️ Délai', value: `${cfg.xpCooldown ?? 20} s`, inline: true },
            { name: '📢 Annonces', value: cfg.announceLevelUp ? '✅ Activées' : '❌ Désactivées', inline: true },
            {
                name: '📨 Canal de notification',
                value: cfg.levelUpChannel ? `<#${cfg.levelUpChannel}>` : '`Non configuré (canal système)`',
                inline: true,
            },
            { name: '🎯 Multiplicateur', value: `${cfg.xpMultiplier ?? 1}x`, inline: true },
            { name: '🎁 Récompenses de rôle', value: roleRewards, inline: false },
        )
        .setFooter({ text: 'Le tableau de bord se ferme après 5 minutes d\'inactivité' })
        .setTimestamp();
}

function buildButtonRows() {
    const configRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('lvl_cfg_enable')
            .setLabel('Activer / Désactiver')
            .setEmoji('⚙️')
            .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
            .setCustomId('lvl_cfg_channel')
            .setLabel('Canal de notif.')
            .setEmoji('📨')
            .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId('lvl_cfg_xp')
            .setLabel('Plage XP')
            .setEmoji('💎')
            .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId('lvl_cfg_cooldown')
            .setLabel('Délai')
            .setEmoji('⏱️')
            .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId('lvl_cfg_announce')
            .setLabel('Annonces')
            .setEmoji('📢')
            .setStyle(ButtonStyle.Secondary),
    );

    const backRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('lvl_cfg_back')
            .setLabel('Retour au panel')
            .setEmoji('↩️')
            .setStyle(ButtonStyle.Danger),
    );

    return [configRow, backRow];
}

async function sendNotice(interaction, text) {
    try {
        if (interaction.replied || interaction.deferred) {
            await interaction.followUp({
                content: `<@${interaction.user.id}> ${text}`,
                flags: MessageFlags.Ephemeral,
            });
        } else {
            await interaction.reply({
                content: text,
                flags: MessageFlags.Ephemeral,
            });
        }
    } catch (error) {
        logger.debug('Leveling notice failed:', error.message);
    }
}

async function refreshDashboard(rootInteraction, client, guildId) {
    try {
        const cfg = await getLevelingConfig(client, guildId);
        await InteractionHelper.safeEditReply(rootInteraction, {
            embeds: [buildDashboardEmbed(cfg, rootInteraction.guild)],
            components: buildButtonRows(),
        });
    } catch (error) {
        logger.debug('Leveling dashboard refresh failed:', error.message);
    }
}

export default {
    async execute(interaction, config, client, onBack) {
        await InteractionHelper.safeDeferOrUpdate(interaction, {});

        try {
            const guildId = interaction.guild.id;
            const cfg = await getLevelingConfig(client, guildId);

            await InteractionHelper.safeEditReply(interaction, {
                embeds: [buildDashboardEmbed(cfg, interaction.guild)],
                components: buildButtonRows(),
            });

            InteractionHelper.armDashboardSession(interaction);

            const collector = interaction.channel.createMessageComponentCollector({
                componentType: ComponentType.Button,
                filter: i =>
                    i.user.id === interaction.user.id &&
                    [
                        'lvl_cfg_enable',
                        'lvl_cfg_channel',
                        'lvl_cfg_xp',
                        'lvl_cfg_cooldown',
                        'lvl_cfg_announce',
                        'lvl_cfg_back',
                    ].includes(i.customId),
                time: DASHBOARD_TIME,
            });

            collector.on('collect', async btnInteraction => {
                InteractionHelper.armDashboardSession(interaction);

                try {
                    switch (btnInteraction.customId) {
                        case 'lvl_cfg_enable':
                            await handleEnable(btnInteraction, client, guildId);
                            break;
                        case 'lvl_cfg_channel':
                            await handleChannel(btnInteraction, interaction, client, guildId);
                            return;
                        case 'lvl_cfg_xp':
                            await handleXp(btnInteraction, interaction, client, guildId);
                            return;
                        case 'lvl_cfg_cooldown':
                            await handleCooldown(btnInteraction, interaction, client, guildId);
                            return;
                        case 'lvl_cfg_announce':
                            await handleAnnounce(btnInteraction, client, guildId);
                            break;
                        case 'lvl_cfg_back':
                            await btnInteraction.deferUpdate().catch(() => {});
                            if (typeof onBack === 'function') {
                                await onBack(btnInteraction);
                            }
                            return;
                    }

                    await refreshDashboard(interaction, client, guildId);
                } catch (error) {
                    if (error instanceof TitanBotError) {
                        logger.debug(`Leveling config validation error: ${error.message}`);
                    } else {
                        logger.error('Unexpected leveling dashboard error:', error);
                    }

                    const message = error instanceof TitanBotError
                        ? (error.userMessage || 'Une erreur est survenue lors de la configuration.')
                        : `Une erreur inattendue est survenue (${error.message}).`;

                    await sendNotice(btnInteraction, message);
                }
            });
        } catch (error) {
            logger.error('Leveling dashboard failed to open:', error);
            await sendNotice(
                interaction,
                `Impossible d'ouvrir le tableau de bord du leveling (${error.message}).`,
            );
        }
    },
};

async function handleEnable(btnInteraction, client, guildId) {
    await btnInteraction.deferUpdate();
    const cfg = await getLevelingConfig(client, guildId);
    const nextState = !cfg.enabled;
    cfg.enabled = nextState;

    try {
        await saveLevelingConfig(client, guildId, cfg);
    } catch (error) {
        cfg.enabled = !nextState;
        await sendNotice(btnInteraction, error?.userMessage || 'Impossible d\'enregistrer le changement.');
        return;
    }

    await btnInteraction.followUp({
        embeds: [successEmbed(`Le système de leveling est désormais **${cfg.enabled ? 'activé' : 'désactivé'}**.`, '📈 Leveling')],
        flags: MessageFlags.Ephemeral,
    });
}

async function handleAnnounce(btnInteraction, client, guildId) {
    await btnInteraction.deferUpdate();
    const cfg = await getLevelingConfig(client, guildId);
    cfg.announceLevelUp = !cfg.announceLevelUp;
    await saveLevelingConfig(client, guildId, cfg);

    await btnInteraction.followUp({
        embeds: [successEmbed(`Les annonces de montée de niveau sont **${cfg.announceLevelUp ? 'activées' : 'désactivées'}**.`, '📢 Annonces')],
        flags: MessageFlags.Ephemeral,
    });
}

async function handleChannel(btnInteraction, rootInteraction, client, guildId) {
    await btnInteraction.deferUpdate().catch(() => {});

    const channelSelect = new ChannelSelectMenuBuilder()
        .setCustomId('lvl_flow_channel_select')
        .setPlaceholder('Sélectionne un salon texte...')
        .addChannelTypes(ChannelType.GuildText)
        .setMaxValues(1);

    await btnInteraction.followUp({
        embeds: [
            new EmbedBuilder()
                .setTitle('📨 Canal de notification')
                .setDescription('Sélectionne le salon où seront envoyées les notifications de montée de niveau.')
                .setColor(getColor('info')),
        ],
        components: [new ActionRowBuilder().addComponents(channelSelect)],
        flags: MessageFlags.Ephemeral,
    });

    const chanCollector = rootInteraction.channel.createMessageComponentCollector({
        componentType: ComponentType.ChannelSelect,
        filter: i => i.user.id === btnInteraction.user.id && i.customId === 'lvl_flow_channel_select',
        time: FLOW_TIME,
        max: 1,
    });

    chanCollector.on('collect', async chanInteraction => {
        chanCollector.stop('collected');
        const channel = chanInteraction.channels.first();
        if (!channel) {
            await sendNotice(chanInteraction, 'Aucun salon sélectionné. Le paramètre n\'a pas été modifié.');
            return;
        }

        const cfg = await getLevelingConfig(client, guildId);
        cfg.levelUpChannel = channel.id;
        await saveLevelingConfig(client, guildId, cfg);

        await sendNotice(
            chanInteraction,
            `Les notifications de montée de niveau seront envoyées dans <#${channel.id}>.`,
        );

        await refreshDashboard(rootInteraction, client, guildId);
    });

    chanCollector.on('end', (collected, reason) => {
        if (reason === 'time' && collected.size === 0) {
            sendNotice(btnInteraction, 'Aucun salon sélectionné. Le paramètre n\'a pas été modifié.')
                .catch(() => {});
        }
    });
}

async function handleXp(btnInteraction, rootInteraction, client, guildId) {
    const xpRange = resolveXpRange(await getLevelingConfig(client, guildId));

    const modal = new ModalBuilder()
        .setCustomId('lvl_cfg_xp_modal')
        .setTitle('Plage d\'XP par message')
        .addComponents(
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('min_input')
                    .setLabel('XP minimum')
                    .setStyle(TextInputStyle.Short)
                    .setValue(String(xpRange.min))
                    .setMaxLength(3)
                    .setMinLength(1)
                    .setRequired(true),
            ),
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('max_input')
                    .setLabel('XP maximum')
                    .setStyle(TextInputStyle.Short)
                    .setValue(String(xpRange.max))
                    .setMaxLength(3)
                    .setMinLength(1)
                    .setRequired(true),
            ),
        );

    const shown = await btnInteraction.showModal(modal).then(() => true).catch(() => false);
    if (!shown) {
        await sendNotice(btnInteraction, 'Impossible d\'ouvrir la fenêtre de saisie. Réessaie.');
        return;
    }

    const submitted = await btnInteraction
        .awaitModalSubmit({
            filter: i => i.customId === 'lvl_cfg_xp_modal' && i.user.id === btnInteraction.user.id,
            time: 120_000,
        })
        .catch(() => null);

    if (!submitted) return;

    const min = parseInt(submitted.fields.getTextInputValue('min_input'), 10);
    const max = parseInt(submitted.fields.getTextInputValue('max_input'), 10);

    if (Number.isNaN(min) || Number.isNaN(max) || min < 1 || max < 1 || min > max) {
        await submitted.reply({
            embeds: [warningEmbed('L\'XP minimum doit être inférieur ou égal au maximum, et les deux doivent être ≥ 1.', '⚠️ Plage invalide')],
            flags: MessageFlags.Ephemeral,
        });
        return;
    }

    const cfg = await getLevelingConfig(client, guildId);
    cfg.xpRange = { min, max };
    await saveLevelingConfig(client, guildId, cfg);

    await submitted.reply({
        embeds: [successEmbed(`Chaque message accorde désormais entre **${min}** et **${max}** XP.`, '💎 Plage d\'XP')],
        flags: MessageFlags.Ephemeral,
    });

    await refreshDashboard(rootInteraction, client, guildId);
}

async function handleCooldown(btnInteraction, rootInteraction, client, guildId) {
    const cfg = await getLevelingConfig(client, guildId);

    const modal = new ModalBuilder()
        .setCustomId('lvl_cfg_cooldown_modal')
        .setTitle('Délai entre deux gains d\'XP')
        .addComponents(
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('seconds_input')
                    .setLabel('Délai (secondes, 0-3600)')
                    .setStyle(TextInputStyle.Short)
                    .setValue(String(cfg.xpCooldown ?? 20))
                    .setMaxLength(4)
                    .setMinLength(1)
                    .setRequired(true),
            ),
        );

    const shown = await btnInteraction.showModal(modal).then(() => true).catch(() => false);
    if (!shown) {
        await sendNotice(btnInteraction, 'Impossible d\'ouvrir la fenêtre de saisie. Réessaie.');
        return;
    }

    const submitted = await btnInteraction
        .awaitModalSubmit({
            filter: i => i.customId === 'lvl_cfg_cooldown_modal' && i.user.id === btnInteraction.user.id,
            time: 120_000,
        })
        .catch(() => null);

    if (!submitted) return;

    const seconds = parseInt(submitted.fields.getTextInputValue('seconds_input'), 10);
    if (Number.isNaN(seconds) || seconds < 0 || seconds > 3600) {
        await submitted.reply({
            embeds: [warningEmbed('Le délai doit être compris entre 0 et 3600 secondes.', '⚠️ Délai invalide')],
            flags: MessageFlags.Ephemeral,
        });
        return;
    }

    const latest = await getLevelingConfig(client, guildId);
    latest.xpCooldown = seconds;
    await saveLevelingConfig(client, guildId, latest);

    await submitted.reply({
        embeds: [successEmbed(`Un utilisateur peut gagner de l'XP toutes les **${seconds}** seconde(s).`, '⏱️ Délai')],
        flags: MessageFlags.Ephemeral,
    });

    await refreshDashboard(rootInteraction, client, guildId);
}
