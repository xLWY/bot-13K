import {
    SlashCommandBuilder,
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    StringSelectMenuBuilder,
    StringSelectMenuOptionBuilder,
    ComponentType,
    MessageFlags,
} from 'discord.js';
import { getColor } from '../config/bot.js';
import { InteractionHelper } from '../utils/interactionHelper.js';
import { logger } from '../utils/logger.js';

const PER_PAGE = 8;
const SESSION_MS = 600_000;

function collectCategories(client) {
    const groups = new Map();

    for (const command of client.commands.values()) {
        if (!command?.data?.name) continue;
        if (command.hiddenFromSlash) continue;

        const category = command.category || 'Divers';
        if (!groups.has(category)) groups.set(category, []);
        groups.get(category).push(command);
    }

    return [...groups.entries()]
        .map(([name, commands]) => [
            name,
            commands.sort((a, b) => a.data.name.localeCompare(b.data.name)),
        ])
        .sort((a, b) => a[0].localeCompare(b[0]));
}

function getSubcommandNames(command) {
    const json = typeof command.data?.toJSON === 'function' ? command.data.toJSON() : command.data;
    const names = [];

    for (const option of json?.options || []) {
        if (option.type === 1 && Array.isArray(option.options)) {
            names.push(...option.options.map(o => o.name));
        } else if (option.type === 1) {
            names.push(option.name);
        }
    }

    return names;
}

function cleanDescription(command) {
    const raw = command.data?.description || 'Aucune description.';
    return raw.replace(/^\*\s*/, '').trim();
}

function buildOverview(categories, total) {
    const lines = categories.map(([name, commands]) => {
        const bullet = '\u{2022}';
        return `${bullet} **${name}** \u{2014} \`${commands.length}\` commande(s)`;
    });

    return new EmbedBuilder()
        .setTitle('\u{1F4D6} Commandes du bot')
        .setDescription(
            `${total} commandes reparties en ${categories.length} categories.\n` +
            'Choisis une categorie ci-dessous, ou navigue avec les fleches.\n\n' +
            lines.join('\n'),
        )
        .setColor(getColor('primary'))
        .setFooter({ text: 'Utilise /help ou !help dans n importe quel salon.' })
        .setTimestamp();
}

function buildCategoryPage(categoryName, commands, pageIndex, pageCount) {
    const slice = commands.slice(pageIndex * PER_PAGE, (pageIndex + 1) * PER_PAGE);

    const body = slice.map(command => {
        const subs = getSubcommandNames(command);
        const suffix = subs.length ? ` \u{203A} \`${subs.join('`, `')}\`` : '';
        return `\`/${command.data.name}\`${suffix}\n${cleanDescription(command)}`;
    }).join('\n\n');

    const embed = new EmbedBuilder()
        .setTitle(`\u{1F4D6} ${categoryName}`)
        .setDescription(body)
        .setColor(getColor('info'))
        .setFooter({
            text: `Page ${pageIndex + 1}/${pageCount} \u{2022} ${commands.length} commande(s) \u{2022} ${slice.length} affichee(s)`,
        })
        .setTimestamp();

    return embed;
}

function buildOverviewRows(categories) {
    const menu = new StringSelectMenuBuilder()
        .setCustomId('help_category')
        .setPlaceholder('Aller directement a une categorie...')
        .addOptions(
            categories.slice(0, 25).map(([name, commands]) =>
                new StringSelectMenuOptionBuilder({
                    label: name,
                    value: name,
                    description: `${commands.length} commande(s)`,
                }),
            ),
        );

    return [
        new ActionRowBuilder().addComponents(menu),
    ];
}

