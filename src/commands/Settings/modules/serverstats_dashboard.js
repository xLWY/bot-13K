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
    PermissionFlagsBits,
    StringSelectMenuBuilder,
    StringSelectMenuOptionBuilder,
} from 'discord.js';
import { InteractionHelper } from '../../../utils/interactionHelper.js';
import { successEmbed, warningEmbed } from '../../../utils/embeds.js';
import { logger } from '../../../utils/logger.js';
import {
    getCounterBaseName,
    getCounterCount,
    getCounterEmoji,
    getGuildCounterStats,
    getServerCounters,
    resolveCounterChannel,
    saveServerCounters,
    updateCounter,
} from '../../../services/serverstatsService.js';
import { performDeletionByCounterId } from '../../ServerStats/modules/serverstats_delete.js';

const TYPE_LABELS = {
    members: 'Membres + bots',
    members_only: 'Membres uniquement',
    bots: 'Bots uniquement',
    online: 'Membres en ligne',
    voice: 'Membres en vocal',
};

const MAX_LISTED_COUNTERS = 20;
const MAX_SELECT_OPTIONS = 25;
const STEP_TIMEOUT_MS = 90_000;

const activeCreateFlows = new Set();
const activeRootCollectors = new Map();

function registerRootCollectors(key, collectors) {
    const previous = activeRootCollectors.get(key);
    if (previous) {
        for (const collector of previous) {
            try {
                collector.stop('replaced');
            } catch {
                void 0;
            }
        }
    }
    activeRootCollectors.set(key, collectors);
}

function typeLabel(type) {
    return TYPE_LABELS[type] || type;
}

function formatCount(count) {
    return typeof count === 'number' ? count.toLocaleString('en-US') : '?';
}

function truncate(value, max) {
    return value.length > max ? `${value.substring(0, max - 1)}…` : value;
}

async function buildDashboardEmbed(guild, counters, stats) {
    const fields = [
        { name: '👥 Membres', value: formatCount(stats.totalCount), inline: true },
        { name: '🌐 En ligne', value: formatCount(stats.onlineCount), inline: true },
        { name: '🔊 En vocal', value: formatCount(stats.voiceCount), inline: true },
        { name: '🤖 Bots', value: formatCount(stats.botCount), inline: true },
    ];

    if (counters.length === 0) {
        fields.push({
            name: '📊 Compteurs',
            value: '`Aucun`\nUtilise **➕ Créer** pour ajouter ton premier compteur.',
            inline: false,
        });
    } else {
        for (const counter of counters.slice(0, MAX_LISTED_COUNTERS)) {
            const channel = await resolveCounterChannel(guild, counter.channelId);
            const count = await getCounterCount(guild, counter.type, stats);
            fields.push({
                name: truncate(`📌 Compteur ${getCounterEmoji(counter.type)} ${typeLabel(counter.type)}`, 256),
                value: `${channel ? `<#${channel.id}>` : '`Salon introuvable`'}\n\`${formatCount(count)}\` • ${counter.enabled === false ? '⏸️ Désactivé' : '✅ Actif'}`,
                inline: true,
            });
        }
        if (counters.length > MAX_LISTED_COUNTERS) {
            const hidden = counters
                .slice(MAX_LISTED_COUNTERS)
                .map(counter => `${getCounterEmoji(counter.type)} ${typeLabel(counter.type)}`)
                .join(' • ');
            fields.push({
                name: `➕ ${counters.length - MAX_LISTED_COUNTERS} autre(s) compteur(s)`,
                value: truncate(hidden, 1024),
                inline: false,
            });
        }
    }

    return new EmbedBuilder()
        .setTitle('📊 Tableau de bord des compteurs')
        .setDescription(
            `Gère les salons compteurs de **${guild.name}**.\nLes noms se mettent à jour automatiquement aux arrivées, départs, changements de vocal et toutes les 15 minutes.`,
        )
        .setColor(getColor('info'))
        .addFields(fields)
        .setFooter({ text: `**${counters.length}** compteur(s) • le tableau de bord se ferme après 10 minutes d\'inactivité` })
        .setTimestamp();
}

function buildButtonRow() {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('ss_dash_create')
            .setLabel('Créer')
            .setEmoji('➕')
            .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
            .setCustomId('ss_dash_refresh')
            .setLabel('Actualiser')
            .setEmoji('🔄')
            .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
            .setCustomId('ss_dash_back')
            .setLabel('Retour au panel')
            .setEmoji('⬅️')
            .setStyle(ButtonStyle.Danger),
    );
}

