import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { errorEmbed, successEmbed } from '../../utils/embeds.js';
import { brandFooter } from '../../ui/kit.js';
import { logger } from '../../utils/logger.js';
import { ModerationService } from '../../services/moderationService.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';

const NO_MENTIONS = { parse: [], repliedUser: false };
const CONTEXT = 'Débannissement';

function payload(embed) {
    return {
        embeds: [embed.setFooter(brandFooter(CONTEXT))],
        components: [],
        allowedMentions: NO_MENTIONS,
    };
}

function short(value, limit = 400) {
    return String(value ?? 'Aucune raison fournie').replace(/`/g, '').slice(0, limit);
}

export default {
    data: new SlashCommandBuilder()
        .setName('unban')
        .setDescription('Débannir un utilisateur du serveur')
        .addUserOption((option) =>
            option
                .setName('target')
                .setDescription('L’utilisateur à débannir (peut être un ID ou une mention)')
                .setRequired(true),
        )
        .addStringOption((option) =>
            option
                .setName('reason')
                .setDescription('Raison du débannissement')
                .setRequired(false),
        )
        .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers),
    category: 'moderation',

    async execute(interaction, config, client) {
        const deferSuccess = await InteractionHelper.safeDefer(interaction);
        if (!deferSuccess) {
            logger.warn('Unban interaction defer failed', {
                userId: interaction.user.id,
                guildId: interaction.guildId,
                commandName: 'unban',
            });
            return;
        }

        try {
            const targetUser = interaction.options.getUser('target');
            const reason = interaction.options.getString('reason') || 'Aucune raison fournie';

            const result = await ModerationService.unbanUser({
                guild: interaction.guild,
                user: targetUser,
                moderator: interaction.member,
                reason,
            });

            return InteractionHelper.safeEditReply(interaction, payload(
                successEmbed(`<@${targetUser.id}> a été débanni du serveur.`, '✅ Membre débanni')
                    .addFields(
                        { name: 'Membre', value: `<@${targetUser.id}> • \`${targetUser.id}\``, inline: false },
                        { name: 'Motif', value: short(reason), inline: false },
                        { name: 'Dossier', value: `\`#${result.caseId}\``, inline: true },
                    ),
            ));
        } catch (error) {
            logger.error('Unban command error:', error);
            return InteractionHelper.safeEditReply(interaction, payload(
                errorEmbed(error?.userMessage || 'Impossible de débannir ce membre. Réessaie dans un instant.'),
            ));
        }
    },
};
