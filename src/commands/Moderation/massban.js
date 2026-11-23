import { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } from 'discord.js';
import { isBotOwner } from '../../utils/ownerIds.js';
import { logModerationAction } from '../../utils/moderation.js';
import { logger } from '../../utils/logger.js';
import { checkRateLimit } from '../../utils/rateLimiter.js';
import { createEmbed, errorEmbed, warningEmbed } from '../../utils/embeds.js';
import {
    brandFooter,
    buildNavRow,
    buildPageJumpRow,
    formatNumber,
    guildIconUrl,
    progressBar,
} from '../../ui/kit.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';

const PAGE_SIZE = 5;
const COLLECTOR_MS = 180_000;
const PREV = 'massban_prev';
const NEXT = 'massban_next';
const JUMP = 'massban_jump';
const NO_MENTIONS = { parse: [], repliedUser: false };
const CONTEXT = 'Bannissement massif';

function simple(embed) {
    return {
        embeds: [embed.setFooter(brandFooter(CONTEXT))],
        components: [],
        allowedMentions: NO_MENTIONS,
    };
}

function short(value, limit = 90) {
    return String(value ?? '—').replace(/[`\n]/g, ' ').slice(0, limit);
}

function buildResultsPayload(results, page, guild) {
    const entries = [
        ...results.successful.map((entry) => ({ ...entry, state: 'ok' })),
        ...results.skipped.map((entry) => ({ ...entry, state: 'skip' })),
        ...results.failed.map((entry) => ({ ...entry, state: 'fail' })),
    ];
    const pageCount = Math.max(1, Math.ceil(entries.length / PAGE_SIZE));
    const currentPage = Math.min(Math.max(0, page), pageCount - 1);
    const slice = entries.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE);

    const lines = slice.map((entry) => {
        const icon = entry.state === 'ok' ? '✅' : entry.state === 'skip' ? '⚠️' : '❌';
        const who = entry.user ? `<@${entry.userId}>` : `\`${entry.userId}\``;
        return `${icon} ${who} — ${short(entry.reason)}`;
    });

    const description = [
        ...lines,
        '',
        `Page **${currentPage + 1}/${pageCount}** \`${progressBar(currentPage + 1, pageCount, 10)}\``,
    ].join('\n');

    const embed = createEmbed({
        title: '🔨 Bannissement massif terminé',
        description,
        color: results.failed.length || results.skipped.length ? 'warning' : 'success',
        thumbnail: guildIconUrl(guild, 64),
        fields: [
            { name: '✅ Bannis', value: `\`${formatNumber(results.successful.length)}\``, inline: true },
            { name: '⚠️ Ignorés', value: `\`${formatNumber(results.skipped.length)}\``, inline: true },
            { name: '❌ Échecs', value: `\`${formatNumber(results.failed.length)}\``, inline: true },
        ],
        footer: brandFooter(CONTEXT),
    });

    return {
        embeds: [embed],
        components: [
            ...buildNavRow({
                page: currentPage,
                pageCount,
                prevId: PREV,
                nextId: NEXT,
                indicatorId: `${JUMP}_indicator`,
            }),
            ...buildPageJumpRow({ page: currentPage, pageCount, customId: JUMP }),
        ],
        allowedMentions: NO_MENTIONS,
    };
}

