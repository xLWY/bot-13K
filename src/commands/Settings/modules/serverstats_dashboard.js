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

const MAX_LISTED_COUNTERS = 10;
const MAX_SELECT_OPTIONS = 25;

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
            const channel = guild.channels.cache.get(counter.channelId);
            const count = await getCounterCount(guild, counter.type, stats);
            fields.push({
                name: truncate(`${getCounterEmoji(counter.type)} ${getCounterBaseName(counter.type)}`, 256),
                value: `${channel ? `<#${channel.id}>` : '`Salon introuvable`'}\n\`${formatCount(count)}\` • ${counter.enabled === false ? '⏸️ Désactivé' : '✅ Actif'}`,
                inline: true,
            });
        }
        if (counters.length > MAX_LISTED_COUNTERS) {
            fields.push({
                name: '➕ Autres',
                value: `\`${counters.length - MAX_LISTED_COUNTERS}\` autre(s) compteur(s)`,
                inline: true,
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
        .setFooter({ text: 'Le tableau de bord se ferme après 10 minutes d\'inactivité' })
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

function buildSelectRow(guild, counters) {
    if (counters.length === 0) {
        return null;
    }

    const select = new StringSelectMenuBuilder()
        .setCustomId('ss_dash_select')
        .setPlaceholder('Gère un compteur...');

    for (const counter of counters.slice(0, MAX_SELECT_OPTIONS)) {
        const channel = guild.channels.cache.get(counter.channelId);
        select.addOptions(
            new StringSelectMenuOptionBuilder()
                .setLabel(truncate(`${getCounterEmoji(counter.type)} ${getCounterBaseName(counter.type)}`, 100))
                .setDescription(truncate(channel ? `Salon : ${channel.name}` : 'Salon introuvable', 100))
                .setValue(counter.id),
        );
    }

    return new ActionRowBuilder().addComponents(select);
}

function buildComponents(guild, counters) {
    const rows = [buildButtonRow()];
    const selectRow = buildSelectRow(guild, counters);
    if (selectRow) {
        rows.push(selectRow);
    }
    return rows;
}

async function refreshDashboard(rootInteraction, client) {
    try {
        const counters = await getServerCounters(client, rootInteraction.guild.id);
        const stats = await getGuildCounterStats(rootInteraction.guild);
        await InteractionHelper.safeEditReply(rootInteraction, {
            embeds: [await buildDashboardEmbed(rootInteraction.guild, counters, stats)],
            components: buildComponents(rootInteraction.guild, counters),
            flags: MessageFlags.Ephemeral,
        });
    } catch (error) {
        logger.debug('Could not refresh serverstats dashboard:', error.message);
    }
}

function waitForSelect(channel, customId, userId, timeout) {
    return new Promise((resolve) => {
        const collector = channel.createMessageComponentCollector({
            componentType: ComponentType.StringSelect,
            filter: i => i.user.id === userId && i.customId === customId,
            time: timeout,
            max: 1,
        });

        collector.once('collect', interaction => {
            collector.stop();
            resolve(interaction);
        });

        collector.once('end', () => resolve(null));
    });
}

function waitForChannelSelect(channel, customId, userId, timeout) {
    return new Promise((resolve) => {
        const collector = channel.createMessageComponentCollector({
            componentType: ComponentType.ChannelSelect,
            filter: i => i.user.id === userId && i.customId === customId,
            time: timeout,
            max: 1,
        });

        collector.once('collect', interaction => {
            collector.stop();
            resolve(interaction);
        });

        collector.once('end', () => resolve(null));
    });
}

export default {
    async execute(interaction, config, client, onBack) {
        try {
            const guildId = interaction.guild.id;
            const counters = await getServerCounters(client, guildId);
            const stats = await getGuildCounterStats(interaction.guild);

            await InteractionHelper.safeDefer(interaction, { flags: MessageFlags.Ephemeral });

            await InteractionHelper.safeEditReply(interaction, {
                embeds: [await buildDashboardEmbed(interaction.guild, counters, stats)],
                components: buildComponents(interaction.guild, counters),
                flags: MessageFlags.Ephemeral,
            });

            const buttonCollector = interaction.channel.createMessageComponentCollector({
                componentType: ComponentType.Button,
                filter: i =>
                    i.user.id === interaction.user.id &&
                    ['ss_dash_create', 'ss_dash_refresh', 'ss_dash_back'].includes(i.customId),
                time: 600_000,
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
                time: 600_000,
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
        if (!guild.channels.cache.get(counter.channelId)) {
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

    if (!btnInteraction.memberPermissions?.has(PermissionFlagsBits.ManageChannels)) {
        await btnInteraction.deferUpdate().catch(() => {});
        await InteractionHelper.sendErrorNotice(btnInteraction, 'Tu as besoin de la permission **Gérer les salons** pour créer un compteur.').catch(() => {});
        return;
    }

    const counters = await getServerCounters(client, guild.id);
    const availableTypes = Object.keys(TYPE_LABELS).filter(type => !counters.some(counter => counter.type === type));

    if (availableTypes.length === 0) {
        await btnInteraction.deferUpdate().catch(() => {});
        await InteractionHelper.sendErrorNotice(btnInteraction, 'Tous les types de compteurs existent déjà. Supprime-en un avant d\'en créer un autre.').catch(() => {});
        return;
    }

    await btnInteraction.deferUpdate().catch(() => {});

    const typeSelect = new StringSelectMenuBuilder()
        .setCustomId('ss_dash_new_type')
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

    await btnInteraction.followUp({
        embeds: [
            new EmbedBuilder()
                .setTitle('➕ Nouveau compteur')
                .setDescription('**Étape 1/3** — Choisis le type de compteur à créer.')
                .setColor(getColor('info')),
        ],
        components: [new ActionRowBuilder().addComponents(typeSelect)],
        flags: MessageFlags.Ephemeral,
    });

    const typeInteraction = await waitForSelect(rootInteraction.channel, 'ss_dash_new_type', btnInteraction.user.id, 120_000);
    if (!typeInteraction) {
        await InteractionHelper.sendErrorNotice(btnInteraction, 'Aucune sélection. Le compteur n\'a pas été créé.').catch(() => {});
        return;
    }

    const type = typeInteraction.values[0];
    await typeInteraction.deferUpdate().catch(() => {});

    const kindSelect = new StringSelectMenuBuilder()
        .setCustomId('ss_dash_new_kind')
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

    await typeInteraction.followUp({
        embeds: [
            new EmbedBuilder()
                .setTitle('➕ Nouveau compteur')
                .setDescription(`**Étape 2/3** — Type choisi : **${typeLabel(type)}**.\nChoisis maintenant le type de salon à créer.`)
                .setColor(getColor('info')),
        ],
        components: [new ActionRowBuilder().addComponents(kindSelect)],
        flags: MessageFlags.Ephemeral,
    });

    const kindInteraction = await waitForSelect(rootInteraction.channel, 'ss_dash_new_kind', btnInteraction.user.id, 120_000);
    if (!kindInteraction) {
        await InteractionHelper.sendErrorNotice(btnInteraction, 'Aucune sélection. Le compteur n\'a pas été créé.').catch(() => {});
        return;
    }

    const kind = kindInteraction.values[0];
    await kindInteraction.deferUpdate().catch(() => {});

    const categorySelect = new ChannelSelectMenuBuilder()
        .setCustomId('ss_dash_new_category')
        .setPlaceholder('Choisis la catégorie du salon...')
        .addChannelTypes(ChannelType.GuildCategory)
        .setMaxValues(1);

    await kindInteraction.followUp({
        embeds: [
            new EmbedBuilder()
                .setTitle('➕ Nouveau compteur')
                .setDescription('**Étape 3/3** — Choisis la catégorie où le salon du compteur sera créé.')
                .setColor(getColor('info')),
        ],
        components: [new ActionRowBuilder().addComponents(categorySelect)],
        flags: MessageFlags.Ephemeral,
    });

    const categoryInteraction = await waitForChannelSelect(rootInteraction.channel, 'ss_dash_new_category', btnInteraction.user.id, 120_000);
    if (!categoryInteraction) {
        await InteractionHelper.sendErrorNotice(btnInteraction, 'Aucune sélection. Le compteur n\'a pas été créé.').catch(() => {});
        return;
    }

    const category = categoryInteraction.channels.first();
    await categoryInteraction.deferUpdate().catch(() => {});

    if (!category || category.type !== ChannelType.GuildCategory) {
        await InteractionHelper.sendErrorNotice(categoryInteraction, 'Choisis une catégorie valide.').catch(() => {});
        return;
    }

    const targetChannelType = kind === 'voice' ? ChannelType.GuildVoice : ChannelType.GuildText;

    const channel = await guild.channels.create({
        name: `${getCounterEmoji(type)}・${getCounterBaseName(type)}`,
        type: targetChannelType,
        parent: category.id,
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
        await InteractionHelper.sendErrorNotice(categoryInteraction, 'Échec de l\'enregistrement du compteur. Réessaie.').catch(() => {});
        return;
    }

    const updated = await updateCounter(client, guild, newCounter);
    const finalChannel = guild.channels.cache.get(channel.id) || channel;

    await categoryInteraction.followUp({
        embeds: [
            successEmbed(
                `**Type :** ${typeLabel(type)}\n**Catégorie :** ${category}\n**Salon :** ${finalChannel}\n**Nom actuel :** ${finalChannel.name}${updated ? '' : '\n\n⚠️ Le nom sera corrigé au prochain passage automatique.'}`,
                '✅ Compteur créé',
            ),
        ],
        flags: MessageFlags.Ephemeral,
    });

    await refreshDashboard(rootInteraction, client);
}

async function handleCounterSelection(selectInteraction, rootInteraction, client) {
    const guild = selectInteraction.guild;
    const counters = await getServerCounters(client, guild.id);
    const counter = counters.find(item => item.id === selectInteraction.values[0]);

    await selectInteraction.deferUpdate().catch(() => {});

    if (!counter) {
        await InteractionHelper.sendErrorNotice(selectInteraction, 'Ce compteur n\'existe plus.').catch(() => {});
        return;
    }

    const channel = guild.channels.cache.get(counter.channelId);
    const stats = await getGuildCounterStats(guild);
    const count = await getCounterCount(guild, counter.type, stats);
    const enabled = counter.enabled !== false;

    await selectInteraction.followUp({
        embeds: [
            new EmbedBuilder()
                .setTitle(`${getCounterEmoji(counter.type)} ${getCounterBaseName(counter.type)}`)
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
        filter: i => i.user.id === selectInteraction.user.id && expectedIds.includes(i.customId),
        time: 120_000,
    });

    itemCollector.on('collect', async itemInteraction => {
        await itemInteraction.deferUpdate().catch(() => {});
        itemCollector.stop();

        if (itemInteraction.customId === 'ss_dash_item_close') {
            return;
        }

        if (!itemInteraction.memberPermissions?.has(PermissionFlagsBits.ManageChannels)) {
            await InteractionHelper.sendErrorNotice(itemInteraction, 'Tu as besoin de la permission **Gérer les salons** pour gérer ce compteur.').catch(() => {});
            return;
        }

        if (itemInteraction.customId === `ss_dash_item_refresh:${counter.id}`) {
            const stats = await getGuildCounterStats(guild);
            const refreshed = await updateCounter(client, guild, counter, stats);
            const updatedChannel = guild.channels.cache.get(counter.channelId);
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
                await InteractionHelper.sendErrorNotice(itemInteraction, 'Ce compteur n\'existe plus.').catch(() => {});
                return;
            }
            target.enabled = target.enabled === false;
            const saved = await saveServerCounters(client, guild.id, freshCounters);
            if (!saved) {
                await InteractionHelper.sendErrorNotice(itemInteraction, 'Échec de l\'enregistrement. Réessaie.').catch(() => {});
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
