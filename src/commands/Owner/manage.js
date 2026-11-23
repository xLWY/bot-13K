import {
    SlashCommandBuilder,
    PermissionFlagsBits,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ChannelType,
    MessageFlags,
    PermissionsBitField,
} from 'discord.js';
import { isBotOwner } from '../../utils/ownerIds.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { createEmbed, errorEmbed, successEmbed, warningEmbed } from '../../utils/embeds.js';
import { logger } from '../../utils/logger.js';
import { getGuildConfig } from '../../services/guildConfig.js';
import { buildBotInviteUrl } from '../../utils/inviteUrl.js';
import {
    brandFooter,
    buildNavRow,
    buildPageJumpRow,
    discordTimestamp,
    formatNumber,
    guildIconUrl,
    progressBar,
} from '../../ui/kit.js';

const LIST_PAGE_SIZE = 8;
const COLLECTOR_MS = 180_000;
const LIST_PREV = 'manage_list_prev';
const LIST_NEXT = 'manage_list_next';
const LIST_JUMP = 'manage_list_jump';
const LEAVE_YES = 'manage_leave_yes';
const LEAVE_NO = 'manage_leave_no';

/**
 * Le token d'un bouton peut devenir invalide (DiscordAPIError 50027) quand le
 * bot quitte le serveur où l'interaction a eu lieu. Dans ce cas, on envoie le
 * résultat en MP au propriétaire au lieu de perdre la confirmation.
 */
async function safeComponentReply(componentInteraction, payload, ownerId) {
    try {
        await componentInteraction.editReply(payload);
        return;
    } catch (error) {
        logger.debug(`[Manage] component reply failed (${error?.code ?? error?.message ?? 'inconnu'})`);
    }

    try {
        const owner = await componentInteraction.client.users.fetch(ownerId);
        await owner.send({
            content: payload.content ?? 'Résultat de `/manage` :',
            embeds: payload.embeds ?? [],
            allowedMentions: { parse: [] },
        });
    } catch (dmError) {
        logger.debug(`[Manage] DM fallback failed: ${dmError.message}`);
    }
}

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

