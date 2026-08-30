import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import { createEmbed } from '../../utils/embeds.js';
import { logger } from '../../utils/logger.js';
import { handleInteractionError } from '../../utils/errorHandler.js';

import { InteractionHelper } from '../../utils/interactionHelper.js';
export default {
    data: new SlashCommandBuilder()
    .setName("avatar")
    .setDescription("Afficher l'image de profil d'un utilisateur")
    .addUserOption((option) =>
      option
        .setName("target")
        .setDescription(
          "L'utilisateur dont vous voulez voir l'avatar (par défaut vous-même)",
        ),
    ),

  async execute(interaction) {
    try {
      const user = interaction.options.getUser("target") || interaction.user;
      const avatarUrl = user.displayAvatarURL({ size: 2048, dynamic: true });

      const embed = createEmbed({ 
        title: `Avatar de ${user.username}`, 
        description: `[Lien de téléchargement](${avatarUrl})` 
      })
        .setImage(avatarUrl);

      await InteractionHelper.safeReply(interaction, { embeds: [embed] });
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
      await handleInteractionError(interaction, error, {
        commandName: 'avatar',
        source: 'avatar_command'
      });
    }
  }
};


