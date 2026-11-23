import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { isBotOwner } from '../../utils/ownerIds.js';
import { logModerationAction } from '../../utils/moderation.js';
import { errorEmbed, successEmbed } from '../../utils/embeds.js';
import { brandFooter, formatNumber } from '../../ui/kit.js';
import { logger } from '../../utils/logger.js';
import { WarningService } from '../../services/warningService.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';

const NO_MENTIONS = { parse: [], repliedUser: false };
const CONTEXT = 'Avertissement';

function payload(embed) {
    return {
        embeds: [embed.setFooter(brandFooter(CONTEXT))],
        components: [],
        allowedMentions: NO_MENTIONS,
    };
}

function short(value, limit = 400) {
    return String(value ?? 'Sans raison').replace(/`/g, '').slice(0, limit);
}

export default {
    data: new SlashCommandBuilder()
        .setName('warn')
        .setDescription('Avertir un utilisateur')
        .addUserOption((option) =>
            option
                .setName('target')
                .setRequired(true)
                .setDescription('Utilisateur à avertir'),
        )
        .addStringOption((option) =>
            option
                .setName('reason')
                .setRequired(true)
                .setDescription('Raison de l’avertissement'),
        )
        .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),
    category: 'moderation',

    async execute(interaction, config, client) {
        const deferSuccess = await InteractionHelper.safeDefer(interaction);
        if (!deferSuccess) {
            logger.warn('Warn interaction defer failed', {
                userId: interaction.user.id,
                guildId: interaction.guildId,
                commandName: 'warn',
            });
            return;
        }

        try {
            if (!isBotOwner(interaction.member.id) && !interaction.member.permissions.has(PermissionFlagsBits.ModerateMembers)) {
                throw new Error('Tu as besoin de la permission **Modérer les membres** pour émettre des avertissements.');
            }

            const target = interaction.options.getUser('target');
            const member = interaction.options.getMember('target');
            const reason = interaction.options.getString('reason');
            const moderator = interaction.user;
            const guildId = interaction.guildId;

            if (!member) {
                throw new Error('L’utilisateur ciblé n’est actuellement pas dans ce serveur.');
            }

            const result = await WarningService.addWarning({
                guildId,
                userId: target.id,
                moderatorId: moderator.id,
                reason,
                timestamp: Date.now(),
            });

            if (!result.success) {
                throw new Error('Impossible d’enregistrer l’avertissement. Réessaie dans un instant.');
            }

            const totalWarns = result.totalCount;

            await logModerationAction({
                client,
                guild: interaction.guild,
                event: {
                    action: 'User Warned',
                    target: `<@${target.id}> (${target.id})`,
                    executor: `<@${moderator.id}> (${moderator.id})`,
                    reason,
                    metadata: {
                        userId: target.id,
                        moderatorId: moderator.id,
                        totalWarns,
                        warningNumber: totalWarns,
                        warningId: result.id,
                    },
                },
            });

            return InteractionHelper.safeEditReply(interaction, payload(
                successEmbed(`<@${target.id}> a reçu un avertissement.`, '⚠️ Avertissement enregistré')
                    .addFields(
                        { name: 'Membre', value: `<@${target.id}> • \`${target.id}\``, inline: false },
                        { name: 'Motif', value: short(reason), inline: false },
                        { name: 'Total', value: `\`${formatNumber(totalWarns)}\` avertissement(s)`, inline: true },
                        { name: 'Modérateur', value: `<@${moderator.id}>`, inline: true },
                    ),
            ));
        } catch (error) {
            logger.error('Warn command error:', error);
            const knownMessages = new Set([
                'Tu as besoin de la permission **Modérer les membres** pour émettre des avertissements.',
                'L’utilisateur ciblé n’est actuellement pas dans ce serveur.',
                'Impossible d’enregistrer l’avertissement. Réessaie dans un instant.',
            ]);
            const message = knownMessages.has(error?.message)
                ? error.message
                : 'Impossible d’enregistrer l’avertissement. Réessaie dans un instant.';
            return InteractionHelper.safeEditReply(interaction, payload(errorEmbed(message)));
        }
    },
};
