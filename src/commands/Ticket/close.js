import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import { logger } from '../../utils/logger.js';
import { errorEmbed, successEmbed } from '../../utils/embeds.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { getTicketPermissionContext } from '../../utils/ticketPermissions.js';
import { closeTicket } from '../../services/ticket.js';
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
        .setName('close')
        .setDescription('Ferme le ticket actuel.')
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

            if (!permissionContext.canCloseTicket) {
                return errorReply(interaction, 'Tu dois avoir la permission `Gérer les salons`, le rôle `Staff Tickets` configuré, ou être le créateur du ticket pour le fermer.');
            }

            const channel = interaction.channel;
            const reason = 'Aucun motif précisé.';
            const result = await closeTicket(channel, interaction.user, reason);

            if (!result.success) {
                logger.warn('Ticket close failed - not a valid ticket channel', {
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
            const embed = successEmbed('Le ticket est fermé.', '✅ Ticket fermé');
            embed.addFields(
                { name: 'Salon', value: `${channel}`, inline: true },
                ...(ticket.ticketNumber
                    ? [{ name: 'Ticket', value: `\`#${formatNumber(ticket.ticketNumber)}\``, inline: true }]
                    : []),
                { name: 'Fermé le', value: discordTimestamp(ticket.closedAt) },
                { name: 'Motif', value: reason },
                { name: 'Par', value: `${interaction.user}` },
            );
            embed.setFooter(brandFooter(FOOTER_CONTEXT));

            await InteractionHelper.safeEditReply(interaction, {
                embeds: [embed],
                allowedMentions: NO_MENTIONS,
                flags: MessageFlags.Ephemeral,
            });

            logger.info('Ticket closed successfully', {
                userId: interaction.user.id,
                userTag: interaction.user.tag,
                channelId: channel.id,
                channelName: channel.name,
                guildId: interaction.guildId,
                reason: 'Aucun motif précisé.',
                commandName: 'close'
            });

        } catch (error) {
            logger.error('Error executing close command', {
                error: error.message,
                stack: error.stack,
                userId: interaction.user.id,
                channelId: interaction.channel?.id,
                guildId: interaction.guildId,
                commandName: 'close'
            });
            await errorReply(interaction, 'Impossible de fermer le ticket. Réessaie dans un instant.');
        }
    },
};
