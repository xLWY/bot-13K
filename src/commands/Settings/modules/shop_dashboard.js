import { getColor } from '../../../config/bot.js';
import {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    StringSelectMenuBuilder,
    StringSelectMenuOptionBuilder,
    MessageFlags,
    ComponentType,
    EmbedBuilder,
} from 'discord.js';
import { InteractionHelper } from '../../../utils/interactionHelper.js';
import { successEmbed, warningEmbed } from '../../../utils/embeds.js';
import { logger } from '../../../utils/logger.js';
import shopService from '../../../services/shopService.js';
import { getCurrentPrice, getItemById } from '../../../config/shop/index.js';
import { getEconomyData, formatShopItem } from '../../../utils/economy.js';

function buildShopEmbed(items, categoryName, balance, currencyName, page, categoriesForDisplay) {
    const itemLines = items.length
        ? items.map((item, idx) => formatShopItem(item, idx + 1)).join('\n')
        : '`Aucun article dans cette catégorie.`';

    const embed = new EmbedBuilder()
        .setTitle('🛒 Boutique')
        .setDescription(
            `Solde : **${balance.toLocaleString('fr-FR')} ${currencyName}**\nCatégorie : **${categoryName}**\n\nUtilise le menu ci-dessous pour choisir une catégorie, puis un article à acheter.`,
        )
        .setColor(0x5865F2)
        .setFooter({ text: `Page ${page}` })
        .setTimestamp();

    if (itemLines && items.length > 0) {
        embed.addFields({ name: '🛍️ Articles', value: itemLines, inline: false });
    } else {
        embed.setDescription(
            `Solde : **${balance.toLocaleString('fr-FR')} ${currencyName}**\nCatégorie : **${categoryName}**\n\n**Aucun article dans cette catégorie.**\n\nUtilise le menu ci-dessous pour choisir une catégorie.`,
        );
    }

    return embed;
}

function buildCategorySelect() {
    const categories = shopService.getCategories();
    return new StringSelectMenuBuilder()
        .setCustomId('shop_cfg_category')
        .setPlaceholder('Choisis une catégorie...')
        .addOptions(
            categories.map(c =>
                new StringSelectMenuOptionBuilder()
                    .setLabel(c.name)
                    .setValue(c.id)
                    .setEmoji(c.emoji || c.icon || '🛍️'),
            ),
        );
}

function buildItemSelect(items) {
    if (!items.length) return null;
    const options = items.slice(0, 25).map(item =>
        new StringSelectMenuOptionBuilder()
            .setLabel(`${item.name} — ${getCurrentPrice(item.id).toLocaleString('fr-FR')}`)
            .setValue(item.id),
    );
    return new StringSelectMenuBuilder()
        .setCustomId('shop_cfg_item')
        .setPlaceholder('Choisis un article à acheter...')
        .addOptions(options);
}

function buildButtonRows() {
    const backRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('shop_cfg_back')
            .setLabel('Retour au panel')
            .setEmoji('⬅️')
            .setStyle(ButtonStyle.Danger),
    );
    return [backRow];
}

