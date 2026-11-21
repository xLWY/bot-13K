import {
    SlashCommandBuilder,
    PermissionFlagsBits,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ChannelType,
} from 'discord.js';
import { isBotOwner } from '../../utils/ownerIds.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { createEmbed, warningEmbed } from '../../utils/embeds.js';
import { logger } from '../../utils/logger.js';
import { getGuildConfig } from '../../services/guildConfig.js';

const LIST_PAGE_SIZE = 8;
const COLLECTOR_MS = 180_000;
const LIST_PREV = 'manage_list_prev';
const LIST_NEXT = 'manage_list_next';
const LEAVE_YES = 'manage_leave_yes';
const LEAVE_NO = 'manage_leave_no';

const VERIFICATION_LABELS = {
    0: 'Aucune',
    1: 'Faible',
    2: 'Moyenne',
    3: 'Élevée',
    4: 'Très élevée',
};

const KEY_PERMISSIONS = [
    'Administrator',
    'ManageGuild',
    'ManageRoles',
    'ManageChannels',
    'SendMessages',
    'ViewChannel',
    'EmbedLinks',
    'KickMembers',
    'BanMembers',
];

function cleanName(name) {
    return String(name ?? 'Serveur sans nom').replace(/[`@]/g, '').slice(0, 80);
}

function timestamp(value, format = 'R') {
    if (!value) return 'inconnu';
    return `<t:${Math.floor(new Date(value).getTime() / 1000)}:${format}>`;
}

async function fetchAllGuilds(client) {
    let guilds = [...(client.guilds?.cache?.values?.() ?? [])];

    try {
        const fetched = await client.guilds.fetch();
        guilds = [...fetched.values()];
    } catch (error) {
        logger.debug(`[Manage] guilds.fetch() failed, using cache: ${error.message}`);
    }

    return guilds.sort(
        (a, b) => (b.memberCount ?? 0) - (a.memberCount ?? 0) || cleanName(a.name).localeCompare(cleanName(b.name))
    );
}

async function resolveGuild(client, input) {
    const guilds = await fetchAllGuilds(client);
    const needle = String(input ?? '').trim();

    if (!needle) return { guild: null, matches: [], guilds };

    let matches = guilds.filter((guild) => guild.id === needle);
    if (matches.length === 0) {
        matches = guilds.filter((guild) => cleanName(guild.name).toLowerCase() === needle.toLowerCase());
    }
    if (matches.length === 0) {
        matches = guilds.filter((guild) => cleanName(guild.name).toLowerCase().includes(needle.toLowerCase()));
    }

    return { guild: matches[0] ?? null, matches, guilds };
}

function buildListPayload(guilds, page) {
    const pageCount = Math.max(1, Math.ceil(guilds.length / LIST_PAGE_SIZE));
    const currentPage = Math.min(Math.max(0, page), pageCount - 1);
    const slice = guilds.slice(currentPage * LIST_PAGE_SIZE, (currentPage + 1) * LIST_PAGE_SIZE);

    const lines = slice.map((guild, index) => {
        const position = currentPage * LIST_PAGE_SIZE + index + 1;
        return [
            `**${position}. ${cleanName(guild.name)}**`,
            `　\`${guild.id}\` • 👥 \`${guild.memberCount ?? '?'}\` • 👑 <@${guild.ownerId}> • ${timestamp(guild.joinedAt)}`,
        ].join('\n');
    });

    const embed = createEmbed({
        title: '🛠️ Serveurs où je suis présent',
        description: [
            `**${guilds.length}** serveur(s) • page **${currentPage + 1}/${pageCount}**`,
            '',
            lines.join('\n\n') || 'Aucun serveur pour le moment.',
        ].join('\n'),
        color: 'info',
        footer: { text: 'Utilise /manage info <serveur> pour les détails • /manage leave <serveur> pour quitter' },
    });

    const components = [];
    if (pageCount > 1) {
        components.push(
            new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId(LIST_PREV)
                    .setLabel('◀ Précédent')
                    .setStyle(ButtonStyle.Secondary)
                    .setDisabled(currentPage <= 0),
                new ButtonBuilder()
                    .setCustomId(LIST_NEXT)
                    .setLabel('Suivant ▶')
                    .setStyle(ButtonStyle.Secondary)
                    .setDisabled(currentPage >= pageCount - 1),
            )
        );
    }

    return { embeds: [embed], components };
}

