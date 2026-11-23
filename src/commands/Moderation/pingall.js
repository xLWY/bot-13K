import { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } from 'discord.js';
import { isBotOwner } from '../../utils/ownerIds.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { logger } from '../../utils/logger.js';
import { errorEmbed, successEmbed, warningEmbed } from '../../utils/embeds.js';
import { brandFooter, discordTimestamp } from '../../ui/kit.js';

const COOLDOWN_MS = 5 * 60 * 1000;
const cooldowns = new Map();
const NO_MENTIONS = { parse: [], repliedUser: false };
const CONTEXT = 'Ping général';

function payload(embed, ephemeral = true) {
    return {
        embeds: [embed.setFooter(brandFooter(CONTEXT))],
        components: [],
        allowedMentions: NO_MENTIONS,
        ...(ephemeral ? { flags: MessageFlags.Ephemeral } : {}),
    };
}

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

async function notify(interaction, embed) {
    if (interaction.isPrefixCommand?.()) {
        const sent = await interaction.user.send({
            embeds: [embed.setFooter(brandFooter(CONTEXT))],
            allowedMentions: NO_MENTIONS,
        }).catch((error) => {
            logger.debug(`[PingAll] DM notice failed: ${error.code || error.message}`);
            return null;
        });
        if (sent) return true;
        return InteractionHelper.safeReply(interaction, payload(embed, false));
    }
    return InteractionHelper.safeReply(interaction, payload(embed));
}

export default {
    data: new SlashCommandBuilder()
        .setName('pingall')
        .setDescription('Pinger tout le monde avec @everyone')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
    category: 'moderation',

    async execute(interaction) {
        const isPrefix = interaction.isPrefixCommand?.() === true;

        if (!isBotOwner(interaction.member.id) && !interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
            return notify(interaction, errorEmbed('Tu as besoin de la permission **Gérer le serveur** pour pinger tout le monde.'));
        }

        const remaining = hasCooldown(interaction.user.id);
        if (remaining > 0) {
            return notify(interaction, warningEmbed(
                `Tu pourras de nouveau utiliser cette commande ${discordTimestamp(Date.now() + remaining, 'R')}.`,
            ));
        }

        const pingChannel = interaction.channel;
        if (!pingChannel) {
            return notify(interaction, errorEmbed('Impossible d’envoyer le ping dans ce salon.'));
        }

        const mentionText = '@everyone';

        if (!isPrefix) {
            await InteractionHelper.safeDefer(interaction, { flags: MessageFlags.Ephemeral });
        }

        const pingMessage = await pingChannel
            .send({ content: mentionText })
            .catch((err) => {
                logger.debug('Failed to send pingall message:', err);
                return null;
            });

        if (pingMessage) {
            setTimeout(() => {
                pingMessage.delete().catch((err) => logger.debug('Failed to auto-delete pingall:', err));
            }, 1000);
        }

        cooldowns.set(interaction.user.id, Date.now() + COOLDOWN_MS);

        const embed = pingMessage
            ? successEmbed(`<#${pingChannel.id}> a été mentionné.`, '✅ Ping envoyé')
                .addFields(
                    { name: 'Salon', value: `<#${pingChannel.id}>`, inline: true },
                    { name: 'Prochaine utilisation', value: discordTimestamp(Date.now() + COOLDOWN_MS, 'R'), inline: true },
                )
            : warningEmbed('Le ping n’a pas pu être envoyé. Vérifie mes permissions dans ce salon.');

        if (isPrefix) {
            return notify(interaction, embed);
        }
        return InteractionHelper.safeEditReply(interaction, payload(embed));
    },
};
