import { SlashCommandBuilder, AttachmentBuilder } from 'discord.js';
import { infoEmbed, errorEmbed } from '../../utils/embeds.js';
import { logger } from '../../utils/logger.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { brandFooter } from '../../ui/kit.js';
import { fileURLToPath } from 'url';
import path from 'path';

const NO_MENTIONS = { parse: [], repliedUser: false };

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const IMAGE_PATH = path.resolve(__dirname, '../../../assets/images/hoxley.png');

export default {
    hiddenFromSlash: true,
    data: new SlashCommandBuilder()
        .setName('hoxley')
        .setDescription('Envoyer une image'),

    async execute(interaction) {
        try {
            const attachment = new AttachmentBuilder(IMAGE_PATH, { name: 'hoxley.png' });
            const embed = infoEmbed(
                'Voici l’image demandée. Clique sur la pièce jointe pour l’ouvrir en grand.',
                'ℹ️ Image Hoxley'
            );
            embed.setFooter(brandFooter('Image'));

            await InteractionHelper.safeReply(interaction, {
                embeds: [embed],
                files: [attachment],
                allowedMentions: NO_MENTIONS,
            });

            logger.info(`Hoxley command executed`, {
                userId: interaction.user.id,
                guildId: interaction.guildId
            });
        } catch (error) {
            logger.error(`Hoxley command execution failed`, {
                error: error.message,
                stack: error.stack,
                userId: interaction.user.id,
                guildId: interaction.guildId,
                commandName: 'hoxley'
            });
            await InteractionHelper.safeReply(interaction, {
                embeds: [errorEmbed('Impossible d’envoyer l’image. Réessaie dans un instant.')],
                allowedMentions: NO_MENTIONS,
            });
        }
    },
};
