import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, MessageFlags } from 'discord.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { logger } from '../../utils/logger.js';
import { handleInteractionError, createError, ErrorTypes } from '../../utils/errorHandler.js';
import { getColor } from '../../config/bot.js';

// Store embed data per user
const embedBuilderData = new Map();

function getEmbedData(userId) {
  if (!embedBuilderData.has(userId)) {
    embedBuilderData.set(userId, {
      title: null,
      description: null,
      color: null,
      fields: [],
      image: null,
      thumbnail: null,
      footer: null,
      author: null,
      timestamp: false
    });
  }
  return embedBuilderData.get(userId);
}

function clearEmbedData(userId) {
  embedBuilderData.delete(userId);
}

function generatePreviewEmbed(data) {
  const embed = new EmbedBuilder();
  
  if (data.title) embed.setTitle(data.title);
  if (data.description) embed.setDescription(data.description);
  if (data.color) embed.setColor(data.color);
  if (data.fields.length > 0) embed.addFields(data.fields);
  if (data.image) embed.setImage(data.image);
  if (data.thumbnail) embed.setThumbnail(data.thumbnail);
  if (data.footer) embed.setFooter({ text: data.footer });
  if (data.author) embed.setAuthor({ name: data.author });
  if (data.timestamp) embed.setTimestamp();
  
  return embed;
}

function getBuilderComponents() {
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

  return [row, row2, row3];
}

function getStatusEmbed(data) {
  const embed = new EmbedBuilder()
    .setTitle('🎨 Embed Builder')
    .setDescription('Use the buttons below to customize your embed')
    .setColor(getColor('info'))
    .addFields(
      { name: '📝 Title', value: data.title || 'Not set', inline: true },
      { name: '📖 Description', value: data.description ? data.description.substring(0, 50) + '...' : 'Not set', inline: true },
      { name: '🎨 Color', value: data.color || 'Default', inline: true },
      { name: '📊 Fields', value: data.fields.length.toString(), inline: true },
      { name: '🖼️ Image', value: data.image ? 'Set' : 'Not set', inline: true },
      { name: '👾 Thumbnail', value: data.thumbnail ? 'Set' : 'Not set', inline: true }
    );

  return embed;
}

export async function handleEmbedBuilderButtons(interaction, client) {
  try {
    const userId = interaction.user.id;
    const customId = interaction.customId;
    const data = getEmbedData(userId);

    logger.info(`Embed builder button clicked: ${customId} by user ${userId}`);

    // Handle different button actions
    switch (customId) {
      case 'embed_title':
        await showTitleModal(interaction);
        break;
      case 'embed_desc':
        await showDescriptionModal(interaction);
        break;
      case 'embed_color':
        await showColorModal(interaction);
        break;
      case 'embed_field':
        await showFieldModal(interaction);
        break;
      case 'embed_image':
        await showImageModal(interaction);
        break;
      case 'embed_thumb':
        await showThumbnailModal(interaction);
        break;
      case 'embed_footer':
        await showFooterModal(interaction);
        break;
      case 'embed_preview':
        await showPreview(interaction, data);
        break;
      case 'embed_reset':
        await resetEmbed(interaction, userId);
        break;
      case 'embed_cancel':
        await cancelEmbed(interaction, userId);
        break;
      case 'embed_send':
        await sendEmbed(interaction, data);
        break;
      default:
        logger.warn(`Unknown embed builder button: ${customId}`);
    }
  } catch (error) {
    logger.error(`Embed builder button handler failed`, {
      error: error.message,
      stack: error.stack,
      customId: interaction.customId,
      userId: interaction.user.id
    });
    
    // Show a simple error message to the user
    try {
      const errorMessage = `❌ Erreur: ${error.message}`;
      if (interaction.deferred) {
        await interaction.editReply({ content: errorMessage, components: [] });
      } else if (interaction.replied) {
        await interaction.followUp({ content: errorMessage, ephemeral: true });
      } else {
        await interaction.reply({ content: errorMessage, ephemeral: true });
      }
    } catch (replyError) {
      logger.error('Failed to send error message:', replyError);
    }
  }
}

async function showTitleModal(interaction) {
  try {
    const modal = new ModalBuilder()
      .setCustomId('embed_title_modal')
      .setTitle('Définir Titre de l\'Embed');

    const titleInput = new TextInputBuilder()
      .setCustomId('embed_title')
      .setLabel('Titre de l\'Embed')
      .setStyle(TextInputStyle.Short)
      .setPlaceholder('Entrez votre titre ici')
      .setMaxLength(256)
      .setRequired(false);

    const firstActionRow = new ActionRowBuilder().addComponents(titleInput);
    modal.addComponents(firstActionRow);

    await interaction.showModal(modal);
  } catch (error) {
    logger.error('Error showing title modal:', error);
    throw error;
  }
}

