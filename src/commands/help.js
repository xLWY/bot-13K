import {
    SlashCommandBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    StringSelectMenuBuilder,
    StringSelectMenuOptionBuilder,
    ComponentType,
    MessageFlags,
    PermissionFlagsBits,
    PermissionsBitField,
} from 'discord.js';
import { InteractionHelper } from '../utils/interactionHelper.js';
import { logger } from '../utils/logger.js';
import { isBotOwner } from '../utils/ownerIds.js';
import { getCategoryLabel } from '../config/commandMeta.js';
import { createEmbed, errorEmbed, warningEmbed } from '../utils/embeds.js';
import { brandFooter, buildNavRow, buildPageJumpRow, formatNumber, progressBar } from '../ui/kit.js';

const PER_PAGE = 8;
const SESSION_MS = 600_000;
const CONTEXT = 'Aide';
const PREV_ID = 'help_prev';
const NEXT_ID = 'help_next';
const OVERVIEW_ID = 'help_overview';
const CATEGORY_ID = 'help_category';
const JUMP_ID = 'help_page_jump';
const INDICATOR_ID = 'help_page_indicator';
const activeHelpCollectors = new Map();

function truncate(value, max) {
    const text = String(value ?? '');
    return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function getCommandDefaultPermissions(command) {
    const json = typeof command.data?.toJSON === 'function' ? command.data.toJSON() : command.data;
    const raw = json?.default_member_permissions;

    if (raw === undefined || raw === null || raw === '') return null;

    try {
        return BigInt(raw);
    } catch {
        return null;
    }
}

function canUseCommand(interaction, command) {
    if (command.ownerOnly === true) {
        return isBotOwner(interaction.user?.id);
    }

    const required = getCommandDefaultPermissions(command);
    if (required === null) return true;
    if (isBotOwner(interaction.user?.id)) return true;

    const permissions = interaction.memberPermissions ?? new PermissionsBitField();
    if (!interaction.inGuild() && required !== 0n) return false;
    if (permissions.has(PermissionFlagsBits.Administrator)) return true;
    if (required === 0n) return false;

    return permissions.has(required);
}

function collectCategories(interaction, client) {
    const groups = new Map();

    for (const command of client.commands.values()) {
        if (!command?.data?.name) continue;
        if (command.hiddenFromSlash) continue;
        if (!canUseCommand(interaction, command)) continue;

        const category = getCategoryLabel(command.category);
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
        if (option.type === 1) {
            names.push(option.name);
        } else if (option.type === 2) {
            for (const subOption of option.options || []) {
                if (subOption.type === 1) {
                    names.push(`${option.name}/${subOption.name}`);
                }
            }
        }
    }

    return names;
}

function cleanDescription(command) {
    const raw = command.data?.description || 'Aucune description.';
    return raw.trim();
}

function buildOverview(categories, total) {
    if (categories.length === 0) {
        return warningEmbed(
            'Aucune commande n’est disponible avec tes permissions actuelles.',
            '⚠️ Aucune commande',
        ).setFooter(brandFooter(CONTEXT));
    }

    const lines = categories.map(([name, commands]) =>
        `• **${name}** — \`${formatNumber(commands.length)}\` commande(s)`,
    );

    return createEmbed({
        title: 'Commandes du bot',
        description: [
            `**${formatNumber(total)}** commandes dans **${formatNumber(categories.length)}** catégorie(s).`,
            'Choisis une catégorie dans le menu ci-dessous.',
        ].join('\n'),
        color: 'info',
        fields: [
            {
                name: 'Catégories',
                value: truncate(lines.join('\n'), 1000),
                inline: false,
            },
        ],
        footer: brandFooter(CONTEXT),
    });
}

function buildCategoryPage(categoryName, commands, pageIndex, pageCount) {
    const slice = commands.slice(pageIndex * PER_PAGE, (pageIndex + 1) * PER_PAGE);
    const lines = slice.map((command) => {
        const subs = getSubcommandNames(command);
        const commandLine = `\`/${command.data.name}\` — ${truncate(cleanDescription(command), 140)}`;
        if (subs.length === 0) return commandLine;

        const labels = subs.slice(0, 6).map((sub) => `\`${sub}\``).join(', ');
        return `${commandLine}\n  Sous-commandes : ${labels}${subs.length > 6 ? '…' : ''}`;
    });

    return createEmbed({
        title: categoryName,
        description: [
            `Page **${pageIndex + 1}/${pageCount}** ${progressBar(pageIndex + 1, pageCount, 10)}`,
            'Sélectionne une autre catégorie pour changer de rubrique.',
        ].join('\n'),
        color: 'info',
        fields: [
            {
                name: 'Commandes',
                value: truncate(lines.join('\n\n'), 1000) || 'Aucune commande dans cette catégorie.',
                inline: false,
            },
        ],
        footer: brandFooter(CONTEXT),
    });
}

function buildOverviewRows(categories) {
    if (categories.length === 0) return [];

    const menu = new StringSelectMenuBuilder()
        .setCustomId(CATEGORY_ID)
        .setPlaceholder('Aller à une catégorie…')
        .addOptions(
            categories.slice(0, 25).map(([name, commands]) =>
                new StringSelectMenuOptionBuilder({
                    label: name,
                    value: name,
                    description: `${formatNumber(commands.length)} commande(s)`,
                }),
            ),
        );

    return [new ActionRowBuilder().addComponents(menu)];
}

function buildCategoryNavRows(pageIndex, pageCount, categories) {
    const [navRow] = buildNavRow({
        page: pageIndex,
        pageCount,
        prevId: PREV_ID,
        nextId: NEXT_ID,
        indicatorId: INDICATOR_ID,
    });

    if (navRow) {
        navRow.addComponents(
            new ButtonBuilder()
                .setCustomId(OVERVIEW_ID)
                .setLabel('Vue d’ensemble')
                .setStyle(ButtonStyle.Primary),
        );
    }

    return [
        ...(navRow ? [navRow] : []),
        ...buildPageJumpRow({
            page: pageIndex,
            pageCount,
            customId: JUMP_ID,
            placeholder: 'Aller à une page…',
        }),
        ...buildOverviewRows(categories),
    ];
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

function renderHelp(interaction, client, state, categories = collectCategories(interaction, client)) {
    const total = categories.reduce((sum, [, commands]) => sum + commands.length, 0);
    const overview = () => ({
        embeds: [buildOverview(categories, total)],
        components: buildOverviewRows(categories),
        allowedMentions: { parse: [], repliedUser: false },
    });

    if (categories.length === 0 || state.categoryIndex === null) return overview();

    const entry = categories[state.categoryIndex];
    if (!entry) {
        state.categoryIndex = null;
        state.page = 0;
        return overview();
    }

    const [name, commands] = entry;
    const pageCount = Math.max(1, Math.ceil(commands.length / PER_PAGE));
    const pageIndex = Math.max(0, Math.min(state.page, pageCount - 1));
    state.page = pageIndex;

    return {
        embeds: [buildCategoryPage(name, commands, pageIndex, pageCount)],
        components: buildCategoryNavRows(pageIndex, pageCount, categories),
        allowedMentions: { parse: [], repliedUser: false },
    };
}

async function startCollector(interaction, client) {
    const reply = await interaction.fetchReply?.().catch(() => null);
    const target = reply && typeof reply.createMessageComponentCollector === 'function'
        ? reply
        : await resolveChannel(interaction);
    if (!target) return;

    // Un seul collecteur par utilisateur : évite que plusieurs /help se répondent.
    const key = `${interaction.guildId ?? 'dm'}:${interaction.user.id}`;
    activeHelpCollectors.get(key)?.stop('replaced');

    const state = { categoryIndex: null, page: 0 };
    let lastInteraction = null;

    const collector = target.createMessageComponentCollector({
        componentType: [ComponentType.Button, ComponentType.StringSelect],
        filter: i => i.user.id === interaction.user.id,
        time: SESSION_MS,
    });
    activeHelpCollectors.set(key, collector);

    collector.on('collect', async i => {
        lastInteraction = i;
        InteractionHelper.armDashboardSession(i);
        try {
            if (i.isStringSelectMenu()) {
                if (i.customId === JUMP_ID) {
                    const requested = Number(i.values?.[0]);
                    if (Number.isInteger(requested)) state.page = requested;
                } else if (i.customId === CATEGORY_ID) {
                    const name = i.values[0];
                    const index = collectCategories(i, client).findIndex(([categoryName]) => categoryName === name);
                    state.categoryIndex = index >= 0 ? index : null;
                    state.page = 0;
                }
            } else if (i.customId === NEXT_ID) {
                state.page += 1;
            } else if (i.customId === PREV_ID) {
                state.page = Math.max(0, state.page - 1);
            } else if (i.customId === OVERVIEW_ID) {
                state.categoryIndex = null;
                state.page = 0;
            }

            await i.deferUpdate();
            await i.editReply(renderHelp(i, client, state));
        } catch (error) {
            logger.error('Error in help navigation:', error);
        }
    });

    collector.on('end', async () => {
        if (activeHelpCollectors.get(key) === collector) activeHelpCollectors.delete(key);
        if (!lastInteraction) return;
        try {
            await lastInteraction.editReply({ components: [] });
        } catch {
            // Le message n’existe plus ou n’est plus modifiable.
        }
    });
}

export default {
    data: new SlashCommandBuilder()
        .setName('help')
        .setDescription('Liste toutes les commandes du bot')
        .setDMPermission(true),

    category: 'Utilitaire',

    async execute(interaction, config, client) {
        try {
            if (!(await InteractionHelper.safeDefer(interaction, { flags: MessageFlags.Ephemeral }))) return;

            const categories = collectCategories(interaction, client);
            const payload = renderHelp(interaction, client, { categoryIndex: null, page: 0 }, categories);
            if (!(await InteractionHelper.safeEditReply(interaction, payload))) return;

            if (categories.length > 0) await startCollector(interaction, client);
        } catch (error) {
            logger.error('Error in /help:', error);
            await InteractionHelper.safeEditReply(interaction, {
                embeds: [errorEmbed(
                    'Impossible d’afficher la liste des commandes. Réessaie dans un instant.',
                ).setFooter(brandFooter(CONTEXT))],
                components: [],
                allowedMentions: { parse: [], repliedUser: false },
            });
        }
    },
};
