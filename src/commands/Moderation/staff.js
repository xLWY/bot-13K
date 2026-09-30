import { SlashCommandBuilder, PermissionFlagsBits, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, MessageFlags, ComponentType, ModalBuilder, TextInputBuilder, TextInputStyle } from 'discord.js';
import { getColor } from '../../config/bot.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { isBotOwner } from '../../utils/ownerIds.js';
import { logger } from '../../utils/logger.js';
import { successEmbed, warningEmbed } from '../../utils/embeds.js';
import { logModerationAction } from '../../utils/moderation.js';
import { WarningService } from '../../services/warningService.js';

const P = PermissionFlagsBits;

const ACTIONS = [
    { id: 'staff_warn', label: 'Warn', emoji: '\u{1F4CC}', style: ButtonStyle.Primary, perm: P.ModerateMembers, permLabel: 'Moderer les membres' },
    { id: 'staff_timeout', label: 'Timeout', emoji: '\u{23F0}', style: ButtonStyle.Secondary, perm: P.ModerateMembers, permLabel: 'Moderer les membres', hasDuration: true },
    { id: 'staff_untimeout', label: 'Untimeout', emoji: '\u{23F1}', style: ButtonStyle.Secondary, perm: P.ModerateMembers, permLabel: 'Moderer les membres' },
    { id: 'staff_mute', label: 'Mute', emoji: '\u{1F507}', style: ButtonStyle.Secondary, perm: P.MuteMembers, permLabel: 'Couper les micros' },
    { id: 'staff_unmute', label: 'Unmute', emoji: '\u{1F3A4}', style: ButtonStyle.Secondary, perm: P.MuteMembers, permLabel: 'Couper les micros' },

    { id: 'staff_purge', label: 'Purge', emoji: '\u{1F9F9}', style: ButtonStyle.Secondary, perm: P.ModerateMembers, permLabel: 'Supprimer des messages', noTarget: true, amount: { label: 'Nb de messages', hint: '10', max: 100 } },
    { id: 'staff_lock', label: 'Lock', emoji: '\u{1F512}', style: ButtonStyle.Secondary, perm: P.ManageChannels, permLabel: 'Gerer les salons', noTarget: true },
    { id: 'staff_unlock', label: 'Unlock', emoji: '\u{1F513}', style: ButtonStyle.Secondary, perm: P.ManageChannels, permLabel: 'Gerer les salons', noTarget: true },
    { id: 'staff_slowmode', label: 'Slowmode', emoji: '\u{1F40C}', style: ButtonStyle.Secondary, perm: P.ManageChannels, permLabel: 'Gerer les salons', noTarget: true, amount: { label: 'Secondes', hint: '60', max: 21600 } },
    { id: 'staff_nickreset', label: 'Pseudo', emoji: '\u{270F}\u{FE0F}', style: ButtonStyle.Secondary, perm: P.ModerateMembers, permLabel: 'Moderer les membres' },

    { id: 'staff_kick', label: 'Kick', emoji: '\u{1F5D1}', style: ButtonStyle.Secondary, perm: P.KickMembers, permLabel: 'Expulser des membres' },
    { id: 'staff_ban', label: 'Ban', emoji: '\u{1F6AB}', style: ButtonStyle.Danger, perm: P.BanMembers, permLabel: 'Bannir des membres' },
    { id: 'staff_unban', label: 'Unban', emoji: '\u{1F91E}', style: ButtonStyle.Secondary, perm: P.BanMembers, permLabel: 'Bannir des membres' },
    { id: 'staff_warnlist', label: 'Warn list', emoji: '\u{1F4CB}', style: ButtonStyle.Secondary, perm: P.ModerateMembers, permLabel: 'Moderer les membres' },
];

const REASON_LIMIT = 512;
const MAX_TIMEOUT = 2419200000;
const MAX_PER_ROW = 5;

