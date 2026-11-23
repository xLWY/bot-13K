import { SlashCommandBuilder } from 'discord.js';
import { createEmbed, errorEmbed } from '../../utils/embeds.js';
import { logger } from '../../utils/logger.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { brandFooter, formatNumber } from '../../ui/kit.js';

const NO_MENTIONS = { parse: [], repliedUser: false };

export default {
    data: new SlashCommandBuilder()
        .setName('avatar')
        .setDescription('Afficher l’image de profil d’un utilisateur')
        .addUserOption((option) => option
            .setName('target')
            .setDescription('L’utilisateur dont tu veux voir l’avatar (par défaut toi-même)')),

    async execute(interaction) {
        try {
            const user = interaction.options.getUser('target') || interaction.user;
            const avatarUrl = user.displayAvatarURL({ size: 2048, dynamic: true });

            const embed = createEmbed({
                title: `Avatar de ${user.username}`,
                description: [
                    `${user} • [Ouvrir l’image en pleine taille](${avatarUrl})`,
                    'Clique sur le lien pour l’enregistrer ou l’ouvrir dans un nouvel onglet.',
                ].join('\n'),
                color: 'info',
                thumbnail: avatarUrl,
                image: avatarUrl,
                fields: [
                    { name: 'ID', value: `\`${user.id}\``, inline: true },
                    { name: 'Format', value: user.avatar ? 'Personnalisé' : 'Par défaut', inline: true },
                    { name: 'Taille', value: `${formatNumber(2048)} px`, inline: true },
                ],
                footer: brandFooter('Avatar'),
            });

            await InteractionHelper.safeReply(interaction, {
                embeds: [embed],
                allowedMentions: NO_MENTIONS,
            });

            logger.info(`Avatar command executed`, {
                userId: interaction.user.id,
                targetUserId: user.id,
                guildId: interaction.guildId
            });
        } catch (error) {
            logger.error(`Avatar command execution failed`, {
                error: error.message,
                stack: error.stack,
                userId: interaction.user.id,
                guildId: interaction.guildId,
                commandName: 'avatar'
            });
            await InteractionHelper.safeReply(interaction, {
                embeds: [errorEmbed('Impossible d’afficher cet avatar. Réessaie dans un instant.')],
                allowedMentions: NO_MENTIONS,
            });
        }
    },
};
