import {
  ChannelType,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  PermissionFlagsBits,
  AttachmentBuilder,
} from 'discord.js';
import { getGuildConfig } from './guildConfig.js';
import { getTicketData, saveTicketData, deleteTicketData, getOpenTicketCountForUser, incrementTicketCounter } from '../utils/database.js';
import { logger } from '../utils/logger.js';
import { createEmbed } from '../utils/embeds.js';
import { logTicketEvent } from '../utils/ticketLogging.js';
import { BotConfig } from '../config/bot.js';
import { ensureTypedServiceError } from '../utils/serviceErrorBoundary.js';

const DEFAULT_TYPES = {
  support: { emoji: '🛟', label: 'Support', description: 'Une question ou un problème à régler', slug: 'support' },
  prize: { emoji: '🎁', label: 'Lot Giveaway', description: "Récupérer un lot gagné lors d'un concours", slug: 'lot' },
  partner: { emoji: '🤝', label: 'Partenariat', description: 'Proposer un partenariat ou une collaboration', slug: 'partenariat' },
  other: { emoji: '📩', label: 'Autre', description: 'Toute autre demande', slug: 'autre' },
};

function getTicketTypesMap() {
  const types = BotConfig.tickets?.types || {};
  const map = {};
  for (const key of Object.keys(DEFAULT_TYPES)) {
    const config = types[key] || DEFAULT_TYPES[key];
    map[key] = {
      emoji: config.emoji || DEFAULT_TYPES[key].emoji,
      label: config.label || DEFAULT_TYPES[key].label,
      description: config.description || DEFAULT_TYPES[key].description,
      slug: config.slug || DEFAULT_TYPES[key].slug,
    };
  }
  return map;
}

const TICKET_TYPES = getTicketTypesMap();

const TICKET_DELETE_DELAY_MS = 3000;
const TICKET_DELETE_DELAY_SECONDS = Math.floor(TICKET_DELETE_DELAY_MS / 1000);

// ─── Helpers ───────────────────────────────────────────────────────────────────

export function getTicketTypes() {
  return TICKET_TYPES;
}

export function getTicketType(typeId) {
  return TICKET_TYPES[typeId] || TICKET_TYPES.support;
}

export function resolveTicketTypes(guildConfig = {}) {
  const raw =
    Array.isArray(guildConfig?.ticketTypes) && guildConfig.ticketTypes.length
      ? guildConfig.ticketTypes
      : Object.entries(DEFAULT_TYPES).map(([id, type]) => ({ id, ...type }));

  return raw
    .map((type) => {
      const id = String(type.id || type.slug || 'support');
      const slug =
        String(type.slug || id)
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-+|-+$/g, '') || 'ticket';
      return {
        id,
        emoji: type.emoji || '🎫',
        label: type.label || 'Ticket',
        description: type.description || '',
        slug,
      };
    })
    .filter((type) => type.label.trim().length > 0);
}

export function getTicketTypesForGuild(guildConfig = {}) {
  const map = {};
  for (const type of resolveTicketTypes(guildConfig)) {
    map[type.id] = type;
  }
  return map;
}

export function getTicketTypeForGuild(guildConfig, typeId) {
  const types = getTicketTypesForGuild(guildConfig);
  return (
    types[typeId] ||
    types.support ||
    types[Object.keys(types)[0]] ||
    getTicketType('support')
  );
}

async function findTicketEmbedMessage(channel) {
  const messages = await channel.messages.fetch();
  return messages.find((m) => m.embeds.length > 0 && m.embeds[0].title?.startsWith('🎫 Ticket #'));
}

function buildTicketEmbed({ ticketData, guild, member, ticketNumber }) {
  const type = {
    emoji: ticketData.ticketTypeEmoji || getTicketType(ticketData.ticketType).emoji,
    label: ticketData.ticketTypeLabel || getTicketType(ticketData.ticketType).label,
  };
  const status = ticketData.status === 'closed' ? '🔴 Fermé' : '🟢 Ouvert';
  const claimedBy = ticketData.claimedBy ? `<@${ticketData.claimedBy}>` : 'Personne';
  const number = ticketNumber ?? ticketData.ticketNumber ?? '';

  const fields = [
    { name: '🏷️ Type', value: `${type.emoji} ${type.label}`, inline: true },
    { name: '🟢 Statut', value: status, inline: true },
    { name: '🙋 Réclamé par', value: claimedBy, inline: true },
  ];

  if (ticketData.reason) {
    fields.push({ name: '📝 Demande', value: ticketData.reason, inline: false });
  }

  const creator = member ? member.toString() : `<@${ticketData.userId}>`;

  return createEmbed({
    title: `🎫 Ticket #${number}`,
    description: `${creator}, un membre de l'équipe va s'occuper de votre demande très vite.\n\nMerci de décrire précisément votre besoin dans ce salon.`,
    color: 'info',
    fields,
    footer: { text: `Ticket #${number} • ${guild?.name || ''}` },
    timestamp: false,
  });
}

