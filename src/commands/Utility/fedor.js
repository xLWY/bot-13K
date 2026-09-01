import { SlashCommandBuilder, AttachmentBuilder } from 'discord.js';
import { createEmbed } from '../../utils/embeds.js';
import { logger } from '../../utils/logger.js';
import { handleInteractionError } from '../../utils/errorHandler.js';
import { fileURLToPath } from 'url';
import path from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const IMAGE_PATH = path.resolve(__dirname, '../../../assets/images/fedor.png');

import { InteractionHelper } from '../../utils/interactionHelper.js';
export default {
    data: new SlashCommandBuilder()
        .setName('fedor')
        .setDescription('* Envoyer une image'),

    async execute(interaction) {
        try {
            const attachment = new AttachmentBuilder(IMAGE_PATH, { name: 'fedor.png' });

            const embed = createEmbed({
                title: '',
                description: '',
            })
                .setImage('attachment://fedor.png');

            await InteractionHelper.safeReply(interaction, {
                embeds: [embed],
                files: [attachment],
            });

            logger.info(`Fedor command executed`, {
                userId: interaction.user.id,
                guildId: interaction.guildId
            });
        } catch (error) {
            logger.error(`Fedor command execution failed`, {
                error: error.message,
                stack: error.stack,
                userId: interaction.user.id,
                guildId: interaction.guildId,
                commandName: 'fedor'
            });
            await handleInteractionError(interaction, error, {
                commandName: 'fedor',
                source: 'fedor_command'
            });
        }
    }
};