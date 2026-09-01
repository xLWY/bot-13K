import { SlashCommandBuilder, AttachmentBuilder } from 'discord.js';
import { logger } from '../../utils/logger.js';
import { handleInteractionError } from '../../utils/errorHandler.js';
import { fileURLToPath } from 'url';
import path from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const IMAGE_PATH = path.resolve(__dirname, '../../../assets/images/hoxley.png');

import { InteractionHelper } from '../../utils/interactionHelper.js';
export default {
    hiddenFromSlash: true,
    data: new SlashCommandBuilder()
        .setName('hoxley')
        .setDescription('* Envoyer une image'),

    async execute(interaction) {
        try {
            const attachment = new AttachmentBuilder(IMAGE_PATH, { name: 'hoxley.png' });

            await InteractionHelper.safeReply(interaction, {
                files: [attachment],
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
            await handleInteractionError(interaction, error, {
                commandName: 'hoxley',
                source: 'hoxley_command'
            });
        }
    }
};