function buildTicketButtons(ticketData) {
  const rows = [];

  rows.push(
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('ticket_close')
        .setLabel('Fermer')
        .setStyle(ButtonStyle.Danger)
        .setEmoji('?')
        .setDisabled(ticketData.status === 'closed'),
    ),
  );

  return rows;
}

export function buildTicketTypeButtons(label = 'Ouvrir un ticket') {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('create_ticket')
        .setLabel(label)
        .setStyle(ButtonStyle.Primary)
        .setEmoji('🎫'),
    ),
  ];
}

// ─── Counts ────────────────────────────────────────────────────────────────────

export async function getUserTicketCount(guildId, userId) {
  try {
    return await getOpenTicketCountForUser(guildId, userId);
  } catch (error) {
    const typedError = ensureTypedServiceError(error, {
      service: 'ticketService',
      operation: 'getUserTicketCount',
      message: 'Ticket operation failed: getUserTicketCount',
      userMessage: 'Impossible de compter les tickets ouverts.',
      context: { guildId, userId }
    });
    logger.error('Error counting user tickets:', {
      guildId,
      userId,
      error: typedError.message,
      errorCode: typedError.context?.errorCode
    });
    return 0;
  }
}

// ─── Create ────────────────────────────────────────────────────────────────────

export async function createTicket(guild, member, options = {}) {
  const typeId = options.type || 'support';
  const reason = options.reason || 'Aucun motif précisé.';
  let channelCreated = false;
  let channel = null;
  try {
    const config = await getGuildConfig(guild.client, guild.id);
    const type = getTicketTypeForGuild(config, typeId);

    const maxTicketsPerUser = config.maxTicketsPerUser ?? 3;
    const currentTicketCount = await getUserTicketCount(guild.id, member.id);

    if (currentTicketCount >= maxTicketsPerUser) {
      return {
        success: false,
        error: `Vous avez atteint le nombre maximum de tickets ouverts (${maxTicketsPerUser}).\nVeuillez fermer vos tickets existants avant d'en créer un nouveau.`,
      };
    }

    let category = config.ticketCategoryId
      ? guild.channels.cache.get(config.ticketCategoryId) ||
        (await guild.channels.fetch(config.ticketCategoryId).catch(() => null))
      : guild.channels.cache.find(
          (c) => c.type === ChannelType.GuildCategory && c.name.toLowerCase().includes('tickets'),
        );

    if (!category && !config.ticketCategoryId) {
      category = await guild.channels.create({
        name: 'Tickets',
        type: ChannelType.GuildCategory,
        permissionOverwrites: [
          {
            id: guild.id,
            deny: [PermissionFlagsBits.ViewChannel],
          },
        ],
      });
    }

    const ticketNumber = await getNextTicketNumber(guild.id);
    let channelName = `${type.emoji}-${type.slug}-ticket-${ticketNumber}`;

const allowPerms = [
      PermissionFlagsBits.ViewChannel,
      PermissionFlagsBits.SendMessages,
      PermissionFlagsBits.AttachFiles,
      PermissionFlagsBits.ReadMessageHistory,
      PermissionFlagsBits.AddReactions,
      PermissionFlagsBits.MentionEveryone,
    ];

channel = await guild.channels.create({
      name: channelName,
      type: ChannelType.GuildText,
      parent: category?.id,
      permissionOverwrites: [
        {
          id: guild.id,
          deny: [PermissionFlagsBits.ViewChannel],
        },
        {
          id: guild.client.user.id,
          allow: allowPerms,
        },
        {
          id: member.id,
          allow: allowPerms,
        },
        ...(config.ticketStaffRoleId
          ? [
              {
                id: config.ticketStaffRoleId,
                allow: allowPerms,
              },
            ]
          : []),
      ],
    });
    channelCreated = true;

    const ticketData = {
      id: channel.id,
      ticketNumber,
      userId: member.id,
      guildId: guild.id,
      createdAt: new Date().toISOString(),
      status: 'open',
      claimedBy: null,
      ticketType: type.id,
      ticketTypeEmoji: type.emoji,
      ticketTypeLabel: type.label,
      reason,
    };

    await saveTicketData(guild.id, channel.id, ticketData);

    const embed = buildTicketEmbed({ ticketData, guild, member, ticketNumber });
    const rows = buildTicketButtons(ticketData);
    const staffMention = config.ticketStaffRoleId ? ` <@&${config.ticketStaffRoleId}>` : '';
    const messageContent = `${member.toString()}${staffMention}`;

    const ticketMessage = await channel.send({
      content: messageContent,
      embeds: [embed],
      components: rows,
    });

    await ticketMessage.pin().catch(() => {});

    await logTicketEvent({
      client: guild.client,
      guildId: guild.id,
      event: {
        type: 'open',
        ticketId: channel.id,
        ticketNumber: ticketNumber,
        userId: member.id,
        executorId: member.id,
        reason: reason,
        metadata: {
          channelId: channel.id,
          categoryName: category?.name || 'Default',
          ticketType: typeId,
        },
      },
    });

return { success: true, channel, ticketData };
  } catch (error) {
    const typedError = ensureTypedServiceError(error, {
      service: 'ticketService',
      operation: 'createTicket',
      message: 'Ticket operation failed: createTicket',
      userMessage: 'Impossible de créer le ticket. Réessayez dans un instant.',
      context: { guildId: guild?.id, userId: member?.id }
    });
    logger.error('Error creating ticket:', {
      guildId: guild?.id,
      userId: member?.id,
      error: typedError.message,
      errorCode: typedError.context?.errorCode,
      originalError: typedError.context?.originalErrorMessage || String(error)
    });

    if (channelCreated && channel && channel.deletable) {
      try {
        await channel.delete('Échec de la création du ticket');
      } catch (cleanupError) {
        logger.warn('Failed to clean up empty ticket channel:', {
          channelId: channel.id,
          error: cleanupError.message
        });
      }
    }

    return {
      success: false,
      error: typedError.userMessage || typedError.message,
      errorCode: typedError.context?.errorCode,
      debug: typedError.context?.originalErrorMessage || typedError.message
};
  }
}

