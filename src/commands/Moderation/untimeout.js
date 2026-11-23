import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { errorEmbed, successEmbed } from '../../utils/embeds.js';
import { brandFooter } from '../../ui/kit.js';
import { logger } from '../../utils/logger.js';
import { ModerationService } from '../../services/moderationService.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';

const NO_MENTIONS = { parse: [], repliedUser: false };
const CONTEXT = 'Fin de timeout';

function payload(embed) {
    return {
        embeds: [embed.setFooter(brandFooter(CONTEXT))],
        components: [],
        allowedMentions: NO_MENTIONS,
    };
}

export default {
    data: new SlashCommandBuilder()
        .setName('untimeout')
        .setDescription('Retirer le timeout d’un utilisateur')
        .addUserOption((option) =>
            option
                .setName('target')
                .setDescription('Utilisateur à sortir du timeout')
                .setRequired(true),
        )
        .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),
    category: 'moderation',

    async execute(interaction, config, client) {
        const deferSuccess = await InteractionHelper.safeDefer(interaction);
        if (!deferSuccess) {
            logger.warn('Untimeout interaction defer failed', {
                userId: interaction.user.id,
                guildId: interaction.guildId,
                commandName: 'untimeout',
            });
            return;
        }

        try {
            const targetUser = interaction.options.getUser('target');
            const member = interaction.options.getMember('target');

            await ModerationService.removeTimeoutUser({
                guild: interaction.guild,
                member,
                moderator: interaction.member,
            });

            return InteractionHelper.safeEditReply(interaction, payload(
                successEmbed(`Le timeout de <@${targetUser.id}> a été levé.`, '✅ Timeout levé')
                    .addFields(
                        { name: 'Membre', value: `<@${targetUser.id}> • \`${targetUser.id}\``, inline: false },
                        { name: 'Statut', value: '🟢 Peut de nouveau participer', inline: true },
                        { name: 'Modérateur', value: `<@${interaction.user.id}>`, inline: true },
                    ),
            ));
        } catch (error) {
            logger.error('Untimeout command error:', error);
            return InteractionHelper.safeEditReply(interaction, payload(
                errorEmbed(error?.userMessage || 'Impossible de lever le timeout. Réessaie dans un instant.'),
            ));
        }
    },
};
