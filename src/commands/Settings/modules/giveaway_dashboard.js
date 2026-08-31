import { getColor } from '../../../config/bot.js';
import {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    ChannelSelectMenuBuilder,
    StringSelectMenuBuilder,
    StringSelectMenuOptionBuilder,
    ChannelType,
    MessageFlags,
    ComponentType,
    EmbedBuilder,
} from 'discord.js';
import { InteractionHelper } from '../../../utils/interactionHelper.js';
import { successEmbed, warningEmbed } from '../../../utils/embeds.js';
import { logger } from '../../../utils/logger.js';
import { TitanBotError, ErrorTypes } from '../../../utils/errorHandler.js';
import {
    getGuildGiveaways,
    saveGiveaway,
    deleteGiveaway,
    isGiveawayEnded,
    createGiveawayEmbed,
    giveawayButtons,
} from '../../../utils/giveaways.js';
import {
    parseDuration,
    validatePrize,
    validateWinnerCount,
    endGiveaway,
} from '../../../services/giveawayService.js';

function buildDashboardEmbed(giveaways, guild) {
    const active = giveaways.filter(g => !isGiveawayEnded(g));
    const ended = giveaways.filter(g => isGiveawayEnded(g));

    const activeList = active.length
        ? active.slice(0, 10).map(g => `🎁 **${g.prize || 'Concours'}** — <t:${Math.floor((g.endsAt || g.endTime) / 1000)}:R>`).join('\n')
        : '`Aucun concours actif`';

    return new EmbedBuilder()
        .setTitle('🎁 Tableau de bord des Giveaways')
        .setDescription(
            `Gère les concours de **${guild.name}**.\nUtilise les boutons ci-dessous pour créer, terminer ou supprimer un concours.`,
        )
        .setColor(getColor('info'))
        .addFields(
            { name: '🎉 Actifs', value: `\`${active.length}\``, inline: true },
            { name: '🏁 Terminés', value: `\`${ended.length}\``, inline: true },
            { name: '🕐 Actuellement en cours', value: activeList, inline: false },
        )
        .setFooter({ text: 'Le tableau de bord se ferme après 10 minutes d\'inactivité' })
        .setTimestamp();
}

function buildButtonRows() {
    const actionRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('gw_cfg_create')
            .setLabel('Créer un concours')
            .setEmoji('✨')
            .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
            .setCustomId('gw_cfg_end')
            .setLabel('Terminer')
            .setEmoji('🏁')
            .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId('gw_cfg_delete')
            .setLabel('Supprimer')
            .setEmoji('🗑️')
            .setStyle(ButtonStyle.Danger),
    );
    const backRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('gw_cfg_back')
            .setLabel('Retour au panel')
            .setEmoji('⬅️')
            .setStyle(ButtonStyle.Danger),
    );
    return [actionRow, backRow];
}

function buildGiveawaySelect(giveaways, label) {
    const options = giveaways.slice(0, 25).map(g => {
        const title = `${g.prize || 'Concours'} (${isGiveawayEnded(g) ? 'terminé' : 'actif'})`;
        return new StringSelectMenuOptionBuilder()
            .setLabel(title.length > 100 ? title.slice(0, 97) + '…' : title)
            .setValue(g.messageId);
    }).slice(0, 25);
    return new StringSelectMenuBuilder()
        .setCustomId(label.startsWith('end') ? 'gw_cfg_end_select' : 'gw_cfg_delete_select')
        .setPlaceholder('Sélectionne un concours...')
        .addOptions(options);
}