// ─── Close ─────────────────────────────────────────────────────────────────────

export async function closeTicket(channel, closer, reason = 'Aucun motif précisé.') {
  try {
    const ticketData = await getTicketData(channel.guild.id, channel.id);
    if (!ticketData) {
      return { success: false, error: "Ce canal n'est pas un ticket" };
    }

    const config = await getGuildConfig(channel.client, channel.guild.id);
    const dmOnClose = config.dmOnClose !== false;
    const closedCategoryId = config.ticketClosedCategoryId || null;
    let movedToClosedCategory = false;

    ticketData.status = 'closed';
    ticketData.closedBy = closer.id;
    ticketData.closedAt = new Date().toISOString();
    ticketData.closeReason = reason;

    await saveTicketData(channel.guild.id, channel.id, ticketData);

    if (closedCategoryId && channel.parentId !== closedCategoryId) {
      const closedCategory =
        channel.guild.channels.cache.get(closedCategoryId) ||
        (await channel.guild.channels.fetch(closedCategoryId).catch(() => null));

      if (closedCategory?.type === ChannelType.GuildCategory) {
        try {
          await channel.setParent(closedCategoryId, { lockPermissions: false });
          movedToClosedCategory = true;
        } catch (moveError) {
          logger.warn(`Could not move ticket ${channel.id} to closed category ${closedCategoryId}: ${moveError.message}`);
        }
      } else {
        logger.warn(`Configured closed category is invalid for guild ${channel.guild.id}: ${closedCategoryId}`);
      }
    }

    if (dmOnClose) {
      try {
        const ticketCreator = await channel.client.users.fetch(ticketData.userId).catch(() => null);
        if (ticketCreator) {
          const dmEmbed = createEmbed({
            title: '🎫 Votre ticket a été fermé',
            description: `Votre ticket **${channel.name}** a été fermé.\n\n**Motif :** ${reason}\n**Fermé par :** ${closer.tag}\n**Fermé le :** <t:${Math.floor(Date.now() / 1000)}:F>\n\nMerci d'avoir utilisé notre support ! Si vous avez d'autres questions, n'hésitez pas à créer un nouveau ticket.`,
            color: '#e74c3c',
            footer: { text: `Ticket ID: ${ticketData.id}` }
          });

          await ticketCreator.send({ embeds: [dmEmbed] });

          // Sondage de satisfaction — message DM séparé pour être modifiable après réponse
          try {
            const feedbackEmbed = createEmbed({
              title: '⭐ Comment s\'est passée votre expérience ?',
              description: `Nous aimerions connaître votre avis sur le ticket **${channel.name}**.\nChoisissez une note ci-dessous — cela ne prend qu'une seconde !`,
              color: '#F1C40F',
              footer: { text: 'Votre avis nous aide à nous améliorer.' },
            });

            const base = `ticket_feedback:${channel.guild.id}:${channel.id}`;
            const starsRow = new ActionRowBuilder().addComponents(
new ButtonBuilder().setCustomId(`${base}:1`).setLabel('⭐ 1').setStyle(ButtonStyle.Secondary),
              new ButtonBuilder().setCustomId(`${base}:2`).setLabel('⭐⭐ 2').setStyle(ButtonStyle.Secondary),
              new ButtonBuilder().setCustomId(`${base}:3`).setLabel('⭐⭐⭐ 3').setStyle(ButtonStyle.Secondary),
              new ButtonBuilder().setCustomId(`${base}:4`).setLabel('⭐⭐⭐⭐ 4').setStyle(ButtonStyle.Secondary),
              new ButtonBuilder().setCustomId(`${base}:5`).setLabel('⭐⭐⭐⭐⭐ 5').setStyle(ButtonStyle.Secondary),
            );
            const declineRow = new ActionRowBuilder().addComponents(
              new ButtonBuilder()
                .setCustomId(`ticket_feedback_decline:${channel.guild.id}:${channel.id}`)
                .setLabel('❌ Non merci')
                .setStyle(ButtonStyle.Secondary),
            );

            await ticketCreator.send({
              embeds: [feedbackEmbed],
              components: [starsRow, declineRow],
            });
          } catch (feedbackError) {
            logger.warn(`Could not send feedback survey to ticket creator ${ticketData.userId}: ${feedbackError.message}`);
          }
        }
      } catch (dmError) {
        logger.warn(`Could not send DM to ticket creator ${ticketData.userId}: ${dmError.message}`);
      }
    }

    try {
      const user = await channel.guild.members.fetch(ticketData.userId).catch(() => null);
      const targetUser = user?.user || (await channel.client.users.fetch(ticketData.userId).catch(() => null));

      if (targetUser) {
        const overwrite = channel.permissionOverwrites.cache.get(ticketData.userId);
        if (overwrite) {
          await overwrite.edit({
            ViewChannel: false,
            SendMessages: false,
          });
        } else {
          await channel.permissionOverwrites.create(targetUser, {
            ViewChannel: false,
            SendMessages: false,
          });
        }
      }
    } catch (permError) {
      logger.warn(`Could not update user permissions for closed ticket: ${permError.message}`);
    }

try {
      const ticketMessage = await findTicketEmbedMessage(channel);

      if (ticketMessage) {
        const updatedEmbed = buildTicketEmbed({ ticketData, guild: channel.guild, ticketNumber: ticketData.ticketNumber });
        await ticketMessage.edit({
          embeds: [updatedEmbed],
          components: [],
        });
      }
    } catch (embedEditError) {
      logger.warn(`Could not refresh ticket embed message on close: ${embedEditError.message}`);
    }

    const closeEmbed = createEmbed({
      title: '🔒 Ticket Fermé',
      description: `Ce ticket a été fermé par ${closer}.\n**Motif :** ${reason}${dmOnClose ? '\n\n📩 Un message a été envoyé au créateur du ticket.' : ''}`,
      color: '#e74c3c',
      footer: { text: `Ticket ID: ${ticketData.id}` }
    });

    const controlRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('ticket_reopen')
        .setLabel('Rouvrir')
        .setStyle(ButtonStyle.Success)
        .setEmoji('🔓'),
      new ButtonBuilder()
        .setCustomId('ticket_delete')
        .setLabel('Supprimer')
        .setStyle(ButtonStyle.Danger)
        .setEmoji('🗑️'),
    );

    try {
      await channel.send({ embeds: [closeEmbed], components: [controlRow] });
    } catch (closeSendError) {
      logger.warn(`Could not send close embed in ticket ${channel.id}: ${closeSendError.message}`);
    }

    await logTicketEvent({
      client: channel.client,
      guildId: channel.guild.id,
      event: {
        type: 'close',
        ticketId: channel.id,
        ticketNumber: ticketData.ticketNumber || ticketData.id,
        userId: ticketData.userId,
        executorId: closer.id,
        reason: reason,
        metadata: {
          dmSent: dmOnClose,
          closedAt: ticketData.closedAt,
          movedToClosedCategory,
        },
      },
    });

    return { success: true, ticketData };
  } catch (error) {
    const typedError = ensureTypedServiceError(error, {
      service: 'ticketService',
      operation: 'closeTicket',
      message: 'Ticket operation failed: closeTicket',
      userMessage: 'Impossible de fermer le ticket. Réessayez dans un instant.',
      context: { guildId: channel?.guild?.id, channelId: channel?.id, closerId: closer?.id }
    });
    logger.error('Error closing ticket:', {
      guildId: channel?.guild?.id,
      channelId: channel?.id,
userId: closer?.id,
      error: typedError.message,
      errorCode: typedError.context?.errorCode
    });
    return {
      success: false,
      error: typedError.userMessage || typedError.message,
      errorCode: typedError.context?.errorCode,
      debug: typedError.message
    };
  }
}

