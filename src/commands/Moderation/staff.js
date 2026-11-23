import {
    SlashCommandBuilder,
    PermissionFlagsBits,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    MessageFlags,
    ComponentType,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
} from 'discord.js';
import { createEmbed, errorEmbed, successEmbed } from '../../utils/embeds.js';
import {
    brandFooter,
    buildNavRow,
    buildPageJumpRow,
    discordTimestamp,
    formatNumber,
    guildIconUrl,
    progressBar,
} from '../../ui/kit.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { isBotOwner } from '../../utils/ownerIds.js';
import { logger } from '../../utils/logger.js';
import { logModerationAction } from '../../utils/moderation.js';
import { WarningService } from '../../services/warningService.js';

const P = PermissionFlagsBits;

const ACTIONS = [
    { id: 'staff_warn', label: 'Avertir', emoji: '📌', style: ButtonStyle.Primary, perm: P.ModerateMembers, permLabel: 'Modérer les membres' },
    { id: 'staff_timeout', label: 'Timeout', emoji: '⏰', style: ButtonStyle.Secondary, perm: P.ModerateMembers, permLabel: 'Modérer les membres', hasDuration: true },
    { id: 'staff_untimeout', label: 'Lever', emoji: '⏱️', style: ButtonStyle.Secondary, perm: P.ModerateMembers, permLabel: 'Modérer les membres' },
    { id: 'staff_mute', label: 'Muet', emoji: '🔇', style: ButtonStyle.Secondary, perm: P.MuteMembers, permLabel: 'Couper les micros' },
    { id: 'staff_unmute', label: 'Parler', emoji: '🎤', style: ButtonStyle.Secondary, perm: P.MuteMembers, permLabel: 'Couper les micros' },

    { id: 'staff_purge', label: 'Purge', emoji: '🧹', style: ButtonStyle.Secondary, perm: P.ModerateMembers, permLabel: 'Supprimer des messages', noTarget: true, amount: { label: 'Nb de messages', hint: '10', max: 100 } },
    { id: 'staff_lock', label: 'Verrouiller', emoji: '🔒', style: ButtonStyle.Secondary, perm: P.ManageChannels, permLabel: 'Gérer les salons', noTarget: true },
    { id: 'staff_unlock', label: 'Déverrouiller', emoji: '🔓', style: ButtonStyle.Secondary, perm: P.ManageChannels, permLabel: 'Gérer les salons', noTarget: true },
    { id: 'staff_slowmode', label: 'Slowmode', emoji: '🐌', style: ButtonStyle.Secondary, perm: P.ManageChannels, permLabel: 'Gérer les salons', noTarget: true, amount: { label: 'Secondes', hint: '60', max: 21600 } },
    { id: 'staff_nickreset', label: 'Pseudo', emoji: '✏️', style: ButtonStyle.Secondary, perm: P.ModerateMembers, permLabel: 'Modérer les membres' },

    { id: 'staff_kick', label: 'Expulser', emoji: '🗑️', style: ButtonStyle.Secondary, perm: P.KickMembers, permLabel: 'Expulser des membres' },
    { id: 'staff_ban', label: 'Bannir', emoji: '🚫', style: ButtonStyle.Danger, perm: P.BanMembers, permLabel: 'Bannir des membres' },
    { id: 'staff_unban', label: 'Débannir', emoji: '🤝', style: ButtonStyle.Secondary, perm: P.BanMembers, permLabel: 'Bannir des membres' },
    { id: 'staff_warnlist', label: 'Avertis', emoji: '📋', style: ButtonStyle.Secondary, perm: P.ModerateMembers, permLabel: 'Modérer les membres' },
];

const REASON_LIMIT = 512;
const MAX_TIMEOUT = 2419200000;
const MAX_PER_ROW = 5;
const WARN_PAGE_SIZE = 5;
const WARN_COLLECTOR_MS = 180_000;
const WARN_PREV = 'staff_warn_prev';
const WARN_NEXT = 'staff_warn_next';
const WARN_JUMP = 'staff_warn_jump';
const NO_MENTIONS = { parse: [], repliedUser: false };

