import { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } from 'discord.js';
import { logger } from '../../utils/logger.js';
import { errorEmbed, successEmbed } from '../../utils/embeds.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { getTicketPermissionContext } from '../../utils/ticketPermissions.js';
import { claimTicket } from '../../services/ticket.js';
import { brandFooter, discordTimestamp, formatNumber } from '../../ui/kit.js';

const NO_MENTIONS = { parse: [], repliedUser: false };
const FOOTER_CONTEXT = 'Tickets';

function errorReply(interaction, message) {
    const embed = errorEmbed(message);
    embed.setFooter(brandFooter(FOOTER_CONTEXT));
    return InteractionHelper.safeEditReply(interaction, {
        embeds: [embed],
        allowedMentions: NO_MENTIONS,
        flags: MessageFlags.Ephemeral,
    });
}

export default {
    data: new SlashCommandBuilder()
        .setName('claim')
        .setDescription('Réclame un ticket ouvert et l’assigne à toi-même.')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
        .setDMPermission(false),

    async execute(interaction, guildConfig, client) {
        try {
            const deferred = await InteractionHelper.safeDefer(interaction, { flags: MessageFlags.Ephemeral });
            if (!deferred) {
                return;
            }

            const permissionContext = await getTicketPermissionContext({ client, interaction });
            if (!permissionContext.ticketData) {
                return errorReply(interaction, 'Cette commande ne peut être utilisée que dans un salon de ticket valide.');
            }

            if (!permissionContext.canManageTicket) {
                return errorReply(interaction, 'Tu dois avoir la permission `Gérer les salons` ou le rôle `Staff Tickets` configuré pour réclamer un ticket.');
            }

            const channel = interaction.channel;
            const result = await claimTicket(channel, interaction.user);

            if (!result.success) {
                logger.warn('Ticket claim failed - not a valid ticket channel', {
                    userId: interaction.user.id,
                    channelId: channel.id,
                    guildId: interaction.guildId,
                    error: result.error
                });
                return errorReply(
                    interaction,
                    result.error || 'Cette commande ne peut être utilisée que dans un salon de ticket valide.',
                );
            }

            const ticket = result.ticketData ?? {};
            const embed = successEmbed('Tu as réclamé ce ticket. Les autres staff peuvent voir ta prise en charge.', '✅ Ticket réclamé');
            embed.addFields(
                { name: 'Salon', value: `${channel}`, inline: true },
                ...(ticket.ticketNumber
                    ? [{ name: 'Ticket', value: `\`#${formatNumber(ticket.ticketNumber)}\``, inline: true }]
                    : []),
                { name: 'Réclamé le', value: discordTimestamp(ticket.claimedAt) },
                { name: 'Par', value: `${interaction.user}` },
            );
            embed.setFooter(brandFooter(FOOTER_CONTEXT));

            await InteractionHelper.safeEditReply(interaction, {
                embeds: [embed],
                allowedMentions: NO_MENTIONS,
                flags: MessageFlags.Ephemeral,
            });

            logger.info('Ticket claimed successfully', {
                userId: interaction.user.id,
                userTag: interaction.user.tag,
                channelId: channel.id,
                channelName: channel.name,
                guildId: interaction.guildId,
                commandName: 'claim'
            });

        } catch (error) {
            logger.error('Error executing claim command', {
                error: error.message,
                stack: error.stack,
                userId: interaction.user.id,
                channelId: interaction.channel?.id,
                guildId: interaction.guildId,
                commandName: 'claim'
            });
            await errorReply(interaction, 'Impossible de réclamer le ticket. Réessaie dans un instant.');
        }
    },
};