export default {
    async execute(interaction, config, client, onBack) {
        try {
            const guildId = interaction.guild.id;
            const giveaways = await getGuildGiveaways(client, guildId);

            await InteractionHelper.safeDefer(interaction, { flags: MessageFlags.Ephemeral });

            await InteractionHelper.safeEditReply(interaction, {
                embeds: [buildDashboardEmbed(giveaways, interaction.guild)],
                components: buildButtonRows(),
                flags: MessageFlags.Ephemeral,
            });

            const collector = interaction.channel.createMessageComponentCollector({
                componentType: ComponentType.Button,
                filter: i =>
                    i.user.id === interaction.user.id &&
                    ['gw_cfg_create', 'gw_cfg_end', 'gw_cfg_delete', 'gw_cfg_back'].includes(i.customId),
                time: 600_000,
            });

            collector.on('collect', async btnInteraction => {
                const id = btnInteraction.customId;
                try {
                    switch (id) {
                        case 'gw_cfg_create':
                            await handleCreate(btnInteraction, interaction, client, guildId);
                            break;
                        case 'gw_cfg_end':
                            await handleEnd(btnInteraction, interaction, client, guildId);
                            break;
                        case 'gw_cfg_delete':
                            await handleDelete(btnInteraction, interaction, client, guildId);
                            break;
                        case 'gw_cfg_back':
                            await btnInteraction.deferUpdate().catch(() => {});
                            if (typeof onBack === 'function') {
                                await onBack(btnInteraction);
                            }
                            break;
                    }
                } catch (error) {
                    logger.debug(`Giveaway dashboard action failed (${id}):`, error.message);
                    await InteractionHelper.sendErrorNotice(btnInteraction, 'Une erreur est survenue lors de cette action. Réessaie.').catch(() => {});
                }
            });
        } catch (error) {
            logger.error('Giveaway dashboard failed to open:', error);
            await InteractionHelper.sendErrorNotice(interaction, 'Impossible d\'ouvrir le tableau de bord des giveaways.').catch(() => {});
        }
    },
};

async function refreshDashboard(rootInteraction, client, guildId) {
    const giveaways = await getGuildGiveaways(client, guildId);
    await InteractionHelper.safeEditReply(rootInteraction, {
        embeds: [buildDashboardEmbed(giveaways, rootInteraction.guild)],
        components: buildButtonRows(),
        flags: MessageFlags.Ephemeral,
    });
}

async function handleCreate(btnInteraction, rootInteraction, client, guildId) {
    try {
        await btnInteraction.deferUpdate();
    } catch {
        return;
    }

    const channelSelect = new ChannelSelectMenuBuilder()
        .setCustomId('gw_cfg_create_channel')
        .setPlaceholder('Sélectionne le salon du concours...')
        .addChannelTypes(ChannelType.GuildText)
        .setMaxValues(1);

    await btnInteraction.followUp({
        embeds: [
            new EmbedBuilder()
                .setTitle('✨ Créer un concours')
                .setDescription('Étape 1/2 : choisis le salon où le concours sera posté.')
                .setColor(getColor('info')),
        ],
        components: [new ActionRowBuilder().addComponents(channelSelect)],
        flags: MessageFlags.Ephemeral,
    });

    const chanCollector = rootInteraction.channel.createMessageComponentCollector({
        componentType: ComponentType.ChannelSelect,
        filter: i => i.user.id === btnInteraction.user.id && i.customId === 'gw_cfg_create_channel',
        time: 60_000,
        max: 1,
    });

    chanCollector.on('collect', async chanInteraction => {
        try {
            await chanInteraction.deferUpdate();
            const channel = chanInteraction.channels.first();
            await openCreateModal(chanInteraction, rootInteraction, client, guildId, channel.id);
        } catch (error) {
            logger.debug('Giveaway channel select error:', error.message);
        }
    });
}