function embedPayload(embed) {
    return {
        embeds: [embed],
        components: [],
        allowedMentions: NO_MENTIONS,
        flags: MessageFlags.Ephemeral,
    };
}

function notice(embed, context) {
    return embedPayload(embed.setFooter(brandFooter(context)));
}

function short(value, limit = 110) {
    return String(value ?? 'Sans raison').replace(/[`\n]/g, ' ').slice(0, limit);
}

function buildEmbed(guild) {
    return createEmbed({
        title: 'Panneau de modération',
        description: [
            `Serveur : **${String(guild.name ?? 'Inconnu').replace(/[`@]/g, '').slice(0, 80)}**`,
            'Choisis une action dans la barre de boutons, puis renseigne le membre et le motif dans la fenêtre.',
        ].join('\n'),
        color: 'warning',
        thumbnail: guildIconUrl(guild, 128),
        fields: [
            { name: '🛡️ Membres', value: '`Avertir` • `Timeout` • `Lever` • `Expulser` • `Bannir` • `Débannir`', inline: false },
            { name: '🎙️ Vocal et pseudo', value: '`Muet` • `Parler` • `Réinitialiser le pseudo`', inline: false },
            { name: '🧹 Salon', value: '`Purge` • `Verrouiller` • `Déverrouiller` • `Slowmode`', inline: false },
            { name: '📋 Consultation', value: '`Avertis` — historique des avertissements d’un membre', inline: false },
        ],
        footer: brandFooter('Panneau de modération'),
    });
}

function buildRows() {
    const rows = [];
    for (let i = 0; i < ACTIONS.length; i += MAX_PER_ROW) {
        rows.push(new ActionRowBuilder().addComponents(
            ACTIONS.slice(i, i + MAX_PER_ROW).map((action) =>
                new ButtonBuilder()
                    .setCustomId(action.id)
                    .setLabel(action.label)
                    .setEmoji(action.emoji)
                    .setStyle(action.style),
            ),
        ));
    }
    return rows;
}

function canRun(interaction) {
    return isBotOwner(interaction.user.id);
}

function resolveUserId(raw) {
    const value = (raw || '').trim();
    const mention = value.match(/^<@!?(\d+)>$/);
    if (mention) return mention[1];
    if (/^\d{5,25}$/.test(value)) return value;
    return null;
}

function parseDuration(raw) {
    if (!raw) return null;
    const match = String(raw).trim().toLowerCase().match(/^(\d+)\s*(s|m|h|d)$/);
    if (!match) return null;
    const amount = parseInt(match[1], 10);
    if (!Number.isFinite(amount) || amount <= 0) return null;
    return amount * { s: 1000, m: 60000, h: 3600000, d: 86400000 }[match[2]];
}

function parseAmount(raw, fallback, max) {
    const value = parseInt(String(raw ?? '').trim(), 10);
    if (!Number.isFinite(value) || value <= 0) return fallback;
    return Math.min(value, max);
}

async function openStaff(interaction, client) {
    await InteractionHelper.safeDeferOrUpdate(interaction, {});
    await InteractionHelper.safeEditReply(interaction, {
        embeds: [buildEmbed(interaction.guild)],
        components: buildRows(),
        allowedMentions: NO_MENTIONS,
    });

    InteractionHelper.armDashboardSession(interaction);

    const collector = interaction.channel.createMessageComponentCollector({
        componentType: ComponentType.Button,
        filter: (candidate) => candidate.user.id === interaction.user.id && isBotOwner(candidate.user.id) && ACTIONS.some((action) => action.id === candidate.customId),
        time: 600_000,
    });

    collector.on('collect', async (button) => {
        InteractionHelper.armDashboardSession(interaction);
        const action = ACTIONS.find((candidate) => candidate.id === button.customId);
        if (!action) return;

        if (!canRun(button)) {
            await InteractionHelper.sendErrorNotice(button, 'Ce panneau est réservé au propriétaire du bot.').catch(() => {});
            return;
        }

        if (action.id === 'staff_warnlist') {
            await openWarnList(button);
            return;
        }

        await openActionModal(button, action);
    });
}

async function openActionModal(button, action) {
    const isUnban = action.id === 'staff_unban';
    const modal = new ModalBuilder().setCustomId(`staff_modal_${action.id}`);

    modal.setTitle(`${action.label} - ${button.guild.name}`.slice(0, 45));

    if (action.noTarget) {
        modal.addComponents(
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('target_input')
                    .setLabel('Membre (laisser vide)')
                    .setStyle(TextInputStyle.Short)
                    .setMaxLength(20)
                    .setRequired(false),
            ),
        );
    } else {
        modal.addComponents(
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('target_input')
                    .setLabel(isUnban ? 'ID de l’utilisateur' : 'Membre (mention ou ID)')
                    .setStyle(TextInputStyle.Short)
                    .setMaxLength(20)
                    .setMinLength(2)
                    .setRequired(true),
            ),
        );
    }

    if (action.hasDuration) {
        modal.addComponents(
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('duration_input')
                    .setLabel('Durée (30m, 2h, 7d)')
                    .setStyle(TextInputStyle.Short)
                    .setMaxLength(8)
                    .setMinLength(2)
                    .setRequired(true),
            ),
        );
    }

    if (action.amount) {
        modal.addComponents(
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('amount_input')
                    .setLabel(action.amount.label)
                    .setPlaceholder(action.amount.hint)
                    .setStyle(TextInputStyle.Short)
                    .setMaxLength(6)
                    .setRequired(false),
            ),
        );
    }

    modal.addComponents(
        new ActionRowBuilder().addComponents(
            new TextInputBuilder()
                .setCustomId('reason_input')
                .setLabel(action.noTarget ? 'Raison (facultative)' : 'Raison')
                .setStyle(TextInputStyle.Paragraph)
                .setMaxLength(REASON_LIMIT)
                .setMinLength(2)
                .setRequired(!action.noTarget && !isUnban),
        ),
    );

    try {
        await button.showModal(modal);
    } catch {
        return;
    }

    const submitted = await button
        .awaitModalSubmit({
            filter: (candidate) => candidate.customId === `staff_modal_${action.id}` && candidate.user.id === button.user.id,
            time: 120_000,
        })
        .catch(() => null);

    if (!submitted) return;

    const reason = submitted.fields.getTextInputValue('reason_input') || 'Aucune raison donnée';
    const durationRaw = action.hasDuration ? submitted.fields.getTextInputValue('duration_input') : null;
    const amountRaw = action.amount ? submitted.fields.getTextInputValue('amount_input') : null;
    const targetId = resolveUserId(submitted.fields.getTextInputValue('target_input'));

    if (!action.noTarget && !targetId) {
        await submitted.reply(notice(errorEmbed('Mention ou ID utilisateur invalide.'), 'Sanction')).catch(() => {});
        return;
    }

    const result = await applyAction({
        interaction: submitted,
        action,
        targetId,
        reason,
        durationRaw,
        amountRaw,
        channel: button.channel,
    });

    if (!result.success) {
        await submitted.reply(notice(errorEmbed(result.error), 'Sanction')).catch(() => {});
        return;
    }

    await submitted.reply(
        notice(successEmbed(result.message, result.title), 'Sanction appliquée'),
    ).catch(() => {});
}

