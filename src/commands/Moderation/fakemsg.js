import { SlashCommandBuilder, PermissionFlagsBits, ChannelType } from 'discord.js';
import { isBotOwner } from '../../utils/ownerIds.js';
import { logger } from '../../utils/logger.js';
import { errorEmbed, successEmbed } from '../../utils/embeds.js';
import { brandFooter, formatNumber } from '../../ui/kit.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';

const NO_MENTIONS = { parse: [], repliedUser: false };
const CONTEXT = 'Message factice';

function payload(embed) {
    return {
        embeds: [embed.setFooter(brandFooter(CONTEXT))],
        components: [],
        allowedMentions: NO_MENTIONS,
    };
}

export default {
    data: new SlashCommandBuilder()
        .setName('fakemsg')
        .setDescription('Publier un message dans un salon, affiché comme venant d’un autre membre')
        .addUserOption((option) =>
            option
                .setName('user')
                .setDescription('Le membre dont le message doit avoir l’apparence')
                .setRequired(true),
        )
        .addStringOption((option) =>
            option
                .setName('message')
                .setDescription('Le contenu du message (2000 caractères max)')
                .setRequired(false),
        )
        .addAttachmentOption((option) =>
            option
                .setName('image')
                .setDescription('Une image à envoyer en pièce jointe')
                .setRequired(false),
        )
        .addChannelOption((option) =>
            option
                .setName('channel')
                .setDescription('Le salon où envoyer (par défaut : le salon actuel)')
                .addChannelTypes(ChannelType.GuildText, ChannelType.GuildForum)
                .setRequired(false),
        )
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageWebhooks)
        .setDMPermission(false),
    category: 'Moderation',

    async execute(interaction, config, client) {
        const deferSuccess = await InteractionHelper.safeDefer(interaction);
        if (!deferSuccess) {
            logger.warn('Fakemsg interaction defer failed', {
                userId: interaction.user.id,
                guildId: interaction.guildId,
                commandName: 'fakemsg',
            });
            return;
        }

        if (
            !isBotOwner(interaction.member.id) &&
            !interaction.member.permissions.has(PermissionFlagsBits.ManageWebhooks)
        ) {
            return InteractionHelper.safeEditReply(interaction, payload(
                errorEmbed('Tu as besoin de la permission **Gérer les webhooks** pour utiliser cette commande.'),
            ));
        }

        const targetUser = interaction.options.getUser('user');
        const message = interaction.options.getString('message');
        const image = interaction.options.getAttachment('image');
        const channel = interaction.options.getChannel('channel') || interaction.channel;

        if (!message && !image) {
            return InteractionHelper.safeEditReply(interaction, payload(
                errorEmbed('Indique un message ou une image à envoyer.'),
            ));
        }

        if (message && message.length > 2000) {
            return InteractionHelper.safeEditReply(interaction, payload(
                errorEmbed('Le message doit faire moins de 2000 caractères.'),
            ));
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
            return InteractionHelper.safeEditReply(interaction, payload(
                errorEmbed('Choisis un salon textuel.'),
            ));
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
                reason: `Message factice posté par ${interaction.user.tag}`,
            });

            try {
                await webhook.send({
                    content: message || undefined,
                    username: name,
                    avatarURL,
                    threadId: threadId || undefined,
                    files: image ? [image.url] : undefined,
                });
            } finally {
                await webhook.delete('Message factice envoyé').catch(() => {});
            }

            return InteractionHelper.safeEditReply(interaction, payload(
                successEmbed(`Le message a été publié dans <#${targetChannel.id}>.`, '✅ Message publié')
                    .addFields(
                        { name: 'Apparence', value: `<@${targetUser.id}>`, inline: true },
                        { name: 'Salon', value: `<#${targetChannel.id}>`, inline: true },
                        { name: 'Contenu', value: message ? `\`${formatNumber(message.length)}\` caractères` : 'Image seulement', inline: false },
                        { name: 'Auteur de la commande', value: `<@${interaction.user.id}>`, inline: false },
                    ),
            ));
        } catch (error) {
            logger.error('Error in fakemsg command:', error);
            return InteractionHelper.safeEditReply(interaction, payload(
                errorEmbed('Impossible de publier le message factice. Vérifie la permission **Gérer les webhooks** du bot dans ce salon.'),
            ));
        }
    },
};
