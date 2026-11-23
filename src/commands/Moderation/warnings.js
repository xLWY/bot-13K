import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { createEmbed, errorEmbed, successEmbed } from '../../utils/embeds.js';
import { logEvent } from '../../utils/moderation.js';
import { logger } from '../../utils/logger.js';
import {
    brandFooter,
    buildNavRow,
    buildPageJumpRow,
    discordTimestamp,
    formatNumber,
    guildIconUrl,
    progressBar,
} from '../../ui/kit.js';
import { WarningService } from '../../services/warningService.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';

const PAGE_SIZE = 5;
const COLLECTOR_MS = 180_000;
const PREV = 'warnings_prev';
const NEXT = 'warnings_next';
const JUMP = 'warnings_jump';
const NO_MENTIONS = { parse: [], repliedUser: false };
const CONTEXT = 'Historique des avertissements';

function short(value, limit = 110) {
    return String(value ?? 'Sans raison').replace(/[`\n]/g, ' ').slice(0, limit);
}

function buildPayload(target, warnings, page, guild, viewerId) {
    if (warnings.length === 0) {
        return {
            embeds: [successEmbed(`<@${target.id}> n’a aucun avertissement enregistré.`, '✅ Aucun avertissement')
                .setFooter(brandFooter(CONTEXT))
                .addFields({ name: 'Membre', value: `<@${target.id}> • \`${target.id}\``, inline: false })],
            components: [],
            allowedMentions: NO_MENTIONS,
        };
    }

    const pageCount = Math.max(1, Math.ceil(warnings.length / PAGE_SIZE));
    const currentPage = Math.min(Math.max(0, page), pageCount - 1);
    const slice = warnings.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE);

    const lines = slice.map((warning, index) => {
        const number = currentPage * PAGE_SIZE + index + 1;
        const author = warning.moderatorId ? `<@${warning.moderatorId}>` : 'inconnu';
        const when = discordTimestamp(warning.timestamp || Date.now(), 'R');
        const date = discordTimestamp(warning.timestamp || Date.now(), 'F');
        return `**#${number}** • ${short(warning.reason)} — ${author} • ${when} (${date})`;
    });

    const embed = createEmbed({
        title: '⚠️ Avertissements',
        description: [
            `Membre : <@${target.id}> • \`${target.id}\``,
            '',
            ...lines,
            '',
            `Page **${currentPage + 1}/${pageCount}** \`${progressBar(currentPage + 1, pageCount, 10)}\``,
        ].join('\n'),
        color: 'warning',
        thumbnail: guildIconUrl(guild, 64),
        fields: [
            { name: 'Total', value: `\`${formatNumber(warnings.length)}\``, inline: true },
            { name: 'Consulté par', value: `<@${viewerId}>`, inline: true },
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

function attachCollector(reply, viewerId, target, warnings, guild, state) {
    if (!reply?.createMessageComponentCollector) return null;

    const allowed = [PREV, NEXT, JUMP];
    const collector = reply.createMessageComponentCollector({
        filter: (candidate) => candidate.user.id === viewerId && allowed.includes(candidate.customId),
        time: COLLECTOR_MS,
    });

    collector.on('collect', async (componentInteraction) => {
        try {
            await componentInteraction.deferUpdate();
        } catch (error) {
            logger.debug(`[Warnings] component expired: ${error.message}`);
            return;
        }

        const pageCount = Math.max(1, Math.ceil(warnings.length / PAGE_SIZE));
        if (componentInteraction.customId === PREV) {
            state.page = Math.max(0, state.page - 1);
        } else if (componentInteraction.customId === NEXT) {
            state.page = Math.min(pageCount - 1, state.page + 1);
        } else if (componentInteraction.customId === JUMP) {
            const requested = Number(componentInteraction.values?.[0]);
            if (!Number.isInteger(requested)) return;
            state.page = Math.min(pageCount - 1, Math.max(0, requested));
        } else {
            return;
        }

        const payload = buildPayload(target, warnings, state.page, guild, viewerId);
        try {
            await componentInteraction.editReply(payload);
        } catch (error) {
            logger.debug(`[Warnings] component reply failed: ${error.message}`);
            await componentInteraction.client.users.fetch(viewerId)
                .then((user) => user.send(payload))
                .catch((dmError) => logger.debug(`[Warnings] DM fallback failed: ${dmError.message}`));
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
        .setName('warnings')
        .setDescription('Voir tous les avertissements d’un utilisateur')
        .addUserOption((option) =>
            option
                .setName('target')
                .setRequired(true)
                .setDescription('Utilisateur dont il faut consulter les avertissements'),
        )
        .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),
    category: 'moderation',

    async execute(interaction, config, client) {
        const deferSuccess = await InteractionHelper.safeDefer(interaction);
        if (!deferSuccess) {
            logger.warn('Warnings interaction defer failed', {
                userId: interaction.user.id,
                guildId: interaction.guildId,
                commandName: 'warnings',
            });
            return;
        }

        try {
            const target = interaction.options.getUser('target');
            const guildId = interaction.guildId;
            const viewerId = interaction.user.id;

            const validWarnings = await WarningService.getWarnings(guildId, target.id);
            const totalWarns = validWarnings.length;

            if (totalWarns === 0) {
                return InteractionHelper.safeEditReply(interaction, buildPayload(target, [], 0, interaction.guild, viewerId));
            }

            await logEvent({
                client,
                guild: interaction.guild,
                event: {
                    action: 'Warnings Viewed',
                    target: `<@${target.id}> (${target.id})`,
                    executor: `<@${viewerId}> (${viewerId})`,
                    reason: `Consultation de ${totalWarns} avertissements`,
                    metadata: {
                        userId: target.id,
                        moderatorId: viewerId,
                        totalWarnings: totalWarns,
                    },
                },
            });

            const state = { page: 0 };
            const payload = buildPayload(target, validWarnings, state.page, interaction.guild, viewerId);
            if (!(await InteractionHelper.safeEditReply(interaction, payload))) return;

            if (totalWarns <= PAGE_SIZE) return;

            const reply = await interaction.fetchReply?.().catch(() => null);
            attachCollector(reply, viewerId, target, validWarnings, interaction.guild, state);
        } catch (error) {
            logger.error('Warnings command error:', error);
            return InteractionHelper.safeEditReply(interaction, {
                embeds: [errorEmbed('Impossible de consulter les avertissements. Réessaie dans un instant.')
                    .setFooter(brandFooter(CONTEXT))],
                components: [],
                allowedMentions: NO_MENTIONS,
            });
        }
    },
};
