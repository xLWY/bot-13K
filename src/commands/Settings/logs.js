import { SlashCommandBuilder, PermissionFlagsBits, MessageFlags, ChannelType } from 'discord.js';
import { setLoggingChannel, getLoggingStatus, EVENT_TYPES } from '../../services/loggingService.js';
import { getGuildConfig, updateGuildConfig } from '../../services/guildConfig.js';
import { createEmbed, errorEmbed, successEmbed } from '../../utils/embeds.js';
import { logger } from '../../utils/logger.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { isBotOwner } from '../../utils/ownerIds.js';
import { brandFooter, buildNavRow, buildPageJumpRow, formatNumber, progressBar } from '../../ui/kit.js';

const NO_MENTIONS = { parse: [], repliedUser: false };
const FOOTER_CONTEXT = 'Configuration des logs';
const EXCLUSION_PAGE_SIZE = 8;
const COLLECTOR_MS = 180_000;
const EXCLUSIONS_PREV = 'logs_exclusions_prev';
const EXCLUSIONS_NEXT = 'logs_exclusions_next';
const EXCLUSIONS_JUMP = 'logs_exclusions_jump';

function errorReply(interaction, message) {
    const embed = errorEmbed(message);
    embed.setFooter(brandFooter(FOOTER_CONTEXT));
    return InteractionHelper.safeEditReply(interaction, {
        embeds: [embed],
        allowedMentions: NO_MENTIONS,
        flags: MessageFlags.Ephemeral,
    });
}

function buildExclusionsPayload(users, channels, page) {
    const entries = [
        ...users.map((id) => ({ kind: 'Utilisateur', mention: `<@${String(id)}>` })),
        ...channels.map((id) => ({ kind: 'Salon', mention: `<#${String(id)}>` })),
    ];
    const pageCount = Math.max(1, Math.ceil(entries.length / EXCLUSION_PAGE_SIZE));
    const currentPage = Math.min(Math.max(0, page), pageCount - 1);
    const slice = entries.slice(currentPage * EXCLUSION_PAGE_SIZE, (currentPage + 1) * EXCLUSION_PAGE_SIZE);

    const embed = createEmbed({
        title: '🔍 Exclusions des logs',
        description: entries.length
            ? `Un événement lié à ces éléments n’est **jamais** journalisé.\nPage **${currentPage + 1}/${pageCount}** ${progressBar(currentPage + 1, pageCount, 10)}.`
            : 'Aucun utilisateur ni salon n’est exclu : tous les événements sont journalisés.',
        color: entries.length ? 'warning' : 'info',
        fields: entries.length
            ? [{
                name: `Éléments exclus (${formatNumber(entries.length)})`,
                value: slice.map((entry) => `• ${entry.kind} : ${entry.mention}`).join('\n'),
            }]
            : [{
                name: 'Aucune exclusion',
                value: 'La journalisation est active pour tout le serveur.',
            }],
        footer: brandFooter(FOOTER_CONTEXT),
    });

    return {
        embeds: [embed],
        components: [
            ...buildNavRow({
                page: currentPage,
                pageCount,
                prevId: EXCLUSIONS_PREV,
                nextId: EXCLUSIONS_NEXT,
                indicatorId: `${EXCLUSIONS_JUMP}_indicator`,
            }),
            ...buildPageJumpRow({ page: currentPage, pageCount, customId: EXCLUSIONS_JUMP }),
        ],
        allowedMentions: NO_MENTIONS,
        flags: MessageFlags.Ephemeral,
    };
}

async function safeComponentReply(componentInteraction, payload) {
    const { flags, ...editPayload } = payload;
    try {
        await componentInteraction.editReply(editPayload);
        return;
    } catch (error) {
        logger.debug(`[Logs] component reply failed (${error?.code ?? error?.message ?? 'inconnu'})`);
    }

    try {
        await componentInteraction.followUp({ ...payload, flags: flags ?? MessageFlags.Ephemeral });
    } catch (error) {
        logger.debug(`[Logs] component follow-up failed: ${error.message}`);
    }
}

