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
    PermissionFlagsBits,
    RoleSelectMenuBuilder,
    TextInputBuilder,
    TextInputStyle,
} from 'discord.js';
import { InteractionHelper } from '../../../utils/interactionHelper.js';
import { successEmbed } from '../../../utils/embeds.js';
import { logger } from '../../../utils/logger.js';
import { TitanBotError, ErrorTypes } from '../../../utils/errorHandler.js';
import { updateJoinToCreateConfig } from '../../../utils/database.js';
import {
    getConfiguration,
    hasManageGuildPermission,
    initializeJoinToCreate,
    removeTriggerChannel,
    updateChannelConfig,
    validateBitrate,
    validateChannelNameTemplate,
    validateUserLimit,
} from '../../../services/joinToCreateService.js';

const TRIGGER_CHANNEL_NAME = '➕ Créer votre salon';
const PICKER_TIME = 300_000;
const MODAL_TIME = 120_000;

function getTriggerId(cfg) {
    return Array.isArray(cfg?.triggerChannels) && cfg.triggerChannels.length > 0
        ? cfg.triggerChannels[0]
        : null;
}

function resolveTriggerOptions(cfg, triggerId) {
    const perChannel = triggerId ? cfg?.channelOptions?.[triggerId] || {} : {};
    return {
        nameTemplate: perChannel.nameTemplate || cfg?.channelNameTemplate || '{username} · Salon',
        userLimit: perChannel.userLimit ?? cfg?.userLimit ?? 0,
        bitrate: perChannel.bitrate || cfg?.bitrate || 64000,
        categoryId: perChannel.categoryId || null,
        moderatorRoleId: perChannel.moderatorRoleId || cfg?.moderatorRoleId || null,
    };
}

function missingBotPermissions(target) {
    if (!target) return ['accès du bot'];
    const me = target.guild?.members?.me;
    if (!me) return ['accès du bot'];
    const permissions = target.permissionsFor(me);
    if (!permissions) return ['accès du bot'];
    const required = [
        [PermissionFlagsBits.ManageChannels, 'Gérer les salons'],
        [PermissionFlagsBits.MoveMembers, 'Déplacer des membres'],
        [PermissionFlagsBits.Connect, 'Se connecter'],
    ];
    return required.filter(([flag]) => !permissions.has(flag)).map(([, label]) => label);
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
        logger.debug('JTC notice failed:', error.message);
    }
}

async function syncTriggers(guild, client, guildId) {
    const cfg = await getConfiguration(client, guildId);
    const triggers = Array.isArray(cfg.triggerChannels) ? cfg.triggerChannels : [];
    if (triggers.length === 0) return cfg;

    const alive = [];
    for (const triggerId of triggers) {
        const channel = guild.channels.cache.get(triggerId)
            || await guild.channels.fetch(triggerId).catch(() => null);
        if (channel) alive.push(triggerId);
    }

    if (alive.length === triggers.length) return cfg;

    for (const triggerId of triggers) {
        if (!alive.includes(triggerId)) {
            await removeTriggerChannel(client, guildId, triggerId).catch(() => {});
        }
    }

    return getConfiguration(client, guildId);
}

function buildDashboardEmbed(cfg, guild) {
    const triggerId = getTriggerId(cfg);
    const options = resolveTriggerOptions(cfg, triggerId);
    const triggerChannel = triggerId ? guild.channels.cache.get(triggerId) : null;
    const category = triggerChannel?.parentId ? `<#${triggerChannel.parentId}>` : '`Aucune`';
    const temporaryCount = Object.keys(cfg?.temporaryChannels || {}).length;

    return new EmbedBuilder()
        .setTitle('🔊 Tableau de bord des salons vocaux temporaires')
        .setDescription(
            triggerId
                ? `Quand un membre rejoint **${triggerChannel || 'le salon déclencheur'}**, le bot lui crée un salon vocal personnel qu\'il peut.rename, verrouiller ou supprimer.`
                : 'Aucun salon déclencheur pour l\'instant. Crée-le pour activer la création automatique de salons vocaux personnels.',
        )
        .setColor(triggerId ? getColor('info') : getColor('warning'))
        .addFields(
            { name: '⚙️ Statut', value: cfg.enabled ? '✅ Activé' : '❌ Désactivé', inline: true },
            {
                name: '🚪 Salon déclencheur',
                value: triggerId ? `${triggerChannel || `⚠️ Introuvable (${triggerId})`}` : '`Non créé`',
                inline: true,
            },
            { name: '📁 Catégorie', value: category, inline: true },
            { name: '✏️ Nom des salons', value: `\`${options.nameTemplate}\``, inline: true },
            { name: '👥 Limite', value: options.userLimit > 0 ? `${options.userLimit} membre(s)` : 'Illimitée', inline: true },
            { name: '🎙️ Débit', value: `${Math.round(options.bitrate / 1000)} kbps`, inline: true },
            { name: '🛡️ Rôle modérateur', value: options.moderatorRoleId ? `<@&${options.moderatorRoleId}>` : '`Aucun`', inline: true },
            {
                name: '📊 Salons en cours',
                value: temporaryCount > 0 ? `${temporaryCount} salon(s) temporaire(s)` : '`Aucun`',
                inline: true,
            },
        )
        .setFooter({ text: 'Le tableau de bord se ferme après 5 minutes d\'inactivité' })
        .setTimestamp();
}