async function showDescriptionModal(interaction) {
  try {
    const modal = new ModalBuilder()
      .setCustomId('embed_desc_modal')
      .setTitle('Définir Description de l\'Embed');

    const descInput = new TextInputBuilder()
      .setCustomId('embed_desc')
      .setLabel('Description de l\'Embed')
      .setStyle(TextInputStyle.Short)
      .setPlaceholder('Entrez votre description ici')
      .setMaxLength(4096)
      .setRequired(false);

    const firstActionRow = new ActionRowBuilder().addComponents(descInput);
    modal.addComponents(firstActionRow);

    await interaction.showModal(modal);
  } catch (error) {
    logger.error('Error showing description modal:', error);
    throw error;
  }
}

async function showColorModal(interaction) {
  try {
    await interaction.update({
      content: '🎨 Veuillez entrer votre couleur...',
      embeds: [],
      components: []
    });

    const modal = new ModalBuilder()
      .setCustomId('embed_color_modal')
      .setTitle('Définir Couleur de l\'Embed');

    const colorInput = new TextInputBuilder()
      .setCustomId('embed_color')
      .setLabel('Couleur (code hex ou décimal)')
      .setStyle(TextInputStyle.Short)
      .setPlaceholder('ex: #00ff00 ou 65280')
      .setMaxLength(20)
      .setRequired(false);

    const firstActionRow = new ActionRowBuilder().addComponents(colorInput);
    modal.addComponents(firstActionRow);

    await interaction.showModal(modal);
  } catch (error) {
    logger.error('Error showing color modal:', error);
    throw error;
  }
}

async function showFieldModal(interaction) {
  try {
    await interaction.update({
      content: '📊 Veuillez entrer les informations du champ...',
      embeds: [],
      components: []
    });

    const modal = new ModalBuilder()
      .setCustomId('embed_field_modal')
      .setTitle('Ajouter un Champ à l\'Embed');

    const nameInput = new TextInputBuilder()
      .setCustomId('field_name')
      .setLabel('Nom du Champ')
      .setStyle(TextInputStyle.Short)
      .setPlaceholder('Nom du champ')
      .setMaxLength(256)
      .setRequired(true);

    const valueInput = new TextInputBuilder()
      .setCustomId('field_value')
      .setLabel('Valeur du Champ')
      .setStyle(TextInputStyle.Paragraph)
      .setPlaceholder('Valeur du champ')
      .setMaxLength(1024)
      .setRequired(true);

    const inlineInput = new TextInputBuilder()
      .setCustomId('field_inline')
      .setLabel('En ligne? (true/false)')
      .setStyle(TextInputStyle.Short)
      .setPlaceholder('true ou false')
      .setMaxLength(5)
      .setRequired(false)
      .setValue('false');

    const firstActionRow = new ActionRowBuilder().addComponents(nameInput);
    const secondActionRow = new ActionRowBuilder().addComponents(valueInput);
    const thirdActionRow = new ActionRowBuilder().addComponents(inlineInput);

    modal.addComponents(firstActionRow, secondActionRow, thirdActionRow);
    await interaction.showModal(modal);
  } catch (error) {
    logger.error('Error showing field modal:', error);
    throw error;
  }
}

async function showImageModal(interaction) {
  const modal = new ModalBuilder()
    .setCustomId('embed_image_modal')
    .setTitle('Définir Image de l\'Embed');

  const imageInput = new TextInputBuilder()
    .setCustomId('embed_image')
    .setLabel('URL de l\'Image')
    .setStyle(TextInputStyle.Short)
    .setPlaceholder('https://example.com/image.png')
    .setRequired(false);

  const firstActionRow = new ActionRowBuilder().addComponents(imageInput);
  modal.addComponents(firstActionRow);

  await interaction.showModal(modal);
}

async function showThumbnailModal(interaction) {
  const modal = new ModalBuilder()
    .setCustomId('embed_thumb_modal')
    .setTitle('Définir Miniature de l\'Embed');

  const thumbnailInput = new TextInputBuilder()
    .setCustomId('embed_thumb')
    .setLabel('URL de la Miniature')
    .setStyle(TextInputStyle.Short)
    .setPlaceholder('https://example.com/thumbnail.png')
    .setRequired(false);

  const firstActionRow = new ActionRowBuilder().addComponents(thumbnailInput);
  modal.addComponents(firstActionRow);

  await interaction.showModal(modal);
}

