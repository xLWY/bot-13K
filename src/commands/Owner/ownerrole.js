import {
    SlashCommandBuilder,
    PermissionFlagsBits,
    MessageFlags,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    StringSelectMenuBuilder,
    StringSelectMenuOptionBuilder,
} from 'discord.js';
import { isBotOwner } from '../../utils/ownerIds.js';
import { successEmbed, errorEmbed, infoEmbed } from '../../utils/embeds.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { logger } from '../../utils/logger.js';

const SELECT_ID = 'ownerrole_select';
const PREV_ID = 'ownerrole_prev';
const NEXT_ID = 'ownerrole_next';
const COLLECTOR_MS = 300_000;
const PAGE_SIZE = 25;

function permissionScore(role) {
    if (role.permissions.has(PermissionFlagsBits.Administrator)) return 1000;
    return role.permissions.toArray().length;
}

function permissionSummary(role) {
    if (role.permissions.has(PermissionFlagsBits.Administrator)) return 'Administrateur';
    const count = role.permissions.toArray().length;
    return count ? `${count} permission(s)` : 'Aucune permission spéciale';
}

function getAssignableRoles(guild, botMember, ownerMember) {
    const botHighest = botMember.roles.highest;

    return [...guild.roles.cache.values()]
        .filter(role =>
            role.id !== guild.id
            && !role.managed
            && role.position < botHighest.position
            && !ownerMember.roles.cache.has(role.id)
        )
        .sort((a, b) => permissionScore(b) - permissionScore(a) || b.position - a.position);
}

function buildMenu(roles, page) {
    const pageRoles = roles.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);

    const menu = new StringSelectMenuBuilder()
        .setCustomId(SELECT_ID)
        .setPlaceholder('Choisis le rôle à te donner')
        .addOptions(
            pageRoles.map(role =>
                new StringSelectMenuOptionBuilder()
                    .setLabel(role.name.slice(0, 100))
                    .setValue(role.id)
                    .setDescription(`Position ${role.position} • ${permissionSummary(role)}`.slice(0, 100))
            )
        );

    return new ActionRowBuilder().addComponents(menu);
}

function buildPager(page, pageCount) {
    const prev = new ButtonBuilder()
        .setCustomId(PREV_ID)
        .setLabel('◀ Précédent')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(page <= 0);

    const next = new ButtonBuilder()
        .setCustomId(NEXT_ID)
        .setLabel('Suivant ▶')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(page >= pageCount - 1);

    return new ActionRowBuilder().addComponents(prev, next);
}

function buildComponents(roles, page) {
    const pageCount = Math.max(1, Math.ceil(roles.length / PAGE_SIZE));
    const components = [buildMenu(roles, page)];

    if (pageCount > 1) {
        components.push(buildPager(page, pageCount));
    }

    return components;
}

function buildEmbed(roles, page) {
    const pageCount = Math.max(1, Math.ceil(roles.length / PAGE_SIZE));
    const start = page * PAGE_SIZE + 1;
    const end = Math.min(roles.length, (page + 1) * PAGE_SIZE);

    return infoEmbed(
        [
            `J'ai trouvé **${roles.length}** rôle(s) que je peux te donner.`,
            `Page **${page + 1}/${pageCount}** — rôles **${start}** à **${end}**.`,
            'Choisis-en un dans le menu ci-dessous.',
            'Seuls les rôles placés sous mon rôle le plus haut sont proposés.',
            'Ils sont classés par nombre de permissions.',
        ].join('\n'),
        '🎭 Rôles disponibles'
    );
}

async function sendError(interaction, text) {
    if (interaction.isPrefixCommand?.() === true) {
        if (!interaction.guild) {
            await InteractionHelper.safeReply(interaction, { content: text, components: [] }).catch(() => {});
            return;
        }

        const sent = await interaction.user.send({ content: text }).catch(() => null);
        if (!sent) {
            await InteractionHelper.safeReply(interaction, { content: text }).catch(() => {});
        }
        return;
    }

    await InteractionHelper.sendErrorNotice(interaction, text);
}

