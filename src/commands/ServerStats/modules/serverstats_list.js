import { getColor } from '../../../config/bot.js';
import { PermissionFlagsBits } from 'discord.js';
import { createEmbed } from '../../../utils/embeds.js';
import { getServerCounters, getCounterEmoji as getCounterTypeEmoji, getCounterTypeLabel, getGuildCounterStats, resolveCounterChannel } from '../../../services/serverstatsService.js';
import { logger } from '../../../utils/logger.js';
import { InteractionHelper } from '../../../utils/interactionHelper.js';
import { isBotOwner } from '../../../utils/ownerIds.js';
import { brandFooter, buildNavRow, buildPageJumpRow, discordTimestamp, formatNumber } from '../../../ui/kit.js';

const PAGE_SIZE = 4;
const NAV_PREV = 'serverstats_list_prev';
const NAV_NEXT = 'serverstats_list_next';
const NAV_JUMP = 'serverstats_list_jump';
const REFRESH_MS = 6 * 60 * 1000;

function getCounterTypeDisplay(type) {
    return `${getCounterTypeEmoji(type)} ${getCounterTypeLabel(type)}`;
}

function getCurrentCount(stats, type) {
    switch (type) {
        case 'members': return stats.totalCount;
        case 'bots': return stats.botCount;
        case 'members_only': return stats.humanCount;
        case 'online': return stats.onlineCount;
        case 'voice': return stats.voiceCount;
        default: return 0;
    }
}

function isActive(counter, channelById) {
    return Boolean(channelById.get(counter.channelId)?.name.includes(':'));
}

function buildListPayload(counters, channelById, stats, missingChannelCounters, page) {
    const pageCount = Math.max(1, Math.ceil(counters.length / PAGE_SIZE));
    const currentPage = Math.min(Math.max(0, page), pageCount - 1);
    const slice = counters.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE);
    const activeCount = counters.filter((counter) => isActive(counter, channelById)).length;

    const fields = slice.map((counter, index) => {
        const channel = channelById.get(counter.channelId);
        const position = String(currentPage * PAGE_SIZE + index + 1).padStart(2, '0');

        return {
            name: `${position} · ${getCounterTypeDisplay(counter.type)} · ${channel?.name ?? 'salon introuvable'}`.slice(0, 256),
            value: [
                `ID : \`${counter.id}\` • Valeur : \`${formatNumber(getCurrentCount(stats, counter.type))}\``,
                `Salon : ${channel ?? 'introuvable'} • Statut : ${isActive(counter, channelById) ? '✅ Actif' : '⚠️ Non actualisé'}`,
                `Créé ${discordTimestamp(counter.createdAt, 'R')}`,
            ].join('\n'),
            inline: false,
        };
    });

    fields.push({
        name: 'Résumé',
        value: [
            `Total : \`${formatNumber(counters.length)}\` • Actifs : \`${formatNumber(activeCount)}\``,
            missingChannelCounters.length
                ? `⚠️ \`${formatNumber(missingChannelCounters.length)}\` compteur(s) vers un salon introuvable. La configuration est conservée.`
                : '✅ Aucune anomalie détectée.',
            `Prochaine actualisation ${discordTimestamp(Date.now() + REFRESH_MS, 'R')}`,
        ].join('\n'),
        inline: false,
    });

    const embed = createEmbed({
        title: 'Compteurs du serveur',
        description: [
            `**${formatNumber(counters.length)}** compteur(s) actif(s).`,
            `Page **${currentPage + 1}/${pageCount}**.`,
        ].join('\n'),
        color: getColor('info'),
        fields,
        footer: brandFooter('Compteurs'),
    });

    return {
        embeds: [embed],
        components: [
            ...buildNavRow({
                page: currentPage,
                pageCount,
                prevId: NAV_PREV,
                nextId: NAV_NEXT,
                indicatorId: `${NAV_JUMP}_indicator`,
            }),
            ...buildPageJumpRow({ page: currentPage, pageCount, customId: NAV_JUMP }),
        ],
        allowedMentions: { parse: [] },
    };
}