async function showFooterModal(interaction) {
  const modal = new ModalBuilder()
    .setCustomId('embed_footer_modal')
    .setTitle('Définir Footer de l\'Embed');

  const footerInput = new TextInputBuilder()
    .setCustomId('embed_footer')
    .setLabel('Texte du Footer')
    .setStyle(TextInputStyle.Short)
    .setPlaceholder('Texte du footer')
    .setMaxLength(2048)
    .setRequired(false);

  const firstActionRow = new ActionRowBuilder().addComponents(footerInput);
  modal.addComponents(firstActionRow);

  await interaction.showModal(modal);
}

async function showPreview(interaction, data) {
  const previewEmbed = generatePreviewEmbed(data);
  
  await interaction.update({
    embeds: [previewEmbed],
    components: getBuilderComponents()
  });
}

async function resetEmbed(interaction, userId) {
  clearEmbedData(userId);
  const data = getEmbedData(userId);
  
  await interaction.update({
    embeds: [getStatusEmbed(data)],
    components: getBuilderComponents()
  });
  
  logger.info(`Embed builder reset for user ${userId}`);
}

async function cancelEmbed(interaction, userId) {
  clearEmbedData(userId);
  
  await interaction.update({
    embeds: [
      new EmbedBuilder()
        .setDescription('❌ Embed builder cancelled')
        .setColor(getColor('error'))
    ],
    components: []
  });
  
  logger.info(`Embed builder cancelled for user ${userId}`);
}

async function sendEmbed(interaction, data) {
  if (!data.title && !data.description && data.fields.length === 0) {
    await interaction.reply({
      content: '❌ Your embed is empty! Add at least a title, description, or field.',
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  const finalEmbed = generatePreviewEmbed(data);
  
  // Send the embed to the current channel
  await interaction.channel.send({ embeds: [finalEmbed] });
  
  // Clear the data and close the builder
  clearEmbedData(interaction.user.id);
  
  await interaction.update({
    embeds: [
      new EmbedBuilder()
        .setDescription('✅ Embed sent successfully!')
        .setColor(getColor('success'))
    ],
    components: []
  });
  
  logger.info(`Embed sent by user ${interaction.user.id} in channel ${interaction.channelId}`);
}

// Modal submission handlers
export async function handleEmbedBuilderModals(interaction, client) {
  try {
    const userId = interaction.user.id;
    const customId = interaction.customId;
    const data = getEmbedData(userId);

    logger.info(`Embed builder modal submitted: ${customId} by user ${userId}`);

    switch (customId) {
      case 'embed_title_modal':
        data.title = interaction.fields.getTextInputValue('embed_title') || null;
        break;
      case 'embed_desc_modal':
        data.description = interaction.fields.getTextInputValue('embed_desc') || null;
        break;
      case 'embed_color_modal':
        const colorValue = interaction.fields.getTextInputValue('embed_color');
        if (colorValue) {
          try {
            // Try hex format
            if (colorValue.startsWith('#')) {
              data.color = parseInt(colorValue.replace('#', ''), 16);
            } else {
              // Try decimal format
              data.color = parseInt(colorValue);
            }
          } catch (e) {
            data.color = null;
          }
        } else {
          data.color = null;
        }
        break;
      case 'embed_field_modal':
        const fieldName = interaction.fields.getTextInputValue('field_name');
        const fieldValue = interaction.fields.getTextInputValue('field_value');
        const fieldInline = interaction.fields.getTextInputValue('field_inline') === 'true';
        
        if (fieldName && fieldValue) {
          data.fields.push({ name: fieldName, value: fieldValue, inline: fieldInline });
        }
        break;
      case 'embed_image_modal':
        data.image = interaction.fields.getTextInputValue('embed_image') || null;
        break;
      case 'embed_thumb_modal':
        data.thumbnail = interaction.fields.getTextInputValue('embed_thumb') || null;
        break;
      case 'embed_footer_modal':
        data.footer = interaction.fields.getTextInputValue('embed_footer') || null;
        break;
    }

    await interaction.update({
      embeds: [getStatusEmbed(data)],
      components: getBuilderComponents()
    });

  } catch (error) {
    logger.error(`Embed builder modal handler failed`, {
      error: error.message,
      stack: error.stack,
      customId: interaction.customId,
      userId: interaction.user.id
    });
    
    // Show a simple error message to the user
    try {
      const errorMessage = `❌ Erreur: ${error.message}`;
      if (interaction.deferred) {
        await interaction.editReply({ content: errorMessage, components: [] });
      } else if (interaction.replied) {
        await interaction.followUp({ content: errorMessage, ephemeral: true });
      } else {
        await interaction.reply({ content: errorMessage, ephemeral: true });
      }
    } catch (replyError) {
      logger.error('Failed to send error message:', replyError);
    }
  }
}