import { SlashCommandBuilder, PermissionFlagsBits, PermissionsBitField, ChannelType } from 'discord.js';
import { logEvent } from '../../utils/moderation.js';
import { logger } from '../../utils/logger.js';
import { sanitizeMarkdown } from '../../utils/sanitization.js';

import { InteractionHelper } from '../../utils/interactionHelper.js';

export default {
    data: new SlashCommandBuilder()
        .setName("dm")
        .setDescription("* Envoyer un message privé à un utilisateur (réservé au staff)")
        .addUserOption(option =>
            option
                .setName("user")
                .setDescription("L'utilisateur à qui envoyer le MP")
                .setRequired(true)
        )
        .addStringOption(option =>
            option
                .setName("message")
                .setDescription("Le message à envoyer")
                .setRequired(true)
        )
        .addBooleanOption(option =>
            option
                .setName("anonymous")
                .setDescription("Envoyer le message anonymement (défaut : non)")
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
                return await InteractionHelper.sendErrorNotice(interaction, 'message trop long (2000 caractères max)');
            }

            if (targetUser.bot) {
                return await InteractionHelper.sendErrorNotice(interaction, "impossible d'envoyer un DM à un bot");
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

            const sentMessage = await interaction.editReply({ content: `<@${targetUser.id}> message bien envoyé` });
            if (sentMessage && typeof sentMessage.delete === 'function') {
                setTimeout(() => { sentMessage.delete().catch(() => {}); }, 5000).unref?.();
            }
        } catch (error) {
            logger.error('DM command error:', error);
            
            if (error.code === 50007) {
                return await InteractionHelper.sendErrorNotice(interaction, `envoi impossible, <@${targetUser.id}> a fermé ses DMs`);
            }
            
            return await InteractionHelper.sendErrorNotice(interaction, "l'envoi du DM a échoué");
        }
    }
};


