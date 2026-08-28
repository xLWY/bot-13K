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

    // Handle different button actions
    switch (customId) {
      case 'embed_title':
        await showTitleModal(interaction);
        break;
      case 'embed_description':
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
      case 'embed_thumbnail':
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
      customId: interaction.customId,
      userId: interaction.user.id
    });
    await handleInteractionError(interaction, error, {
      type: 'button',
      customId: interaction.customId
    });
  }
}

async function showTitleModal(interaction) {
  const modal = new ModalBuilder()
    .setCustomId('embed_modal_title')
    .setTitle('Set Embed Title');

  const titleInput = new TextInputBuilder()
    .setCustomId('title_input')
    .setLabel('Embed Title')
    .setStyle(TextInputStyle.Short)
    .setPlaceholder('Enter your embed title here')
    .setMaxLength(256)
    .setRequired(false);

  const firstActionRow = new ActionRowBuilder().addComponents(titleInput);
  modal.addComponents(firstActionRow);

  await interaction.showModal(modal);
}

async function showDescriptionModal(interaction) {
  const modal = new ModalBuilder()
    .setCustomId('embed_modal_description')
    .setTitle('Set Embed Description');

  const descInput = new TextInputBuilder()
    .setCustomId('description_input')
    .setLabel('Embed Description')
    .setStyle(TextInputStyle.Paragraph)
    .setPlaceholder('Enter your embed description here')
    .setMaxLength(4096)
    .setRequired(false);

  const firstActionRow = new ActionRowBuilder().addComponents(descInput);
  modal.addComponents(firstActionRow);

  await interaction.showModal(modal);
}

async function showColorModal(interaction) {
  const modal = new ModalBuilder()
    .setCustomId('embed_modal_color')
    .setTitle('Set Embed Color');

  const colorInput = new TextInputBuilder()
    .setCustomId('color_input')
    .setLabel('Color (hex code or decimal)')
    .setStyle(TextInputStyle.Short)
    .setPlaceholder('e.g., #00ff00 or 65280')
    .setMaxLength(20)
    .setRequired(false);

  const firstActionRow = new ActionRowBuilder().addComponents(colorInput);
  modal.addComponents(firstActionRow);

  await interaction.showModal(modal);
}

async function showFieldModal(interaction) {
  const modal = new ModalBuilder()
    .setCustomId('embed_modal_field')
    .setTitle('Add Embed Field');

  const nameInput = new TextInputBuilder()
    .setCustomId('field_name')
    .setLabel('Field Name')
    .setStyle(TextInputStyle.Short)
    .setPlaceholder('Field name')
    .setMaxLength(256)
    .setRequired(true);

  const valueInput = new TextInputBuilder()
    .setCustomId('field_value')
    .setLabel('Field Value')
    .setStyle(TextInputStyle.Paragraph)
    .setPlaceholder('Field value')
    .setMaxLength(1024)
    .setRequired(true);

  const inlineInput = new TextInputBuilder()
    .setCustomId('field_inline')
    .setLabel('Inline? (true/false)')
    .setStyle(TextInputStyle.Short)
    .setPlaceholder('true or false')
    .setMaxLength(5)
    .setRequired(false)
    .setValue('false');

  const firstActionRow = new ActionRowBuilder().addComponents(nameInput);
  const secondActionRow = new ActionRowBuilder().addComponents(valueInput);
  const thirdActionRow = new ActionRowBuilder().addComponents(inlineInput);

  modal.addComponents(firstActionRow, secondActionRow, thirdActionRow);
  await interaction.showModal(modal);
}

async function showImageModal(interaction) {
  const modal = new ModalBuilder()
    .setCustomId('embed_modal_image')
    .setTitle('Set Embed Image');

  const imageInput = new TextInputBuilder()
    .setCustomId('image_input')
    .setLabel('Image URL')
    .setStyle(TextInputStyle.Short)
    .setPlaceholder('https://example.com/image.png')
    .setRequired(false);

  const firstActionRow = new ActionRowBuilder().addComponents(imageInput);
  modal.addComponents(firstActionRow);

  await interaction.showModal(modal);
}

async function showThumbnailModal(interaction) {
  const modal = new ModalBuilder()
    .setCustomId('embed_modal_thumbnail')
    .setTitle('Set Embed Thumbnail');

  const thumbnailInput = new TextInputBuilder()
    .setCustomId('thumbnail_input')
    .setLabel('Thumbnail URL')
    .setStyle(TextInputStyle.Short)
    .setPlaceholder('https://example.com/thumbnail.png')
    .setRequired(false);

  const firstActionRow = new ActionRowBuilder().addComponents(thumbnailInput);
  modal.addComponents(firstActionRow);

  await interaction.showModal(modal);
}

async function showFooterModal(interaction) {
  const modal = new ModalBuilder()
    .setCustomId('embed_modal_footer')
    .setTitle('Set Embed Footer');

  const footerInput = new TextInputBuilder()
    .setCustomId('footer_input')
    .setLabel('Footer Text')
    .setStyle(TextInputStyle.Short)
    .setPlaceholder('Footer text')
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

    switch (customId) {
      case 'embed_modal_title':
        data.title = interaction.fields.getTextInputValue('title_input') || null;
        break;
      case 'embed_modal_description':
        data.description = interaction.fields.getTextInputValue('description_input') || null;
        break;
      case 'embed_modal_color':
        const colorValue = interaction.fields.getTextInputValue('color_input');
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
      case 'embed_modal_field':
        const fieldName = interaction.fields.getTextInputValue('field_name');
        const fieldValue = interaction.fields.getTextInputValue('field_value');
        const fieldInline = interaction.fields.getTextInputValue('field_inline') === 'true';
        
        if (fieldName && fieldValue) {
          data.fields.push({ name: fieldName, value: fieldValue, inline: fieldInline });
        }
        break;
      case 'embed_modal_image':
        data.image = interaction.fields.getTextInputValue('image_input') || null;
        break;
      case 'embed_modal_thumbnail':
        data.thumbnail = interaction.fields.getTextInputValue('thumbnail_input') || null;
        break;
      case 'embed_modal_footer':
        data.footer = interaction.fields.getTextInputValue('footer_input') || null;
        break;
    }

    await interaction.update({
      embeds: [getStatusEmbed(data)],
      components: getBuilderComponents()
    });

  } catch (error) {
    logger.error(`Embed builder modal handler failed`, {
      error: error.message,
      customId: interaction.customId,
      userId: interaction.user.id
    });
    await handleInteractionError(interaction, error, {
      type: 'modal',
      customId: interaction.customId
    });
  }
}