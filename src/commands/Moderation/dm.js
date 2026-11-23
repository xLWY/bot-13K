import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { logEvent } from '../../utils/moderation.js';
import { logger } from '../../utils/logger.js';
import { sanitizeMarkdown } from '../../utils/sanitization.js';
import { errorEmbed, successEmbed } from '../../utils/embeds.js';
import { brandFooter, formatNumber } from '../../ui/kit.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';

const NO_MENTIONS = { parse: [], repliedUser: false };
const CONTEXT = 'Message privé';

function payload(embed) {
    return {
        embeds: [embed.setFooter(brandFooter(CONTEXT))],
        components: [],
        allowedMentions: NO_MENTIONS,
    };
}

export default {
    data: new SlashCommandBuilder()
        .setName('dm')
        .setDescription('Envoyer un message privé à un utilisateur (réservé au staff)')
        .addUserOption((option) =>
            option
                .setName('user')
                .setDescription('L’utilisateur à qui envoyer le MP')
                .setRequired(true),
        )
        .addStringOption((option) =>
            option
                .setName('message')
                .setDescription('Le message à envoyer')
                .setRequired(true),
        )
        .addBooleanOption((option) =>
            option
                .setName('anonymous')
                .setDescription('Envoyer le message anonymement (défaut : non)')
                .setRequired(false),
        )
        .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
        .setDMPermission(false),
    category: 'Moderation',

    async execute(interaction, config, client) {
        const deferSuccess = await InteractionHelper.safeDefer(interaction);
        if (!deferSuccess) {
            logger.warn('DM interaction defer failed', {
                userId: interaction.user.id,
                guildId: interaction.guildId,
                commandName: 'dm',
            });
            return;
        }

        const targetUser = interaction.options.getUser('user');
        const message = interaction.options.getString('message');
        const anonymous = interaction.options.getBoolean('anonymous') || false;

        try {
            if (message.length > 2000) {
                return InteractionHelper.safeEditReply(interaction, payload(
                    errorEmbed('Le message est trop long : 2000 caractères maximum.'),
                ));
            }

            if (targetUser.bot) {
                return InteractionHelper.safeEditReply(interaction, payload(
                    errorEmbed('Impossible d’envoyer un message privé à un bot.'),
                ));
            }

            const sanitized = sanitizeMarkdown(message);

            const targetMember = await interaction.guild.members.fetch(targetUser.id).catch(() => null);
            const targetName = targetMember?.displayName || targetUser.username;
            const moderatorName = interaction.member?.displayName || interaction.user.username || 'Staff';

            const dmChannel = await targetUser.createDM();
            await dmChannel.send(sanitized);

            await logEvent({
                client: interaction.client,
                guild: interaction.guild,
                event: {
                    action: 'DM Sent',
                    target: `<@${targetUser.id}>`,
                    executor: `<@${interaction.user.id}>`,
                    targetName,
                    moderatorName,
                    content: sanitized,
                    hideFooter: true,
                    metadata: {
                        content: sanitized,
                    },
                },
            });

            return InteractionHelper.safeEditReply(interaction, payload(
                successEmbed(`Le message a été envoyé à <@${targetUser.id}>.`, '✅ Message envoyé')
                    .addFields(
                        { name: 'Destinataire', value: `<@${targetUser.id}> • \`${targetUser.id}\``, inline: false },
                        { name: 'Envoi', value: anonymous ? 'Anonyme' : 'Identifié', inline: true },
                        { name: 'Longueur', value: `\`${formatNumber(message.length)}\` caractères`, inline: true },
                    ),
            ));
        } catch (error) {
            logger.error('DM command error:', error);

            if (error.code === 50007) {
                return InteractionHelper.safeEditReply(interaction, payload(
                    errorEmbed(`Envoi impossible : <@${targetUser.id}> a fermé ses messages privés.`),
                ));
            }

            return InteractionHelper.safeEditReply(interaction, payload(
                errorEmbed('L’envoi du message privé a échoué. Réessaie dans un instant.'),
            ));
        }
    },
};