function buildButtonRows(cfg) {
    const triggerId = getTriggerId(cfg);
    const rows = [];

    const stateRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('jtc_dash_toggle')
            .setLabel(cfg.enabled ? 'Désactiver' : 'Activer')
            .setEmoji('⚙️')
            .setStyle(cfg.enabled ? ButtonStyle.Danger : ButtonStyle.Success)
            .setDisabled(!triggerId),
    );

    if (triggerId) {
        stateRow.addComponents(
            new ButtonBuilder()
                .setCustomId('jtc_dash_move')
                .setLabel('Déplacer')
                .setEmoji('📁')
                .setStyle(ButtonStyle.Secondary),
            new ButtonBuilder()
                .setCustomId('jtc_dash_role')
                .setLabel('Rôle modérateur')
                .setEmoji('🛡️')
                .setStyle(ButtonStyle.Secondary),
        );
    } else {
        stateRow.addComponents(
            new ButtonBuilder()
                .setCustomId('jtc_dash_create')
                .setLabel('Créer le salon')
                .setEmoji('➕')
                .setStyle(ButtonStyle.Success),
        );
    }
    rows.push(stateRow);

    rows.push(
        new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('jtc_dash_t_name')
                .setLabel('Nom')
                .setEmoji('✏️')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(!triggerId),
            new ButtonBuilder()
                .setCustomId('jtc_dash_t_limit')
                .setLabel('Limite')
                .setEmoji('👥')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(!triggerId),
            new ButtonBuilder()
                .setCustomId('jtc_dash_t_bitrate')
                .setLabel('Débit')
                .setEmoji('🎙️')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(!triggerId),
        ),
    );

    rows.push(
        new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('jtc_dash_d_name')
                .setLabel('Nom par défaut')
                .setEmoji('📝')
                .setStyle(ButtonStyle.Secondary),
            new ButtonBuilder()
                .setCustomId('jtc_dash_d_limit')
                .setLabel('Limite par défaut')
                .setEmoji('🔢')
                .setStyle(ButtonStyle.Secondary),
            new ButtonBuilder()
                .setCustomId('jtc_dash_d_bitrate')
                .setLabel('Débit par défaut')
                .setEmoji('📶')
                .setStyle(ButtonStyle.Secondary),
        ),
    );

    const actionRow = new ActionRowBuilder();
    if (triggerId) {
        actionRow.addComponents(
            new ButtonBuilder()
                .setCustomId('jtc_dash_delete')
                .setLabel('Supprimer le déclencheur')
                .setEmoji('🗑️')
                .setStyle(ButtonStyle.Danger),
        );
    }
    actionRow.addComponents(
        new ButtonBuilder()
            .setCustomId('jtc_dash_back')
            .setLabel('Retour au panel')
            .setEmoji('⬅️')
            .setStyle(ButtonStyle.Danger),
    );
    rows.push(actionRow);

    return rows;
}

async function refreshDashboard(rootInteraction, client, guildId) {
    try {
        const cfg = await getConfiguration(client, guildId);
        await InteractionHelper.safeEditReply(rootInteraction, {
            embeds: [buildDashboardEmbed(cfg, rootInteraction.guild)],
            components: buildButtonRows(cfg),
        });
    } catch (error) {
        logger.debug('JTC dashboard refresh failed:', error.message);
    }
}

async function askText(btnInteraction, options) {
    const modal = new ModalBuilder()
        .setCustomId(options.customId)
        .setTitle(options.title)
        .addComponents(
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('value')
                    .setLabel(options.label)
                    .setStyle(options.style || TextInputStyle.Paragraph)
                    .setValue(String(options.value ?? ''))
                    .setMaxLength(options.maxLength || 100)
                    .setRequired(true),
            ),
        );

    const shown = await btnInteraction.showModal(modal).then(() => true).catch(() => false);
    if (!shown) return null;

    const submitted = await btnInteraction
        .awaitModalSubmit({
            filter: i => i.customId === options.customId && i.user.id === btnInteraction.user.id,
            time: MODAL_TIME,
        })
        .catch(() => null);

    if (!submitted) return null;

    return {
        interaction: submitted,
        value: (submitted.fields.getTextInputValue('value') || '').trim(),
    };
}