async function openCreateModal(selectInteraction, rootInteraction, client, guildId, channelId) {
    const modal = new ModalBuilder()
        .setCustomId('gw_cfg_create_modal')
        .setTitle('Créer un concours')
        .addComponents(
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('prize_input')
                    .setLabel('Lot à gagner')
                    .setStyle(TextInputStyle.Short)
                    .setMaxLength(256)
                    .setMinLength(1)
                    .setRequired(true),
            ),
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('duration_input')
                    .setLabel('Durée (ex : 1h, 30m, 5d)')
                    .setStyle(TextInputStyle.Short)
                    .setMaxLength(6)
                    .setMinLength(2)
                    .setRequired(true),
            ),
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('winners_input')
                    .setLabel('Nombre de gagnants (1-10)')
                    .setStyle(TextInputStyle.Short)
                    .setMaxLength(2)
                    .setMinLength(1)
                    .setRequired(true),
            ),
        );

    try {
        await selectInteraction.showModal(modal);
    } catch {
        return;
    }

    const submitted = await selectInteraction
        .awaitModalSubmit({
            filter: i => i.customId === 'gw_cfg_create_modal' && i.user.id === selectInteraction.user.id,
            time: 120_000,
        })
        .catch(() => null);

    if (!submitted) {
        return;
    }

    const prizeRaw = submitted.fields.getTextInputValue('prize_input');
    const durationRaw = submitted.fields.getTextInputValue('duration_input');
    const winnersRaw = submitted.fields.getTextInputValue('winners_input');

    try {
        const prize = validatePrize(prizeRaw);
        const durationMs = parseDuration(durationRaw);
        const winnerCount = parseInt(winnersRaw, 10);
        validateWinnerCount(winnerCount);

        const endTime = Date.now() + durationMs;
        const initialData = {
            messageId: 'placeholder',
            channelId,
            guildId,
            prize,
            hostId: submitted.user.id,
            endTime,
            endsAt: endTime,
            winnerCount,
            participants: [],
            isEnded: false,
            ended: false,
            createdAt: new Date().toISOString(),
        };

        const message = await guildChannel(client, guildId, channelId).send({
            embeds: [createGiveawayEmbed(initialData, 'active')],
            components: [giveawayButtons(false)],
        });

        initialData.messageId = message.id;
        await saveGiveaway(client, guildId, initialData);

        await submitted.reply({
            embeds: [successEmbed(`Le concours **${prize}** a été lancé dans <#${channelId}> !`, '🎁 Concours créé')],
            flags: MessageFlags.Ephemeral,
        });
    } catch (error) {
        logger.debug('Giveaway creation validation error:', error.message);
        await submitted.reply({
            embeds: [warningEmbed(
                error instanceof TitanBotError ? (error.userMessage || 'Données de concours invalides.') : 'Erreur lors de la création du concours.',
                '⚠️ Impossible de créer',
            )],
            flags: MessageFlags.Ephemeral,
        });
        return;
    }

    await refreshDashboard(rootInteraction, client, guildId);
}

function guildChannel(client, guildId, channelId) {
    const guild = client.guilds.cache.get(guildId);
    return guild?.channels.cache.get(channelId);
}