// ─── Claim ─────────────────────────────────────────────────────────────────────

export async function claimTicket(channel, claimer) {
  try {
    const ticketData = await getTicketData(channel.guild.id, channel.id);
    if (!ticketData) {
      return { success: false, error: "Ce canal n'est pas un ticket" };
    }

    if (ticketData.claimedBy) {
      return {
        success: false,
        error: `Ce ticket est déjà réclamé par <@${ticketData.claimedBy}>`,
      };
    }

    ticketData.claimedBy = claimer.id;
    ticketData.claimedAt = new Date().toISOString();

    await saveTicketData(channel.guild.id, channel.id, ticketData);

    const ticketMessage = await findTicketEmbedMessage(channel);

    if (ticketMessage) {
      const updatedEmbed = buildTicketEmbed({ ticketData, guild: channel.guild, ticketNumber: ticketData.ticketNumber });
      const row = buildTicketButtons(ticketData);
      await ticketMessage.edit({
        embeds: [updatedEmbed],
        components: row,
      });
    }

    const claimEmbed = createEmbed({
      title: '🙋 Ticket Réclamé',
      description: `${claimer} a réclamé ce ticket !`,
      color: '#2ecc71',
    });

    const unclaimRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('ticket_unclaim')
        .setLabel('Ne plus réclamer')
        .setStyle(ButtonStyle.Secondary)
        .setEmoji('🔓'),
    );

    const messages = await channel.messages.fetch();
    const claimStatusMessage = messages.find(
      (m) =>
        m.embeds.length > 0 &&
        (m.embeds[0].title === '🙋 Ticket Réclamé' || m.embeds[0].title === '🔓 Ticket Non Réclamé'),
    );

    if (claimStatusMessage) {
      await claimStatusMessage.edit({ embeds: [claimEmbed], components: [unclaimRow] });
    } else {
      await channel.send({ embeds: [claimEmbed], components: [unclaimRow] });
    }

    await logTicketEvent({
      client: channel.client,
      guildId: channel.guild.id,
      event: {
        type: 'claim',
        ticketId: channel.id,
        ticketNumber: ticketData.ticketNumber || ticketData.id,
        userId: ticketData.userId,
        executorId: claimer.id,
        metadata: {
          claimedAt: ticketData.claimedAt,
        },
      },
    });

    return { success: true, ticketData };
  } catch (error) {
    const typedError = ensureTypedServiceError(error, {
      service: 'ticketService',
      operation: 'claimTicket',
      message: 'Ticket operation failed: claimTicket',
      userMessage: 'Impossible de réclamer le ticket. Réessayez dans un instant.',
      context: { guildId: channel?.guild?.id, channelId: channel?.id, claimerId: claimer?.id }
    });
    logger.error('Error claiming ticket:', {
      guildId: channel?.guild?.id,
      channelId: channel?.id,
      userId: claimer?.id,
      error: typedError.message,
      errorCode: typedError.context?.errorCode
    });
    return {
      success: false,
      error: typedError.userMessage || typedError.message,
      errorCode: typedError.context?.errorCode
    };
  }
}

