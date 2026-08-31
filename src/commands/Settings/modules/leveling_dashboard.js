import { getColor } from '../../../config/bot.js';
import {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    ChannelSelectMenuBuilder,
    ChannelType,
    MessageFlags,
    ComponentType,
    EmbedBuilder,
} from 'discord.js';
import { InteractionHelper } from '../../../utils/interactionHelper.js';
import { successEmbed, warningEmbed } from '../../../utils/embeds.js';
import { logger } from '../../../utils/logger.js';
import { TitanBotError, ErrorTypes } from '../../../utils/errorHandler.js';
import { getLevelingConfig, saveLevelingConfig } from '../../../services/leveling.js';

function buildDashboardEmbed(cfg, guild) {
    const levelUpChannel = cfg.levelUpChannel
        ? `<#${cfg.levelUpChannel}>`
        : '`Non configurÃ© (canal systÃ¨me)`';
    const xpRange = cfg.xpRange || cfg.xpPerMessage || { min: 15, max: 25 };
    const roleRewards = cfg.roleRewards && Object.keys(cfg.roleRewards).length > 0
        ? Object.entries(cfg.roleRewards).map(([level, roleId]) => `Niveau ${level} â†’ <@&${roleId}>`).join('\n')
        : '`Aucune`';

    return new EmbedBuilder()
        .setTitle('ðŸ“ˆ Tableau de bord du Leveling / XP')
        .setDescription(
            `GÃ¨re le systÃ¨me d'XP et de niveaux pour **${guild.name}**.\nUtilise les boutons ci-dessous pour configurer chaque paramÃ¨tre.`,
        )
        .setColor(getColor('info'))
        .addFields(
            { name: 'âš™ï¸ Statut', value: cfg.enabled ? 'âœ… ActivÃ©' : 'âŒ DÃ©sactivÃ©', inline: true },
            { name: 'â­ XP par message', value: `${xpRange.min} - ${xpRange.max}`, inline: true },
            { name: 'â±ï¸ DÃ©lai', value: `${cfg.xpCooldown ?? 20} s`, inline: true },
            { name: 'ðŸ”” Annonces', value: cfg.announceLevelUp ? 'âœ… ActivÃ©es' : 'âŒ DÃ©sactivÃ©es', inline: true },
            { name: 'ðŸŒ€ Canal de notification', value: levelUpChannel, inline: true },
            { name: 'ðŸš€ Multiplicateur', value: `${cfg.xpMultiplier ?? 1}x`, inline: true },
            { name: 'ðŸŽ­ RÃ©compenses de rÃ´le', value: roleRewards, inline: false },
        )
        .setFooter({ text: 'Le tableau de bord se ferme aprÃ¨s 10 minutes d\'inactivitÃ©' })
        .setTimestamp();
}

function buildButtonRows() {
    const configRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('lvl_cfg_enable')
            .setLabel('Activer / DÃ©sactiver')
            .setEmoji('âš™ï¸')
            .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
            .setCustomId('lvl_cfg_channel')
            .setLabel('Canal de notif.')
            .setEmoji('ðŸŒ€')
            .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId('lvl_cfg_xp')
            .setLabel('Plage XP')
            .setEmoji('â­')
            .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId('lvl_cfg_cooldown')
            .setLabel('DÃ©lai')
            .setEmoji('â±ï¸')
            .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId('lvl_cfg_announce')
            .setLabel('Annonces')
            .setEmoji('ðŸ””')
            .setStyle(ButtonStyle.Secondary),
    );
    const backRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('lvl_cfg_back')
            .setLabel('Retour au panel')
            .setEmoji('â¬…ï¸')
            .setStyle(ButtonStyle.Danger),
    );
    return [configRow, backRow];
}