async function openCategoryPicker(btnInteraction, rootInteraction, client, guildId) {
    const categorySelect = new ChannelSelectMenuBuilder()
        .setCustomId('jtc_flow_create_category')
        .setPlaceholder('Choisis la catégorie du salon déclencheur...')
        .addChannelTypes(ChannelType.GuildCategory)
        .setMaxValues(1);

    const cancelButton = new ButtonBuilder()
        .setCustomId('jtc_flow_create_cancel')
        .setLabel('Annuler')
        .setStyle(ButtonStyle.Danger)
        .setEmoji('❌');

    const shown = await btnInteraction
        .deferReply({ flags: MessageFlags.Ephemeral })
        .then(() =>
            btnInteraction.editReply({
                embeds: [
                    new EmbedBuilder()
                        .setTitle('📁 Catégorie du salon déclencheur')
                        .setDescription(
                            'Les salons vocaux temporaires seront créés dans la même catégorie que ce salon. Laisse vide pour le placer à la racine du serveur.',
                        )
                        .setColor(getColor('info')),
                ],
                components: [
                    new ActionRowBuilder().addComponents(categorySelect),
                    new ActionRowBuilder().addComponents(cancelButton),
                ],
            }),
        )
        .then(() => true)
        .catch(error => {
            logger.error('JTC category picker could not be displayed:', error);
            return false;
        });

    if (!shown) {
        await sendNotice(
            btnInteraction,
            'Impossible d\'afficher le sélecteur de catégorie. Réessaie dans un instant.',
        ).catch(() => {});
        return;
    }

    const selectCollector = rootInteraction.channel.createMessageComponentCollector({
        componentType: ComponentType.ChannelSelect,
        filter: i => i.user.id === btnInteraction.user.id && i.customId === 'jtc_flow_create_category',
        time: PICKER_TIME,
        max: 1,
    });

    const cancelCollector = rootInteraction.channel.createMessageComponentCollector({
        componentType: ComponentType.Button,
        filter: i => i.user.id === btnInteraction.user.id && i.customId === 'jtc_flow_create_cancel',
        time: PICKER_TIME,
        max: 1,
    });

    cancelCollector.on('collect', async cancelInteraction => {
        await cancelInteraction.deferUpdate().catch(() => {});
        await cancelInteraction.deleteReply().catch(() => {});
        selectCollector.stop('cancelled');
        await sendNotice(cancelInteraction, 'Création annulée.').catch(() => {});
    });

    selectCollector.on('collect', async selectInteraction => {
        const acknowledged = await selectInteraction.deferUpdate().then(() => true).catch(() => false);
        if (!acknowledged) return;
        cancelCollector.stop('selected');

        try {
            const category = selectInteraction.channels.first() || null;

            const cfg = await getConfiguration(client, guildId);
            if (getTriggerId(cfg)) {
                await sendNotice(
                    selectInteraction,
                    'Un salon déclencheur existe déjà. Supprime-le avant d\'en créer un nouveau.',
                ).catch(() => {});
                await refreshDashboard(rootInteraction, client, guildId);
                return;
            }

            const target = category || rootInteraction.guild;
            const missing = missingBotPermissions(target);
            if (missing.length > 0) {
                await sendNotice(
                    selectInteraction,
                    `Il me manque les permissions suivantes dans ${category ? category.toString() : 'ce serveur'} : **${missing.join('**, **')}**.`,
                ).catch(() => {});
                return;
            }

            const options = resolveTriggerOptions(cfg, null);
            let triggerChannel;

            try {
                triggerChannel = await rootInteraction.guild.channels.create({
                    name: TRIGGER_CHANNEL_NAME,
                    type: ChannelType.GuildVoice,
                    parent: category?.id,
                    userLimit: 0,
                    bitrate: Math.min(64000, rootInteraction.guild.bitrate || 64000),
                    permissionOverwrites: [
                        {
                            id: rootInteraction.guild.id,
                            allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect],
                        },
                    ],
                });
            } catch (error) {
                logger.error('Failed to create JTC trigger channel:', error);
                await sendNotice(
                    selectInteraction,
                    'Impossible de créer le salon vocal. Vérifie que j\'ai la permission **Gérer les salons** dans cette catégorie.',
                ).catch(() => {});
                return;
            }

            try {
                await initializeJoinToCreate(client, guildId, triggerChannel.id, {
                    nameTemplate: options.nameTemplate,
                    userLimit: options.userLimit,
                    bitrate: options.bitrate,
                    categoryId: category?.id || null,
                });
            } catch (error) {
                await triggerChannel.delete('Échec de la configuration Join to Create').catch(() => {});
                const message = error instanceof TitanBotError
                    ? error.userMessage
                    : 'La configuration du salon déclencheur a échoué.';
                await sendNotice(selectInteraction, message).catch(() => {});
                return;
            }

            await selectInteraction.followUp({
                embeds: [
                    successEmbed(
                        '✅ Salon déclencheur créé',
                        `${triggerChannel} a été créé. Chaque membre qui le rejoint obtient son propre salon vocal.`,
                    ),
                ],
                flags: MessageFlags.Ephemeral,
            });

            await refreshDashboard(rootInteraction, client, guildId);
        } catch (error) {
            logger.error('Unexpected error while creating JTC trigger:', error);
            await sendNotice(
                selectInteraction,
                'Une erreur inattendue est survenue. Rien n\'a été créé.',
            ).catch(() => {});
        }
    });

    selectCollector.on('end', (collected, reason) => {
        cancelCollector.stop(reason);
        if (reason === 'time' && collected.size === 0) {
            sendNotice(btnInteraction, 'Aucune catégorie sélectionnée. Rien n\'a été créé.')
                .catch(() => {});
        }
    });
}

