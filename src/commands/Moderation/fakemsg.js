import { SlashCommandBuilder, PermissionFlagsBits, ChannelType } from 'discord.js';
import { successEmbed, errorEmbed } from '../../utils/embeds.js';
import { logger } from '../../utils/logger.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';

export default {
    data: new SlashCommandBuilder()
        .setName("fakemsg")
        .setDescription("Publier un message dans un salon, affiché comme venant d'un autre membre")
        .addUserOption(option =>
            option
                .setName("user")
                .setDescription("Le membre dont le message doit avoir l'apparence")
                .setRequired(true)
        )
        .addStringOption(option =>
            option
                .setName("message")
                .setDescription("Le contenu du message (2000 caractères max)")
                .setRequired(true)
        )
        .addChannelOption(option =>
            option
                .setName("channel")
                .setDescription("Le salon où envoyer (par défaut : le salon actuel)")
                .addChannelTypes(ChannelType.GuildText)
                .setRequired(false)
        )
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageWebhooks)
        .setDMPermission(false),
    category: "Moderation",

    async execute(interaction, config, client) {
        const deferSuccess = await InteractionHelper.safeDefer(interaction);
        if (!deferSuccess) {
            logger.warn(`Fakemsg interaction defer failed`, {
                userId: interaction.user.id,
                guildId: interaction.guildId,
                commandName: 'fakemsg'
            });
            return;
        }

        if (!interaction.member.permissions.has(PermissionFlagsBits.ManageWebhooks)) {
            return await InteractionHelper.safeEditReply(interaction, {
                embeds: [
                    errorEmbed(
                        "Permission Denied",
                        "You need the **Manage Webhooks** permission to use this command."
                    ),
                ],
            });
        }

        const targetUser = interaction.options.getUser("user");
        const message = interaction.options.getString("message");
        const channel = interaction.options.getChannel("channel") || interaction.channel;

        if (message.length > 2000) {
            return await InteractionHelper.safeEditReply(interaction, {
                embeds: [
                    errorEmbed(
                        "Message Too Long",
                        "Messages must be under 2000 characters."
                    ),
                ],
            });
        }

        if (!channel || channel.type !== ChannelType.GuildText) {
            return await InteractionHelper.safeEditReply(interaction, {
                embeds: [
                    errorEmbed(
                        "Invalid Channel",
                        "Please choose a text channel."
                    ),
                ],
            });
        }

        try {
            const member = await interaction.guild.members.fetch(targetUser.id).catch(() => null);
            const name = (member?.displayName || targetUser.username).substring(0, 80);
            const avatarURL = targetUser.displayAvatarURL({ extension: 'png', size: 256 });

            const webhook = await channel.createWebhook({
                name,
                reason: `Fake message posted by ${interaction.user.tag}`
            });

            try {
                await webhook.send({
                    content: message,
                    username: name,
                    avatarURL
                });
            } finally {
                await webhook.delete('Fake message sent').catch(() => {});
            }

            return await InteractionHelper.safeEditReply(interaction, {
                embeds: [
                    successEmbed(
                        `Message publié dans ${channel} avec l'apparence de **${name}**.`,
                        "✅ Fake message envoyé"
                    ),
                ]
            });
        } catch (error) {
            logger.error("Error in fakemsg command:", error);
            return await InteractionHelper.safeEditReply(interaction, {
                embeds: [
                    errorEmbed(
                        "System Error",
                        "Failed to post the fake message. Check the bot's Manage Webhooks permission in that channel."
                    ),
                ],
            });
        }
    }
};