export default {
    async execute(interaction, config, client, onBack) {
        try {
            const guildId = interaction.guild.id;
            const cfg = await getLevelingConfig(client, guildId);

            await InteractionHelper.safeDefer(interaction, { flags: MessageFlags.Ephemeral });

            await InteractionHelper.safeEditReply(interaction, {
                embeds: [buildDashboardEmbed(cfg, interaction.guild)],
                components: buildButtonRows(),
                flags: MessageFlags.Ephemeral,
            });

            const collector = interaction.channel.createMessageComponentCollector({
                componentType: ComponentType.Button,
                filter: i =>
                    i.user.id === interaction.user.id &&
                    ['lvl_cfg_enable', 'lvl_cfg_channel', 'lvl_cfg_xp', 'lvl_cfg_cooldown', 'lvl_cfg_announce', 'lvl_cfg_back'].includes(i.customId),
                time: 600_000,
            });

            collector.on('collect', async btnInteraction => {
                const id = btnInteraction.customId;
                try {
                    switch (id) {
                        case 'lvl_cfg_enable':
                            await handleEnable(btnInteraction, interaction, client, guildId);
                            break;
                        case 'lvl_cfg_channel':
                            await handleChannel(btnInteraction, interaction, client, guildId);
                            break;
                        case 'lvl_cfg_xp':
                            await handleXp(btnInteraction, interaction, client, guildId);
                            break;
                        case 'lvl_cfg_cooldown':
                            await handleCooldown(btnInteraction, interaction, client, guildId);
                            break;
                        case 'lvl_cfg_announce':
                            await handleAnnounce(btnInteraction, interaction, client, guildId);
                            break;
                        case 'lvl_cfg_back':
                            await btnInteraction.deferUpdate().catch(() => {});
                            if (typeof onBack === 'function') {
                                await onBack(btnInteraction);
                            }
                            break;
                    }
                } catch (error) {
                    if (error instanceof TitanBotError) {
                        logger.debug(`Leveling config validation error: ${error.message}`);
                    } else {
                        logger.error('Unexpected leveling dashboard error:', error);
                    }

                    const errorMessage =
                        error instanceof TitanBotError
                            ? error.userMessage || 'Une erreur est survenue lors du traitement de ton action.'
                            : 'Une erreur inattendue est survenue lors de la mise Ã  jour de la configuration.';

                    if (!btnInteraction.replied && !btnInteraction.deferred) {
                        await btnInteraction.deferUpdate().catch(() => {});
                    }
                    await InteractionHelper.sendErrorNotice(btnInteraction, errorMessage).catch(() => {});
                }
            });
        } catch (error) {
            logger.error('Leveling dashboard failed to open:', error);
            await InteractionHelper.sendErrorNotice(interaction, 'Impossible d\'ouvrir le tableau de bord du leveling. RÃ©essaie.').catch(() => {});
        }
    },
};

async function handleEnable(btnInteraction, rootInteraction, client, guildId) {
    await btnInteraction.deferUpdate();
    const cfg = await getLevelingConfig(client, guildId);
    cfg.enabled = !cfg.enabled;
    await saveLevelingConfig(client, guildId, cfg);

    await btnInteraction.followUp({
        embeds: [successEmbed(`Le systÃ¨me de leveling est dÃ©sormais **${cfg.enabled ? 'activÃ©' : 'dÃ©sactivÃ©'}**.`, 'ðŸ“ˆ Leveling')],
        flags: MessageFlags.Ephemeral,
    });

    const latest = await getLevelingConfig(client, guildId);
    await InteractionHelper.safeEditReply(rootInteraction, {
        embeds: [buildDashboardEmbed(latest, rootInteraction.guild)],
        components: buildButtonRows(),
        flags: MessageFlags.Ephemeral,
    });
}

async function handleChannel(btnInteraction, rootInteraction, client, guildId) {
    try {
        await btnInteraction.deferUpdate();
    } catch {
        return;
    }

    const channelSelect = new ChannelSelectMenuBuilder()
        .setCustomId('lvl_cfg_channel_select')
        .setPlaceholder('SÃ©lectionne un canal texte...')
        .addChannelTypes(ChannelType.GuildText)
        .setMaxValues(1);

    await btnInteraction.followUp({
        embeds: [
            new EmbedBuilder()
                .setTitle('ðŸŒ€ Canal de notification')
                .setDescription('SÃ©lectionne le canal oÃ¹ seront envoyÃ©es les notifications de montÃ©e de niveau.')
                .setColor(getColor('info')),
        ],
        components: [new ActionRowBuilder().addComponents(channelSelect)],
        flags: MessageFlags.Ephemeral,
    });

    const chanCollector = rootInteraction.channel.createMessageComponentCollector({
        componentType: ComponentType.ChannelSelect,
        filter: i =>
            i.user.id === btnInteraction.user.id && i.customId === 'lvl_cfg_channel_select',
        time: 60_000,
        max: 1,
    });

    chanCollector.on('collect', async chanInteraction => {
        await chanInteraction.deferUpdate();
        const channel = chanInteraction.channels.first();
        const cfg = await getLevelingConfig(client, guildId);
        cfg.levelUpChannel = channel.id;
        await saveLevelingConfig(client, guildId, cfg);

        await chanInteraction.followUp({
            embeds: [successEmbed('âœ… Canal mis Ã  jour', `Les notifications de montÃ©e de niveau seront envoyÃ©es dans ${channel}.`)],
            flags: MessageFlags.Ephemeral,
        });

        const latest = await getLevelingConfig(client, guildId);
        await InteractionHelper.safeEditReply(rootInteraction, {
            embeds: [buildDashboardEmbed(latest, rootInteraction.guild)],
            components: buildButtonRows(),
            flags: MessageFlags.Ephemeral,
        });
    });

    chanCollector.on('end', (collected, reason) => {
        if (reason === 'time' && collected.size === 0) {
            InteractionHelper.sendErrorNotice(btnInteraction, 'Aucun canal n\'a Ã©tÃ© sÃ©lectionnÃ©. Le paramÃ¨tre n\'a pas Ã©tÃ© modifiÃ©.')
                .catch(() => {});
        }
    });
}