async function applyChannelAction({ interaction, action, reason, amountRaw, channel }) {
    const me = interaction.guild.members.me;

    if (!channel || !channel.isTextBased?.()) {
        return { success: false, error: 'Ce salon ne gère pas les messages.' };
    }
    if (!me?.permissions.has(action.perm)) {
        return { success: false, error: `Le bot n’a pas la permission : ${action.permLabel}.` };
    }

    if (action.id === 'staff_purge') {
        const amount = parseAmount(amountRaw, 10, 100);
        const messages = await channel.messages.fetch({ limit: amount }).catch(() => null);
        if (!messages || messages.size === 0) {
            return { success: false, error: 'Aucun message à supprimer dans ce salon.' };
        }
        const deleted = await channel.bulkDelete(messages, true).then((collection) => collection.size).catch(() => 0);
        if (deleted === 0) {
            return { success: false, error: 'Suppression impossible. Les messages ont plus de 14 jours.' };
        }
        await auditChannel(interaction, 'Messages Purged', reason, { deleted, amount, channelId: channel.id });
        return {
            success: true,
            title: '🧹 Purge',
            message: `\`${formatNumber(deleted)}\` message(s) supprimé(s) dans <#${channel.id}>.`,
        };
    }

    if (action.id === 'staff_lock' || action.id === 'staff_unlock') {
        const locked = action.id === 'staff_lock';
        const ok = await channel.permissionOverwrites
            .edit(interaction.guild.roles.everyone, { SendMessages: !locked }, { reason: reason.slice(0, REASON_LIMIT) })
            .then(() => true).catch(() => false);
        if (!ok) return { success: false, error: `${locked ? 'Verrouillage' : 'Déverrouillage'} impossible.` };
        await auditChannel(interaction, locked ? 'Channel Locked' : 'Channel Unlocked', reason, { channelId: channel.id });
        return {
            success: true,
            title: locked ? '🔒 Salon verrouillé' : '🔓 Salon déverrouillé',
            message: `<#${channel.id}> est maintenant ${locked ? 'bloqué (lecture seule)' : 'ouvert aux écritures'}.`,
        };
    }

    if (action.id === 'staff_slowmode') {
        const seconds = parseAmount(amountRaw, 60, 21600);
        const ok = await channel.setRateLimitPerUser(seconds, reason.slice(0, REASON_LIMIT))
            .then(() => true).catch(() => false);
        if (!ok) return { success: false, error: 'Slowmode impossible.' };
        await auditChannel(interaction, 'Slowmode Set', reason, { seconds, channelId: channel.id });
        return {
            success: true,
            title: '🐌 Slowmode',
            message: `Slowmode de <#${channel.id}> : \`${seconds}s\` entre chaque message.`,
        };
    }

    return { success: false, error: 'Action inconnue.' };
}