function buildEmptyPayload() {
    const embed = createEmbed({
        title: 'Compteurs du serveur',
        description: [
            'Aucun compteur n’est configuré pour ce serveur.',
            'Crée ton premier compteur avec `/serverstats create`.',
        ].join('\n'),
        color: getColor('warning'),
        footer: brandFooter('Compteurs'),
    });

    embed.addFields({
        name: 'Types disponibles',
        value: [
            '👥 Membres + bots',
            '👤 Membres uniquement',
            '🤖 Bots uniquement',
            '🌐 Membres en ligne',
            '🔊 Membres en vocal',
        ].join('\n'),
        inline: false,
    });

    return { embeds: [embed], allowedMentions: { parse: [] } };
}

export async function handleList(interaction, client) {
    const guild = interaction.guild;

    try {
        await InteractionHelper.safeDefer(interaction);
    } catch (error) {
        logger.error('Failed to defer reply:', error);
        return;
    }

    if (!isBotOwner(interaction.user.id) && !interaction.member?.permissions?.has(PermissionFlagsBits.ManageChannels)) {
        await InteractionHelper.sendErrorNotice(interaction, 'Tu as besoin de la permission **Gérer les salons** pour voir les compteurs.').catch(logger.error);
        return;
    }

    try {
        const counters = await getServerCounters(client, guild.id);
        const stats = await getGuildCounterStats(guild);
        const channelById = new Map();
        const validCounters = [];
        const missingChannelCounters = [];

        for (const counter of counters) {
            const channel = await resolveCounterChannel(guild, counter.channelId);
            if (channel) {
                validCounters.push(counter);
                channelById.set(counter.channelId, channel);
            } else {
                missingChannelCounters.push(counter);
                logger.warn(
                    `Counter ${counter.id} (type: ${counter.type}) points to missing channel ${counter.channelId} - kept in config, not deleted`,
                );
            }
        }

        if (validCounters.length === 0) {
            await InteractionHelper.safeEditReply(interaction, buildEmptyPayload()).catch(logger.error);
            return;
        }

        const pageCount = Math.ceil(validCounters.length / PAGE_SIZE);
        let page = 0;
        await InteractionHelper.safeEditReply(
            interaction,
            buildListPayload(validCounters, channelById, stats, missingChannelCounters, page),
        ).catch(logger.error);

        if (pageCount <= 1) return;

        const reply = await interaction.fetchReply?.().catch(() => null);
        if (!reply?.createMessageComponentCollector) return;

        const collector = reply.createMessageComponentCollector({
            filter: (component) => component.user.id === interaction.user.id
                && [NAV_PREV, NAV_NEXT, NAV_JUMP].includes(component.customId),
            time: 5 * 60 * 1000,
        });

        collector.on('collect', async (component) => {
            try {
                if (component.customId === NAV_JUMP) {
                    const requested = Number(component.values?.[0]);
                    if (!Number.isInteger(requested)) return;
                    page = Math.min(pageCount - 1, Math.max(0, requested));
                } else {
                    page = component.customId === NAV_PREV
                        ? Math.max(0, page - 1)
                        : Math.min(pageCount - 1, page + 1);
                }

                await component.update(
                    buildListPayload(validCounters, channelById, stats, missingChannelCounters, page),
                );
            } catch (error) {
                logger.debug('Counter pagination update failed:', error.message);
            }
        });

        collector.on('end', async () => {
            try {
                await interaction.editReply({ components: [] });
            } catch {
                // Le message a pu etre supprime entre-temps.
            }
        });
    } catch (error) {
        logger.error('Error displaying counters:', error);
        await InteractionHelper.sendErrorNotice(interaction, 'Une erreur est survenue pendant la récupération des compteurs. Réessaie.').catch(logger.error);
    }
}
