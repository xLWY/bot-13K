import {
    SlashCommandBuilder,
    PermissionFlagsBits,
    MessageFlags,
    ActionRowBuilder,
    StringSelectMenuBuilder,
    StringSelectMenuOptionBuilder,
} from 'discord.js';
import { isBotOwner } from '../../utils/ownerIds.js';
import { errorEmbed, infoEmbed, successEmbed, warningEmbed } from '../../utils/embeds.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { logger } from '../../utils/logger.js';
import { brandFooter, buildNavRow, formatNumber, progressBar } from '../../ui/kit.js';

const SELECT_ID = 'ownerrole_select';
const PREV_ID = 'ownerrole_prev';
const NEXT_ID = 'ownerrole_next';
const INDICATOR_ID = 'ownerrole_indicator';
const COLLECTOR_MS = 300_000;
const PAGE_SIZE = 25;
const CONTEXT = 'Rôles propriétaire';

function errorPage(message, title = '❌ Erreur') {
    return errorEmbed(message).setTitle(title).setFooter(brandFooter(CONTEXT));
}

function successPage(message, title) {
    return successEmbed(message, title).setFooter(brandFooter(CONTEXT));
}

function warningPage(message, title) {
    return warningEmbed(message, title).setFooter(brandFooter(CONTEXT));
}

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
        .setPlaceholder('Choisis le rôle à t’attribuer')
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

function buildComponents(roles, page) {
    const pageCount = Math.max(1, Math.ceil(roles.length / PAGE_SIZE));

    return [
        buildMenu(roles, page),
        ...buildNavRow({
            page,
            pageCount,
            prevId: PREV_ID,
            nextId: NEXT_ID,
            indicatorId: INDICATOR_ID,
        }),
    ];
}

function buildEmbed(roles, page) {
    const pageCount = Math.max(1, Math.ceil(roles.length / PAGE_SIZE));
    const start = page * PAGE_SIZE + 1;
    const end = Math.min(roles.length, (page + 1) * PAGE_SIZE);

    return infoEmbed(
        'Choisis le rôle à t’attribuer dans le menu ci-dessous.',
        'Rôles disponibles',
    )
        .addFields(
            { name: 'Rôles proposables', value: `\`${formatNumber(roles.length)}\``, inline: true },
            {
                name: 'Page',
                value: `**${page + 1}/${pageCount}** \`${progressBar(page + 1, pageCount, 8)}\``,
                inline: true,
            },
            { name: 'Affichés', value: `\`${formatNumber(start)}–${formatNumber(end)}\``, inline: true },
            {
                name: 'Critères',
                value: 'Rôles non gérés, placés sous mon rôle le plus haut, classés par permissions.',
                inline: false,
            },
        )
        .setFooter(brandFooter(CONTEXT));
}