function buildNavRows(pageIndex, pageCount, categories, canPrev, canNext) {
    const menu = new StringSelectMenuBuilder()
        .setCustomId('help_category')
        .setPlaceholder('Aller directement a une categorie...')
        .addOptions(
            categories.slice(0, 25).map(([name, commands]) =>
                new StringSelectMenuOptionBuilder({
                    label: name,
                    value: name,
                    description: `${commands.length} commande(s)`,
                }),
            ),
        );

    const buttons = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('help_prev').setLabel('Precedent').setEmoji('\u{2B05}\u{FE0F}').setStyle(ButtonStyle.Secondary).setDisabled(!canPrev),
        new ButtonBuilder().setCustomId('help_next').setLabel('Suivant').setEmoji('\u{27A1}\u{FE0F}').setStyle(ButtonStyle.Secondary).setDisabled(!canNext),
        new ButtonBuilder().setCustomId('help_overview').setLabel('Overview').setEmoji('\u{1F5C2}\u{FE0F}').setStyle(ButtonStyle.Primary),
    );

    return [buttons, new ActionRowBuilder().addComponents(menu)];
}

async function resolveChannel(interaction) {
    const channel = interaction.channel;
    if (!channel) return null;
    if (!channel.partial && typeof channel.createMessageComponentCollector === 'function') return channel;
    try {
        const fetched = await interaction.client.channels.fetch(channel.id);
        return fetched && typeof fetched.createMessageComponentCollector === 'function' ? fetched : null;
    } catch {
        return null;
    }
}

async function renderHelp(interaction, client, state) {
    const categories = collectCategories(client);
    const total = categories.reduce((sum, [, commands]) => sum + commands.length, 0);

    const payload = state.categoryIndex === null
        ? { embeds: [buildOverview(categories, total)], components: buildOverviewRows(categories) }
        : (() => {
            const [name, commands] = categories[state.categoryIndex];
            const pageCount = Math.max(1, Math.ceil(commands.length / PER_PAGE));
            const pageIndex = Math.min(state.page, pageCount - 1);
            return {
                embeds: [buildCategoryPage(name, commands, pageIndex, pageCount)],
                components: buildNavRows(pageIndex, pageCount, categories, pageIndex > 0, pageIndex < pageCount - 1),
            };
        })();

    return payload;
}

async function startCollector(interaction, client) {
    const channel = await resolveChannel(interaction);
    if (!channel) return;

    const state = { categoryIndex: null, page: 0 };
    let lastInteraction = null;

    const collector = channel.createMessageComponentCollector({
        componentType: [ComponentType.Button, ComponentType.StringSelect],
        filter: i => i.user.id === interaction.user.id,
        time: SESSION_MS,
    });

    collector.on('collect', async i => {
        lastInteraction = i;
        InteractionHelper.armDashboardSession(i);
        try {
            if (i.isStringSelectMenu()) {
                const name = i.values[0];
                const index = collectCategories(client).findIndex(([categoryName]) => categoryName === name);
                state.categoryIndex = index >= 0 ? index : null;
                state.page = 0;
            } else if (i.customId === 'help_next') {
                state.page += 1;
            } else if (i.customId === 'help_prev') {
                state.page = Math.max(0, state.page - 1);
            } else if (i.customId === 'help_overview') {
                state.categoryIndex = null;
                state.page = 0;
            }

            await i.deferUpdate();
            const payload = await renderHelp(i, client, state);
            await i.editReply(payload);
        } catch (error) {
            logger.error('Error in help navigation:', error);
        }
    });

    collector.on('end', async () => {
        if (!lastInteraction) return;
        try {
            await lastInteraction.editReply({ components: [] });
        } catch {
            // message already gone or no longer editable
        }
    });
}

export default {
    data: new SlashCommandBuilder()
        .setName('help')
        .setDescription('* Liste toutes les commandes du bot')
        .setDMPermission(true),

    category: 'Utilitaire',

    async execute(interaction, config, client) {
        try {
            await InteractionHelper.safeDefer(interaction, { flags: MessageFlags.Ephemeral });

            const categories = collectCategories(client);
            const total = categories.reduce((sum, [, commands]) => sum + commands.length, 0);

            await InteractionHelper.safeEditReply(interaction, {
                embeds: [buildOverview(categories, total)],
                components: buildOverviewRows(categories),
                flags: MessageFlags.Ephemeral,
            });

            await startCollector(interaction, client);
        } catch (error) {
            logger.error('Error in /help:', error);
            await InteractionHelper.sendErrorNotice(interaction, 'Impossible d afficher la liste des commandes.').catch(() => {});
        }
    },
};
