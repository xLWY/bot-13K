import { SlashCommandBuilder, PermissionFlagsBits, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, MessageFlags, ComponentType, ModalBuilder, TextInputBuilder, TextInputStyle } from 'discord.js';
import { getColor } from '../../config/bot.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { isBotOwner } from '../../utils/ownerIds.js';
import { logger } from '../../utils/logger.js';
import { successEmbed, warningEmbed } from '../../utils/embeds.js';
import { logModerationAction } from '../../utils/moderation.js';
import { WarningService } from '../../services/warningService.js';

const ACTIONS = [
    { id: 'sanctions_warn', label: 'Avertir', emoji: '\u{26A0}', style: ButtonStyle.Primary, perm: 'ModerateMembers' },
    { id: 'sanctions_timeout', label: 'Timeout', emoji: '\u{23F1}', style: ButtonStyle.Secondary, perm: 'ModerateMembers' },
    { id: 'sanctions_kick', label: 'Expulser', emoji: '\u{1F5D1}', style: ButtonStyle.Secondary, perm: 'KickMembers' },
    { id: 'sanctions_ban', label: 'Bannir', emoji: '\u{1F6AB}', style: ButtonStyle.Danger, perm: 'BanMembers' },
    { id: 'sanctions_unban', label: 'Débannir', emoji: '\u{1F91E}', style: ButtonStyle.Secondary, perm: 'BanMembers' },
    { id: 'sanctions_unwarn', label: 'Voir les warns', emoji: '\u{1F4CB}', style: ButtonStyle.Secondary, perm: 'ModerateMembers' },
];

const REASON_LIMIT = 512;

function buildEmbed(guild) {
    return new EmbedBuilder()
        .setTitle('\u{1F6E1}\u{FE0F} Tableau de bord des sanctions')
        .setDescription(
            `Gère les sanctions de **${guild.name}**.\n` +
            'Choisis une action ci-dessous, puis indique le membre et la raison.',
        )
        .setColor(getColor('warning'))
        .addFields(
            { name: '\u{1F4CB} Avertissements', value: 'Utilise **Voir les warns** pour consulter et retirer les avertissements.', inline: false },
        )
        .setFooter({ text: 'Seuls les modérateurs peuvent utiliser ce tableau de bord' })
        .setTimestamp();
}