// ─── Reopen ────────────────────────────────────────────────────────────────────

export async function reopenTicket(channel, reopener) {
  try {
    const ticketData = await getTicketData(channel.guild.id, channel.id);
    if (!ticketData) {
      return { success: false, error: "Ce canal n'est pas un ticket" };
    }

    if (ticketData.status !== 'closed') {
      return {
        success: false,
        error: 'Ce ticket n\'est actuellement pas fermé',
      };
    }

    const config = await getGuildConfig(channel.client, channel.guild.id);
    const openCategoryId = config.ticketCategoryId || null;
    let movedToOpenCategory = false;
    let openCategoryMoveFailed = false;

    ticketData.status = 'open';
    ticketData.closedBy = null;
    ticketData.closedAt = null;
    ticketData.closeReason = null;

    await saveTicketData(channel.guild.id, channel.id, ticketData);

    if (openCategoryId && channel.parentId !== openCategoryId) {
      const openCategory =
        channel.guild.channels.cache.get(openCategoryId) ||
        (await channel.guild.channels.fetch(openCategoryId).catch(() => null));

      if (openCategory?.type === ChannelType.GuildCategory) {
        try {
          await channel.setParent(openCategoryId, { lockPermissions: false });
          movedToOpenCategory = true;
        } catch (moveError) {
          openCategoryMoveFailed = true;
          logger.warn(`Could not move reopened ticket ${channel.id} to open category ${openCategoryId}: ${moveError.message}`);
        }
      } else {
        openCategoryMoveFailed = true;
        logger.warn(`Configured open ticket category is invalid for guild ${channel.guild.id}: ${openCategoryId}`);
      }
    }

    try {
      const user = await channel.guild.members.fetch(ticketData.userId).catch(() => null);
      if (user) {
        await channel.permissionOverwrites.create(user, {
          ViewChannel: true,
          SendMessages: true,
          ReadMessageHistory: true,
          AttachFiles: true,
        });
      }
    } catch (error) {
      logger.warn(`Could not restore access for user ${ticketData.userId}:`, error.message);
    }

    const ticketMessage = await findTicketEmbedMessage(channel);

    if (ticketMessage) {
      const updatedEmbed = buildTicketEmbed({ ticketData, guild: channel.guild, ticketNumber: ticketData.ticketNumber });
      const row = buildTicketButtons(ticketData);
      await ticketMessage.edit({
        embeds: [updatedEmbed],
        components: row,
      });
    }

    const reopenEmbed = createEmbed({
      title: '🔓 Ticket Rouvert',
      description: `${reopener} a rouvert ce ticket !`,
      color: '#2ecc71',
    });

    const messages = await channel.messages.fetch();
    const closeStatusMessage = messages.find(
      (m) =>
        m.embeds.length > 0 &&
        m.embeds[0].title === '🔒 Ticket Fermé' &&
        m.components.length > 0 &&
        m.components[0].components.some((c) => c.customId === 'ticket_reopen'),
    );

    if (closeStatusMessage) {
      await closeStatusMessage.edit({ embeds: [reopenEmbed], components: [] });
    } else {
      await channel.send({ embeds: [reopenEmbed] });
    }

    return {
      success: true,
      ticketData,
      movedToOpenCategory,
      openCategoryMoveFailed,
    };
  } catch (error) {
    const typedError = ensureTypedServiceError(error, {
      service: 'ticketService',
      operation: 'reopenTicket',
      message: 'Ticket operation failed: reopenTicket',
      userMessage: 'Impossible de rouvrir le ticket. Réessayez dans un instant.',
      context: { guildId: channel?.guild?.id, channelId: channel?.id, reopenerId: reopener?.id }
    });
    logger.error('Error reopening ticket:', {
      guildId: channel?.guild?.id,
      channelId: channel?.id,
      userId: reopener?.id,
      error: typedError.message,
      errorCode: typedError.context?.errorCode
    });
    return {
      success: false,
      error: typedError.userMessage || typedError.message,
      errorCode: typedError.context?.errorCode
    };
  }
}