export default {
    async execute(interaction, config, client, onBack) {
        try {
            const guildId = interaction.guild.id;
            const userId = interaction.user.id;
            const currency = shopService.getCurrencyInfo();
            const economy = await getEconomyData(client, guildId, userId);

            await InteractionHelper.safeDefer(interaction, { flags: MessageFlags.Ephemeral });

            let currentCategory = 'all';
            let currentCategoryName = 'Tous les articles';
            let allItems = shopService.getItemsForCategory('all');

            const embed = buildShopEmbed(allItems, currentCategoryName, economy.wallet, currency.namePlural, 1, shopService.getCategories());
            const components = [
                new ActionRowBuilder().addComponents(buildCategorySelect()),
                ...(buildItemSelect(allItems) ? [new ActionRowBuilder().addComponents(buildItemSelect(allItems))] : []),
                ...buildButtonRows(),
            ];

            await InteractionHelper.safeEditReply(interaction, {
                embeds: [embed],
                components,
                flags: MessageFlags.Ephemeral,
            });

            const collector = interaction.channel.createMessageComponentCollector({
                componentType: ComponentType.Button,
                filter: i =>
                    i.user.id === interaction.user.id && i.customId === 'shop_cfg_back',
                time: 600_000,
            });

            collector.on('collect', async btnInteraction => {
                try {
                    await btnInteraction.deferUpdate().catch(() => {});
                    if (typeof onBack === 'function') {
                        await onBack(btnInteraction);
                    }
                } catch (error) {
                    logger.debug('Shop back button error:', error.message);
                }
            });

            const catCollector = interaction.channel.createMessageComponentCollector({
                componentType: ComponentType.StringSelect,
                filter: i => i.user.id === interaction.user.id && i.customId === 'shop_cfg_category',
                time: 600_000,
            });

            catCollector.on('collect', async selectInteraction => {
                try {
                    await selectInteraction.deferUpdate();
                    const catId = selectInteraction.values[0];
                    const cats = shopService.getCategories();
                    const cat = cats.find(c => c.id === catId);
                    currentCategory = catId;
                    currentCategoryName = cat ? cat.name : 'Tous les articles';
                    allItems = shopService.getItemsForCategory(catId);

                    const newEmbed = buildShopEmbed(allItems, currentCategoryName, economy.wallet, currency.namePlural, 1, cats);
                    const newComponents = [
                        new ActionRowBuilder().addComponents(buildCategorySelect()),
                        ...(buildItemSelect(allItems) ? [new ActionRowBuilder().addComponents(buildItemSelect(allItems))] : []),
                        ...buildButtonRows(),
                    ];
                    await interaction.editReply({
                        embeds: [newEmbed],
                        components: newComponents,
                    }).catch(() => {});
                } catch (error) {
                    logger.debug('Shop category select error:', error.message);
                    await InteractionHelper.sendErrorNotice(selectInteraction, 'Impossible de charger cette catégorie.').catch(() => {});
                }
            });

            const itemCollector = interaction.channel.createMessageComponentCollector({
                componentType: ComponentType.StringSelect,
                filter: i => i.user.id === interaction.user.id && i.customId === 'shop_cfg_item',
                time: 600_000,
            });

            itemCollector.on('collect', async selectInteraction => {
                try {
                    await selectInteraction.deferUpdate();
                    const itemId = selectInteraction.values[0];
                    await handlePurchase(selectInteraction, interaction, client, guildId, userId, itemId);
                } catch (error) {
                    logger.debug('Shop purchase error:', error.message);
                    await InteractionHelper.sendErrorNotice(selectInteraction, 'Impossible d\'effectuer cet achat.').catch(() => {});
                }
            });
        } catch (error) {
            logger.error('Shop dashboard failed to open:', error);
            await InteractionHelper.sendErrorNotice(interaction, 'Impossible d\'ouvrir la boutique.').catch(() => {});
        }
    },
};

async function handlePurchase(selectInteraction, rootInteraction, client, guildId, userId, itemId) {
    const item = getItemById(itemId);
    if (!item) {
        await InteractionHelper.sendErrorNotice(selectInteraction, 'Article introuvable.');
        return;
    }

    const confirmRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('shop_cfg_confirm')
            .setLabel('Confirmer l\'achat')
            .setEmoji('✅')
            .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
            .setCustomId('shop_cfg_cancel')
            .setLabel('Annuler')
            .setEmoji('❌')
            .setStyle(ButtonStyle.Secondary),
    );

    const currency = shopService.getCurrencyInfo();
    const price = getCurrentPrice(itemId).toLocaleString('fr-FR');

    await selectInteraction.followUp({
        embeds: [
            new EmbedBuilder()
                .setTitle(`🛒 ${item.name}`)
                .setDescription(
                    `${item.description || 'Aucune description.'}\n\n**Prix :** ${price} ${currency.namePlural}\n**Type :** ${item.type}`,
                )
                .setColor(getColor('info')),
        ],
        components: [confirmRow],
        flags: MessageFlags.Ephemeral,
    });

    const confirmCollector = rootInteraction.channel.createMessageComponentCollector({
        componentType: ComponentType.Button,
        filter: i =>
            i.user.id === selectInteraction.user.id &&
            ['shop_cfg_confirm', 'shop_cfg_cancel'].includes(i.customId),
        time: 30_000,
        max: 1,
    });

    confirmCollector.on('collect', async btnInteraction => {
        try {
            await btnInteraction.deferUpdate();
            if (btnInteraction.customId === 'shop_cfg_cancel') {
                await btnInteraction.followUp({
                    embeds: [warningEmbed('Achat annulé.', '❌ Annulé')],
                    flags: MessageFlags.Ephemeral,
                });
                return;
            }

            const result = await shopService.purchaseItem(userId, itemId, 1, { guildId, client });
            if (result.success) {
                await btnInteraction.followUp({
                    embeds: [successEmbed(result.message, '🛒 Achat réussi')],
                    flags: MessageFlags.Ephemeral,
                });
            } else {
                await btnInteraction.followUp({
                    embeds: [warningEmbed(result.message, '❌ Achat refusé')],
                    flags: MessageFlags.Ephemeral,
                });
            }
        } catch (error) {
            logger.debug('Shop confirm error:', error.message);
            await InteractionHelper.sendErrorNotice(btnInteraction, 'Erreur lors de l\'achat.').catch(() => {});
        }
    });
}