async function buildInfoPayload(guild, client) {
    const botMember = guild.members?.me ?? await guild.members?.fetchMe?.().catch(() => null) ?? null;
    const permissions = botMember?.permissions?.toArray?.() ?? [];
    const keyPermissions = KEY_PERMISSIONS.filter((permission) => permissions.includes(permission));

    let channels = 0;
    let textChannels = 0;
    let voiceChannels = 0;
    let categories = 0;
    for (const channel of guild.channels?.cache?.values?.() ?? []) {
        channels += 1;
        if (channel.type === ChannelType.GuildText) textChannels += 1;
        if (channel.type === ChannelType.GuildCategory) categories += 1;
        if (typeof channel.isVoiceBased === 'function' && channel.isVoiceBased()) voiceChannels += 1;
    }

    let configLine = 'Configuration indisponible';
    try {
        const config = await getGuildConfig(client, guild.id);
        configLine = [
            `préfixe \`${config?.prefix ?? '?'}\``,
            `logs ${config?.logging?.enabled ? 'activés' : 'désactivés'}`,
        ].join(' • ');
    } catch (error) {
        logger.debug(`[Manage] guild config unavailable for ${guild.id}: ${error.message}`);
    }

    let ownerTag = `<@${guild.ownerId}>`;
    try {
        const owner = await client.users.fetch(guild.ownerId);
        if (owner?.tag) ownerTag = `${owner.tag} (\`${owner.id}\`)`;
    } catch (_) {
        // Le mention reste affichée même si l'utilisateur n'est pas en cache.
    }

    const features = (guild.features ?? []).slice(0, 8).map((feature) =>
        feature.toLowerCase().replace(/_/g, ' ')
    );

    const embed = createEmbed({
        title: `ℹ️ ${cleanName(guild.name)}`,
        description: `ID : \`${guild.id}\``,
        color: 'info',
        fields: [
            {
                name: '👑 Propriétaire',
                value: ownerTag,
                inline: false,
            },
            {
                name: '📊 Activité',
                value: [
                    `Membres : \`${guild.memberCount ?? '?'}\``,
                    `Salons : \`${channels}\` (${textChannels} texte, ${voiceChannels} vocal, ${categories} catégories)`,
                    `Rôles : \`${Math.max(0, (guild.roles?.cache?.size ?? 1) - 1)}\``,
                ].join('\n'),
                inline: false,
            },
            {
                name: '🤖 Bot',
                value: [
                    `Arrivé : ${timestamp(guild.joinedAt)}`,
                    `Permissions clés : ${keyPermissions.length ? keyPermissions.map((p) => `\`${p}\``).join(', ') : 'aucune'}`,
                ].join('\n'),
                inline: false,
            },
            {
                name: '⚙️ Serveur',
                value: [
                    `Vérification : \`${VERIFICATION_LABELS[guild.verificationLevel] ?? guild.verificationLevel ?? '?'}\``,
                    `Boosts : \`${guild.premiumSubscriptionCount ?? 0}\` (niveau \`${guild.premiumTier ?? 0}\`)`,
                    `Langue : \`${guild.preferredLocale ?? '?'}\``,
                    `Fonctionnalités : ${features.length ? features.join(', ') : 'aucune'}`,
                ].join('\n'),
                inline: false,
            },
            {
                name: '🗄️ Configuration enregistrée',
                value: configLine,
                inline: false,
            },
        ],
        footer: { text: 'Géré via /manage • owner uniquement' },
    });

    return { embeds: [embed], components: [] };
}