function buildRows() {
    const rows = [];
    for (let i = 0; i < ACTIONS.length; i += 3) {
        rows.push(new ActionRowBuilder().addComponents(
            ACTIONS.slice(i, i + 3).map(a =>
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

function hasPerm(interaction, action) {
    if (isBotOwner(interaction.user.id)) return true;
    return Boolean(interaction.memberPermissions?.has(PermissionFlagsBits[action.perm]));
}

async function openSanctions(interaction, client) {
    const guildId = interaction.guild.id;

    await InteractionHelper.safeDeferOrUpdate(interaction, {});
    await InteractionHelper.safeEditReply(interaction, {
        embeds: [buildEmbed(interaction.guild)],
        components: buildRows(),
        flags: MessageFlags.Ephemeral,
    });

    InteractionHelper.armDashboardSession(interaction);

    const collector = interaction.channel.createMessageComponentCollector({
        componentType: ComponentType.Button,
        filter: i => i.user.id === interaction.user.id && ACTIONS.some(a => a.id === i.customId),
        time: 300_000,
    });

    collector.on('collect', async btn => {
        InteractionHelper.armDashboardSession(interaction);
        const action = ACTIONS.find(a => a.id === btn.customId);
        if (!action) return;

        if (!hasPerm(btn, action)) {
            await InteractionHelper.sendErrorNotice(btn, `Tu as besoin de la permission \`${action.perm}\` pour cette action.`).catch(() => {});
            return;
        }

        if (action.id === 'sanctions_unwarn') {
            await openWarnList(btn, interaction);
            return;
        }

        await openSanctionModal(btn, action);
    });

    return { guildId, client };
}

async function openSanctionModal(btn, action) {
    const isUnban = action.id === 'sanctions_unban';

    const modal = new ModalBuilder()
        .setCustomId(`sanction_modal_${action.id}`)
        .setTitle(isUnban ? 'Débannir un membre' : `${action.label} un membre`)
        .addComponents(
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('target_input')
                    .setLabel(isUnban ? 'ID de l\'utilisateur' : 'Membre (mention ou ID)')
                    .setStyle(TextInputStyle.Short)
                    .setMaxLength(20)
                    .setMinLength(2)
                    .setRequired(true),
            ),
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('reason_input')
                    .setLabel(isUnban ? 'Raison (optionnel)' : 'Raison de la sanction')
                    .setStyle(TextInputStyle.Paragraph)
                    .setMaxLength(REASON_LIMIT)
                    .setMinLength(2)
                    .setRequired(!isUnban),
            ),
        );

    if (!isUnban && action.id === 'sanctions_timeout') {
        modal.addComponents(
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('duration_input')
                    .setLabel('Durée (ex : 10m, 2h, 7d)')
                    .setStyle(TextInputStyle.Short)
                    .setMaxLength(8)
                    .setMinLength(2)
                    .setRequired(true),
            ),
        );
    }

    try {
        await btn.showModal(modal);
    } catch {
        return;
    }

    const submitted = await btn
        .awaitModalSubmit({
            filter: i => i.customId === `sanction_modal_${action.id}` && i.user.id === btn.user.id,
            time: 120_000,
        })
        .catch(() => null);

    if (!submitted) return;

    const rawTarget = submitted.fields.getTextInputValue('target_input');
    const reason = submitted.fields.getTextInputValue('reason_input') || 'Aucune raison donnée';
    const durationRaw = action.id === 'sanctions_timeout'
        ? submitted.fields.getTextInputValue('duration_input')
        : null;

    try {
        const targetId = resolveUserId(rawTarget);
        if (!targetId) {
            throw new Error('Mention ou ID utilisateur invalide.');
        }

        const result = await applySanction({
            interaction: submitted,
            action,
            targetId,
            reason,
            durationRaw,
        });

        if (!result.success) {
            throw new Error(result.error);
        }

        await submitted.reply({
            embeds: [successEmbed(result.message, result.title)],
            flags: MessageFlags.Ephemeral,
        });
    } catch (error) {
        logger.debug('Sanction action failed:', error.message);
        await submitted.reply({
            embeds: [warningEmbed(error.message || 'Action impossible.', '\u{26A0}\u{FE0F} Sanction échouée')],
            flags: MessageFlags.Ephemeral,
        }).catch(() => {});
    }
}

function resolveUserId(raw) {
    const value = raw.trim();
    const mention = value.match(/^<@!?(\d+)>$/);
    if (mention) return mention[1];
    if (/^\d{5,25}$/.test(value)) return value;
    return null;
}

function parseDuration(raw) {
    if (!raw) return null;
    const match = raw.trim().toLowerCase().match(/^(\d+)\s*(s|m|h|d)$/);
    if (!match) return null;
    const amount = parseInt(match[1], 10);
    if (!Number.isFinite(amount) || amount <= 0) return null;
    const unit = match[2];
    const factor = { s: 1000, m: 60000, h: 3600000, d: 86400000 }[unit];
    return amount * factor;
}

async function applySanction({ interaction, action, targetId, reason, durationRaw }) {
    const guild = interaction.guild;
    const moderatorId = interaction.user.id;

    if (targetId === interaction.client.user.id) {
        return { success: false, error: 'Je ne peux pas me sanctionner moi-même.' };
    }
    if (targetId === moderatorId) {
        return { success: false, error: 'Tu ne peux pas te sanctionner toi-même.' };
    }

    if (action.id === 'sanctions_ban') {
        const banned = await guild.bans.create(targetId, { reason: reason.slice(0, REASON_LIMIT) }).then(() => true).catch(() => false);
        if (!banned) return { success: false, error: 'Impossible de bannir ce membre (permissions insuffisantes ?).' };
        await audit(interaction, 'User Banned', targetId, reason, moderatorId);
        return { success: true, title: '\u{1F6AB} Membre banni', message: `<@${targetId}> a été banni.` };
    }

    if (action.id === 'sanctions_unban') {
        const unbanned = await guild.bans.remove(targetId, reason.slice(0, REASON_LIMIT)).then(() => true).catch(() => false);
        if (!unbanned) return { success: false, error: 'Impossible de débannir ce membre (banni ? permissions ?).' };
        await audit(interaction, 'User Unbanned', targetId, reason, moderatorId);
        return { success: true, title: '\u{1F91E} Membre débanni', message: `<@${targetId}> a été débanni.` };
    }

    const member = await guild.members.fetch(targetId).catch(() => null);
    if (!member) {
        return { success: false, error: 'Ce membre n\'est pas dans le serveur.' };
    }

    if (action.id === 'sanctions_kick') {
        const kicked = await member.kick(reason.slice(0, REASON_LIMIT)).then(() => true).catch(() => false);
        if (!kicked) return { success: false, error: 'Impossible d\'expulser ce membre (permissions insuffisantes ?).' };
        await audit(interaction, 'User Kicked', targetId, reason, moderatorId);
        return { success: true, title: '\u{1F6AA} Membre expulsé', message: `<@${targetId}> a été expulsé.` };
    }

    if (action.id === 'sanctions_timeout') {
        const duration = parseDuration(durationRaw);
        if (!duration) {
            return { success: false, error: 'Durée invalide. Formats acceptés : 30m, 2h, 7d.' };
        }
        if (duration > 2419200000) {
            return { success: false, error: 'La durée maximale est de 28 jours.' };
        }
        const timedOut = await member.timeout(duration, reason.slice(0, REASON_LIMIT)).then(() => true).catch(() => false);
        if (!timedOut) return { success: false, error: 'Impossible de mettre ce membre en timeout.' };
        await audit(interaction, 'User Timed Out', targetId, reason, moderatorId, { duration });
        return { success: true, title: '\u{23F1}\u{FE0F} Timeout appliqué', message: `<@${targetId}> est en timeout.` };
    }

    if (action.id === 'sanctions_warn') {
        const result = await WarningService.addWarning({
            guildId: guild.id,
            userId: targetId,
            moderatorId,
            reason,
            timestamp: Date.now(),
        });
        if (!result.success) {
            return { success: false, error: 'Échec de l\'enregistrement de l\'avertissement.' };
        }
        await audit(interaction, 'User Warned', targetId, reason, moderatorId, { totalWarns: result.totalCount });
        return {
            success: true,
            title: '\u{26A0}\u{FE0F} Membre averti',
            message: `<@${targetId}> a été averti. Total : \`${result.totalCount}\` avertissement(s).`,
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

async function openWarnList(btn, rootInteraction) {
    try {
        await btn.deferUpdate();
    } catch {
        return;
    }

    const modal = new ModalBuilder()
        .setCustomId('sanction_warnlist_modal')
        .setTitle('Consulter les avertissements')
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
        );

    try {
        await btn.showModal(modal);
    } catch {
        return;
    }

    const submitted = await btn
        .awaitModalSubmit({
            filter: i => i.customId === 'sanction_warnlist_modal' && i.user.id === btn.user.id,
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

    const warnings = await WarningService.getWarnings(rootInteraction.guild.id, targetId);
    const active = Array.isArray(warnings) ? warnings.filter(w => w.status !== 'deleted') : [];

    const lines = active.length
        ? active.slice(0, 10).map((w, i) => {
            const who = w.moderatorId ? `<@${w.moderatorId}>` : 'inconnu';
            return `**${i + 1}.** ${w.reason || 'Sans raison'} \u{2014} par ${who} \u{2022} <t:${Math.floor((w.timestamp || Date.now()) / 1000)}:R>`;
        }).join('\n')
        : '`Aucun avertissement actif`';

    await submitted.reply({
        embeds: [
            new EmbedBuilder()
                .setTitle(`\u{1F4CB} Avertissements de <@${targetId}>`)
                .setDescription(lines)
                .setColor(active.length ? getColor('warning') : getColor('success'))
                .addFields({ name: 'Total', value: `\`${active.length}\``, inline: true })
                .setTimestamp(),
        ],
        flags: MessageFlags.Ephemeral,
    }).catch(() => {});
}

export default {
    data: new SlashCommandBuilder()
        .setName('sanctions')
        .setDescription('* Tableau de bord des sanctions (warn, timeout, kick, ban)')
        .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),

    category: 'moderation',

    async execute(interaction, config, client) {
        try {
            if (!isBotOwner(interaction.user.id) && !interaction.memberPermissions?.has(PermissionFlagsBits.ModerateMembers)) {
                return await InteractionHelper.sendErrorNotice(interaction, 'Tu as besoin de la permission **Modérer les membres** pour utiliser `/sanctions`.');
            }

            await InteractionHelper.safeDefer(interaction);
            await openSanctions(interaction, client);
        } catch (error) {
            logger.error('Error in /sanctions:', error);
            return await InteractionHelper.sendErrorNotice(interaction, 'Une erreur est survenue lors de l\'ouverture du tableau de bord des sanctions.');
        }
    },
};

export { openSanctions };