function attachCollector(reply, userId, results, guild, onPageChange) {
    if (!reply?.createMessageComponentCollector) return null;

    const allowed = [PREV, NEXT, JUMP];
    const collector = reply.createMessageComponentCollector({
        filter: (candidate) => candidate.user.id === userId && allowed.includes(candidate.customId),
        time: COLLECTOR_MS,
    });

    collector.on('collect', async (componentInteraction) => {
        try {
            await componentInteraction.deferUpdate();
        } catch (error) {
            logger.debug(`[MassBan] component expired: ${error.message}`);
            return;
        }

        const pageCount = Math.max(1, Math.ceil(onPageChange.total / PAGE_SIZE));
        if (componentInteraction.customId === PREV) {
            onPageChange.page = Math.max(0, onPageChange.page - 1);
        } else if (componentInteraction.customId === NEXT) {
            onPageChange.page = Math.min(pageCount - 1, onPageChange.page + 1);
        } else if (componentInteraction.customId === JUMP) {
            const requested = Number(componentInteraction.values?.[0]);
            if (!Number.isInteger(requested)) return;
            onPageChange.page = Math.min(pageCount - 1, Math.max(0, requested));
        } else {
            return;
        }

        const payload = buildResultsPayload(results, onPageChange.page, guild);
        try {
            await componentInteraction.editReply(payload);
        } catch (error) {
            logger.debug(`[MassBan] component reply failed: ${error.message}`);
            await componentInteraction.client.users.fetch(userId)
                .then((user) => user.send(payload))
                .catch((dmError) => logger.debug(`[MassBan] DM fallback failed: ${dmError.message}`));
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
        .setName('massban')
        .setDescription('Bannir plusieurs utilisateurs du serveur d’un coup')
        .addStringOption((option) =>
            option
                .setName('users')
                .setDescription('IDs ou mentions des utilisateurs à bannir (séparés par des espaces ou des virgules)')
                .setRequired(true),
        )
        .addStringOption((option) =>
            option
                .setName('reason')
                .setDescription('Raison du bannissement massif')
                .setRequired(false),
        )
        .addIntegerOption((option) =>
            option
                .setName('delete_days')
                .setDescription('Nombre de jours de messages à supprimer (0-7)')
                .setMinValue(0)
                .setMaxValue(7)
                .setRequired(false),
        )
        .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers),
    category: 'moderation',

    async execute(interaction, config, client) {
        const deferSuccess = await InteractionHelper.safeDefer(interaction, { flags: MessageFlags.Ephemeral });
        if (!deferSuccess) {
            logger.warn('Massban interaction defer failed', {
                userId: interaction.user.id,
                guildId: interaction.guildId,
                commandName: 'massban',
            });
            return;
        }

        if (!isBotOwner(interaction.member.id) && !interaction.member.permissions.has(PermissionFlagsBits.BanMembers)) {
            return InteractionHelper.safeEditReply(interaction, simple(
                errorEmbed('Tu n’as pas la permission de bannir des membres.'),
            ));
        }

        const usersInput = interaction.options.getString('users');
        const reason = interaction.options.getString('reason') || 'Bannissement massif - Aucune raison fournie';
        const deleteDays = interaction.options.getInteger('delete_days') || 0;

        try {
            const rateLimitKey = `massban_${interaction.user.id}`;
            const isAllowed = await checkRateLimit(rateLimitKey, 3, 60000);
            if (!isAllowed) {
                return InteractionHelper.safeEditReply(interaction, simple(
                    warningEmbed('Tu effectues des bannissements massifs trop vite. Attends une minute avant de réessayer.'),
                ));
            }

            const userIds = usersInput
                .replace(/<@!?(\d+)>/g, '$1')
                .split(/[\s,]+/)
                .filter((id) => id && /^\d+$/.test(id))
                .slice(0, 20);

            if (userIds.length === 0) {
                return InteractionHelper.safeEditReply(interaction, simple(
                    errorEmbed('Fournis des IDs ou mentions valides. Maximum 20 utilisateurs à la fois.'),
                ));
            }

            if (userIds.includes(interaction.user.id)) {
                return InteractionHelper.safeEditReply(interaction, simple(
                    errorEmbed('Tu ne peux pas t’inclure toi-même dans un bannissement massif.'),
                ));
            }

            if (userIds.includes(client.user.id)) {
                return InteractionHelper.safeEditReply(interaction, simple(
                    errorEmbed('Tu ne peux pas inclure le bot dans un bannissement massif.'),
                ));
            }

            const results = {
                successful: [],
                failed: [],
                skipped: [],
            };

            for (const userId of userIds) {
                try {
                    const user = await client.users.fetch(userId).catch(() => null);

                    if (!user) {
                        results.failed.push({ userId, reason: 'Utilisateur introuvable' });
                        continue;
                    }

                    const member = await interaction.guild.members.fetch(userId).catch(() => null);

                    if (member) {
                        if (
                            member.roles.highest.position >= interaction.member.roles.highest.position &&
                            interaction.guild.ownerId !== interaction.user.id &&
                            !isBotOwner(interaction.user.id)
                        ) {
                            results.skipped.push({
                                user: user.tag,
                                userId,
                                reason: 'Impossible de bannir un utilisateur au rôle égal ou supérieur',
                            });
                            continue;
                        }
                    }

                    await interaction.guild.members.ban(userId, {
                        reason,
                        // discord.js v14 attend des secondes, pas des jours.
                        deleteMessageSeconds: deleteDays * 86400,
                    });

                    results.successful.push({
                        user: user.tag,
                        userId,
                        reason: 'Banni',
                    });

                    await logModerationAction({
                        client,
                        guild: interaction.guild,
                        event: {
                            action: 'Member Banned',
                            target: `<@${user.id}> (${user.id})`,
                            executor: `<@${interaction.user.id}> (${interaction.user.id})`,
                            reason: `${reason} (Bannissement massif)`,
                            metadata: {
                                userId: user.id,
                                moderatorId: interaction.user.id,
                                massBan: true,
                                permanent: true,
                            },
                        },
                    });
                } catch (error) {
                    logger.error(`Failed to ban user ${userId}:`, error);
                    results.failed.push({
                        userId,
                        reason: error?.code === 50013 ? 'Permissions insuffisantes' : 'Le bannissement a échoué',
                    });
                }
            }

            const total = results.successful.length + results.skipped.length + results.failed.length;
            const state = { page: 0, total };
            if (!(await InteractionHelper.safeEditReply(interaction, buildResultsPayload(results, state.page, interaction.guild)))) {
                return;
            }

            if (total <= PAGE_SIZE) return;

            const reply = await interaction.fetchReply?.().catch(() => null);
            attachCollector(reply, interaction.user.id, results, interaction.guild, state);
        } catch (error) {
            logger.error('Error in massban command:', error);
            return InteractionHelper.safeEditReply(interaction, simple(
                errorEmbed('Une erreur est survenue pendant le bannissement massif. Réessaie plus tard.'),
            ));
        }
    },
};