function buildListPayload(guilds, page, client) {
    const pageCount = Math.max(1, Math.ceil(guilds.length / LIST_PAGE_SIZE));
    const currentPage = Math.min(Math.max(0, page), pageCount - 1);
    const slice = guilds.slice(currentPage * LIST_PAGE_SIZE, (currentPage + 1) * LIST_PAGE_SIZE);
    const totalMembers = guilds.reduce((sum, guild) => sum + (guild.memberCount ?? 0), 0);

    const fields = slice.map((guild, index) => {
        const position = String(currentPage * LIST_PAGE_SIZE + index + 1).padStart(2, '0');

        return {
            name: `${position} · ${cleanName(guild.name)}`.slice(0, 256),
            value: [
                `ID \`${guild.id}\` • 👥 \`${formatNumber(guild.memberCount ?? 0)}\``,
                `Propriétaire <@${guild.ownerId}> • Arrivé ${discordTimestamp(guild.joinedAt)}`,
            ].join('\n'),
            inline: false,
        };
    });

    if (fields.length === 0) {
        fields.push({
            name: 'Aucun serveur',
            value: 'Le bot n’est dans aucun serveur. Utilise `/manage invite` pour l’ajouter.',
        });
    }

    const embed = createEmbed({
        author: {
            name: '13K · Gestion des serveurs',
            iconURL: client?.user?.displayAvatarURL?.({ size: 64 }) ?? undefined,
        },
        title: 'Serveurs rejoints',
        description: [
            'Vue d’ensemble des serveurs. Ouvre une fiche avec `/manage info <serveur>`.',
            `\`${progressBar(currentPage + 1, pageCount, 12)}\``,
        ].join('\n'),
        color: 'info',
        fields: [
            {
                name: 'Serveurs',
                value: `\`${formatNumber(guilds.length)}\``,
                inline: true,
            },
            {
                name: 'Membres',
                value: `\`${formatNumber(totalMembers)}\``,
                inline: true,
            },
            {
                name: 'Page',
                value: `\`${currentPage + 1}/${pageCount}\``,
                inline: true,
            },
            ...fields,
        ],
        thumbnail: client?.user?.displayAvatarURL?.({ size: 128 }) ?? null,
        footer: brandFooter('Gestion des serveurs'),
    });

    return {
        embeds: [embed],
        components: [
            ...buildNavRow({
                page: currentPage,
                pageCount,
                prevId: LIST_PREV,
                nextId: LIST_NEXT,
                indicatorId: `${LIST_JUMP}_indicator`,
            }),
            ...buildPageJumpRow({ page: currentPage, pageCount, customId: LIST_JUMP }),
        ],
    };
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
        title: `Fiche serveur · ${cleanName(guild.name)}`,
        description: `ID : \`${guild.id}\``,
        color: 'info',
        thumbnail: guildIconUrl(guild, 128),
        fields: [
            {
                name: '👑 Propriétaire',
                value: ownerTag,
                inline: false,
            },
            {
                name: '📊 Activité',
                value: [
                    `Membres : \`${formatNumber(guild.memberCount ?? 0)}\``,
                    `Salons : \`${channels}\` (${textChannels} texte, ${voiceChannels} vocal, ${categories} catégories)`,
                    `Rôles : \`${Math.max(0, (guild.roles?.cache?.size ?? 1) - 1)}\``,
                ].join('\n'),
                inline: false,
            },
            {
                name: '🤖 Bot',
                value: [
                    `Arrivé : ${discordTimestamp(guild.joinedAt)}`,
                    `Permissions clés (${keyPermissions.length}/${KEY_PERMISSIONS.length}) : \`${progressBar(keyPermissions.length, KEY_PERMISSIONS.length, 10)}\``,
                    keyPermissions.length ? keyPermissions.map((p) => `\`${p}\``).join(', ') : 'aucune permission clé',
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
        footer: brandFooter('Fiche détaillée'),
    });

    return { embeds: [embed], components: [] };
}

function buildLeavePayload(guild, isMainGuild) {
    const embed = warningEmbed(
        [
            `Tu es sur le point de faire quitter **${cleanName(guild.name)}** (\`${guild.id}\`) au bot.`,
            `Membres : \`${formatNumber(guild.memberCount ?? 0)}\` • 👑 Propriétaire : <@${guild.ownerId}>`,
            '',
            isMainGuild
                ? '⚠️ C\'est le serveur principal (`GUILD_ID`) : les commandes de serveur ne seront plus enregistrées.'
                : 'Cette action est définitive jusqu\'à une nouvelle invitation du bot.',
            '',
            'Confirme avec le bouton ci-dessous.',
        ].join('\n'),
        'Confirmation de départ'
    );
    const icon = guildIconUrl(guild, 128);
    if (icon) embed.setThumbnail(icon);
    embed.setFooter(brandFooter('Action sensible'));

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

function attachCollector(reply, ownerId, onCollect, allowedIds = null) {
    if (!reply?.createMessageComponentCollector) return null;

    const collector = reply.createMessageComponentCollector({
        filter: (interaction) => interaction.user.id === ownerId
            && (!allowedIds || allowedIds.includes(interaction.customId)),
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
            await safeComponentReply(componentInteraction, {
                content: 'Une erreur est survenue. Réessaie avec la commande.',
                components: [],
                embeds: [],
            }, ownerId);
        }
    });

    collector.on('end', async (_, reason) => {
        if (reason !== 'time') return;
        await reply.edit({ components: [] }).catch(() => {});
    });

    return collector;
}

const INVITE_PERMISSION_SETS = {
    recommended: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.EmbedLinks,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.AddReactions,
        PermissionFlagsBits.UseExternalEmojis,
        PermissionFlagsBits.ManageRoles,
        PermissionFlagsBits.ManageChannels,
        PermissionFlagsBits.KickMembers,
        PermissionFlagsBits.BanMembers,
    ],
    admin: [PermissionFlagsBits.Administrator],
};

function buildInviteUrl(client, mode) {
    const clientId = process.env.CLIENT_ID || client?.user?.id;
    if (!clientId) return null;

    const permissions = new PermissionsBitField(
        INVITE_PERMISSION_SETS[mode] ?? INVITE_PERMISSION_SETS.recommended,
    );
    return buildBotInviteUrl(clientId, permissions.bitfield);
}

function buildInvitePayload(url, mode) {
    const label = mode === 'admin' ? 'Administrateur' : 'Recommandées';

    return {
        embeds: [createEmbed({
            title: 'Inviter le bot sur un serveur',
            description: [
                'Ouvre le lien ci-dessous, choisis le serveur voulu et valide les permissions.',
                'Le bot et ses commandes slash seront ajoutés en une seule étape.',
            ].join('\n'),
            color: 'info',
            fields: [
                { name: 'Permissions', value: label, inline: true },
                { name: 'Portée', value: 'Bot + commandes slash', inline: true },
                {
                    name: 'Lien manuel',
                    value: `\`${url}\``,
                },
            ],
            footer: brandFooter('Invitation'),
        })],
        components: [new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setLabel('Ajouter le bot à un serveur')
                .setStyle(ButtonStyle.Link)
                .setURL(url),
        )],
        allowedMentions: { parse: [] },
    };
}

