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
            .setLabel('Set Title')
            .setStyle(ButtonStyle.Primary),
          new ButtonBuilder()
            .setCustomId('embed_description')
            .setLabel('Set Description')
            .setStyle(ButtonStyle.Primary),
          new ButtonBuilder()
            .setCustomId('embed_color')
            .setLabel('Set Color')
            .setStyle(ButtonStyle.Secondary),
          new ButtonBuilder()
            .setCustomId('embed_field')
            .setLabel('Add Field')
            .setStyle(ButtonStyle.Secondary)
        );

      const row2 = new ActionRowBuilder()
        .addComponents(
          new ButtonBuilder()
            .setCustomId('embed_image')
            .setLabel('Set Image')
            .setStyle(ButtonStyle.Secondary),
          new ButtonBuilder()
            .setCustomId('embed_thumbnail')
            .setLabel('Set Thumbnail')
            .setStyle(ButtonStyle.Secondary),
          new ButtonBuilder()
            .setCustomId('embed_footer')
            .setLabel('Set Footer')
            .setStyle(ButtonStyle.Secondary),
          new ButtonBuilder()
            .setCustomId('embed_send')
            .setLabel('Send Embed')
            .setStyle(ButtonStyle.Success)
        );

      const row3 = new ActionRowBuilder()
        .addComponents(
          new ButtonBuilder()
            .setCustomId('embed_preview')
            .setLabel('Preview')
            .setStyle(ButtonStyle.Primary),
          new ButtonBuilder()
            .setCustomId('embed_reset')
            .setLabel('Reset')
            .setStyle(ButtonStyle.Danger),
          new ButtonBuilder()
            .setCustomId('embed_cancel')
            .setLabel('Cancel')
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