async function handleEnd(btnInteraction, rootInteraction, client, guildId) {
    try {
        await btnInteraction.deferUpdate();
    } catch {
        return;
    }

    const giveaways = await getGuildGiveaways(client, guildId);
    const active = giveaways.filter(g => !isGiveawayEnded(g));
    if (active.length === 0) {
        await InteractionHelper.sendErrorNotice(btnInteraction, 'Aucun concours actif à terminer.');
        return;
    }

    const select = buildGiveawaySelect(active, 'end');
    await btnInteraction.followUp({
        embeds: [
            new EmbedBuilder()
                .setTitle('🏁 Terminer un concours')
                .setDescription('Sélectionne le concours que tu veux terminer immédiatement.')
                .setColor(getColor('info')),
        ],
        components: [new ActionRowBuilder().addComponents(select)],
        flags: MessageFlags.Ephemeral,
    });

    const selCollector = rootInteraction.channel.createMessageComponentCollector({
        componentType: ComponentType.StringSelect,
        filter: i => i.user.id === btnInteraction.user.id && i.customId === 'gw_cfg_end_select',
        time: 60_000,
        max: 1,
    });

    selCollector.on('collect', async selInteraction => {
        try {
            await selInteraction.deferUpdate();
            const messageId = selInteraction.values[0];
            const giveaway = giveaways.find(g => g.messageId === messageId);
            if (!giveaway) {
                await InteractionHelper.sendErrorNotice(selInteraction, 'Ce concours n\'a pas été trouvé.');
                return;
            }

            const result = await endGiveaway(client, giveaway, guildId, selInteraction.user.id);
            giveaway.ended = true;
            giveaway.isEnded = true;
            giveaway.winnerIds = result.winners;
            giveaway.endedAt = new Date().toISOString();
            giveaway.participantCount = result.participantCount;
            await saveGiveaway(client, guildId, giveaway);

            const channel = guildChannel(client, guildId, giveaway.channelId);
            if (channel) {
                const msg = await channel.messages.fetch(messageId).catch(() => null);
                if (msg) {
                    await msg.edit({
                        embeds: [createGiveawayEmbed(giveaway, 'ended', result.winners)],
                        components: [giveawayButtons(true)],
                    });
                }
                if (result.winners.length > 0) {
                    await channel.send(`🎉 Félicitations ${result.winners.map(id => `<@${id}>`).join(', ')} ! Tu as gagné **${giveaway.prize}** !`);
                }
            }

            await selInteraction.followUp({
                embeds: [successEmbed(`Le concours **${giveaway.prize}** est terminé.`, '🏁 Concours terminé')],
                flags: MessageFlags.Ephemeral,
            });
        } catch (error) {
            logger.debug('Giveaway end error:', error.message);
            await InteractionHelper.sendErrorNotice(selInteraction, 'Impossible de terminer ce concours.');
        }
        await refreshDashboard(rootInteraction, client, guildId);
    });
}

async function handleDelete(btnInteraction, rootInteraction, client, guildId) {
    try {
        await btnInteraction.deferUpdate();
    } catch {
        return;
    }

    const giveaways = await getGuildGiveaways(client, guildId);
    if (giveaways.length === 0) {
        await InteractionHelper.sendErrorNotice(btnInteraction, 'Aucun concours à supprimer.');
        return;
    }

    const select = buildGiveawaySelect(giveaways, 'delete');
    await btnInteraction.followUp({
        embeds: [
            new EmbedBuilder()
                .setTitle('🗑️ Supprimer un concours')
                .setDescription('Sélectionne le concours à supprimer. Le message Discord associé sera aussi supprimé.')
                .setColor(getColor('warning')),
        ],
        components: [new ActionRowBuilder().addComponents(select)],
        flags: MessageFlags.Ephemeral,
    });

    const selCollector = rootInteraction.channel.createMessageComponentCollector({
        componentType: ComponentType.StringSelect,
        filter: i => i.user.id === btnInteraction.user.id && i.customId === 'gw_cfg_delete_select',
        time: 60_000,
        max: 1,
    });

    selCollector.on('collect', async selInteraction => {
        try {
            await selInteraction.deferUpdate();
            const messageId = selInteraction.values[0];
            const giveaway = giveaways.find(g => g.messageId === messageId);
            await deleteGiveaway(client, guildId, messageId);

            const channel = guildChannel(client, guildId, giveaway?.channelId);
            if (channel) {
                const msg = await channel.messages.fetch(messageId).catch(() => null);
                if (msg) {
                    await msg.delete().catch(() => {});
                }
            }

            await selInteraction.followUp({
                embeds: [successEmbed(`Le concours **${giveaway?.prize || ''}** a été supprimé.`, '🗑️ Concours supprimé')],
                flags: MessageFlags.Ephemeral,
            });
        } catch (error) {
            logger.debug('Giveaway delete error:', error.message);
            await InteractionHelper.sendErrorNotice(selInteraction, 'Impossible de supprimer ce concours.');
        }
        await refreshDashboard(rootInteraction, client, guildId);
    });
}
