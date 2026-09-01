import { SlashCommandBuilder, PermissionFlagsBits, ChannelType } from 'discord.js';
import { logger } from '../../utils/logger.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';

export default {
    data: new SlashCommandBuilder()
        .setName("fakemsg")
        .setDescription("* Publier un message dans un salon, affiché comme venant d'un autre membre")
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
                .setRequired(false)
        )
        .addAttachmentOption(option =>
            option
                .setName("image")
                .setDescription("Une image à envoyer en pièce jointe")
                .setRequired(false)
        )
        .addChannelOption(option =>
            option
                .setName("channel")
                .setDescription("Le salon où envoyer (par défaut : le salon actuel)")
                .addChannelTypes(ChannelType.GuildText, ChannelType.GuildForum)
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
            return await InteractionHelper.sendErrorNotice(interaction, "Tu as besoin de la permission **Gérer les webhooks** pour utiliser cette commande.");
        }

        const targetUser = interaction.options.getUser("user");
        const message = interaction.options.getString("message");
        const image = interaction.options.getAttachment("image");
        const channel = interaction.options.getChannel("channel") || interaction.channel;

        if (!message && !image) {
            return await InteractionHelper.sendErrorNotice(interaction, "Indique un message ou une image à envoyer.");
        }

        if (message && message.length > 2000) {
            return await InteractionHelper.sendErrorNotice(interaction, "Les messages doivent faire moins de 2000 caractères.");
        }

        let targetChannel = channel;
        let threadId = null;

        if (channel.isThread?.()) {
            threadId = channel.id;
            targetChannel = channel.parent;
        }

        if (
            !targetChannel ||
            (targetChannel.type !== ChannelType.GuildText && targetChannel.type !== ChannelType.GuildForum)
        ) {
            return await InteractionHelper.sendErrorNotice(interaction, "Choisis un salon textuel.");
        }

        try {
            const member = await interaction.guild.members.fetch(targetUser.id).catch(() => null);
            const name = (member?.displayName || targetUser.username).substring(0, 80);
            const avatarURL = targetUser.displayAvatarURL({ extension: 'png', size: 256 });

            let avatarBuffer = null;
            try {
                const response = await fetch(avatarURL);
                if (response.ok) {
                    avatarBuffer = Buffer.from(await response.arrayBuffer());
                }
            } catch (_) {
                avatarBuffer = null;
            }

            const webhook = await targetChannel.createWebhook({
                name,
                avatar: avatarBuffer || undefined,
                reason: `Message factice posté par ${interaction.user.tag}`
            });

            try {
                await webhook.send({
                    content: message || undefined,
                    username: name,
                    avatarURL,
                    threadId: threadId || undefined,
                    files: image ? [image.url] : undefined
                });
            } finally {
                await webhook.delete('Message factice envoyé').catch(() => {});
            }

            try {
                const confirmation = await interaction.fetchReply().catch(() => null);
                if (confirmation) await confirmation.delete().catch(() => {});
            } catch (_) {
                // reply already gone
            }
        } catch (error) {
            logger.error("Error in fakemsg command:", error);
            return await InteractionHelper.sendErrorNotice(interaction, "Échec de la publication du message factice. Vérifie la permission **Gérer les webhooks** du bot dans ce salon.");
        }
    }
};