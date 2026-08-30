import { SlashCommandBuilder, PermissionFlagsBits, PermissionsBitField, ChannelType } from 'discord.js';
import { logEvent } from '../../utils/moderation.js';
import { logger } from '../../utils/logger.js';
import { sanitizeMarkdown } from '../../utils/sanitization.js';

import { InteractionHelper } from '../../utils/interactionHelper.js';

async function sendTransient(interaction, content) {
    const sent = await InteractionHelper.safeEditReply(interaction, { content });
    if (sent) {
        setTimeout(async () => {
            try {
                const reply = await interaction.fetchReply().catch(() => null);
                if (reply) await reply.delete().catch(() => {});
            } catch (_) {
                // already deleted
            }
        }, 5000).unref?.();
    }
}

export default {
    data: new SlashCommandBuilder()
        .setName("dm")
        .setDescription("Send a direct message to a user (Staff only)")
        .addUserOption(option =>
            option
                .setName("user")
                .setDescription("The user to send a DM to")
                .setRequired(true)
        )
        .addStringOption(option =>
            option
                .setName("message")
                .setDescription("The message to send")
                .setRequired(true)
        )
        .addBooleanOption(option =>
            option
                .setName("anonymous")
                .setDescription("Send the message anonymously (default: false)")
                .setRequired(false)
        )
        .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
        .setDMPermission(false),
    category: "Moderation",

    async execute(interaction, config, client) {
        const deferSuccess = await InteractionHelper.safeDefer(interaction);
        if (!deferSuccess) {
            logger.warn(`DM interaction defer failed`, {
                userId: interaction.user.id,
                guildId: interaction.guildId,
                commandName: 'dm'
            });
            return;
        }

    const targetUser = interaction.options.getUser("user");
        const message = interaction.options.getString("message");
        const anonymous = interaction.options.getBoolean("anonymous") || false;

        try {
            if (message.length > 2000) {
                return await sendTransient(interaction, `<@${interaction.user.id}> message trop long (2000 caractères max)`);
            }

            if (targetUser.bot) {
                return await sendTransient(interaction, `<@${interaction.user.id}> impossible d'envoyer un DM à un bot`);
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
                    action: "DM Sent",
                    target: `<@${targetUser.id}>`,
                    executor: `<@${interaction.user.id}>`,
                    targetName,
                    moderatorName,
                    content: sanitized,
                    hideFooter: true,
                    metadata: {
                        content: sanitized
                    }
                }
            });

            await sendTransient(interaction, `<@${targetUser.id}> message bien envoyé`);
        } catch (error) {
            logger.error('DM command error:', error);
            
            if (error.code === 50007) {
                return await sendTransient(interaction, `<@${interaction.user.id}> envoi impossible, <@${targetUser.id}> a fermé ses DMs`);
            }
            
            return await sendTransient(interaction, `<@${interaction.user.id}> l'envoi du DM a échoué`);
        }
    }
};