async function handleCreate(btnInteraction, rootInteraction, client, guildId) {
    const cfg = await getConfiguration(client, guildId);
    if (getTriggerId(cfg)) {
        return await sendNotice(
            btnInteraction,
            'Un salon déclencheur existe déjà. Utilise « Supprimer le déclencheur » avant d\'en créer un nouveau.',
        ).catch(() => {});
    }
    await openCategoryPicker(btnInteraction, rootInteraction, client, guildId);
}

async function handleToggle(btnInteraction, client, guildId) {
    const cfg = await getConfiguration(client, guildId);
    if (!getTriggerId(cfg)) {
        throw new TitanBotError(
            'No Join to Create trigger configured',
            ErrorTypes.VALIDATION,
            'Crée d\'abord un salon déclencheur.',
        );
    }

    await updateJoinToCreateConfig(client, guildId, { enabled: !cfg.enabled });

    await sendNotice(
        btnInteraction,
        `Les salons vocaux temporaires sont **${cfg.enabled ? 'désactivés' : 'activés'}**.`,
    ).catch(() => {});
}

async function handleMove(btnInteraction, rootInteraction, client, guildId) {
    const cfg = await getConfiguration(client, guildId);
    const triggerId = getTriggerId(cfg);
    if (!triggerId) return;

    const triggerChannel = rootInteraction.guild.channels.cache.get(triggerId)
        || await rootInteraction.guild.channels.fetch(triggerId).catch(() => null);
    if (!triggerChannel) {
        return await sendNotice(
            btnInteraction,
            'Le salon déclencheur est introuvable. Supprime-le puis recrée-le.',
        ).catch(() => {});
    }

    const categorySelect = new ChannelSelectMenuBuilder()
        .setCustomId('jtc_flow_move_category')
        .setPlaceholder('Choisis la nouvelle catégorie...')
        .addChannelTypes(ChannelType.GuildCategory)
        .setMaxValues(1);
    if (triggerChannel.parentId) {
        categorySelect.setDefaultValues([triggerChannel.parentId]);
    }

    const cancelButton = new ButtonBuilder()
        .setCustomId('jtc_flow_move_cancel')
        .setLabel('Annuler')
        .setStyle(ButtonStyle.Danger)
        .setEmoji('❌');

    const shown = await btnInteraction
        .deferReply({ flags: MessageFlags.Ephemeral })
        .then(() =>
            btnInteraction.editReply({
                embeds: [
                    new EmbedBuilder()
                        .setTitle('📁 Déplacer le salon déclencheur')
                        .setDescription(
                            `**Actuel :** ${triggerChannel.parentId ? `<#${triggerChannel.parentId}>` : '`Aucune`'}\n\nLes salons temporaires suivront la catégorie du salon déclencheur.`,
                        )
                        .setColor(getColor('info')),
                ],
                components: [
                    new ActionRowBuilder().addComponents(categorySelect),
                    new ActionRowBuilder().addComponents(cancelButton),
                ],
            }),
        )
        .then(() => true)
        .catch(error => {
            logger.error('JTC move picker could not be displayed:', error);
            return false;
        });

    if (!shown) {
        await sendNotice(
            btnInteraction,
            'Impossible d\'afficher le sélecteur de catégorie. Réessaie dans un instant.',
        ).catch(() => {});
        return;
    }

    const selectCollector = rootInteraction.channel.createMessageComponentCollector({
        componentType: ComponentType.ChannelSelect,
        filter: i => i.user.id === btnInteraction.user.id && i.customId === 'jtc_flow_move_category',
        time: PICKER_TIME,
        max: 1,
    });

    const cancelCollector = rootInteraction.channel.createMessageComponentCollector({
        componentType: ComponentType.Button,
        filter: i => i.user.id === btnInteraction.user.id && i.customId === 'jtc_flow_move_cancel',
        time: PICKER_TIME,
        max: 1,
    });

    cancelCollector.on('collect', async cancelInteraction => {
        await cancelInteraction.deferUpdate().catch(() => {});
        await cancelInteraction.deleteReply().catch(() => {});
        selectCollector.stop('cancelled');
        await sendNotice(cancelInteraction, 'Déplacement annulé.').catch(() => {});
    });

    selectCollector.on('collect', async selectInteraction => {
        const acknowledged = await selectInteraction.deferUpdate().then(() => true).catch(() => false);
        if (!acknowledged) return;
        cancelCollector.stop('selected');
        await selectInteraction.deleteReply().catch(() => {});

        const category = selectInteraction.channels.first() || null;
        const missing = missingBotPermissions(category || rootInteraction.guild);
        if (missing.length > 0) {
            await sendNotice(
                selectInteraction,
                `Il me manque les permissions suivantes dans ${category ? category.toString() : 'ce serveur'} : **${missing.join('**, **')}**.`,
            ).catch(() => {});
            return;
        }

        try {
            await triggerChannel.setParent(category, { lockPermissions: false });
            await updateChannelConfig(client, guildId, triggerId, { categoryId: category?.id || null });
        } catch (error) {
            logger.error('Failed to move JTC trigger channel:', error);
            await sendNotice(
                selectInteraction,
                'Impossible de déplacer le salon déclencheur. Vérifie mes permissions dans cette catégorie.',
            ).catch(() => {});
            return;
        }

        await sendNotice(
            selectInteraction,
            `Salon déclencheur déplacé dans ${category ? category.toString() : 'la racine du serveur'}.`,
        ).catch(() => {});

        await refreshDashboard(rootInteraction, client, guildId);
    });

    selectCollector.on('end', (collected, reason) => {
        cancelCollector.stop(reason);
        if (reason === 'time' && collected.size === 0) {
            sendNotice(btnInteraction, 'Aucun salon sélectionné. Le paramètre n\'a pas été modifié.')
                .catch(() => {});
        }
    });
}