function startCollector(interaction, guild, reply, roles) {
    const ownerId = interaction.user.id;
    const pageCount = Math.max(1, Math.ceil(roles.length / PAGE_SIZE));
    let page = 0;

    const collector = reply.createMessageComponentCollector({
        time: COLLECTOR_MS,
        filter: i => i.user.id === ownerId && [SELECT_ID, PREV_ID, NEXT_ID].includes(i.customId),
    });

    collector.on('collect', async i => {
        try {
            await i.deferUpdate();
        } catch (error) {
            logger.warn('Owner role component interaction expired before acknowledgement:', error.message);
            return;
        }

        if (i.customId === PREV_ID || i.customId === NEXT_ID) {
            if (i.customId === PREV_ID) {
                page = Math.max(0, page - 1);
            } else {
                page = Math.min(pageCount - 1, page + 1);
            }

            await i.editReply({
                embeds: [buildEmbed(roles, page)],
                components: buildComponents(roles, page),
            }).catch(() => {});
            return;
        }

        try {
            const roleId = i.values[0];
            const role = guild.roles.cache.get(roleId) ?? await guild.roles.fetch(roleId).catch(() => null);

            if (!role) {
                await i.editReply({
                    embeds: [errorEmbed('Ce rôle n\'existe plus.')],
                    components: [],
                });
                collector.stop('missing_role');
                return;
            }

            const botMember = guild.members.me ?? await guild.members.fetchMe();
            const ownerMember = await guild.members.fetch(ownerId);
            const botHighest = botMember.roles.highest;

            if (role.id === guild.id || role.managed || role.position >= botHighest.position) {
                await i.editReply({
                    embeds: [errorEmbed('Je ne peux plus attribuer ce rôle. Vérifie la position de mon rôle.')],
                    components: [],
                });
                collector.stop('not_assignable');
                return;
            }

            if (ownerMember.roles.cache.has(role.id)) {
                await i.editReply({
                    embeds: [infoEmbed(`Tu as déjà le rôle ${role}.`, 'ℹ️ Rôle déjà possédé')],
                    components: [],
                });
                collector.stop('already_owned');
                return;
            }

            await ownerMember.roles.add(role, `Owner role command par ${interaction.user.tag}`);

            logger.info(
                `[OwnerRole] ${interaction.user.tag} a reçu le rôle ${role.name} (${role.id}) dans ${guild.name}`
            );

            await i.editReply({
                embeds: [
                    successEmbed(
                        `Je t'ai donné le rôle ${role}.\nPosition : \`${role.position}\` — ${permissionSummary(role)}`,
                        '✅ Rôle attribué'
                    ),
                ],
                components: [],
            });
            collector.stop('assigned');
        } catch (error) {
            logger.error('Error in /ownerrole select:', error);
            await i.editReply({
                embeds: [errorEmbed('Impossible de te donner ce rôle. Vérifie mes permissions et la position de mon rôle.')],
                components: [],
            }).catch(() => {});
            collector.stop('error');
        }
    });

    collector.on('end', async (_, reason) => {
        if (reason !== 'time') return;
        await interaction.editReply({ components: [] }).catch(() => {});
    });
}

export default {
    data: new SlashCommandBuilder()
        .setName('ownerrole')
        .setDescription('Choisir un rôle que le bot peut te donner')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .setDMPermission(true),

    category: 'Owner',
    deferEphemeral: true,

    async execute(interaction, config, client) {
        const isPrefix = interaction.isPrefixCommand?.() === true;

        if (!isBotOwner(interaction.user.id)) {
            return sendError(interaction, 'Cette commande est réservée au owner du bot.');
        }

        // En préfixe dans un serveur, on renvoie vers la version slash.
        // En MP, on continue pour afficher le menu directement.
        if (isPrefix && interaction.guild) {
            const sent = await interaction.user
                .send({ content: 'Utilise `/ownerrole` pour choisir ton rôle.' })
                .catch(() => null);
            if (!sent) {
                await InteractionHelper.safeReply(interaction, {
                    content: 'Utilise `/ownerrole` pour choisir ton rôle.',
                }).catch(() => {});
            }
            return;
        }

        const inGuild = Boolean(interaction.guild);

        const deferSuccess = await InteractionHelper.safeDefer(
            interaction,
            inGuild ? { flags: MessageFlags.Ephemeral } : {}
        );
        if (!deferSuccess) return;

        try {
            const discordClient = client ?? interaction.client;
            const configuredGuildId = discordClient?.config?.bot?.guildId ?? process.env.GUILD_ID;

            if (interaction.guild && configuredGuildId && interaction.guild.id !== configuredGuildId) {
                return sendError(
                    interaction,
                    'Cette commande est réservée au serveur principal.'
                );
            }

            const guildId = interaction.guild?.id ?? configuredGuildId;

            if (!guildId) {
                return sendError(
                    interaction,
                    'Aucun serveur cible configuré. Ajoute `GUILD_ID` sur Render.'
                );
            }

            const cachedGuild = discordClient?.guilds?.cache?.get(guildId);
            const guild = interaction.guild
                ?? cachedGuild
                ?? (discordClient ? await discordClient.guilds.fetch(guildId).catch(() => null) : null);

            if (!guild) {
                return sendError(
                    interaction,
                    'Je ne trouve pas le serveur cible. Vérifie `GUILD_ID` et que le bot est bien dans le serveur.'
                );
            }

            const botMember = guild.members.me ?? await guild.members.fetchMe();

            if (!botMember.permissions.has(PermissionFlagsBits.ManageRoles)) {
                return sendError(interaction, 'Je n\'ai pas la permission **Gérer les rôles**.');
            }

            const ownerMember = interaction.guild
                ? (interaction.member ?? await guild.members.fetch(interaction.user.id).catch(() => null))
                : await guild.members.fetch(interaction.user.id).catch(() => null);

            if (!ownerMember) {
                return sendError(
                    interaction,
                    'Je n\'arrive pas à te trouver dans le serveur cible. Vérifie que tu es bien membre du serveur.'
                );
            }

            const roles = getAssignableRoles(guild, botMember, ownerMember);

            if (roles.length === 0) {
                return sendError(
                    interaction,
                    'Je n\'ai aucun rôle que je peux te donner. Vérifie que mon rôle est au-dessus des rôles et que tu n\'as pas déjà tous ces rôles.'
                );
            }

            const edited = await InteractionHelper.safeEditReply(interaction, {
                embeds: [buildEmbed(roles, 0)],
                components: buildComponents(roles, 0),
            });
            if (!edited) return;

            const reply = await interaction.fetchReply().catch(() => null);
            if (!reply) return;

            startCollector(interaction, guild, reply, roles);
        } catch (error) {
            logger.error('Error in /ownerrole:', error);
            await sendError(
                interaction,
                'Impossible de préparer la liste des rôles. Vérifie mes permissions et la position de mon rôle.'
            );
        }
    },
};