// ─── Transcript ─────────────────────────────────────────────────────────────────

function escapeHtml(text) {
  if (!text) return '';
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

async function generateTranscript(channel) {
  try {
    logger.debug('Generating transcript for channel', {
      channelId: channel.id,
      channelName: channel.name,
    });

    const messages = [];
    let before = undefined;
    let batch;
    do {
      batch = await channel.messages.fetch({ limit: 100, ...(before ? { before } : {}) });
      if (batch.size === 0) break;
      messages.push(...batch.values());
      before = batch.last()?.id;
    } while (batch.size === 100);

    messages.sort((a, b) => a.createdTimestamp - b.createdTimestamp);

    const escape = (str) =>
      String(str ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');

    const rows = messages
      .map((msg) => {
        const ts = new Date(msg.createdTimestamp).toISOString().replace('T', ' ').slice(0, 19);
        const author = escape(msg.author?.tag ?? msg.author?.username ?? 'Unknown');
        const content = escape(msg.content || (msg.embeds.length ? '[embed]' : '[attachment]'));
        return `<tr><td class="ts">${ts}</td><td class="author">${author}</td><td class="msg">${content}</td></tr>`;
      })
      .join('\n');

    const html = `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Transcript – #${escape(channel.name)}</title>
<style>
body{font-family:sans-serif;background:#36393f;color:#dcddde;margin:0;padding:16px}
h1{color:#fff;font-size:1.2rem;margin-bottom:8px}
table{width:100%;border-collapse:collapse;font-size:0.85rem}
th{background:#2f3136;color:#8e9297;padding:6px 8px;text-align:left;border-bottom:2px solid #202225}
td{padding:4px 8px;border-bottom:1px solid #40444b;vertical-align:top}
.ts{color:#72767d;white-space:nowrap;width:160px}
.author{color:#7289da;white-space:nowrap;width:160px}
.msg{word-break:break-word}
</style>
</head>
<body>
<h1>📜 Transcript – #${escape(channel.name)}</h1>
<p style="color:#72767d">${messages.length} message(s) exportés le ${new Date().toUTCString()}</p>
<table>
<thead><tr><th>Horodatage (UTC)</th><th>Auteur</th><th>Message</th></tr></thead>
<tbody>
${rows}
</tbody>
</table>
</body>
</html>`;

    const buffer = Buffer.from(html, 'utf8');
    const attachment = new AttachmentBuilder(buffer, { name: `ticket-${channel.id}.html` });

    logger.info('✅ Successfully generated transcript', {
      channelId: channel.id,
      channelName: channel.name,
      messageCount: messages.length,
      size: buffer.length,
    });

    return attachment;
  } catch (error) {
    logger.error('❌ Failed to generate transcript:', {
      channelId: channel.id,
      channelName: channel.name,
      errorMessage: error.message,
      errorName: error.name,
      errorStack: error.stack,
    });
    return null;
  }
}

// ─── Delete ────────────────────────────────────────────────────────────────────

export async function deleteTicket(channel, deleter) {
  try {
    const ticketData = await getTicketData(channel.guild.id, channel.id);
    if (!ticketData) {
      return { success: false, error: "Ce canal n'est pas un ticket" };
    }

    const deleteEmbed = createEmbed({
      title: '🗑️ Ticket Supprimé',
      description: `Ce ticket sera définitivement supprimé dans ${TICKET_DELETE_DELAY_SECONDS} secondes.`,
      color: '#e74c3c',
      footer: { text: `Ticket ID: ${ticketData.id}` },
    });

    await channel.send({ embeds: [deleteEmbed] });

    await logTicketEvent({
      client: channel.client,
      guildId: channel.guild.id,
      event: {
        type: 'delete',
        ticketId: channel.id,
        ticketNumber: ticketData.ticketNumber || ticketData.id,
        userId: ticketData.userId,
        executorId: deleter.id,
        metadata: {
          deletedAt: new Date().toISOString(),
        },
      },
    });

    // Suppression effective après un court délai (avec transcript si configuré)
    setTimeout(async () => {
      try {
        let guildConfig = null;
        try {
          guildConfig = await getGuildConfig(channel.client, channel.guild.id);
        } catch (configError) {
          logger.warn('Could not load guild config during ticket deletion:', configError.message);
        }
        const transcriptChannelId = guildConfig?.ticketTranscriptChannelId || null;

        let attachment = null;
        if (transcriptChannelId) {
          attachment = await generateTranscript(channel);
        } else {
          logger.debug('No transcript channel configured, skipping transcript generation', {
            channelId: channel.id,
            ticketNumber: ticketData.ticketNumber || ticketData.id,
          });
        }

        if (attachment && transcriptChannelId) {
          try {
            const transcriptChannel = await channel.client.channels.fetch(transcriptChannelId).catch(() => null);

            if (!transcriptChannel) {
              logger.error('Could not fetch transcript channel', {
                channelId: channel.id,
                transcriptChannelId,
              });
            } else if (!transcriptChannel.isSendable()) {
              logger.error('Transcript channel exists but is not sendable', {
                channelId: channel.id,
                transcriptChannelId,
              });
            } else {
              const transcriptEmbed = new EmbedBuilder()
                .setTitle('📜 Transcript du ticket')
                .setDescription(`Transcript du ticket #${ticketData.ticketNumber || ticketData.id}`)
                .setColor('#3498db')
                .addFields(
                  { name: 'ID du ticket', value: `\`${ticketData.ticketNumber || ticketData.id}\``, inline: true },
                  { name: 'Salon', value: `#${channel.name}`, inline: true },
                  { name: 'Généré le', value: `<t:${Math.floor(Date.now() / 1000)}:F>`, inline: false },
                );

              if (deleter?.username) {
                transcriptEmbed.setFooter({
                  text: `Supprimé par : ${deleter.username}`,
                  iconURL: deleter.displayAvatarURL?.(),
                });
              }

              await transcriptChannel.send({
                embeds: [transcriptEmbed],
                files: [attachment],
              });

              logger.info('✅ Transcript sent successfully', {
                channelId: channel.id,
                ticketNumber: ticketData.ticketNumber || ticketData.id,
                transcriptChannelId,
              });
            }
          } catch (sendError) {
            logger.error('Failed to send transcript to channel:', {
              channelId: channel.id,
              ticketNumber: ticketData.ticketNumber || ticketData.id,
              error: sendError.message,
            });
          }
        }

        try {
          await channel.delete('Ticket deleted permanently');
          await deleteTicketData(channel.guild.id, channel.id);
          logger.info('✅ Channel deleted', {
            channelId: channel.id,
            channelName: channel.name,
            ticketNumber: ticketData.ticketNumber || ticketData.id,
          });
        } catch (deleteError) {
          logger.error('❌ Failed to delete ticket channel:', {
            channelId: channel.id,
            channelName: channel.name,
            ticketNumber: ticketData.ticketNumber || ticketData.id,
            errorMessage: deleteError.message,
            errorCode: deleteError.code,
            errorName: deleteError.name,
          });
        }
      } catch (error) {
        logger.error('❌ Unexpected error during ticket deletion:', {
          channelId: channel.id,
          channelName: channel?.name,
          ticketNumber: ticketData?.ticketNumber || ticketData?.id,
          errorMessage: error.message,
          errorName: error.name,
          errorStack: error.stack,
        });
      }
    }, TICKET_DELETE_DELAY_MS);

    return { success: true, ticketData };
  } catch (error) {
    const typedError = ensureTypedServiceError(error, {
      service: 'ticketService',
      operation: 'deleteTicket',
      message: 'Ticket operation failed: deleteTicket',
      userMessage: 'Impossible de supprimer le ticket. Réessayez dans un instant.',
      context: { guildId: channel?.guild?.id, channelId: channel?.id, deleterId: deleter?.id }
    });
    logger.error('Error deleting ticket:', {
      guildId: channel?.guild?.id,
      channelId: channel?.id,
      userId: deleter?.id,
      error: typedError.message,
      errorCode: typedError.context?.errorCode
    });
    return {
      success: false,
      error: typedError.userMessage || typedError.message,
      errorCode: typedError.context?.errorCode
    };
  }
}

// ─── Unclaim ───────────────────────────────────────────────────────────────────

export async function unclaimTicket(channel, unclaimer) {
  try {
    const ticketData = await getTicketData(channel.guild.id, channel.id);
    if (!ticketData) {
      return { success: false, error: "Ce canal n'est pas un ticket" };
    }

    if (!ticketData.claimedBy) {
      return {
        success: false,
        error: "Ce ticket n'est actuellement réclamé par personne",
      };
    }

    if (ticketData.claimedBy !== unclaimer.id && !unclaimer.permissions.has(PermissionFlagsBits.ManageChannels)) {
      return {
        success: false,
        error: 'Vous ne pouvez retirer le réclamant que de vos propres tickets (ou avec la permission Gérer les salons).',
      };
    }

    const previousClaimer = ticketData.claimedBy;
    ticketData.claimedBy = null;
    ticketData.claimedAt = null;

    await saveTicketData(channel.guild.id, channel.id, ticketData);

    const ticketMessage = await findTicketEmbedMessage(channel);

    if (ticketMessage) {
      const updatedEmbed = buildTicketEmbed({ ticketData, guild: channel.guild, ticketNumber: ticketData.ticketNumber });
      const row = buildTicketButtons(ticketData);
      await ticketMessage.edit({
        embeds: [updatedEmbed],
        components: row,
      });
    }

    const unclaimEmbed = createEmbed({
      title: '🔓 Ticket Non Réclamé',
      description: `${unclaimer} ne réclame plus ce ticket !`,
      color: '#f39c12',
    });

    const messages = await channel.messages.fetch();
    const claimMessage = messages.find(
      (m) =>
        m.embeds.length > 0 &&
        (m.embeds[0].title === '🙋 Ticket Réclamé' || m.embeds[0].title === '🔓 Ticket Non Réclamé'),
    );

    if (claimMessage) {
      await claimMessage.edit({ embeds: [unclaimEmbed], components: [] });
    } else {
      await channel.send({ embeds: [unclaimEmbed] });
    }

    await logTicketEvent({
      client: channel.client,
      guildId: channel.guild.id,
      event: {
        type: 'unclaim',
        ticketId: channel.id,
        ticketNumber: ticketData.ticketNumber || ticketData.id,
        userId: ticketData.userId,
        executorId: unclaimer.id,
        metadata: {
          previousClaimer,
        },
      },
    });

    return { success: true, ticketData };
  } catch (error) {
    const typedError = ensureTypedServiceError(error, {
      service: 'ticketService',
      operation: 'unclaimTicket',
      message: 'Ticket operation failed: unclaimTicket',
      userMessage: 'Impossible de retirer la réclamation. Réessayez dans un instant.',
      context: { guildId: channel?.guild?.id, channelId: channel?.id, unclaimerId: unclaimer?.id }
    });
    logger.error('Error unclaiming ticket:', {
      guildId: channel?.guild?.id,
      channelId: channel?.id,
      userId: unclaimer?.id,
      error: typedError.message,
      errorCode: typedError.context?.errorCode
    });
    return {
      success: false,
      error: typedError.userMessage || typedError.message,
      errorCode: typedError.context?.errorCode
    };
  }
}

async function getNextTicketNumber(guildId) {
  return await incrementTicketCounter(guildId);
}