async function buildSelectRow(guild, counters) {
    if (counters.length === 0) {
        return null;
    }

    const select = new StringSelectMenuBuilder()
        .setCustomId('ss_dash_select')
        .setPlaceholder('Gère un compteur...');

    for (const counter of counters.slice(0, MAX_SELECT_OPTIONS)) {
        const channel = await resolveCounterChannel(guild, counter.channelId);
        select.addOptions(
            new StringSelectMenuOptionBuilder()
                .setLabel(truncate(`${getCounterEmoji(counter.type)} ${typeLabel(counter.type)}`, 100))
                .setDescription(truncate(channel ? `Salon : ${channel.name}` : 'Salon introuvable', 100))
                .setValue(counter.id),
        );
    }

    return new ActionRowBuilder().addComponents(select);
}

async function buildComponents(guild, counters) {
    const rows = [buildButtonRow()];
    const selectRow = await buildSelectRow(guild, counters);
    if (selectRow) {
        rows.push(selectRow);
    }
    return rows;
}

function buildCancelRow(flowId) {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`ss_flow_cancel_${flowId}`)
            .setLabel('Annuler la création')
            .setEmoji('❌')
            .setStyle(ButtonStyle.Secondary),
    );
}

async function refreshDashboard(rootInteraction, client) {
    try {
        const counters = await getServerCounters(client, rootInteraction.guild.id);
        const stats = await getGuildCounterStats(rootInteraction.guild);
        await InteractionHelper.safeEditReply(rootInteraction, {
            embeds: [await buildDashboardEmbed(rootInteraction.guild, counters, stats)],
            components: await buildComponents(rootInteraction.guild, counters),
            flags: MessageFlags.Ephemeral,
        });
    } catch (error) {
        logger.debug('Could not refresh serverstats dashboard:', error.message);
    }
}

function waitForStep({ channel, message, componentType, customId, cancelId, userId, timeout = STEP_TIMEOUT_MS }) {
    return new Promise((resolve) => {
        let settled = false;

        const selectCollector = channel.createMessageComponentCollector({
            componentType,
            filter: i =>
                i.user.id === userId &&
                i.message?.id === message.id &&
                i.customId === customId,
            time: timeout,
        });

        const cancelCollector = channel.createMessageComponentCollector({
            componentType: ComponentType.Button,
            filter: i =>
                i.user.id === userId &&
                i.message?.id === message.id &&
                i.customId === cancelId,
            time: timeout,
        });

        const finish = result => {
            if (settled) {
                return;
            }
            settled = true;
            selectCollector.stop();
            cancelCollector.stop();
            resolve(result);
        };

        selectCollector.once('collect', interaction =>
            finish({ kind: componentType === ComponentType.ChannelSelect ? 'channel' : 'select', interaction }),
        );
        cancelCollector.once('collect', interaction => finish({ kind: 'cancel', interaction }));
        selectCollector.once('end', () => finish(null));
        cancelCollector.once('end', () => finish(null));
    });
}

async function stopStep(step, stepNumber, fallbackInteraction) {
    if (step && step.kind === 'cancel') {
        await step.interaction.deferUpdate().catch(() => {});
        await step.interaction
            .followUp({
                content: '↩️ Création annulée. Aucun compteur n\'a été créé.',
                flags: MessageFlags.Ephemeral,
            })
            .catch(() => null);
        return;
    }

    logger.debug(`Serverstats create flow timed out at step ${stepNumber}/3`);
    await InteractionHelper.sendErrorNotice(
        fallbackInteraction,
        `⏱️ **Étape ${stepNumber}/3** expirée : aucune sélection effectuée. Aucun compteur n'a été créé. Clique de nouveau sur **➕ Créer**.`,
    ).catch(() => null);
}