async function handleXp(btnInteraction, rootInteraction, client, guildId) {
    const cfg = await getLevelingConfig(client, guildId);
    const xpRange = cfg.xpRange || cfg.xpPerMessage || { min: 15, max: 25 };

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

    try {
        await btnInteraction.showModal(modal);
    } catch {
        return;
    }

    const submitted = await btnInteraction
        .awaitModalSubmit({
            filter: i => i.customId === 'lvl_cfg_xp_modal' && i.user.id === btnInteraction.user.id,
            time: 120_000,
        })
        .catch(() => null);

    if (!submitted) {
        return;
    }

    const min = parseInt(submitted.fields.getTextInputValue('min_input'), 10);
    const max = parseInt(submitted.fields.getTextInputValue('max_input'), 10);

    if (Number.isNaN(min) || Number.isNaN(max) || min < 1 || max < 1 || min > max) {
        await submitted.reply({
            embeds: [warningEmbed('L\'XP minimum doit Ãªtre infÃ©rieur ou Ã©gal au maximum, et les deux doivent Ãªtre â‰¥ 1.', 'âš ï¸ Plage invalide')],
            flags: MessageFlags.Ephemeral,
        });
        return;
    }

    const cfg2 = await getLevelingConfig(client, guildId);
    cfg2.xpRange = { min, max };
    await saveLevelingConfig(client, guildId, cfg2);

    await submitted.reply({
        embeds: [successEmbed(`Chaque message accorde dÃ©sormais entre **${min}** et **${max}** XP.`, 'ðŸ“ˆ Plage d\'XP')],
        flags: MessageFlags.Ephemeral,
    });

    const latest = await getLevelingConfig(client, guildId);
    await InteractionHelper.safeEditReply(rootInteraction, {
        embeds: [buildDashboardEmbed(latest, rootInteraction.guild)],
        components: buildButtonRows(),
        flags: MessageFlags.Ephemeral,
    });
}

async function handleCooldown(btnInteraction, rootInteraction, client, guildId) {
    const cfg = await getLevelingConfig(client, guildId);

    const modal = new ModalBuilder()
        .setCustomId('lvl_cfg_cooldown_modal')
        .setTitle('DÃ©lai entre deux gains d\'XP')
        .addComponents(
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('seconds_input')
                    .setLabel('DÃ©lai (secondes, 0-3600)')
                    .setStyle(TextInputStyle.Short)
                    .setValue(String(cfg.xpCooldown ?? 20))
                    .setMaxLength(4)
                    .setMinLength(1)
                    .setRequired(true),
            ),
        );

    try {
        await btnInteraction.showModal(modal);
    } catch {
        return;
    }

    const submitted = await btnInteraction
        .awaitModalSubmit({
            filter: i => i.customId === 'lvl_cfg_cooldown_modal' && i.user.id === btnInteraction.user.id,
            time: 120_000,
        })
        .catch(() => null);

    if (!submitted) {
        return;
    }

    const seconds = parseInt(submitted.fields.getTextInputValue('seconds_input'), 10);
    if (Number.isNaN(seconds) || seconds < 0 || seconds > 3600) {
        await submitted.reply({
            embeds: [warningEmbed('Le dÃ©lai doit Ãªtre compris entre 0 et 3600 secondes.', 'âš ï¸ DÃ©lai invalide')],
            flags: MessageFlags.Ephemeral,
        });
        return;
    }

    const cfg2 = await getLevelingConfig(client, guildId);
    cfg2.xpCooldown = seconds;
    await saveLevelingConfig(client, guildId, cfg2);

    await submitted.reply({
        embeds: [successEmbed(`Un utilisateur peut gagner de l'XP toutes les **${seconds}** seconde(s).`, 'â±ï¸ DÃ©lai')],
        flags: MessageFlags.Ephemeral,
    });

    const latest = await getLevelingConfig(client, guildId);
    await InteractionHelper.safeEditReply(rootInteraction, {
        embeds: [buildDashboardEmbed(latest, rootInteraction.guild)],
        components: buildButtonRows(),
        flags: MessageFlags.Ephemeral,
    });
}

async function handleAnnounce(btnInteraction, rootInteraction, client, guildId) {
    await btnInteraction.deferUpdate();
    const cfg = await getLevelingConfig(client, guildId);
    cfg.announceLevelUp = !cfg.announceLevelUp;
    await saveLevelingConfig(client, guildId, cfg);

    await btnInteraction.followUp({
        embeds: [successEmbed(`Les annonces de montÃ©e de niveau sont **${cfg.announceLevelUp ? 'activÃ©es' : 'dÃ©sactivÃ©es'}**.`, 'ðŸ”” Annonces')],
        flags: MessageFlags.Ephemeral,
    });

    const latest = await getLevelingConfig(client, guildId);
    await InteractionHelper.safeEditReply(rootInteraction, {
        embeds: [buildDashboardEmbed(latest, rootInteraction.guild)],
        components: buildButtonRows(),
        flags: MessageFlags.Ephemeral,
    });
}