function buildEmbed(guild) {
    return new EmbedBuilder()
        .setTitle(`\u{2699}\u{FE0F} Panneau des sanctions \u{2014} ${guild.name}`)
        .setDescription(
            'Sanctions et moderation rapide.\n' +
            'Choisis une action, renseigne le membre puis valide.',
        )
        .setColor(getColor('warning'))
        .addFields(
            { name: '\u{1F4CC} Warn', value: '`Avertissement`', inline: true },
            { name: '\u{23F0} Timeout', value: '`Expire auto (28j max)`', inline: true },
            { name: '\u{23F1} Untimeout', value: '`Leve le timeout`', inline: true },
            { name: '\u{1F507} Mute', value: '`Coupe le micro`', inline: true },
            { name: '\u{1F3A4} Unmute', value: `\`Rend le micro\``, inline: true },

            { name: '\u{1F9F9} Purge', value: '`Supprime 1-100 messages`', inline: true },
            { name: '\u{1F512} Lock', value: '`Bloque les ecritures`', inline: true },
            { name: '\u{1F513} Unlock', value: '`Rouvre les ecritures`', inline: true },
            { name: '\u{1F40C} Slowmode', value: '`Delai entre messages`', inline: true },
            { name: '\u{270F}\u{FE0F} Pseudo', value: '`Reinit le pseudo`', inline: true },

            { name: '\u{1F5D1} Kick', value: '`Expulsion`', inline: true },
            { name: '\u{1F6AB} Ban', value: '`Bannissement`', inline: true },
            { name: '\u{1F91E} Unban', value: '`Debannissement`', inline: true },
            { name: '\u{1F4CB} Warn list', value: '`Historique d un membre`', inline: true },
        )
        .setFooter({ text: 'Reserve au proprietaire du bot' })
        .setTimestamp();
}

function buildRows() {
    const rows = [];
    for (let i = 0; i < ACTIONS.length; i += MAX_PER_ROW) {
        rows.push(new ActionRowBuilder().addComponents(
            ACTIONS.slice(i, i + MAX_PER_ROW).map(a =>
                new ButtonBuilder()
                    .setCustomId(a.id)
                    .setLabel(a.label)
                    .setEmoji(a.emoji)
                    .setStyle(a.style),
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
        flags: MessageFlags.Ephemeral,
    });

    InteractionHelper.armDashboardSession(interaction);

    const collector = interaction.channel.createMessageComponentCollector({
        componentType: ComponentType.Button,
        filter: i => i.user.id === interaction.user.id && isBotOwner(i.user.id) && ACTIONS.some(a => a.id === i.customId),
        time: 600_000,
    });

    collector.on('collect', async btn => {
        InteractionHelper.armDashboardSession(interaction);
        const action = ACTIONS.find(a => a.id === btn.customId);
        if (!action) return;

        if (!canRun(btn)) {
            await InteractionHelper.sendErrorNotice(btn, 'Ce panneau est reserve au proprietaire du bot.').catch(() => {});
            return;
        }

        if (action.id === 'staff_warnlist') {
            await openWarnList(btn);
            return;
        }

        await openActionModal(btn, action);
    });
}

async function openActionModal(btn, action) {
    const isUnban = action.id === 'staff_unban';
    const modal = new ModalBuilder().setCustomId(`staff_modal_${action.id}`);

    modal.setTitle(`${action.label} - ${btn.guild.name}`.slice(0, 45));

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
                    .setLabel(isUnban ? 'ID de l utilisateur' : 'Membre (mention ou ID)')
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
                    .setLabel('Duree (30m, 2h, 7d)')
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
                .setLabel(action.noTarget ? 'Raison (optionnel)' : 'Raison')
                .setStyle(TextInputStyle.Paragraph)
                .setMaxLength(REASON_LIMIT)
                .setMinLength(2)
                .setRequired(!action.noTarget && !isUnban),
        ),
    );

    try {
        await btn.showModal(modal);
    } catch {
        return;
    }

    const submitted = await btn
        .awaitModalSubmit({
            filter: i => i.customId === `staff_modal_${action.id}` && i.user.id === btn.user.id,
            time: 120_000,
        })
        .catch(() => null);

    if (!submitted) return;

    const reason = submitted.fields.getTextInputValue('reason_input') || 'Aucune raison donnee';
    const durationRaw = action.hasDuration ? submitted.fields.getTextInputValue('duration_input') : null;
    const amountRaw = action.amount ? submitted.fields.getTextInputValue('amount_input') : null;
    const targetId = resolveUserId(submitted.fields.getTextInputValue('target_input'));

    if (!action.noTarget && !targetId) {
        await submitted.reply({
            embeds: [warningEmbed('Mention ou ID utilisateur invalide.', '\u{26A0}\u{FE0F} Erreur')],
            flags: MessageFlags.Ephemeral,
        }).catch(() => {});
        return;
    }

    const result = await applyAction({
        interaction: submitted,
        action,
        targetId,
        reason,
        durationRaw,
        amountRaw,
        channel: btn.channel,
    });

    if (!result.success) {
        await submitted.reply({
            embeds: [warningEmbed(result.error, '\u{26A0}\u{FE0F} Action impossible')],
            flags: MessageFlags.Ephemeral,
        }).catch(() => {});
        return;
    }

    await submitted.reply({
        embeds: [successEmbed(result.message, result.title)],
        flags: MessageFlags.Ephemeral,
    }).catch(() => {});
}