async function applyAction({ interaction, action, targetId, reason, durationRaw, amountRaw, channel }) {
    const guild = interaction.guild;
    const moderatorId = interaction.user.id;

    if (action.noTarget) {
        return applyChannelAction({ interaction, action, reason, amountRaw, channel });
    }

    if (!guild.members.me?.permissions.has(action.perm)) {
        return { success: false, error: `Le bot n’a pas la permission : ${action.permLabel}.` };
    }

    if (targetId === guild.members.me?.id) {
        return { success: false, error: 'Je ne peux pas me sanctionner moi-même.' };
    }

    if (action.id === 'staff_ban') {
        const ok = await guild.bans.create(targetId, { reason: reason.slice(0, REASON_LIMIT) })
            .then(() => true).catch(() => false);
        if (!ok) return { success: false, error: 'Ban impossible. Permissions insuffisantes ou membre déjà banni.' };
        await audit(interaction, 'User Banned', targetId, reason, moderatorId);
        return { success: true, title: '🚫 Banni', message: `<@${targetId}> a été banni.` };
    }

    if (action.id === 'staff_unban') {
        const banned = await guild.bans.fetch(targetId).then(() => true).catch(() => false);
        if (!banned) return { success: false, error: 'Cet utilisateur n’est pas banni.' };
        const ok = await guild.bans.remove(targetId, reason.slice(0, REASON_LIMIT))
            .then(() => true).catch(() => false);
        if (!ok) return { success: false, error: 'Débannissement impossible. Permissions insuffisantes.' };
        await audit(interaction, 'User Unbanned', targetId, reason, moderatorId);
        return { success: true, title: '🤝 Débanni', message: `<@${targetId}> n’est plus banni.` };
    }

    const member = await guild.members.fetch(targetId).catch(() => null);
    if (!member) {
        return { success: false, error: 'Ce membre n’est pas dans le serveur.' };
    }

    const targetRole = member.roles?.cache?.highest;
    if (targetRole && targetRole.position >= (interaction.member?.roles?.highest?.position ?? 0) && !isBotOwner(moderatorId)) {
        return { success: false, error: 'Ce membre a un rôle supérieur ou égal au tien.' };
    }

    if (action.id === 'staff_nickreset') {
        if (!member.manageable) {
            return { success: false, error: 'Ce membre n’est pas gérable (rôle trop haut).' };
        }
        const ok = await member.setNickname(null, reason.slice(0, REASON_LIMIT)).then(() => true).catch(() => false);
        if (!ok) return { success: false, error: 'Réinitialisation du pseudo impossible.' };
        await audit(interaction, 'Nickname Reset', targetId, reason, moderatorId);
        return { success: true, title: '✏️ Pseudo réinitialisé', message: `Le pseudo de <@${targetId}> a été réinitialisé.` };
    }

    if (action.id === 'staff_mute' || action.id === 'staff_unmute') {
        const shouldMute = action.id === 'staff_mute';
        if (!member.voice.channelId) {
            return { success: false, error: 'Ce membre n’est pas connecté en vocal.' };
        }
        const ok = await member.voice.setMute(shouldMute, reason.slice(0, REASON_LIMIT))
            .then(() => true).catch(() => false);
        if (!ok) return { success: false, error: `${shouldMute ? 'Muet' : 'Rétablissement du micro'} impossible.` };
        await audit(interaction, shouldMute ? 'User Muted VC' : 'User Unmuted VC', targetId, reason, moderatorId);
        return {
            success: true,
            title: shouldMute ? '🔇 Muet' : '🎤 Micro rendu',
            message: `<@${targetId}> ${shouldMute ? 'est désormais muet' : 'n’est plus muet'} en vocal.`,
        };
    }

    if (action.id === 'staff_timeout') {
        const duration = parseDuration(durationRaw);
        if (!duration) return { success: false, error: 'Durée invalide. Formats : 30m, 2h, 7d.' };
        if (duration > MAX_TIMEOUT) return { success: false, error: 'La durée maximale est de 28 jours.' };
        const ok = await member.timeout(duration, reason.slice(0, REASON_LIMIT)).then(() => true).catch(() => false);
        if (!ok) return { success: false, error: 'Timeout impossible. Permissions insuffisantes.' };
        await audit(interaction, 'User Timed Out', targetId, reason, moderatorId, { duration });
        return {
            success: true,
            title: '⏰ Timeout',
            message: `<@${targetId}> est en timeout jusqu’à ${discordTimestamp(Date.now() + duration, 'R')}.`,
        };
    }

    if (action.id === 'staff_untimeout') {
        const hadTimeout = Boolean(member.communicationDisabledUntilTimestamp && member.communicationDisabledUntilTimestamp > Date.now());
        const ok = await member.timeout(null).then(() => true).catch(() => false);
        if (!ok) return { success: false, error: 'Impossible de lever le timeout.' };
        await audit(interaction, 'User Timeout Removed', targetId, reason, moderatorId);
        return {
            success: true,
            title: '⏱️ Timeout levé',
            message: hadTimeout
                ? `Le timeout de <@${targetId}> a été levé.`
                : `<@${targetId}> n’était pas en timeout.`,
        };
    }

    if (action.id === 'staff_kick') {
        const ok = await member.kick(reason.slice(0, REASON_LIMIT)).then(() => true).catch(() => false);
        if (!ok) return { success: false, error: 'Expulsion impossible. Permissions insuffisantes.' };
        await audit(interaction, 'User Kicked', targetId, reason, moderatorId);
        return { success: true, title: '🗑️ Expulsé', message: `<@${targetId}> a été expulsé.` };
    }

    if (action.id === 'staff_warn') {
        const result = await WarningService.addWarning({
            guildId: guild.id,
            userId: targetId,
            moderatorId,
            reason,
            timestamp: Date.now(),
        });
        if (!result.success) return { success: false, error: 'Échec de l’enregistrement de l’avertissement.' };
        await audit(interaction, 'User Warned', targetId, reason, moderatorId, { totalWarns: result.totalCount });
        return {
            success: true,
            title: '📌 Averti',
            message: `<@${targetId}> a été averti. Total : \`${formatNumber(result.totalCount)}\` avertissement(s).`,
        };
    }

    return { success: false, error: 'Action inconnue.' };
}