async function handleRole(btnInteraction, rootInteraction, client, guildId) {
    const cfg = await getConfiguration(client, guildId);
    const triggerId = getTriggerId(cfg);
    const currentRoleId = resolveTriggerOptions(cfg, triggerId).moderatorRoleId;

    const roleSelect = new RoleSelectMenuBuilder()
        .setCustomId('jtc_flow_role_select')
        .setPlaceholder('Choisis le rôle qui peut contrôler les salons...')
        .setMinValues(0)
        .setMaxValues(1);
    if (currentRoleId) {
        roleSelect.setDefaultValues([currentRoleId]);
    }

    const cancelButton = new ButtonBuilder()
        .setCustomId('jtc_flow_role_cancel')
        .setLabel('Annuler')
        .setStyle(ButtonStyle.Danger)
        .setEmoji('❌');

    const shown = await btnInteraction
        .deferReply({ flags: MessageFlags.Ephemeral })
        .then(() =>
            btnInteraction.editReply({
                embeds: [
                    new EmbedBuilder()
                        .setTitle('🛡️ Rôle modérateur')
                        .setDescription(
                            `**Actuel :** ${currentRoleId ? `<@&${currentRoleId}>` : '`Aucun`'}\n\nCe rôle pourra gérer les salons temporaires en plus du propriétaire.`,
                        )
                        .setColor(getColor('info')),
                ],
                components: [
                    new ActionRowBuilder().addComponents(roleSelect),
                    new ActionRowBuilder().addComponents(cancelButton),
                ],
            }),
        )
        .then(() => true)
        .catch(error => {
            logger.error('JTC role picker could not be displayed:', error);
            return false;
        });

    if (!shown) {
        await sendNotice(
            btnInteraction,
            'Impossible d\'afficher le sélecteur de rôle. Réessaie dans un instant.',
        ).catch(() => {});
        return;
    }

    const selectCollector = rootInteraction.channel.createMessageComponentCollector({
        componentType: ComponentType.RoleSelect,
        filter: i => i.user.id === btnInteraction.user.id && i.customId === 'jtc_flow_role_select',
        time: PICKER_TIME,
        max: 1,
    });

    const cancelCollector = rootInteraction.channel.createMessageComponentCollector({
        componentType: ComponentType.Button,
        filter: i => i.user.id === btnInteraction.user.id && i.customId === 'jtc_flow_role_cancel',
        time: PICKER_TIME,
        max: 1,
    });

    cancelCollector.on('collect', async cancelInteraction => {
        await cancelInteraction.deferUpdate().catch(() => {});
        await cancelInteraction.deleteReply().catch(() => {});
        selectCollector.stop('cancelled');
        await sendNotice(cancelInteraction, 'Sélection annulée.').catch(() => {});
    });

    selectCollector.on('collect', async selectInteraction => {
        const acknowledged = await selectInteraction.deferUpdate().then(() => true).catch(() => false);
        if (!acknowledged) return;
        cancelCollector.stop('selected');
        await selectInteraction.deleteReply().catch(() => {});

        const roleId = selectInteraction.values?.[0] || null;

        try {
            await updateJoinToCreateConfig(client, guildId, { moderatorRoleId: roleId });
            if (triggerId) {
                await updateChannelConfig(client, guildId, triggerId, { moderatorRoleId: roleId });
            }
        } catch (error) {
            logger.error('Failed to update JTC moderator role:', error);
            await sendNotice(
                selectInteraction,
                'Impossible d\'enregistrer le rôle modérateur. Réessaie dans un instant.',
            ).catch(() => {});
            return;
        }

        await sendNotice(
            selectInteraction,
            roleId ? `Rôle modérateur : <@&${roleId}>.` : 'Aucun rôle modérateur : seuls les administrateurs et le propriétaire peuvent gérer les salons.',
        ).catch(() => {});

        await refreshDashboard(rootInteraction, client, guildId);
    });

    selectCollector.on('end', (collected, reason) => {
        cancelCollector.stop(reason);
        if (reason === 'time' && collected.size === 0) {
            sendNotice(btnInteraction, 'Aucun rôle sélectionné. Le paramètre n\'a pas été modifié.')
                .catch(() => {});
        }
    });
}

