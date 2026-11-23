import { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits } from 'discord.js';
import { createEmbed, errorEmbed } from '../../utils/embeds.js';
import { logger } from '../../utils/logger.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { brandFooter } from '../../ui/kit.js';

const NO_MENTIONS = { parse: [], repliedUser: false };

export default {
  data: new SlashCommandBuilder()
    .setName('embedbuilder')
    .setDescription('Créer des embeds Discord personnalisés avec un constructeur interactif')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),

  async execute(interaction) {
    try {
      const embed = createEmbed({
        title: 'ℹ️ Constructeur d’embed',
        description: 'Utilise les boutons ci-dessous pour composer ton embed, puis prévisualise-le avant de l’envoyer.',
        color: 'info',
        fields: [
          { name: 'Titre', value: 'Non défini', inline: true },
          { name: 'Description', value: 'Non définie', inline: true },
          { name: 'Couleur', value: 'Par défaut', inline: true },
          { name: 'Champs', value: '0', inline: true },
          { name: 'Visuels', value: 'Image : non définie • Miniature : non définie', inline: true },
          { name: 'Salon d’envoi', value: 'Salon actuel', inline: true },
        ],
        footer: brandFooter('Constructeur d’embed'),
      });

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
            .setCustomId('embed_channel')
            .setLabel('Salon d’envoi')
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
        components: [row, row2, row3],
        allowedMentions: NO_MENTIONS,
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
      await InteractionHelper.safeReply(interaction, {
        embeds: [errorEmbed('Impossible d’ouvrir le constructeur d’embed. Réessaie dans un instant.')],
        allowedMentions: NO_MENTIONS,
      });
    }
  }
};