async function audit(interaction, eventName, targetId, reason, moderatorId, metadata = {}) {
    await logModerationAction({
        client: interaction.client,
        guild: interaction.guild,
        event: {
            action: eventName,
            target: `<@${targetId}> (${targetId})`,
            executor: `<@${moderatorId}> (${moderatorId})`,
            reason,
            metadata: { userId: targetId, moderatorId, ...metadata },
        },
    }).catch(() => {});
}

async function auditChannel(interaction, eventName, reason, metadata = {}) {
    await logModerationAction({
        client: interaction.client,
        guild: interaction.guild,
        event: {
            action: eventName,
            target: metadata.channelId ? `<#${metadata.channelId}>` : 'salon',
            executor: `<@${interaction.user.id}> (${interaction.user.id})`,
            reason,
            metadata,
        },
    }).catch(() => {});
}

function buildWarnListPayload(targetId, warnings, page, guild, viewerId) {
    if (warnings.length === 0) {
        return {
            embeds: [successEmbed(`<@${targetId}> n’a aucun avertissement actif.`, '✅ Aucun avertissement')
                .setFooter(brandFooter('Historique des avertissements'))
                .addFields({ name: 'Membre', value: `<@${targetId}>`, inline: false })],
            components: [],
            allowedMentions: NO_MENTIONS,
        };
    }

    const pageCount = Math.max(1, Math.ceil(warnings.length / WARN_PAGE_SIZE));
    const currentPage = Math.min(Math.max(0, page), pageCount - 1);
    const slice = warnings.slice(currentPage * WARN_PAGE_SIZE, (currentPage + 1) * WARN_PAGE_SIZE);

    const lines = slice.map((warning, index) => {
        const number = currentPage * WARN_PAGE_SIZE + index + 1;
        const author = warning.moderatorId ? `<@${warning.moderatorId}>` : 'inconnu';
        return `**#${number}** • ${short(warning.reason)} — ${author} • ${discordTimestamp(warning.timestamp || Date.now(), 'R')}`;
    });

    const embed = createEmbed({
        title: '📋 Avertissements',
        description: [
            `Membre : <@${targetId}> • \`${targetId}\``,
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
        footer: brandFooter('Historique des avertissements'),
    });

    return {
        embeds: [embed],
        components: [
            ...buildNavRow({
                page: currentPage,
                pageCount,
                prevId: WARN_PREV,
                nextId: WARN_NEXT,
                indicatorId: `${WARN_JUMP}_indicator`,
            }),
            ...buildPageJumpRow({ page: currentPage, pageCount, customId: WARN_JUMP }),
        ],
        allowedMentions: NO_MENTIONS,
    };
}

async function openWarnList(button) {
    if (!isBotOwner(button.user.id)) {
        await InteractionHelper.sendErrorNotice(button, 'Seul le propriétaire du bot peut consulter les avertissements.').catch(() => {});
        return;
    }

    try {
        await button.showModal(
            new ModalBuilder()
                .setCustomId('staff_warnlist_modal')
                .setTitle('Avertissements')
                .addComponents(
                    new ActionRowBuilder().addComponents(
                        new TextInputBuilder()
                            .setCustomId('warnuser_input')
                            .setLabel('ID du membre')
                            .setStyle(TextInputStyle.Short)
                            .setMaxLength(20)
                            .setMinLength(2)
                            .setRequired(true),
                    ),
                ),
        );
    } catch {
        return;
    }

    const submitted = await button
        .awaitModalSubmit({
            filter: (candidate) => candidate.customId === 'staff_warnlist_modal' && candidate.user.id === button.user.id,
            time: 120_000,
        })
        .catch(() => null);

    if (!submitted) return;

    const targetId = resolveUserId(submitted.fields.getTextInputValue('warnuser_input'));
    if (!targetId) {
        await submitted.reply(notice(errorEmbed('ID utilisateur invalide.'), 'Historique des avertissements')).catch(() => {});
        return;
    }

    const warnings = await WarningService.getWarnings(button.guild.id, targetId);
    const active = Array.isArray(warnings) ? warnings.filter((warning) => warning.status !== 'deleted') : [];
    const state = { page: 0 };
    const payload = buildWarnListPayload(targetId, active, state.page, button.guild, button.user.id);

    const reply = await submitted.reply({ ...payload, flags: MessageFlags.Ephemeral }).catch(() => null);
    if (!reply || active.length <= WARN_PAGE_SIZE) return;

    const allowed = [WARN_PREV, WARN_NEXT, WARN_JUMP];
    const collector = reply.createMessageComponentCollector({
        filter: (candidate) => candidate.user.id === button.user.id && allowed.includes(candidate.customId),
        time: WARN_COLLECTOR_MS,
    });

    collector.on('collect', async (componentInteraction) => {
        try {
            await componentInteraction.deferUpdate();
        } catch (error) {
            logger.debug(`[Staff] component expired: ${error.message}`);
            return;
        }

        const pageCount = Math.max(1, Math.ceil(active.length / WARN_PAGE_SIZE));
        if (componentInteraction.customId === WARN_PREV) {
            state.page = Math.max(0, state.page - 1);
        } else if (componentInteraction.customId === WARN_NEXT) {
            state.page = Math.min(pageCount - 1, state.page + 1);
        } else if (componentInteraction.customId === WARN_JUMP) {
            const requested = Number(componentInteraction.values?.[0]);
            if (!Number.isInteger(requested)) return;
            state.page = Math.min(pageCount - 1, Math.max(0, requested));
        } else {
            return;
        }

        const updated = buildWarnListPayload(targetId, active, state.page, button.guild, button.user.id);
        try {
            await componentInteraction.editReply(updated);
        } catch (error) {
            logger.debug(`[Staff] component reply failed: ${error.message}`);
            await button.user.send(updated).catch((dmError) => {
                logger.debug(`[Staff] DM fallback failed: ${dmError.message}`);
            });
        }
    });

    collector.on('end', async (_, reason) => {
        if (reason !== 'time') return;
        await reply.edit({ components: [] }).catch(() => {});
    });
}

export default {
    data: new SlashCommandBuilder()
        .setName('staff')
        .setDescription('Panneau de modération (avertissement, timeout, mute, purge, lock, kick, ban)')
        .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),

    hiddenFromSlash: true,

    async execute(interaction, config, client) {
        try {
            if (!isBotOwner(interaction.user.id)) {
                return InteractionHelper.safeReply(interaction, notice(
                    errorEmbed('Cette commande est réservée au propriétaire du bot.'),
                    'Accès refusé',
                ));
            }

            await InteractionHelper.safeDefer(interaction);
            await openStaff(interaction, client);
        } catch (error) {
            logger.error('Error in /staff:', error);
            return InteractionHelper.safeEditReply(interaction, notice(
                errorEmbed('Impossible d’ouvrir le panneau des sanctions. Réessaie dans un instant.'),
                'Panneau de modération',
            ));
        }
    },
};

export { openStaff };