async function handleTemplate(btnInteraction, rootInteraction, client, guildId, scope) {
    const cfg = await getConfiguration(client, guildId);
    const triggerId = getTriggerId(cfg);
    const current = scope === 'trigger'
        ? resolveTriggerOptions(cfg, triggerId).nameTemplate
        : (cfg.channelNameTemplate || '{username} · Salon');

    const answer = await askText(btnInteraction, {
        customId: 'jtc_dash_modal_name',
        title: scope === 'trigger' ? 'Nom des salons' : 'Nom par défaut',
        label: 'Modèle (ex: {username} · Salon)',
        value: current,
        maxLength: 100,
    });
    if (!answer) return;

    try {
        validateChannelNameTemplate(answer.value);
        if (scope === 'trigger') {
            await updateChannelConfig(client, guildId, triggerId, { nameTemplate: answer.value });
        } else {
            await updateJoinToCreateConfig(client, guildId, { channelNameTemplate: answer.value });
        }
    } catch (error) {
        const message = error instanceof TitanBotError
            ? error.userMessage
            : 'Le modèle de nom est invalide.';
        await sendNotice(answer.interaction, message).catch(() => {});
        return;
    }

    await answer.interaction.reply({
        embeds: [successEmbed('✅ Nom mis à jour', `Les nouveaux salons s'appelleront \`${answer.value}\`.`)],
        flags: MessageFlags.Ephemeral,
    });

    await refreshDashboard(rootInteraction, client, guildId);
}

async function handleLimit(btnInteraction, rootInteraction, client, guildId, scope) {
    const cfg = await getConfiguration(client, guildId);
    const triggerId = getTriggerId(cfg);
    const current = scope === 'trigger'
        ? resolveTriggerOptions(cfg, triggerId).userLimit
        : (cfg.userLimit ?? 0);

    const answer = await askText(btnInteraction, {
        customId: 'jtc_dash_modal_limit',
        title: scope === 'trigger' ? 'Limite de membres' : 'Limite par défaut',
        label: 'Nombre max (0 = illimité)',
        value: current,
        style: TextInputStyle.ShortText,
        maxLength: 2,
    });
    if (!answer) return;

    const value = Number.parseInt(answer.value, 10);

    try {
        validateUserLimit(value);
        if (scope === 'trigger') {
            await updateChannelConfig(client, guildId, triggerId, { userLimit: value });
        } else {
            await updateJoinToCreateConfig(client, guildId, { userLimit: value });
        }
    } catch (error) {
        const message = error instanceof TitanBotError
            ? error.userMessage
            : 'La limite doit être un nombre entre 0 et 99.';
        await sendNotice(answer.interaction, message).catch(() => {});
        return;
    }

    await answer.interaction.reply({
        embeds: [
            successEmbed(
                '✅ Limite mise à jour',
                value > 0 ? `${value} membre(s) maximum par salon.` : 'Aucune limite de membres.',
            ),
        ],
        flags: MessageFlags.Ephemeral,
    });

    await refreshDashboard(rootInteraction, client, guildId);
}