export default {
    async execute(interaction, config, client, onBack) {
        try {
            const guildId = interaction.guild.id;
            const counters = await getServerCounters(client, guildId);
            const stats = await getGuildCounterStats(interaction.guild);

            await InteractionHelper.safeDeferOrUpdate(interaction, { flags: MessageFlags.Ephemeral });

            await InteractionHelper.safeEditReply(interaction, {
                embeds: [await buildDashboardEmbed(interaction.guild, counters, stats)],
                components: await buildComponents(interaction.guild, counters),
                flags: MessageFlags.Ephemeral,
            });

            const buttonCollector = interaction.channel.createMessageComponentCollector({
                componentType: ComponentType.Button,
                filter: i =>
                    i.user.id === interaction.user.id &&
                    ['ss_dash_create', 'ss_dash_refresh', 'ss_dash_back'].includes(i.customId),
                time: 300_000,
            });

            buttonCollector.on('collect', async btnInteraction => {
                try {
                    if (btnInteraction.customId === 'ss_dash_back') {
                        await btnInteraction.deferUpdate().catch(() => {});
                        if (typeof onBack === 'function') {
                            await onBack(btnInteraction);
                        }
                        return;
                    }

                    if (btnInteraction.customId === 'ss_dash_refresh') {
                        await btnInteraction.deferUpdate().catch(() => {});
                        await runRefresh(btnInteraction, client);
                        await refreshDashboard(interaction, client);
                        return;
                    }

                    if (btnInteraction.customId === 'ss_dash_create') {
                        await handleCreate(btnInteraction, interaction, client);
                    }
                } catch (error) {
                    logger.error('ServerStats dashboard action failed:', error);
                    if (!btnInteraction.replied && !btnInteraction.deferred) {
                        await btnInteraction.deferUpdate().catch(() => {});
                    }
                    await InteractionHelper.sendErrorNotice(btnInteraction, 'Impossible de traiter cette action. Réessaie.').catch(() => {});
                }
            });

            const selectCollector = interaction.channel.createMessageComponentCollector({
                componentType: ComponentType.StringSelect,
                filter: i => i.user.id === interaction.user.id && i.customId === 'ss_dash_select',
                time: 300_000,
            });

            selectCollector.on('collect', async selectInteraction => {
                try {
                    await handleCounterSelection(selectInteraction, interaction, client);
                } catch (error) {
                    logger.error('ServerStats counter management failed:', error);
                    if (!selectInteraction.replied && !selectInteraction.deferred) {
                        await selectInteraction.deferUpdate().catch(() => {});
                    }
                    await InteractionHelper.sendErrorNotice(selectInteraction, 'Impossible de gérer ce compteur. Réessaie.').catch(() => {});
                }
            });

            buttonCollector.on('end', async (collected, reason) => {
                if (reason === 'time') {
                    selectCollector.stop();
                    await InteractionHelper.safeDeleteReply(interaction);
                }
            });

            registerRootCollectors(`${guildId}:${interaction.user.id}`, [buttonCollector, selectCollector]);
        } catch (error) {
            logger.error('ServerStats dashboard failed to open:', error);
            await InteractionHelper.sendErrorNotice(interaction, 'Impossible d\'ouvrir le tableau de bord des compteurs. Réessaie.').catch(() => {});
        }
    },
};

async function runRefresh(btnInteraction, client) {
    const guild = btnInteraction.guild;
    const counters = await getServerCounters(client, guild.id);
    const stats = await getGuildCounterStats(guild);

    let refreshed = 0;
    let missing = 0;

    for (const counter of counters) {
        if (counter.enabled === false) {
            continue;
        }
        if (!(await resolveCounterChannel(guild, counter.channelId))) {
            missing++;
            continue;
        }
        if (await updateCounter(client, guild, counter, stats)) {
            refreshed++;
        }
    }

    const lines = [`**${refreshed}** compteur(s) actualisé(s).`];
    if (missing > 0) {
        lines.push(`⚠️ **${missing}** compteur(s) pointent vers un salon supprimé : supprime-les via le menu de gestion.`);
    }

    await btnInteraction.followUp({
        embeds: [successEmbed(lines.join('\n'), '🔄 Actualisation')],
        flags: MessageFlags.Ephemeral,
    });
}

