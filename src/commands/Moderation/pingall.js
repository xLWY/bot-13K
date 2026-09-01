import { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } from 'discord.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { logger } from '../../utils/logger.js';
import { getColor } from '../../config/bot.js';

const COOLDOWN_MS = 5 * 60 * 1000;
const cooldowns = new Map();

function hasCooldown(userId) {
    const until = cooldowns.get(userId);
    if (!until) return 0;
    const remaining = until - Date.now();
    if (remaining <= 0) {
        cooldowns.delete(userId);
        return 0;
    }
    return remaining;
}

export default {
    data: new SlashCommandBuilder()
        .setName('pingall')
        .setDescription('* Pinger tout le monde avec @everyone')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
    category: 'moderation',

    async execute(interaction) {
        const isPrefix = interaction.isPrefixCommand?.() === true;
        const client = interaction.client;

        if (!interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
            return await InteractionHelper.sendErrorNotice(interaction, 'Tu as besoin de la permission `Gérer le serveur` pour pinger tout le monde.');
        }

        const remaining = hasCooldown(interaction.user.id);
        if (remaining > 0) {
            const mins = Math.ceil(remaining / 60000);
            return await InteractionHelper.safeEditReply(interaction, {
                embeds: [
                    {
                        color: getColor('warning'),
                        title: '⏳ Temps de recharge',
                        description: `Attends encore **${mins} minute${mins > 1 ? 's' : ''}** avant de re-pinger tout le monde.`,
                    },
                ],
                flags: MessageFlags.Ephemeral,
            });
        }

        const pingChannel = interaction.channel;
        if (!pingChannel) {
            return await InteractionHelper.sendErrorNotice(interaction, 'Impossible de pinger ici.');
        }

        const mentionText = `@everyone`;

        if (isPrefix) {
            const pingMessage = await pingChannel
                .send({ content: `${mentionText} — ${interaction.user} a quelque chose d'important à vous annoncer ! ${interaction.user} relisez le message précédent.` })
                .catch(err => {
                    logger.debug('Failed to send pingall message:', err);
                    return null;
                });

            if (pingMessage) {
                setTimeout(() => {
                    pingMessage.delete().catch(err => logger.debug('Failed to auto-delete pingall:', err));
                }, 1000);
            }

            await interaction.reply({
                embeds: [
                    {
                        color: getColor('success'),
                        title: '📢 Ping envoyé',
                        description: '`@everyone` a été notifié, le message de ping sera supprimé automatiquement.',
                    },
                ],
            }).catch(() => null);

            setTimeout(() => {
                interaction.deleteReply().catch(err => logger.debug('Failed to auto-delete pingall confirmation:', err));
            }, 4000);

            cooldowns.set(interaction.user.id, Date.now() + COOLDOWN_MS);
            return;
        }

        await InteractionHelper.safeDefer(interaction, { flags: MessageFlags.Ephemeral });

        const pingMessage = await pingChannel
            .send({ content: `${mentionText} — ${interaction.user} a quelque chose d'important à vous annoncer ! ${interaction.user} relisez le message précédent.` })
            .catch(err => {
                logger.debug('Failed to send pingall message:', err);
                return null;
            });

        if (pingMessage) {
            setTimeout(() => {
                pingMessage.delete().catch(err => logger.debug('Failed to auto-delete pingall:', err));
            }, 1000);
        }

        await InteractionHelper.safeEditReply(interaction, {
            embeds: [
                {
                    color: getColor('success'),
                    title: '📢 Ping envoyé',
                    description: '`@everyone` a été notifié, le message de ping sera supprimé automatiquement.',
                },
            ],
            flags: MessageFlags.Ephemeral,
        });

        cooldowns.set(interaction.user.id, Date.now() + COOLDOWN_MS);

        setTimeout(() => {
            interaction.deleteReply().catch(err => logger.debug('Failed to auto-delete pingall response:', err));
        }, 5000);
    },
};