function buildLeavePayload(guild, isMainGuild) {
    const embed = warningEmbed(
        [
            `Tu es sur le point de faire quitter **${cleanName(guild.name)}** (\`${guild.id}\`) au bot.`,
            `Membres : \`${guild.memberCount ?? '?'}\` • propriétaire : <@${guild.ownerId}>`,
            '',
            isMainGuild
                ? '⚠️ C\'est le serveur principal (`GUILD_ID`) : les commandes de serveur ne seront plus enregistrées.'
                : 'Cette action est définitive jusqu\'à une nouvelle invitation du bot.',
            '',
            'Confirme avec le bouton ci-dessous.',
        ].join('\n'),
        '⚠️ Confirmation de départ'
    );

    return {
        embeds: [embed],
        components: [
            new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(LEAVE_YES).setLabel('Quitter ce serveur').setStyle(ButtonStyle.Danger),
                new ButtonBuilder().setCustomId(LEAVE_NO).setLabel('Annuler').setStyle(ButtonStyle.Secondary),
            ),
        ],
    };
}

async function sendResolveError(interaction, needle, matches, guilds) {
    const examples = matches.slice(0, 8).map((guild) => `• ${cleanName(guild.name)} → \`${guild.id}\``).join('\n');
    const hint = matches.length > 1
        ? `Plusieurs serveurs correspondent à \`${needle}\` :\n${examples}\n\nPrécise avec l'ID.`
        : [
            `Je ne suis pas dans un serveur qui correspond à \`${needle}\`.`,
            guilds.length ? `Serveurs disponibles : \`${guilds.length}\` (voir \`/manage list\`).` : 'Je ne suis dans aucun serveur.',
        ].join('\n');

    await InteractionHelper.safeEditReply(interaction, {
        embeds: [warningEmbed(hint, '🔍 Serveur introuvable')],
        components: [],
    });
}

function attachCollector(reply, ownerId, onCollect) {
    if (!reply?.createMessageComponentCollector) return null;

    const collector = reply.createMessageComponentCollector({
        filter: (interaction) => interaction.user.id === ownerId,
        time: COLLECTOR_MS,
    });

    collector.on('collect', async (componentInteraction) => {
        try {
            await componentInteraction.deferUpdate();
        } catch (error) {
            logger.debug(`[Manage] component expired before acknowledgement: ${error.message}`);
            return;
        }

        try {
            await onCollect(componentInteraction);
        } catch (error) {
            logger.error('[Manage] component handler failed:', error);
            await componentInteraction.editReply({
                content: 'Une erreur est survenue. Réessaie avec la commande.',
                components: [],
                embeds: [],
            }).catch(() => {});
        }
    });

    collector.on('end', async (_, reason) => {
        if (reason !== 'time') return;
        await reply.edit({ components: [] }).catch(() => {});
    });

    return collector;
}