function attachExclusionCollector(reply, userId, users, channels) {
    const pageCount = Math.max(1, Math.ceil((users.length + channels.length) / EXCLUSION_PAGE_SIZE));
    if (pageCount <= 1 || !reply?.createMessageComponentCollector) return;

    let page = 0;
    const collector = reply.createMessageComponentCollector({
        filter: (componentInteraction) => componentInteraction.user.id === userId
            && [EXCLUSIONS_PREV, EXCLUSIONS_NEXT, EXCLUSIONS_JUMP].includes(componentInteraction.customId),
        time: COLLECTOR_MS,
    });

    collector.on('collect', async (componentInteraction) => {
        try {
            await componentInteraction.deferUpdate();
        } catch (error) {
            logger.debug(`[Logs] component expired before acknowledgement: ${error.message}`);
            return;
        }

        try {
            if (componentInteraction.customId === EXCLUSIONS_PREV) {
                page = Math.max(0, page - 1);
            } else if (componentInteraction.customId === EXCLUSIONS_NEXT) {
                page = Math.min(pageCount - 1, page + 1);
            } else if (componentInteraction.customId === EXCLUSIONS_JUMP) {
                const requested = Number(componentInteraction.values?.[0]);
                if (!Number.isInteger(requested)) return;
                page = Math.min(pageCount - 1, Math.max(0, requested));
            } else {
                return;
            }

            await safeComponentReply(componentInteraction, buildExclusionsPayload(users, channels, page));
        } catch (error) {
            logger.error('[Logs] exclusion pagination failed:', error);
        }
    });

    collector.on('end', async (_, reason) => {
        if (reason !== 'time') return;
        await reply.edit({ components: [] }).catch(() => {});
    });
}

