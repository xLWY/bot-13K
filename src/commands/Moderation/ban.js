import { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } from 'discord.js';
import { errorEmbed, successEmbed } from '../../utils/embeds.js';
import { brandFooter } from '../../ui/kit.js';
import { logger } from '../../utils/logger.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { ModerationService } from '../../services/moderationService.js';

const NO_MENTIONS = { parse: [], repliedUser: false };
const CONTEXT = 'Bannissement';

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
        .setName('ban')
        .setDescription('Bannir un utilisateur du serveur')
        .addUserOption((option) =>
            option
                .setName('target')
                .setDescription('L’utilisateur à bannir')
                .setRequired(true),
        )
        .addStringOption((option) =>
            option.setName('reason').setDescription('Raison du bannissement'),
        )
        .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers),
    category: 'moderation',

    async execute(interaction, config, client) {
        await InteractionHelper.safeDefer(interaction, { flags: MessageFlags.Ephemeral });

        try {
            const user = interaction.options.getUser('target');
            const reason = interaction.options.getString('reason') || 'Aucune raison fournie';

            if (user.id === interaction.user.id) {
                return InteractionHelper.safeEditReply(interaction, payload(
                    errorEmbed('Tu ne peux pas te bannir toi-même.'),
                ));
            }
            if (user.id === client.user.id) {
                return InteractionHelper.safeEditReply(interaction, payload(
                    errorEmbed('Tu ne peux pas bannir le bot.'),
                ));
            }

            const result = await ModerationService.banUser({
                guild: interaction.guild,
                user,
                moderator: interaction.member,
                reason,
            });

            return InteractionHelper.safeEditReply(interaction, payload(
                successEmbed(`<@${user.id}> a été banni du serveur.`, '✅ Membre banni')
                    .addFields(
                        { name: 'Membre', value: `<@${user.id}> • \`${user.id}\``, inline: false },
                        { name: 'Motif', value: short(reason), inline: false },
                        { name: 'Dossier', value: `\`#${result.caseId}\``, inline: true },
                    ),
            ));
        } catch (error) {
            logger.error('Ban command error:', error);
            return InteractionHelper.safeEditReply(interaction, payload(
                errorEmbed(error?.userMessage || 'Impossible de bannir ce membre. Réessaie dans un instant.'),
            ));
        }
    },
};