export default {
    data: new SlashCommandBuilder()
        .setName('manage')
        .setDescription('Gérer les serveurs du bot (owner, utilisable en DM)')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .setDMPermission(true)
        .addSubcommand((subcommand) => subcommand
            .setName('list')
            .setDescription('Lister tous les serveurs où le bot est présent'))
        .addSubcommand((subcommand) => subcommand
            .setName('info')
            .setDescription('Voir les détails d un serveur')
            .addStringOption((option) => option
                .setName('serveur')
                .setDescription('Nom ou ID du serveur')
                .setRequired(true)))
        .addSubcommand((subcommand) => subcommand
            .setName('leave')
            .setDescription('Faire quitter un serveur au bot')
            .addStringOption((option) => option
                .setName('serveur')
                .setDescription('Nom ou ID du serveur')
                .setRequired(true))),

    category: 'Owner',
    deferEphemeral: true,

    async execute(interaction, config, client) {
        if (!isBotOwner(interaction.user.id)) {
            await InteractionHelper.safeReply(interaction, {
                content: '`/manage` est réservé au owner du bot.',
            });
            return;
        }

        const discordClient = client ?? interaction.client;
        const subcommand = interaction.options.getSubcommand(false) ?? 'list';
        const isPrefix = interaction.isPrefixCommand?.() === true;

        try {
            await InteractionHelper.safeDefer(interaction, {});

            if (subcommand === 'list') {
                const guilds = await fetchAllGuilds(discordClient);
                const payload = buildListPayload(guilds, 0);
                if (!(await InteractionHelper.safeEditReply(interaction, payload))) return;

                const reply = await interaction.fetchReply?.().catch(() => null);
                if (!reply || guilds.length <= LIST_PAGE_SIZE) return;

                const pageCount = Math.ceil(guilds.length / LIST_PAGE_SIZE);
                let page = 0;

                attachCollector(reply, interaction.user.id, async (componentInteraction) => {
                    if (componentInteraction.customId === LIST_PREV) {
                        page = Math.max(0, page - 1);
                    } else if (componentInteraction.customId === LIST_NEXT) {
                        page = Math.min(pageCount - 1, page + 1);
                    } else {
                        return;
                    }

                    await componentInteraction.editReply(buildListPayload(guilds, page));
                });
                return;
            }

            const needle = interaction.options.getString('serveur', false);
            const { guild, matches, guilds } = await resolveGuild(discordClient, needle);
            if (!guild) {
                await sendResolveError(interaction, needle ?? '(vide)', matches, guilds);
                return;
            }
            if (matches.length > 1 && cleanName(guild.name).toLowerCase() !== String(needle).toLowerCase()) {
                await sendResolveError(interaction, needle, matches, guilds);
                return;
            }

            if (subcommand === 'info') {
                const payload = await buildInfoPayload(guild, discordClient);
                await InteractionHelper.safeEditReply(interaction, payload);
                return;
            }

            if (subcommand === 'leave') {
                const configuredGuildId = discordClient?.config?.bot?.guildId ?? process.env.GUILD_ID;
                const isMainGuild = Boolean(configuredGuildId && guild.id === configuredGuildId);
                const payload = buildLeavePayload(guild, isMainGuild);
                if (!(await InteractionHelper.safeEditReply(interaction, payload))) return;

                const reply = await interaction.fetchReply?.().catch(() => null);
                if (!reply) return;

                let collector = null;
                collector = attachCollector(reply, interaction.user.id, async (componentInteraction) => {
                    if (componentInteraction.customId === LEAVE_NO) {
                        collector?.stop('cancelled');
                        await componentInteraction.editReply({
                            content: '✅ Départ annulé.',
                            embeds: [],
                            components: [],
                        });
                        return;
                    }
                    if (componentInteraction.customId !== LEAVE_YES) return;

                    const freshGuild = await discordClient.guilds.fetch(guild.id).catch(() => null);
                    if (!freshGuild) {
                        await componentInteraction.editReply({
                            content: `❌ Je ne suis plus dans \`${guild.id}\`.`,
                            embeds: [],
                            components: [],
                        });
                        collector?.stop('already_left');
                        return;
                    }

                    const name = cleanName(freshGuild.name);
                    const id = freshGuild.id;

                    try {
                        await freshGuild.leave();
                    } catch (error) {
                        logger.error(`[Manage] could not leave ${id}: ${error.message}`);
                        await componentInteraction.editReply({
                            content: `❌ Impossible de quitter **${name}** (\`${id}\`) : ${error.message}`,
                            embeds: [],
                            components: [],
                        });
                        return;
                    }

                    logger.info(`[Manage] ${interaction.user.tag} a fait quitter le serveur ${name} (${id})`);

                    collector?.stop('left');
                    await componentInteraction.editReply({
                        content: `✅ J'ai quitté **${name}** (\`${id}\`).`,
                        embeds: [],
                        components: [],
                    });
                });
                return;
            }

            await InteractionHelper.safeEditReply(interaction, {
                content: [
                    `Sous-commande inconnue : \`${subcommand}\`.`,
                    isPrefix
                        ? 'Utilisation : `!manage list`, `!manage info <serveur>`, `!manage leave <serveur>`.'
                        : 'Utilisation : `/manage list`, `/manage info`, `/manage leave`.',
                ].join('\n'),
            });
        } catch (error) {
            logger.error('[Manage] command failed:', error);
            await InteractionHelper.safeEditReply(interaction, {
                embeds: [warningEmbed('Impossible de terminer la commande. Réessaie dans un instant.', '❌ Erreur')],
                components: [],
            });
        }
    },
};