export default {
    data: new SlashCommandBuilder()
        .setName('manage')
        .setDescription('Gérer les serveurs du bot (propriétaire, utilisable en MP)')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .setDMPermission(true)
        .addSubcommand((subcommand) => subcommand
            .setName('list')
            .setDescription('Lister tous les serveurs où le bot est présent'))
        .addSubcommand((subcommand) => subcommand
            .setName('info')
            .setDescription('Voir les détails d’un serveur')
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
                .setRequired(true)))
        .addSubcommand((subcommand) => subcommand
            .setName('invite')
            .setDescription('Générer un lien pour ajouter le bot à un serveur')
            .addStringOption((option) => option
                .setName('permissions')
                .setDescription('Permissions demandées (par défaut : recommandées)')
                .setRequired(false)
                .addChoices(
                    { name: 'Recommandées', value: 'recommended' },
                    { name: 'Administrateur', value: 'admin' },
                ))),

    category: 'Owner',
    ownerOnly: true,
    deferEphemeral: true,
    allowPrefixWithoutSubcommand: true,

    async execute(interaction, config, client) {
        if (!isBotOwner(interaction.user.id)) {
            await InteractionHelper.sendErrorNotice(
                interaction,
                'Cette commande est réservée au propriétaire du bot.',
            );
            return;
        }

        const discordClient = client ?? interaction.client;
        const subcommand = interaction.options.getSubcommand(false) ?? 'list';
        const isPrefix = interaction.isPrefixCommand?.() === true;

        try {
            const deferOptions = interaction.guild ? { flags: MessageFlags.Ephemeral } : {};
            await InteractionHelper.safeDefer(interaction, deferOptions);

            if (subcommand === 'list') {
                const guilds = await fetchAllGuilds(discordClient);
                const payload = buildListPayload(guilds, 0, discordClient);
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
                    } else if (componentInteraction.customId === LIST_JUMP) {
                        const requested = Number(componentInteraction.values?.[0]);
                        if (!Number.isInteger(requested)) return;
                        page = Math.min(pageCount - 1, Math.max(0, requested));
                    } else {
                        return;
                    }

                    await safeComponentReply(
                        componentInteraction,
                        buildListPayload(guilds, page, discordClient),
                        interaction.user.id,
                    );
                }, [LIST_PREV, LIST_NEXT, LIST_JUMP]);
                return;
            }

            if (subcommand === 'invite') {
                const mode = interaction.options.getString('permissions', false) === 'admin'
                    ? 'admin'
                    : 'recommended';
                const url = buildInviteUrl(discordClient, mode);
                if (!url) {
                    await InteractionHelper.safeEditReply(interaction, {
                        embeds: [errorEmbed(
                            'Impossible de générer le lien : `CLIENT_ID` est absent de la configuration.',
                        )],
                    });
                    return;
                }

                await InteractionHelper.safeEditReply(interaction, buildInvitePayload(url, mode));
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
                        await safeComponentReply(componentInteraction, {
                            embeds: [successEmbed('Départ annulé.')],
                            components: [],
                        }, interaction.user.id);
                        collector?.stop('cancelled');
                        return;
                    }
                    if (componentInteraction.customId !== LEAVE_YES) return;

                    // On retire les boutons avant l'action pour éviter un double-clic,
                    // et avant de quitter un serveur qui pourrait rendre le message
                    // (et donc le token du webhook) inaccessible.
                    await reply.edit({ components: [] }).catch(() => {});

                    const freshGuild = await discordClient.guilds.fetch(guild.id).catch(() => null);
                    if (!freshGuild) {
                        await safeComponentReply(componentInteraction, {
                            embeds: [errorEmbed(`Je ne suis plus dans \`${guild.id}\`.`)],
                            components: [],
                        }, interaction.user.id);
                        collector?.stop('already_left');
                        return;
                    }

                    const name = cleanName(freshGuild.name);
                    const id = freshGuild.id;

                    try {
                        await freshGuild.leave();
                    } catch (error) {
                        logger.error(`[Manage] could not leave ${id}: ${error.message}`);
                        await safeComponentReply(componentInteraction, {
                            embeds: [errorEmbed(`Impossible de quitter **${name}** (\`${id}\`) : ${error.message}`)],
                            components: [],
                        }, interaction.user.id);
                        collector?.stop('failed');
                        return;
                    }

                    logger.info(`[Manage] ${interaction.user.tag} a fait quitter le serveur ${name} (${id})`);

                    await safeComponentReply(componentInteraction, {
                        embeds: [successEmbed(`J’ai quitté **${name}** (\`${id}\`).`)],
                        components: [],
                    }, interaction.user.id);
                    collector?.stop('left');
                }, [LEAVE_YES, LEAVE_NO]);
                return;
            }

            const prefix = config?.prefix ?? '!';
            await InteractionHelper.safeEditReply(interaction, {
                content: [
                    `Sous-commande inconnue : \`${subcommand}\`.`,
                    isPrefix
                        ? `Utilisation : \`${prefix}manage list\`, \`${prefix}manage info <serveur>\`, \`${prefix}manage leave <serveur>\`, \`${prefix}manage invite\`.`
                        : 'Utilisation : `/manage list`, `/manage info`, `/manage leave`, `/manage invite`.',
                ].join('\n'),
            });
        } catch (error) {
            logger.error('[Manage] command failed:', error);
            await InteractionHelper.safeEditReply(interaction, {
                embeds: [errorEmbed('Impossible de terminer la commande. Réessaie dans un instant.')],
                components: [],
            });
        }
    },
};