async function handleCreate(btnInteraction, rootInteraction, client) {
    const guild = btnInteraction.guild;

    if (activeCreateFlows.has(guild.id)) {
        await btnInteraction.deferUpdate().catch(() => {});
        await InteractionHelper.sendErrorNotice(
            btnInteraction,
            'Une création de compteur est déjà en cours. Termine-la avec le bouton **❌ Annuler la création**, ou clique sur **➕ Créer** dans une minute.',
        ).catch(() => null);
        return;
    }

    if (!btnInteraction.memberPermissions?.has(PermissionFlagsBits.ManageChannels)) {
        await btnInteraction.deferUpdate().catch(() => {});
        await InteractionHelper.sendErrorNotice(btnInteraction, 'Tu as besoin de la permission **Gérer les salons** pour créer un compteur.').catch(() => null);
        return;
    }

    const counters = await getServerCounters(client, guild.id);
    const availableTypes = Object.keys(TYPE_LABELS).filter(type => !counters.some(counter => counter.type === type));

    if (availableTypes.length === 0) {
        await btnInteraction.deferUpdate().catch(() => {});
        await InteractionHelper.sendErrorNotice(btnInteraction, 'Tous les types de compteurs existent déjà. Supprime-en un avant d\'en créer un autre.').catch(() => null);
        return;
    }

    await btnInteraction.deferUpdate().catch(() => {});

    const flowId = Date.now().toString(36);
    const cancelId = `ss_flow_cancel_${flowId}`;
    activeCreateFlows.add(guild.id);

    try {
        const typeSelect = new StringSelectMenuBuilder()
            .setCustomId(`ss_new_type_${flowId}`)
            .setPlaceholder('Choisis le type de compteur...');

        for (const type of availableTypes) {
            typeSelect.addOptions(
                new StringSelectMenuOptionBuilder()
                    .setLabel(truncate(typeLabel(type), 100))
                    .setDescription(truncate(`Compteur : ${typeLabel(type)}`, 100))
                    .setValue(type)
                    .setEmoji(getCounterEmoji(type)),
            );
        }

        const typeMessage = await btnInteraction.followUp({
            embeds: [
                new EmbedBuilder()
                    .setTitle('➕ Nouveau compteur — Étape 1/3')
                    .setDescription('Choisis le **type de compteur** à créer.')
                    .setColor(getColor('info')),
            ],
            components: [new ActionRowBuilder().addComponents(typeSelect), buildCancelRow(flowId)],
            flags: MessageFlags.Ephemeral,
        });

        const typeStep = await waitForStep({
            channel: rootInteraction.channel,
            message: typeMessage,
            componentType: ComponentType.StringSelect,
            customId: `ss_new_type_${flowId}`,
            cancelId,
            userId: btnInteraction.user.id,
        });

        if (!typeStep || typeStep.kind === 'cancel') {
            await stopStep(typeStep, 1, btnInteraction);
            return;
        }

        const type = typeStep.interaction.values[0];
        await typeStep.interaction.deferUpdate().catch(() => {});

        const kindSelect = new StringSelectMenuBuilder()
            .setCustomId(`ss_new_kind_${flowId}`)
            .setPlaceholder('Choisis le type de salon...')
            .addOptions(
                new StringSelectMenuOptionBuilder()
                    .setLabel('Salon vocal (recommandé)')
                    .setDescription('Non rejoignable, seul le nom change')
                    .setValue('voice')
                    .setEmoji('🔊'),
                new StringSelectMenuOptionBuilder()
                    .setLabel('Salon texte')
                    .setDescription('Le nom du salon texte affiche le compteur')
                    .setValue('text')
                    .setEmoji('💬'),
            );

        const kindMessage = await typeStep.interaction.followUp({
            embeds: [
                new EmbedBuilder()
                    .setTitle('➕ Nouveau compteur — Étape 2/3')
                    .setDescription(
                        `Type choisi : **${typeLabel(type)}**\nChoisis maintenant le **type de salon** à créer.`,
                    )
                    .setColor(getColor('info')),
            ],
            components: [new ActionRowBuilder().addComponents(kindSelect), buildCancelRow(flowId)],
            flags: MessageFlags.Ephemeral,
        });

        const kindStep = await waitForStep({
            channel: rootInteraction.channel,
            message: kindMessage,
            componentType: ComponentType.StringSelect,
            customId: `ss_new_kind_${flowId}`,
            cancelId,
            userId: btnInteraction.user.id,
        });

        if (!kindStep || kindStep.kind === 'cancel') {
            await stopStep(kindStep, 2, btnInteraction);
            return;
        }

        const kind = kindStep.interaction.values[0];
        await kindStep.interaction.deferUpdate().catch(() => {});

        const categories = guild.channels.cache.filter(
            channel => channel.type === ChannelType.GuildCategory && channel.viewable !== false,
        );

        let category = null;
        let categoryStep = null;
        let lastInteraction = kindStep.interaction;

        if (categories.size > 0) {
            const categorySelect = new ChannelSelectMenuBuilder()
                .setCustomId(`ss_new_category_${flowId}`)
                .setPlaceholder('Choisis la catégorie du salon...')
                .addChannelTypes(ChannelType.GuildCategory)
                .setMaxValues(1);

            const categoryMessage = await kindStep.interaction.followUp({
                embeds: [
                    new EmbedBuilder()
                        .setTitle('➕ Nouveau compteur — Étape 3/3')
                        .setDescription('Choisis la **catégorie** où le salon du compteur sera créé.')
                        .setColor(getColor('info')),
                ],
                components: [new ActionRowBuilder().addComponents(categorySelect), buildCancelRow(flowId)],
                flags: MessageFlags.Ephemeral,
            });

            categoryStep = await waitForStep({
                channel: rootInteraction.channel,
                message: categoryMessage,
                componentType: ComponentType.ChannelSelect,
                customId: `ss_new_category_${flowId}`,
                cancelId,
                userId: btnInteraction.user.id,
            });

            if (!categoryStep || categoryStep.kind === 'cancel') {
                await stopStep(categoryStep, 3, btnInteraction);
                return;
            }

            lastInteraction = categoryStep.interaction;
            await categoryStep.interaction.deferUpdate().catch(() => {});
            category = categoryStep.interaction.channels.first() || null;
        }

        const targetChannelType = kind === 'voice' ? ChannelType.GuildVoice : ChannelType.GuildText;

        const channel = await guild.channels.create({
            name: `${getCounterEmoji(type)}・${getCounterBaseName(type)}`,
            type: targetChannelType,
            ...(category ? { parent: category.id } : {}),
            reason: `Salon de compteur créé par ${btnInteraction.user.tag}`,
        });

        if (targetChannelType === ChannelType.GuildVoice) {
            await channel.permissionOverwrites
                .edit(guild.id, { ViewChannel: true, Connect: false, Speak: null, Stream: null })
                .catch(error => logger.debug('Could not lock voice counter channel:', error.message));
        }

        const newCounter = {
            id: Date.now().toString(),
            type,
            channelId: channel.id,
            guildId: guild.id,
            createdAt: new Date().toISOString(),
            enabled: true,
        };

        const saved = await saveServerCounters(client, guild.id, [...counters, newCounter]);
        if (!saved) {
            await channel.delete('Échec de l\'enregistrement du compteur').catch(() => null);
            await InteractionHelper.sendErrorNotice(lastInteraction, 'Échec de l\'enregistrement du compteur. Réessaie.').catch(() => null);
            return;
        }

        const updated = await updateCounter(client, guild, newCounter);
        const finalChannel = guild.channels.cache.get(channel.id) || channel;

        await lastInteraction.followUp({
            embeds: [
                successEmbed(
                    `**Type :** ${typeLabel(type)}\n**Catégorie :** ${category || '_racine du serveur_'}\n**Salon :** ${finalChannel}\n**Nom actuel :** ${finalChannel.name}${updated ? '' : '\n\n⚠️ Le nom sera corrigé au prochain passage automatique.'}`,
                    '✅ Compteur créé',
                ),
            ],
            flags: MessageFlags.Ephemeral,
        });

        await refreshDashboard(rootInteraction, client);
    } finally {
        activeCreateFlows.delete(guild.id);
    }
}

