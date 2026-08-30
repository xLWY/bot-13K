import { SlashCommandBuilder, PermissionFlagsBits, ChannelType } from 'discord.js';
import { successEmbed, errorEmbed } from '../../utils/embeds.js';
import { logger } from '../../utils/logger.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { renderFakeMessageImage } from '../../services/fakeMessageImage.js';

export default {
    data: new SlashCommandBuilder()
        .setName("fakemsg")
        .setDescription("Générer une image imitant un message Discord (avatar, pseudo, texte)")
        .addUserOption(option =>
            option
                .setName("user")
                .setDescription("Le membre à imiter (photo de profil + pseudo)")
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
                .setDescription("Le salon où envoyer l'image (par défaut : le salon actuel)")
                .addChannelTypes(ChannelType.GuildText)
                .setRequired(false)
        )
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
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

        if (!interaction.member.permissions.has(PermissionFlagsBits.ManageMessages)) {
            return await InteractionHelper.safeEditReply(interaction, {
                embeds: [
                    errorEmbed(
                        "Permission Denied",
                        "You need the **Manage Messages** permission to use this command."
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
            const name = member?.displayName || targetUser.username || 'Membre';
            const avatarUrl = targetUser.displayAvatarURL({ extension: 'png', size: 256 });

            const image = await renderFakeMessageImage({
                name,
                avatarUrl,
                message,
                timestamp: new Date()
            });

            await channel.send({
                files: [{ attachment: image, name: 'fakemsg.png' }]
            });

            return await InteractionHelper.safeEditReply(interaction, {
                embeds: [
                    successEmbed(
                        `Image générée et envoyée dans ${channel}.`,
                        "✅ Image falsifiée"
                    ),
                ]
            });
        } catch (error) {
            logger.error("Error in fakemsg command:", error);
            return await InteractionHelper.safeEditReply(interaction, {
                embeds: [
                    errorEmbed(
                        "System Error",
                        "Failed to generate the fake message image."
                    ),
                ],
            });
        }
    }
};