async function sendError(interaction, text) {
    const payload = {
        embeds: [errorPage(text)],
        components: [],
        allowedMentions: { parse: [], repliedUser: false },
    };

    if (interaction.isPrefixCommand?.() === true) {
        if (!interaction.guild) {
            await InteractionHelper.safeReply(interaction, payload).catch(() => {});
            return;
        }

        const sent = await interaction.user.send(payload).catch(() => null);
        if (!sent) {
            await InteractionHelper.safeReply(interaction, payload).catch(() => {});
        }
        return;
    }

    if (!interaction.deferred && !interaction.replied) {
        await InteractionHelper.safeReply(interaction, {
            ...payload,
            flags: MessageFlags.Ephemeral,
        });
        return;
    }

    await InteractionHelper.safeEditReply(interaction, payload);
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
            page = i.customId === PREV_ID
                ? Math.max(0, page - 1)
                : Math.min(pageCount - 1, page + 1);

            await i.editReply({
                embeds: [buildEmbed(roles, page)],
                components: buildComponents(roles, page),
                allowedMentions: { parse: [], repliedUser: false },
            }).catch(() => {});
            return;
        }

        try {
            const roleId = i.values[0];
            const role = guild.roles.cache.get(roleId) ?? await guild.roles.fetch(roleId).catch(() => null);

            if (!role) {
                await i.editReply({
                    embeds: [errorPage('Ce rôle n’existe plus.', '❌ Rôle introuvable')],
                    components: [],
                    allowedMentions: { parse: [], repliedUser: false },
                });
                collector.stop('missing_role');
                return;
            }

            const botMember = guild.members.me ?? await guild.members.fetchMe();
            const ownerMember = await guild.members.fetch(ownerId);
            const botHighest = botMember.roles.highest;

            if (role.id === guild.id || role.managed || role.position >= botHighest.position) {
                await i.editReply({
                    embeds: [errorPage(
                        'Je ne peux plus attribuer ce rôle. Vérifie la position de mon rôle.',
                        '❌ Attribution impossible',
                    )],
                    components: [],
                    allowedMentions: { parse: [], repliedUser: false },
                });
                collector.stop('not_assignable');
                return;
            }

            if (ownerMember.roles.cache.has(role.id)) {
                await i.editReply({
                    embeds: [warningPage(
                        `Tu as déjà le rôle \`${role.name}\` (\`${role.id}\`).`,
                        '⚠️ Déjà attribué',
                    )],
                    components: [],
                    allowedMentions: { parse: [], repliedUser: false },
                });
                collector.stop('already_owned');
                return;
            }

            await ownerMember.roles.add(role, `Owner role command par ${interaction.user.tag}`);

            logger.info(
                `[OwnerRole] ${interaction.user.tag} a reçu le rôle ${role.name} (${role.id}) dans ${guild.name}`
            );

            await i.editReply({
                embeds: [successPage(
                    [
                        `Je t’ai donné le rôle \`${role.name}\` (\`${role.id}\`).`,
                        `Position : \`${role.position}\` • ${permissionSummary(role)}`,
                    ].join('\n'),
                    '✅ Rôle attribué',
                )],
                components: [],
                allowedMentions: { parse: [], repliedUser: false },
            });
            collector.stop('assigned');
        } catch (error) {
            logger.error('Error in /ownerrole select:', error);
            await i.editReply({
                embeds: [errorPage(
                    'Impossible de te donner ce rôle. Vérifie mes permissions et la position de mon rôle.',
                )],
                components: [],
                allowedMentions: { parse: [], repliedUser: false },
            }).catch(() => {});
            collector.stop('error');
        }
    });

    collector.on('end', async (_, reason) => {
        if (reason !== 'time') return;
        await interaction.editReply({
            embeds: [warningPage(
                'Ce menu a expiré. Relance `/ownerrole` pour choisir un rôle.',
                '⚠️ Menu expiré',
            )],
            components: [],
            allowedMentions: { parse: [], repliedUser: false },
        }).catch(() => {});
    });
}

export default {
    data: new SlashCommandBuilder()
        .setName('ownerrole')
        .setDescription('Choisir un rôle que le bot peut te donner')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .setDMPermission(true),

    category: 'Owner',
    ownerOnly: true,
    deferEphemeral: true,

    async execute(interaction, config, client) {
        const isPrefix = interaction.isPrefixCommand?.() === true;

        if (!isBotOwner(interaction.user.id)) {
            return sendError(interaction, 'Cette commande est réservée au propriétaire du bot.');
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
                return sendError(interaction, 'Je n’ai pas la permission **Gérer les rôles**.');
            }

            const ownerMember = interaction.guild
                ? (interaction.member ?? await guild.members.fetch(interaction.user.id).catch(() => null))
                : await guild.members.fetch(interaction.user.id).catch(() => null);

            if (!ownerMember) {
                return sendError(
                    interaction,
                    'Je n’arrive pas à te trouver dans le serveur cible. Vérifie que tu es bien membre du serveur.'
                );
            }

            const roles = getAssignableRoles(guild, botMember, ownerMember);

            if (roles.length === 0) {
                return sendError(
                    interaction,
                    'Je n’ai aucun rôle que je peux te donner. Vérifie que mon rôle est au-dessus des rôles et que tu n’as pas déjà tous ces rôles.'
                );
            }

            const edited = await InteractionHelper.safeEditReply(interaction, {
                embeds: [buildEmbed(roles, 0)],
                components: buildComponents(roles, 0),
                allowedMentions: { parse: [], repliedUser: false },
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