async function handleBitrate(btnInteraction, rootInteraction, client, guildId, scope) {
    const cfg = await getConfiguration(client, guildId);
    const triggerId = getTriggerId(cfg);
    const current = scope === 'trigger'
        ? Math.round(resolveTriggerOptions(cfg, triggerId).bitrate / 1000)
        : Math.round((cfg.bitrate || 64000) / 1000);

    const answer = await askText(btnInteraction, {
        customId: 'jtc_dash_modal_bitrate',
        title: scope === 'trigger' ? 'Débit du salon' : 'Débit par défaut',
        label: 'Débit en kbps (8-384)',
        value: current,
        style: TextInputStyle.ShortText,
        maxLength: 3,
    });
    if (!answer) return;

    const kbps = Number.parseInt(answer.value, 10);

    try {
        validateBitrate(kbps);
        if (scope === 'trigger') {
            await updateChannelConfig(client, guildId, triggerId, { bitrate: kbps * 1000 });
        } else {
            await updateJoinToCreateConfig(client, guildId, { bitrate: kbps * 1000 });
        }
    } catch (error) {
        const message = error instanceof TitanBotError
            ? error.userMessage
            : 'Le débit doit être compris entre 8 et 384 kbps.';
        await sendNotice(answer.interaction, message).catch(() => {});
        return;
    }

    await answer.interaction.reply({
        embeds: [successEmbed('✅ Débit mis à jour', `Les nouveaux salons utiliseront ${kbps} kbps.`)],
        flags: MessageFlags.Ephemeral,
    });

    await refreshDashboard(rootInteraction, client, guildId);
}

async function handleDelete(btnInteraction, rootInteraction, client, guildId) {
    const cfg = await getConfiguration(client, guildId);
    const triggerId = getTriggerId(cfg);
    if (!triggerId) return;

    const triggerChannel = rootInteraction.guild.channels.cache.get(triggerId)
        || await rootInteraction.guild.channels.fetch(triggerId).catch(() => null);

    const confirmButton = new ButtonBuilder()
        .setCustomId('jtc_flow_delete_confirm')
        .setLabel('Confirmer')
        .setStyle(ButtonStyle.Danger)
        .setEmoji('🗑️');
    const cancelButton = new ButtonBuilder()
        .setCustomId('jtc_flow_delete_cancel')
        .setLabel('Annuler')
        .setStyle(ButtonStyle.Secondary)
        .setEmoji('❌');

    const shown = await btnInteraction
        .deferReply({ flags: MessageFlags.Ephemeral })
        .then(() =>
            btnInteraction.editReply({
                embeds: [
                    new EmbedBuilder()
                        .setTitle('🗑️ Supprimer le salon déclencheur ?')
                        .setDescription(
                            `Le salon **${triggerChannel || triggerId}** ne créera plus de salon vocal.\n\nLe salon lui-même **n'est pas supprimé**, seul le lien avec le bot est coupé.`,
                        )
                        .setColor(getColor('warning')),
                ],
                components: [new ActionRowBuilder().addComponents(confirmButton, cancelButton)],
            }),
        )
        .then(() => true)
        .catch(error => {
            logger.error('JTC delete confirmation could not be displayed:', error);
            return false;
        });

    if (!shown) {
        await sendNotice(
            btnInteraction,
            'Impossible d\'afficher la confirmation. Réessaie dans un instant.',
        ).catch(() => {});
        return;
    }

    const confirmCollector = rootInteraction.channel.createMessageComponentCollector({
        componentType: ComponentType.Button,
        filter: i => i.user.id === btnInteraction.user.id && i.customId === 'jtc_flow_delete_confirm',
        time: PICKER_TIME,
        max: 1,
    });

    const cancelCollector = rootInteraction.channel.createMessageComponentCollector({
        componentType: ComponentType.Button,
        filter: i => i.user.id === btnInteraction.user.id && i.customId === 'jtc_flow_delete_cancel',
        time: PICKER_TIME,
        max: 1,
    });

    cancelCollector.on('collect', async cancelInteraction => {
        await cancelInteraction.deferUpdate().catch(() => {});
        await cancelInteraction.deleteReply().catch(() => {});
        confirmCollector.stop('cancelled');
        await sendNotice(cancelInteraction, 'Suppression annulée.').catch(() => {});
    });

    confirmCollector.on('collect', async confirmInteraction => {
        const acknowledged = await confirmInteraction.deferUpdate().then(() => true).catch(() => false);
        if (!acknowledged) return;
        cancelCollector.stop('confirmed');
        await confirmInteraction.deleteReply().catch(() => {});

        try {
            await removeTriggerChannel(client, guildId, triggerId);
        } catch (error) {
            logger.error('Failed to remove JTC trigger:', error);
            await sendNotice(
                confirmInteraction,
                'Impossible de supprimer le déclencheur. Réessaie dans un instant.',
            ).catch(() => {});
            return;
        }

        await sendNotice(
            confirmInteraction,
            'Salon déclencheur supprimé. La création automatique de salons vocaux est désactivée.',
        ).catch(() => {});

        await refreshDashboard(rootInteraction, client, guildId);
    });

    confirmCollector.on('end', (collected, reason) => {
        cancelCollector.stop(reason);
        if (reason === 'time' && collected.size === 0) {
            sendNotice(btnInteraction, 'Suppression annulée (délai dépassé).').catch(() => {});
        }
    });
}