export default {
    data: new SlashCommandBuilder()
        .setName('logs')
        .setDescription('Les logs sont envoyés en MP au propriétaire du bot. Définit un canal de secours')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
        .addChannelOption(option =>
            option.setName('channel')
                .setDescription('Canal textuel de secours, utilisé seulement si le MP échoue')
                .setRequired(false)
                .addChannelTypes(ChannelType.GuildText))
        .addStringOption(option =>
            option.setName('exclusions')
                .setDescription('Vide la liste des utilisateurs/canaux ignorés qui bloquent des logs')
                .setRequired(false)
                .addChoices(
                    { name: 'Vider les exclusions', value: 'clear' },
                    { name: 'Voir les exclusions', value: 'show' },
                )),

    category: 'settings',

    async execute(interaction, config, client) {
        const deferSuccess = await InteractionHelper.safeDefer(interaction, { flags: MessageFlags.Ephemeral });
        if (!deferSuccess) {
            logger.warn('Logs interaction defer failed', {
                userId: interaction.user.id,
                guildId: interaction.guildId,
                commandName: 'logs'
            });
            return;
        }

        if (!isBotOwner(interaction.user.id) && !interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
            return errorReply(interaction, 'Tu as besoin de la permission **Gérer le serveur** pour configurer les logs.');
        }

        const channel = interaction.options.getChannel('channel');
        const exclusionAction = interaction.options.getString('exclusions');

        try {
            if (exclusionAction) {
                const current = await getGuildConfig(client, interaction.guild.id);
                const ignore = current?.logIgnore || { users: [], channels: [] };
                const users = Array.isArray(ignore.users) ? ignore.users : [];
                const channels = Array.isArray(ignore.channels) ? ignore.channels : [];

                if (exclusionAction === 'clear') {
                    await updateGuildConfig(client, interaction.guild.id, {
                        logIgnore: { users: [], channels: [] }
                    });
                    const embed = successEmbed('Tous les logs repartent comme avant.', '✅ Exclusions vidées');
                    embed.addFields(
                        { name: 'Utilisateurs retirés', value: `\`${formatNumber(users.length)}\``, inline: true },
                        { name: 'Canaux retirés', value: `\`${formatNumber(channels.length)}\``, inline: true },
                    );
                    embed.setFooter(brandFooter(FOOTER_CONTEXT));
                    return InteractionHelper.safeEditReply(interaction, {
                        embeds: [embed],
                        allowedMentions: NO_MENTIONS,
                        flags: MessageFlags.Ephemeral,
                    });
                }

                const payload = buildExclusionsPayload(users, channels, 0);
                if (!(await InteractionHelper.safeEditReply(interaction, payload))) return;

                const reply = await interaction.fetchReply?.().catch(() => null);
                attachExclusionCollector(reply, interaction.user.id, users, channels);
                return;
            }

            if (channel) {
                if (channel.guildId !== interaction.guildId) {
                    return errorReply(interaction, `<#${channel.id}> n’est pas dans ce serveur.`);
                }

                const success = await setLoggingChannel(client, interaction.guild.id, channel.id);
                if (!success) {
                    return errorReply(interaction, 'Échec de la configuration du canal des logs. Réessaie dans un instant.');
                }

                logger.info(`[Logs] Set logging channel to ${channel.name} (${channel.id}) in ${interaction.guild.name} (${interaction.guild.id}) by ${interaction.user.tag}`);

                const embed = successEmbed(
                    'Les logs restent envoyés en message privé au propriétaire du bot ; ce salon ne reçoit les logs que si le MP échoue.',
                    '✅ Canal de secours configuré',
                );
                embed.addFields(
                    { name: 'Canal', value: `${channel}`, inline: true },
                    { name: 'Types d’événements', value: `\`${formatNumber(Object.keys(EVENT_TYPES).length)}\``, inline: true },
                );
                embed.setFooter(brandFooter(FOOTER_CONTEXT));
                await InteractionHelper.safeEditReply(interaction, {
                    embeds: [embed],
                    allowedMentions: NO_MENTIONS,
                    flags: MessageFlags.Ephemeral,
                });

                try {
                    await channel.send({
                        content: '📝 Canal de Secours Actif — Ce canal est désormais le **canal de secours** du bot. Les logs partent en message privé au propriétaire ; ce salon ne reçoit les logs qu’en cas d’échec du DM.'
                    });
                } catch {
                    logger.warn(`[Logs] Could not send confirmation in logs channel ${channel.id} (missing Send/Embed permissions?)`);
                }
                return;
            }

            const status = await getLoggingStatus(client, interaction.guild.id);

            const enabledCount = Object.values(EVENT_TYPES).filter(
                type => status.enabledEvents[type] !== false
            ).length;
            const totalCount = Object.keys(EVENT_TYPES).length;

            const currentConfig = await getGuildConfig(client, interaction.guild.id);
            const ignore = currentConfig?.logIgnore || { users: [], channels: [] };
            const ignoredUsers = Array.isArray(ignore.users) ? ignore.users : [];
            const ignoredChannels = Array.isArray(ignore.channels) ? ignore.channels : [];
            const hasExclusions = ignoredUsers.length > 0 || ignoredChannels.length > 0;

            const fallbackLine = status.channelId
                ? (() => {
                    const ch = interaction.guild.channels.cache.get(status.channelId);
                    return ch ? ch.toString() : `\`${status.channelId}\``;
                })()
                : 'Aucun';

            const embed = createEmbed({
                title: '📝 Statut des logs',
                description: hasExclusions
                    ? `⚠️ **${formatNumber(ignoredUsers.length)} utilisateur(s)** et **${formatNumber(ignoredChannels.length)} salon(s)** sont exclus : leurs événements ne sont jamais journalisés. Utilise \`/logs exclusions:Voir les exclusions\` pour les consulter.`
                    : 'Les logs sont envoyés en message privé aux propriétaires du bot. Aucune exclusion n’est active.',
                color: hasExclusions ? 'warning' : 'info',
                fields: [
                    { name: 'Destination', value: 'Message privé aux propriétaires du bot' },
                    { name: 'Canal de secours', value: fallbackLine },
                    {
                        name: 'Événements actifs',
                        value: `\`${formatNumber(enabledCount)} / ${formatNumber(totalCount)}\` ${progressBar(enabledCount, totalCount, 10)}`,
                    },
                    {
                        name: 'Exclusions',
                        value: hasExclusions
                            ? `\`${formatNumber(ignoredUsers.length)}\` utilisateur(s) • \`${formatNumber(ignoredChannels.length)}\` salon(s)`
                            : 'Aucune',
                    },
                ],
                footer: brandFooter(FOOTER_CONTEXT),
            });

            return InteractionHelper.safeEditReply(interaction, {
                embeds: [embed],
                allowedMentions: NO_MENTIONS,
                flags: MessageFlags.Ephemeral,
            });
        } catch (error) {
            logger.error(`[Logs] Failed to configure logging for guild ${interaction.guild.id}:`, error);
            await errorReply(interaction, 'Une erreur est survenue lors de la configuration des logs. Réessaie dans un instant.');
        }
    }
};
