import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, ChannelSelectMenuBuilder, ChannelType } from 'discord.js';
import { logger } from '../../utils/logger.js';
import { getColor } from '../../config/bot.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';

const embedBuilderData = new Map();
const MAX_TEXT_INPUT_LENGTH = 4000;
const MAX_EMBED_DESCRIPTION = 4096;
const MAX_EMBED_FIELDS = 25;

function getEmbedData(userId) {
  if (!embedBuilderData.has(userId)) {
    embedBuilderData.set(userId, createEmptyEmbedData());
  }
  return embedBuilderData.get(userId);
}

function createEmptyEmbedData() {
  return {
    title: null,
    description: null,
    color: null,
    fields: [],
    image: null,
    thumbnail: null,
    footer: null,
    author: null,
    timestamp: false,
    channelId: null
  };
}

function clearEmbedData(userId) {
  embedBuilderData.delete(userId);
}

function truncate(value, max) {
  if (!value) return value;
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

function fieldValue(value) {
  const text = String(value ?? '').trim() || 'Non défini';
  return truncate(text, 1024);
}

function hasEmbedContent(data) {
  return Boolean(
    data.title ||
    data.description ||
    data.image ||
    data.thumbnail ||
    data.footer ||
    data.author ||
    data.fields.length > 0
  );
}

function parseColor(input) {
  if (!input) return null;
  const raw = String(input).trim();
  if (!raw) return null;

  if (raw.startsWith('#')) {
    const hex = raw.slice(1);
    if (!/^[0-9a-fA-F]{6}$/.test(hex)) return null;
    return parseInt(hex, 16);
  }

  if (/^[0-9a-fA-F]{6}$/.test(raw)) {
    return parseInt(raw, 16);
  }

  if (/^\d+$/.test(raw)) {
    const numeric = Number(raw);
    if (Number.isInteger(numeric) && numeric >= 0 && numeric <= 0xffffff) {
      return numeric;
    }
  }

  return null;
}

function formatColor(color) {
  if (typeof color !== 'number' || !Number.isFinite(color)) return 'Par défaut';
  return `#${color.toString(16).padStart(6, '0').toUpperCase()}`;
}

function isValidHttpUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function generatePreviewEmbed(data) {
  const embed = new EmbedBuilder();

  if (!hasEmbedContent(data)) {
    return embed
      .setDescription('Prévisualisation vide — ajoute un titre, une description ou un champ.')
      .setColor(getColor('info'));
  }

  if (data.title) embed.setTitle(truncate(data.title, 256));
  if (data.description) embed.setDescription(truncate(data.description, MAX_EMBED_DESCRIPTION));
  if (typeof data.color === 'number') embed.setColor(data.color);
  if (data.fields.length > 0) embed.addFields(data.fields.slice(0, MAX_EMBED_FIELDS));
  if (data.image) embed.setImage(data.image);
  if (data.thumbnail) embed.setThumbnail(data.thumbnail);
  if (data.footer) embed.setFooter({ text: truncate(data.footer, 2048) });
  if (data.author) embed.setAuthor({ name: truncate(data.author, 256) });
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
        .setCustomId('embed_channel')
        .setLabel('Salon d\'envoi')
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
  const descriptionPreview = data.description
    ? truncate(data.description, 50)
    : 'Non défini';

  return new EmbedBuilder()
    .setTitle('🎨 Embed Builder')
    .setDescription('Utilise les boutons ci-dessous pour personnaliser ton embed.')
    .setColor(typeof data.color === 'number' ? data.color : getColor('info'))
    .addFields(
      { name: '📝 Titre', value: fieldValue(data.title), inline: true },
      { name: '📖 Description', value: fieldValue(descriptionPreview), inline: true },
      { name: '🎨 Couleur', value: fieldValue(formatColor(data.color)), inline: true },
      { name: '📊 Champs', value: fieldValue(String(data.fields.length)), inline: true },
      { name: '🖼️ Image', value: fieldValue(data.image ? 'Définie' : 'Non définie'), inline: true },
      { name: '👾 Miniature', value: fieldValue(data.thumbnail ? 'Définie' : 'Non définie'), inline: true },
      { name: '📢 Salon d\'envoi', value: data.channelId ? `<#${data.channelId}>` : 'Salon actuel', inline: true }
    );
}

function getBuilderOwnerId(interaction) {
  return interaction.message?.interaction?.user?.id
    ?? interaction.message?.interactionMetadata?.user?.id
    ?? null;
}

async function refreshBuilderMessage(interaction, data, extra = {}) {
  const payload = {
    content: extra.content ?? null,
    embeds: extra.embeds ?? [getStatusEmbed(data)],
    components: extra.components ?? getBuilderComponents()
  };

  if (!interaction.replied && !interaction.deferred) {
    if (typeof interaction.update === 'function' && interaction.message) {
      await interaction.update(payload);
      return;
    }
    await interaction.reply(payload);
    return;
  }

  await interaction.editReply(payload);
}

async function showTextModal(interaction, { customId, title, inputCustomId, label, placeholder, style, maxLength, required = false }) {
  const modal = new ModalBuilder()
    .setCustomId(customId)
    .setTitle(title);

  const input = new TextInputBuilder()
    .setCustomId(inputCustomId)
    .setLabel(label)
    .setStyle(style)
    .setPlaceholder(placeholder)
    .setMaxLength(maxLength)
    .setRequired(required);

  modal.addComponents(new ActionRowBuilder().addComponents(input));
  await interaction.showModal(modal);
}

export async function handleEmbedBuilderButtons(interaction, client) {
  try {
    const userId = interaction.user.id;
    const customId = interaction.customId;
    const ownerId = getBuilderOwnerId(interaction);

    if (ownerId && ownerId !== userId) {
      await InteractionHelper.sendErrorNotice(interaction, 'Seule la personne qui a lancé le constructeur peut l’utiliser.');
      return;
    }

    const data = getEmbedData(userId);
    logger.info(`Embed builder button clicked: ${customId} by user ${userId}`);

    switch (customId) {
      case 'embed_title':
        await showTextModal(interaction, {
          customId: 'embed_title_modal',
          title: 'Définir le titre',
          inputCustomId: 'embed_title',
          label: 'Titre de l’embed',
          placeholder: 'Entre ton titre ici',
          style: TextInputStyle.Short,
          maxLength: 256
        });
        break;
      case 'embed_desc':
        await showTextModal(interaction, {
          customId: 'embed_desc_modal',
          title: 'Définir la description',
          inputCustomId: 'embed_desc',
          label: 'Description de l’embed',
          placeholder: 'Entre ta description ici',
          style: TextInputStyle.Paragraph,
          maxLength: MAX_TEXT_INPUT_LENGTH
        });
        break;
      case 'embed_color':
        await showTextModal(interaction, {
          customId: 'embed_color_modal',
          title: 'Définir la couleur',
          inputCustomId: 'embed_color',
          label: 'Couleur (hex ou décimal)',
          placeholder: 'ex: #00ff00 ou 65280',
          style: TextInputStyle.Short,
          maxLength: 20
        });
        break;
      case 'embed_field':
        await showFieldModal(interaction);
        break;
      case 'embed_image':
        await showTextModal(interaction, {
          customId: 'embed_image_modal',
          title: 'Définir l’image',
          inputCustomId: 'embed_image',
          label: 'URL de l’image',
          placeholder: 'https://example.com/image.png',
          style: TextInputStyle.Short,
          maxLength: 512
        });
        break;
      case 'embed_thumb':
        await showTextModal(interaction, {
          customId: 'embed_thumb_modal',
          title: 'Définir la miniature',
          inputCustomId: 'embed_thumb',
          label: 'URL de la miniature',
          placeholder: 'https://example.com/thumbnail.png',
          style: TextInputStyle.Short,
          maxLength: 512
        });
        break;
      case 'embed_footer':
        await showTextModal(interaction, {
          customId: 'embed_footer_modal',
          title: 'Définir le footer',
          inputCustomId: 'embed_footer',
          label: 'Texte du footer',
          placeholder: 'Texte du footer',
          style: TextInputStyle.Short,
          maxLength: 2048
        });
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
      case 'embed_channel':
        await showChannelSelect(interaction, data);
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

    try {
      await InteractionHelper.sendErrorNotice(interaction, `Erreur : ${error.message}`);
    } catch (replyError) {
      logger.error('Failed to send error message:', replyError);
    }
  }
}

async function showFieldModal(interaction) {
  const modal = new ModalBuilder()
    .setCustomId('embed_field_modal')
    .setTitle('Ajouter un champ');

  const nameInput = new TextInputBuilder()
    .setCustomId('field_name')
    .setLabel('Nom du champ')
    .setStyle(TextInputStyle.Short)
    .setPlaceholder('Nom du champ')
    .setMaxLength(256)
    .setRequired(true);

  const valueInput = new TextInputBuilder()
    .setCustomId('field_value')
    .setLabel('Valeur du champ')
    .setStyle(TextInputStyle.Paragraph)
    .setPlaceholder('Valeur du champ')
    .setMaxLength(1024)
    .setRequired(true);

  const inlineInput = new TextInputBuilder()
    .setCustomId('field_inline')
    .setLabel('En ligne ? (true/false)')
    .setStyle(TextInputStyle.Short)
    .setPlaceholder('true ou false')
    .setMaxLength(5)
    .setRequired(false)
    .setValue('false');

  modal.addComponents(
    new ActionRowBuilder().addComponents(nameInput),
    new ActionRowBuilder().addComponents(valueInput),
    new ActionRowBuilder().addComponents(inlineInput)
  );

  await interaction.showModal(modal);
}

async function showChannelSelect(interaction, data) {
  const channelSelect = new ChannelSelectMenuBuilder()
    .setCustomId('embed_channel_select')
    .setPlaceholder('Choisis le salon d\'envoi...')
    .addChannelTypes(ChannelType.GuildText)
    .setMaxValues(1);

  const selectRow = new ActionRowBuilder().addComponents(channelSelect);

  await refreshBuilderMessage(interaction, data, {
    embeds: [
      new EmbedBuilder()
        .setTitle('📢 Choisir le salon d\'envoi')
        .setDescription('Sélectionne le salon où l\'embed sera envoyé.\n\n**Actuel :** ' + (data.channelId ? `<#${data.channelId}>` : 'Salon actuel'))
        .setColor(getColor('info')),
      getStatusEmbed(data)
    ],
    components: [
      selectRow,
      ...getBuilderComponents().slice(0, 2)
    ]
  });
}

async function showPreview(interaction, data) {
  await refreshBuilderMessage(interaction, data, {
    embeds: [generatePreviewEmbed(data), getStatusEmbed(data)]
  });
}

async function resetEmbed(interaction, userId) {
  clearEmbedData(userId);
  const data = getEmbedData(userId);
  await refreshBuilderMessage(interaction, data);
  logger.info(`Embed builder reset for user ${userId}`);
}

async function cancelEmbed(interaction, userId) {
  clearEmbedData(userId);

  await refreshBuilderMessage(interaction, createEmptyEmbedData(), {
    embeds: [
      new EmbedBuilder()
        .setDescription('❌ Constructeur d’embed annulé.')
        .setColor(getColor('error'))
    ],
    components: []
  });

  logger.info(`Embed builder cancelled for user ${userId}`);
}

async function sendEmbed(interaction, data) {
  if (!hasEmbedContent(data)) {
    await InteractionHelper.sendErrorNotice(interaction, 'Ton embed est vide. Ajoute au moins un titre, une description ou un champ.');
    return;
  }

  if (!interaction.replied && !interaction.deferred) {
    await interaction.deferUpdate();
  }

  let targetChannel = interaction.channel;
  if (data.channelId) {
    targetChannel = interaction.guild?.channels.cache.get(data.channelId)
      ?? await interaction.guild?.channels.fetch(data.channelId).catch(() => null);
  }

  if (!targetChannel?.isTextBased?.() || targetChannel.type === ChannelType.GuildForum) {
    await InteractionHelper.sendErrorNotice(interaction, 'Le salon choisi est introuvable ou n\'est pas un salon texte.');
    return;
  }

  const finalEmbed = generatePreviewEmbed(data);
  await targetChannel.send({ embeds: [finalEmbed] });

  clearEmbedData(interaction.user.id);

  await refreshBuilderMessage(interaction, createEmptyEmbedData(), {
    embeds: [
      new EmbedBuilder()
        .setDescription(`✅ Embed envoyé avec succès dans ${targetChannel}.`)
        .setColor(getColor('success'))
    ],
    components: []
  });

  logger.info(`Embed sent by user ${interaction.user.id} in channel ${targetChannel.id}`);
}

export async function handleEmbedBuilderChannelSelect(interaction, client) {
  try {
    const userId = interaction.user.id;
    const customId = interaction.customId;
    const ownerId = getBuilderOwnerId(interaction);

    if (ownerId && ownerId !== userId) {
      await InteractionHelper.sendErrorNotice(interaction, 'Seule la personne qui a lancé le constructeur peut l’utiliser.');
      return;
    }

    const data = getEmbedData(userId);
    const selected = interaction.channels.first();

    if (!selected) {
      await InteractionHelper.sendErrorNotice(interaction, 'Choisis un salon texte.');
      return;
    }
    if (selected.type !== ChannelType.GuildText) {
      await InteractionHelper.sendErrorNotice(interaction, 'Choisis un salon texte.');
      return;
    }

    data.channelId = selected.id;

    logger.info(`Embed builder channel selected: ${selected.id} by user ${userId}`);

    await refreshBuilderMessage(interaction, data);
  } catch (error) {
    logger.error(`Embed builder channel select handler failed`, {
      error: error.message,
      stack: error.stack,
      customId: interaction.customId,
      userId: interaction.user.id
    });

    try {
      await InteractionHelper.sendErrorNotice(interaction, `Erreur : ${error.message}`);
    } catch (replyError) {
      logger.error('Failed to send error message:', replyError);
    }
  }
}

export async function handleEmbedBuilderModals(interaction, client) {
  try {
    const userId = interaction.user.id;
    const customId = interaction.customId;
    const data = getEmbedData(userId);

    logger.info(`Embed builder modal submitted: ${customId} by user ${userId}`);

    switch (customId) {
      case 'embed_title_modal':
        data.title = interaction.fields.getTextInputValue('embed_title').trim() || null;
        break;
      case 'embed_desc_modal':
        data.description = interaction.fields.getTextInputValue('embed_desc').trim() || null;
        break;
      case 'embed_color_modal': {
        const colorValue = interaction.fields.getTextInputValue('embed_color').trim();
        if (!colorValue) {
          data.color = null;
          break;
        }
        const parsedColor = parseColor(colorValue);
        if (parsedColor === null) {
          await refreshBuilderMessage(interaction, data);
          await InteractionHelper.sendErrorNotice(interaction, 'Couleur invalide. Utilise un hex (`#00FF00`) ou un nombre décimal (0–16777215).');
          return;
        }
        data.color = parsedColor;
        break;
      }
      case 'embed_field_modal': {
        if (data.fields.length >= MAX_EMBED_FIELDS) {
          await refreshBuilderMessage(interaction, data);
          await InteractionHelper.sendErrorNotice(interaction, 'Maximum 25 champs par embed.');
          return;
        }

        const fieldName = interaction.fields.getTextInputValue('field_name').trim();
        const fieldValueText = interaction.fields.getTextInputValue('field_value').trim();
        const fieldInline = interaction.fields.getTextInputValue('field_inline').trim().toLowerCase() === 'true';

        if (fieldName && fieldValueText) {
          data.fields.push({ name: fieldName, value: fieldValueText, inline: fieldInline });
        }
        break;
      }
      case 'embed_image_modal': {
        const imageUrl = interaction.fields.getTextInputValue('embed_image').trim();
        if (!imageUrl) {
          data.image = null;
          break;
        }
        if (!isValidHttpUrl(imageUrl)) {
          await refreshBuilderMessage(interaction, data);
          await InteractionHelper.sendErrorNotice(interaction, 'URL d’image invalide. Utilise une URL http(s).');
          return;
        }
        data.image = imageUrl;
        break;
      }
      case 'embed_thumb_modal': {
        const thumbnailUrl = interaction.fields.getTextInputValue('embed_thumb').trim();
        if (!thumbnailUrl) {
          data.thumbnail = null;
          break;
        }
        if (!isValidHttpUrl(thumbnailUrl)) {
          await refreshBuilderMessage(interaction, data);
          await InteractionHelper.sendErrorNotice(interaction, 'URL de miniature invalide. Utilise une URL http(s).');
          return;
        }
        data.thumbnail = thumbnailUrl;
        break;
      }
      case 'embed_footer_modal':
        data.footer = interaction.fields.getTextInputValue('embed_footer').trim() || null;
        break;
    }

    await refreshBuilderMessage(interaction, data);
  } catch (error) {
    logger.error(`Embed builder modal handler failed`, {
      error: error.message,
      stack: error.stack,
      customId: interaction.customId,
      userId: interaction.user.id
    });

    try {
      await InteractionHelper.sendErrorNotice(interaction, `Erreur : ${error.message}`);
    } catch (replyError) {
      logger.error('Failed to send error message:', replyError);
    }
  }
}