export default {
    async execute(interaction, config, client, onBack) {
        try {
            const guildId = interaction.guild.id;

            if (!hasManageGuildPermission(interaction.member)) {
                return await sendNotice(
                    interaction,
                    'Tu as besoin de la permission **Gérer le serveur** pour configurer les salons vocaux.',
                );
            }

            await InteractionHelper.safeDeferOrUpdate(interaction, {});

            const cfg = await syncTriggers(interaction.guild, client, guildId);

            await InteractionHelper.safeEditReply(interaction, {
                embeds: [buildDashboardEmbed(cfg, interaction.guild)],
                components: buildButtonRows(cfg),
            });

            InteractionHelper.armDashboardSession(interaction);

            const collector = interaction.channel.createMessageComponentCollector({
                componentType: ComponentType.Button,
                filter: i => i.user.id === interaction.user.id && i.customId.startsWith('jtc_dash_'),
                time: PICKER_TIME,
            });

            collector.on('collect', async btnInteraction => {
                InteractionHelper.armDashboardSession(interaction);

                if (!hasManageGuildPermission(btnInteraction.member)) {
                    await sendNotice(
                        btnInteraction,
                        'Tu as besoin de la permission **Gérer le serveur** pour cette action.',
                    ).catch(() => {});
                    return;
                }

                try {
                    switch (btnInteraction.customId) {
                        case 'jtc_dash_toggle':
                            await handleToggle(btnInteraction, client, guildId);
                            break;
                        case 'jtc_dash_create':
                            await handleCreate(btnInteraction, interaction, client, guildId);
                            return;
                        case 'jtc_dash_move':
                            await handleMove(btnInteraction, interaction, client, guildId);
                            return;
                        case 'jtc_dash_role':
                            await handleRole(btnInteraction, interaction, client, guildId);
                            return;
                        case 'jtc_dash_t_name':
                            await handleTemplate(btnInteraction, interaction, client, guildId, 'trigger');
                            return;
                        case 'jtc_dash_t_limit':
                            await handleLimit(btnInteraction, interaction, client, guildId, 'trigger');
                            return;
                        case 'jtc_dash_t_bitrate':
                            await handleBitrate(btnInteraction, interaction, client, guildId, 'trigger');
                            return;
                        case 'jtc_dash_d_name':
                            await handleTemplate(btnInteraction, interaction, client, guildId, 'default');
                            return;
                        case 'jtc_dash_d_limit':
                            await handleLimit(btnInteraction, interaction, client, guildId, 'default');
                            return;
                        case 'jtc_dash_d_bitrate':
                            await handleBitrate(btnInteraction, interaction, client, guildId, 'default');
                            return;
                        case 'jtc_dash_delete':
                            await handleDelete(btnInteraction, interaction, client, guildId);
                            return;
                        case 'jtc_dash_back':
                            if (typeof onBack === 'function') {
                                await onBack(btnInteraction);
                            }
                            return;
                    }

                    await refreshDashboard(interaction, client, guildId);
                } catch (error) {
                    if (error instanceof TitanBotError) {
                        logger.debug(`JTC dashboard validation error: ${error.message}`);
                    } else {
                        logger.error('Unexpected JTC dashboard error:', error);
                    }

                    const message = error instanceof TitanBotError
                        ? error.userMessage || 'Une erreur est survenue lors de la configuration.'
                        : 'Une erreur inattendue est survenue. Réessaie dans un instant.';

                    await sendNotice(btnInteraction, message).catch(() => {});
                }
            });
        } catch (error) {
            if (error instanceof TitanBotError) throw error;
            logger.error('Unexpected error in jtc_dashboard:', error);
            throw new TitanBotError(
                `JTC dashboard failed: ${error.message}`,
                ErrorTypes.UNKNOWN,
                'Impossible d\'ouvrir le tableau de bord des salons vocaux.',
            );
        }
    },
};