async function applyChannelAction({ interaction, action, reason, amountRaw, channel }) {
    const me = interaction.guild.members.me;

    if (!channel || !channel.isTextBased?.()) {
        return { success: false, error: 'Ce salon ne gere pas les messages.' };
    }
    if (!me?.permissions.has(action.perm)) {
        return { success: false, error: `Le bot n a pas la permission : ${action.permLabel}.` };
    }

    if (action.id === 'staff_purge') {
        const amount = parseAmount(amountRaw, 10, 100);
        const messages = await channel.messages.fetch({ limit: amount }).catch(() => null);
        if (!messages || messages.size === 0) {
            return { success: false, error: 'Aucun message a supprimer dans ce salon.' };
        }
        const deleted = await channel.bulkDelete(messages, true).then(c => c.size).catch(() => 0);
        if (deleted === 0) {
            return { success: false, error: 'Suppression impossible. Les messages ont plus de 14 jours.' };
        }
        await auditChannel(interaction, 'Messages Purged', reason, { deleted, amount, channelId: channel.id });
        return {
            success: true,
            title: '\u{1F9F9} Purge',
            message: `\`${deleted}\` message(s) supprime(s) dans <#${channel.id}>.`,
        };
    }

    if (action.id === 'staff_lock' || action.id === 'staff_unlock') {
        const locked = action.id === 'staff_lock';
        const ok = await channel.permissionOverwrites
            .edit(channel.roles.everyone, { SendMessages: !locked }, { reason: reason.slice(0, REASON_LIMIT) })
            .then(() => true).catch(() => false);
        if (!ok) return { success: false, error: `${locked ? 'Lock' : 'Unlock'} impossible.` };
        await auditChannel(interaction, locked ? 'Channel Locked' : 'Channel Unlocked', reason, { channelId: channel.id });
        return {
            success: true,
            title: locked ? '\u{1F512} Salon verrouille' : '\u{1F513} Salon deverrouille',
            message: `<#${channel.id}> est maintenant ${locked ? 'bloque (lecture seule)' : 'ouvert aux ecritures'}.`,
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
            title: '\u{1F40C} Slowmode',
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
        return { success: false, error: `Le bot n a pas la permission : ${action.permLabel}.` };
    }

    if (targetId === guild.members.me?.id) {
        return { success: false, error: 'Je ne peux pas me sanctionner moi-meme.' };
    }

    if (action.id === 'staff_ban') {
        const ok = await guild.bans.create(targetId, { reason: reason.slice(0, REASON_LIMIT) })
            .then(() => true).catch(() => false);
        if (!ok) return { success: false, error: 'Ban impossible. Permissions insuffisantes ou membre deja banni.' };
        await audit(interaction, 'User Banned', targetId, reason, moderatorId);
        return { success: true, title: '\u{1F6AB} Banni', message: `<@${targetId}> a ete banni.` };
    }

    if (action.id === 'staff_unban') {
        const banned = await guild.bans.fetch(targetId).then(() => true).catch(() => false);
        if (!banned) return { success: false, error: 'Cet utilisateur n est pas banni.' };
        const ok = await guild.bans.remove(targetId, reason.slice(0, REASON_LIMIT))
            .then(() => true).catch(() => false);
        if (!ok) return { success: false, error: 'Unban impossible. Permissions insuffisantes.' };
        await audit(interaction, 'User Unbanned', targetId, reason, moderatorId);
        return { success: true, title: '\u{1F91E} Debanni', message: `<@${targetId}> n est plus banni.` };
    }

    const member = await guild.members.fetch(targetId).catch(() => null);
    if (!member) {
        return { success: false, error: 'Ce membre n est pas dans le serveur.' };
    }

    const targetRole = member.roles?.cache?.highest;
    if (targetRole && targetRole.position >= interaction.memberRoles?.highest?.position && !isBotOwner(moderatorId)) {
        return { success: false, error: 'Ce membre a un role superieur ou egal au tien.' };
    }

    if (action.id === 'staff_nickreset') {
        if (!member.manageable) {
            return { success: false, error: 'Ce membre n est pas gerable (role trop haut).' };
        }
        const ok = await member.setNickname(null, reason.slice(0, REASON_LIMIT)).then(() => true).catch(() => false);
        if (!ok) return { success: false, error: 'Reinitialisation du pseudo impossible.' };
        await audit(interaction, 'Nickname Reset', targetId, reason, moderatorId);
        return { success: true, title: '\u{270F}\u{FE0F} Pseudo reinitialise', message: `Le pseudo de <@${targetId}> a ete reinitialise.` };
    }

    if (action.id === 'staff_mute' || action.id === 'staff_unmute') {
        const shouldMute = action.id === 'staff_mute';
        if (!member.voice.channelId) {
            return { success: false, error: 'Ce membre n est pas connecte en vocal.' };
        }
        const ok = await member.voice.setMute(shouldMute, reason.slice(0, REASON_LIMIT))
            .then(() => true).catch(() => false);
        if (!ok) return { success: false, error: `${shouldMute ? 'Mute' : 'Unmute'} impossible.` };
        await audit(interaction, shouldMute ? 'User Muted VC' : 'User Unmuted VC', targetId, reason, moderatorId);
        return {
            success: true,
            title: shouldMute ? '\u{1F507} Muet' : '\u{1F3A4} Unmute',
            message: `<@${targetId}> ${shouldMute ? 'est desormais muet' : 'n est plus muet'} en vocal.`,
        };
    }

    if (action.id === 'staff_timeout') {
        const duration = parseDuration(durationRaw);
        if (!duration) return { success: false, error: 'Duree invalide. Formats : 30m, 2h, 7d.' };
        if (duration > MAX_TIMEOUT) return { success: false, error: 'La duree max est de 28 jours.' };
        const ok = await member.timeout(duration, reason.slice(0, REASON_LIMIT)).then(() => true).catch(() => false);
        if (!ok) return { success: false, error: 'Timeout impossible. Permissions insuffisantes.' };
        await audit(interaction, 'User Timed Out', targetId, reason, moderatorId, { duration });
        return { success: true, title: '\u{23F0} Timeout', message: `<@${targetId}> est en timeout.` };
    }

    if (action.id === 'staff_untimeout') {
        const hadTimeout = Boolean(member.communicationDisabledUntilTimestamp && member.communicationDisabledUntilTimestamp > Date.now());
        const ok = await member.timeout(null).then(() => true).catch(() => false);
        if (!ok) return { success: false, error: 'Impossible de lever le timeout.' };
        await audit(interaction, 'User Timeout Removed', targetId, reason, moderatorId);
        return {
            success: true,
            title: '\u{23F1} Timeout leve',
            message: hadTimeout
                ? `Le timeout de <@${targetId}> a ete leve.`
                : `<@${targetId}> n etait pas en timeout.`,
        };
    }

    if (action.id === 'staff_kick') {
        const ok = await member.kick(reason.slice(0, REASON_LIMIT)).then(() => true).catch(() => false);
        if (!ok) return { success: false, error: 'Kick impossible. Permissions insuffisantes.' };
        await audit(interaction, 'User Kicked', targetId, reason, moderatorId);
        return { success: true, title: '\u{1F5D1} Expulse', message: `<@${targetId}> a ete expulse.` };
    }

    if (action.id === 'staff_warn') {
        const result = await WarningService.addWarning({
            guildId: guild.id,
            userId: targetId,
            moderatorId,
            reason,
            timestamp: Date.now(),
        });
        if (!result.success) return { success: false, error: 'Echec de l enregistrement du warn.' };
        await audit(interaction, 'User Warned', targetId, reason, moderatorId, { totalWarns: result.totalCount });
        return {
            success: true,
            title: '\u{1F4CC} Averti',
            message: `<@${targetId}> a ete averti. Total : \`${result.totalCount}\` warn(s).`,
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

async function openWarnList(btn) {
    if (!isBotOwner(btn.user.id)) {
        await InteractionHelper.sendErrorNotice(btn, 'Seul le proprietaire du bot peut consulter la liste des avertissements.').catch(() => {});
        return;
    }

    try {
        await btn.showModal(
            new ModalBuilder()
                .setCustomId('staff_warnlist_modal')
                .setTitle('Warn list')
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

    const submitted = await btn
        .awaitModalSubmit({
            filter: i => i.customId === 'staff_warnlist_modal' && i.user.id === btn.user.id,
            time: 120_000,
        })
        .catch(() => null);

    if (!submitted) return;

    const targetId = resolveUserId(submitted.fields.getTextInputValue('warnuser_input'));
    if (!targetId) {
        await submitted.reply({
            embeds: [warningEmbed('ID utilisateur invalide.', '\u{26A0}\u{FE0F} Erreur')],
            flags: MessageFlags.Ephemeral,
        }).catch(() => {});
        return;
    }

    const warnings = await WarningService.getWarnings(btn.guild.id, targetId);
    const active = Array.isArray(warnings) ? warnings.filter(w => w.status !== 'deleted') : [];

    const list = active.length
        ? active.slice(0, 10).map((w, i) => {
            const who = w.moderatorId ? `<@${w.moderatorId}>` : 'inconnu';
            const when = Math.floor((w.timestamp || Date.now()) / 1000);
            return `**${i + 1}.** ${w.reason || 'Sans raison'} \u{2014} par ${who} \u{2022} <t:${when}:R>`;
        }).join('\n')
        : '`Aucun warn actif`';

    await submitted.reply({
        embeds: [
            new EmbedBuilder()
                .setTitle(`\u{1F4CB} Warns de <@${targetId}>`)
                .setDescription(list)
                .setColor(active.length ? getColor('warning') : getColor('success'))
                .addFields({ name: 'Total', value: `\`${active.length}\``, inline: true })
                .setTimestamp(),
        ],
        flags: MessageFlags.Ephemeral,
    }).catch(() => {});
}

export default {
    data: new SlashCommandBuilder()
        .setName('staff')
        .setDescription('* Panneau de moderation (warn, timeout, mute, purge, lock, kick, ban)')
        .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),

    hiddenFromSlash: true,

    async execute(interaction, config, client) {
        try {
            if (!isBotOwner(interaction.user.id)) {
                return await InteractionHelper.sendErrorNotice(interaction, 'Cette commande est reservee au proprietaire du bot.');
            }

            await InteractionHelper.safeDefer(interaction);
            await openStaff(interaction, client);
        } catch (error) {
            logger.error('Error in /staff:', error);
            return await InteractionHelper.sendErrorNotice(interaction, 'Une erreur est survenue lors de l ouverture du panneau des sanctions.');
        }
    },
};

export { openStaff };