async function handleCounterSelection(selectInteraction, rootInteraction, client) {
    const guild = selectInteraction.guild;
    const counters = await getServerCounters(client, guild.id);
    const counter = counters.find(item => item.id === selectInteraction.values[0]);

    await selectInteraction.deferUpdate().catch(() => {});

    if (!counter) {
        await InteractionHelper.sendErrorNotice(selectInteraction, 'Ce compteur n\'existe plus.').catch(() => null);
        return;
    }

    const channel = await resolveCounterChannel(guild, counter.channelId);
    const stats = await getGuildCounterStats(guild);
    const count = await getCounterCount(guild, counter.type, stats);
    const enabled = counter.enabled !== false;

    const promptMessage = await selectInteraction.followUp({
        embeds: [
            new EmbedBuilder()
                .setTitle(`${getCounterEmoji(counter.type)} ${typeLabel(counter.type)}`)
                .setDescription(
                    `**Type :** ${typeLabel(counter.type)}\n**Valeur actuelle :** \`${formatCount(count)}\`\n**Statut :** ${enabled ? '✅ Actif' : '⏸️ Désactivé'}`,
                )
                .addFields({
                    name: 'Salon',
                    value: channel ? `<#${channel.id}>\n\`${channel.name}\`` : '`Salon introuvable ou supprimé`',
                    inline: false,
                })
                .setColor(getColor('info')),
        ],
        components: [
            new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId(`ss_dash_item_refresh:${counter.id}`)
                    .setLabel('Renommer')
                    .setEmoji('🔄')
                    .setStyle(ButtonStyle.Primary),
                new ButtonBuilder()
                    .setCustomId(`ss_dash_item_toggle:${counter.id}`)
                    .setLabel(enabled ? 'Désactiver' : 'Activer')
                    .setEmoji(enabled ? '⏸️' : '▶️')
                    .setStyle(ButtonStyle.Secondary),
                new ButtonBuilder()
                    .setCustomId(`ss_dash_item_delete:${counter.id}`)
                    .setLabel('Supprimer')
                    .setEmoji('🗑️')
                    .setStyle(ButtonStyle.Danger),
                new ButtonBuilder()
                    .setCustomId('ss_dash_item_close')
                    .setLabel('Fermer')
                    .setEmoji('❌')
                    .setStyle(ButtonStyle.Secondary),
            ),
        ],
        flags: MessageFlags.Ephemeral,
    });

    const expectedIds = [
        `ss_dash_item_refresh:${counter.id}`,
        `ss_dash_item_toggle:${counter.id}`,
        `ss_dash_item_delete:${counter.id}`,
        'ss_dash_item_close',
    ];

    const itemCollector = rootInteraction.channel.createMessageComponentCollector({
        componentType: ComponentType.Button,
        filter: i =>
            i.user.id === selectInteraction.user.id &&
            i.message?.id === promptMessage.id &&
            expectedIds.includes(i.customId),
        time: STEP_TIMEOUT_MS,
    });

    itemCollector.on('collect', async itemInteraction => {
        await itemInteraction.deferUpdate().catch(() => {});
        itemCollector.stop();

        if (itemInteraction.customId === 'ss_dash_item_close') {
            return;
        }

        if (!itemInteraction.memberPermissions?.has(PermissionFlagsBits.ManageChannels)) {
            await InteractionHelper.sendErrorNotice(itemInteraction, 'Tu as besoin de la permission **Gérer les salons** pour gérer ce compteur.').catch(() => null);
            return;
        }

        if (itemInteraction.customId === `ss_dash_item_refresh:${counter.id}`) {
            const stats = await getGuildCounterStats(guild);
            const refreshed = await updateCounter(client, guild, counter, stats);
            const updatedChannel = await resolveCounterChannel(guild, counter.channelId);
            await itemInteraction.followUp({
                embeds: [refreshed
                    ? successEmbed(`\`${formatCount(await getCounterCount(guild, counter.type, stats))}\`\n**Salon :** ${updatedChannel || 'introuvable'}${updatedChannel ? `\n**Nom :** ${updatedChannel.name}` : ''}`, '🔄 Compteur actualisé')
                    : warningEmbed('Impossible de modifier le nom du salon. Vérifie que je peux renommer ce salon.', '⚠️ Échec')],
                flags: MessageFlags.Ephemeral,
            });
        }

        if (itemInteraction.customId === `ss_dash_item_toggle:${counter.id}`) {
            const freshCounters = await getServerCounters(client, guild.id);
            const target = freshCounters.find(item => item.id === counter.id);
            if (!target) {
                await InteractionHelper.sendErrorNotice(itemInteraction, 'Ce compteur n\'existe plus.').catch(() => null);
                return;
            }
            target.enabled = target.enabled === false;
            const saved = await saveServerCounters(client, guild.id, freshCounters);
            if (!saved) {
                await InteractionHelper.sendErrorNotice(itemInteraction, 'Échec de l\'enregistrement. Réessaie.').catch(() => null);
                return;
            }
            if (target.enabled) {
                await updateCounter(client, guild, target, await getGuildCounterStats(guild));
            }
            await itemInteraction.followUp({
                embeds: [successEmbed(`Le compteur **${typeLabel(target.type)}** est désormais **${target.enabled ? 'actif' : 'désactivé'}**.`, target.enabled ? '▶️ Compteur activé' : '⏸️ Compteur désactivé')],
                flags: MessageFlags.Ephemeral,
            });
        }

        if (itemInteraction.customId === `ss_dash_item_delete:${counter.id}`) {
            const result = await performDeletionByCounterId(client, guild, counter.id);
            await itemInteraction.followUp({
                embeds: [result.success ? successEmbed(result.message, '🗑️ Compteur supprimé') : warningEmbed(result.message, '⚠️ Échec')],
                flags: MessageFlags.Ephemeral,
            });
        }

        await refreshDashboard(rootInteraction, client);
    });
}
