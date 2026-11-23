import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { isBotOwner } from '../../utils/ownerIds.js';
import { createEmbed, errorEmbed, warningEmbed } from '../../utils/embeds.js';
import { brandFooter, formatNumber, progressBar } from '../../ui/kit.js';
import { logEvent } from '../../utils/moderation.js';
import { logger } from '../../utils/logger.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';

const NO_MENTIONS = { parse: [], repliedUser: false };
const CONTEXT = 'Purge de messages';

function payload(embed) {
    return {
        embeds: [embed.setFooter(brandFooter(CONTEXT))],
        components: [],
        allowedMentions: NO_MENTIONS,
    };
}

/**
 * En serveur, les commandes préfixées ne peuvent pas être éphémères : on
 * envoie le résultat en message privé pour garder la discrétion du slash.
 */
async function deliver(interaction, embed) {
    const message = payload(embed);
    if (interaction.isPrefixCommand?.()) {
        const sent = await interaction.user.send(message).catch((error) => {
            logger.debug(`[Clear] DM notice failed: ${error.code || error.message}`);
            return null;
        });
        if (sent) return true;
    }
    return InteractionHelper.safeEditReply(interaction, message);
}

export default {
    data: new SlashCommandBuilder()
        .setName('clear')
        .setDescription('Supprimer un nombre précis de messages')
        .addIntegerOption((option) =>
            option
                .setName('amount')
                .setDescription('Nombre de messages (1-100)')
                .setRequired(true),
        )
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),
    category: 'moderation',

    async execute(interaction, config, client) {
        const isPrefix = interaction.isPrefixCommand?.() === true;

        if (!isPrefix) {
            const deferSuccess = await InteractionHelper.safeDefer(interaction);
            if (!deferSuccess) {
                logger.warn('Purge interaction defer failed', {
                    userId: interaction.user.id,
                    guildId: interaction.guildId,
                    commandName: 'clear',
                });
                return;
            }
        }

        if (
            !isBotOwner(interaction.member.id) &&
            !interaction.member.permissions.has(PermissionFlagsBits.ManageMessages)
        ) {
            return deliver(interaction, errorEmbed('Tu as besoin de la permission **Gérer les messages** pour supprimer des messages.'));
        }

        const amount = interaction.options.getInteger('amount');
        const channel = interaction.channel;

        if (amount < 1 || amount > 100) {
            return deliver(interaction, warningEmbed('Spécifie un nombre entre 1 et 100.'));
        }

        try {
            const fetched = await channel.messages.fetch({ limit: amount + 1 });
            const ownReply = await interaction.fetchReply().catch(() => null);
            if (!isPrefix) {
                fetched.delete(ownReply?.id || interaction.id);
            }
            const deleted = await channel.bulkDelete(fetched, true);
            const deletedCount = deleted.size;

            await logEvent({
                client,
                guild: interaction.guild,
                event: {
                    action: 'Messages Purged',
                    target: `${channel} (${deletedCount} messages)`,
                    executor: `<@${interaction.user.id}> (${interaction.user.id})`,
                    reason: `${deletedCount} messages supprimés`,
                    metadata: {
                        channelId: channel.id,
                        messageCount: deletedCount,
                        requestedAmount: amount,
                        moderatorId: interaction.user.id,
                    },
                },
            });

            const total = Math.max(amount || 0, deletedCount);
            const embed = createEmbed({
                title: '🗑️ Messages supprimés',
                description: `${formatNumber(deletedCount)} message(s) supprimé(s) dans <#${channel.id}>.`,
                color: 'success',
                fields: [
                    { name: 'Demandés', value: `\`${formatNumber(amount)}\``, inline: true },
                    { name: 'Supprimés', value: `\`${formatNumber(deletedCount)}\``, inline: true },
                    { name: 'Progression', value: `\`${progressBar(deletedCount, total, 10)}\``, inline: false },
                    { name: 'Modérateur', value: `<@${interaction.user.id}>`, inline: false },
                ],
                footer: brandFooter(CONTEXT),
            });

            return deliver(interaction, embed);
        } catch (error) {
            logger.error('Purge command error:', error);
            return deliver(interaction, errorEmbed(
                'Impossible de supprimer les messages. Vérifie mes permissions et la limite de 14 jours pour une suppression en masse.',
            ));
        }
    },
};
