import { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits } from 'discord.js';
import { createEmbed } from '../../utils/embeds.js';
import { logger } from '../../utils/logger.js';
import { handleInteractionError } from '../../utils/errorHandler.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { BotConfig } from '../../config/bot.js';

export default {
  data: new SlashCommandBuilder()
    .setName('embedbuilder')
    .setDescription('Créer des embeds Discord personnalisés avec un constructeur interactif')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),

  async execute(interaction) {
    try {
      // Initial embed builder interface
      const embed = createEmbed({
        title: '🎨 Embed Builder',
        description: 'Use the buttons below to customize your embed',
        color: BotConfig.embeds.colors.info
      })
        .addFields(
          { name: '📝 Title', value: 'Not set', inline: true },
          { name: '📖 Description', value: 'Not set', inline: true },
          { name: '🎨 Color', value: 'Default', inline: true }
        );

      const row = new ActionRowBuilder()
        .addComponents(
          new ButtonBuilder()
            .setCustomId('embed_title')
            .setLabel('Définir Titre')
            .setStyle(ButtonStyle.Primary),
          new ButtonBuilder()
            .setCustomId('embed_desc')
            .setLabel('Définir Description')
            .setStyle(ButtonStyle.Primary),
          new ButtonBuilder()
            .setCustomId('embed_color')
            .setLabel('Définir Couleur')
            .setStyle(ButtonStyle.Secondary),
          new ButtonBuilder()
            .setCustomId('embed_field')
            .setLabel('Ajouter Champ')
            .setStyle(ButtonStyle.Secondary)
        );

      const row2 = new ActionRowBuilder()
        .addComponents(
          new ButtonBuilder()
            .setCustomId('embed_image')
            .setLabel('Définir Image')
            .setStyle(ButtonStyle.Secondary),
          new ButtonBuilder()
            .setCustomId('embed_thumb')
            .setLabel('Définir Miniature')
            .setStyle(ButtonStyle.Secondary),
          new ButtonBuilder()
            .setCustomId('embed_footer')
            .setLabel('Définir Footer')
            .setStyle(ButtonStyle.Secondary),
          new ButtonBuilder()
            .setCustomId('embed_send')
            .setLabel('Envoyer Embed')
            .setStyle(ButtonStyle.Success)
        );

      const row3 = new ActionRowBuilder()
        .addComponents(
          new ButtonBuilder()
            .setCustomId('embed_preview')
            .setLabel('Prévisualiser')
            .setStyle(ButtonStyle.Primary),
          new ButtonBuilder()
            .setCustomId('embed_reset')
            .setLabel('Réinitialiser')
            .setStyle(ButtonStyle.Danger),
          new ButtonBuilder()
            .setCustomId('embed_cancel')
            .setLabel('Annuler')
            .setStyle(ButtonStyle.Secondary)
        );

      await InteractionHelper.safeReply(interaction, {
        embeds: [embed],
        components: [row, row2, row3]
      });

      logger.info(`Embed builder started`, {
        userId: interaction.user.id,
        guildId: interaction.guildId
      });
    } catch (error) {
      logger.error(`Embed builder command execution failed`, {
        error: error.message,
        stack: error.stack,
        userId: interaction.user.id,
        guildId: interaction.guildId,
        commandName: 'embedbuilder'
      });
      await handleInteractionError(interaction, error, {
        commandName: 'embedbuilder',
        source: 'embedbuilder_command'
      });
    }
  }
};