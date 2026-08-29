import {
  Events,
  MessageFlags,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  PermissionFlagsBits,
} from 'discord.js';
import { logger } from '../utils/logger.js';
import { getGuildConfig } from '../services/guildConfig.js';
import { errorEmbed, successEmbed, createEmbed } from '../utils/embeds.js';
import { saveTicketData, getTicketData, deleteTicketData, incrementTicketCounter } from '../utils/database.js';
import { handleApplicationModal } from '../commands/Community/apply.js';
import { handleApplicationReviewModal } from '../commands/Community/app-admin.js';
import { handleEmbedBuilderButtons, handleEmbedBuilderModals } from '../handlers/interactionHandlers/embedBuilderButtons.js';
import { handleInteractionError, createError, ErrorTypes } from '../utils/errorHandler.js';
import { InteractionHelper } from '../utils/interactionHelper.js';
import { createInteractionTraceContext, runWithTraceContext } from '../utils/traceContext.js';
import { validateChatInputPayloadOrThrow } from '../utils/commandInputValidation.js';
import { enforceAbuseProtection, formatCooldownDuration } from '../utils/abuseProtection.js';
import { checkRateLimit } from '../utils/rateLimiter.js';
import { getUserTicketCount, getTicketTypeForGuild } from '../services/ticket.js';

logger.info('[TicketFallback] v5 chargé — création en un clic + boutons autonomes.');

function withTraceContext(context = {}, traceContext = {}) {
  return {
    traceId: traceContext.traceId,
    guildId: context.guildId || traceContext.guildId,
    userId: context.userId || traceContext.userId,
    command: context.commandName || traceContext.command,
    ...context
  };
}

async function fallbackEligibility(interaction, client) {
  if (!interaction.inGuild()) return { ok: false };

  const rateLimitKey = `${interaction.user.id}:create_ticket`;
  const allowed = await checkRateLimit(rateLimitKey, 3, 60000);
  if (!allowed) {
    return {
      ok: false,
      title: 'Trop de tickets',
      message: 'Vous créez des tickets trop rapidement. Veuillez attendre une minute avant de réessayer.',
    };
  }

  const config = await getGuildConfig(client, interaction.guildId);
  const maxTicketsPerUser = config.maxTicketsPerUser || 3;
  const count = await getUserTicketCount(interaction.guildId, interaction.user.id);

  if (count >= maxTicketsPerUser) {
    return {
      ok: false,
      title: '🎫 Limite de tickets atteinte',
      message: `Vous avez atteint le nombre maximum de tickets ouverts (${maxTicketsPerUser}).\n\nVeuillez fermer vos tickets existants avant d'en créer un nouveau.\n\n**Tickets actuels :** ${count}/${maxTicketsPerUser}`,
    };
  }

  return { ok: true, config };
}

async function fallbackTicketButton(interaction, client) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => {});
  try {
    const eligibility = await fallbackEligibility(interaction, client);
    if (!eligibility.ok) {
      if (eligibility.message) {
        await interaction.editReply({
          embeds: [errorEmbed(eligibility.title || 'Erreur', eligibility.message)],
        }).catch(() => {});
      }
      return;
    }

    const { config } = eligibility;

    const typeId =
      interaction.customId === 'create_ticket'
        ? 'support'
        : interaction.customId.split(':')[1] || 'support';
    const type = getTicketTypeForGuild(config, typeId);

    if (!type) {
      return await interaction.editReply({
        embeds: [errorEmbed('Type inconnu', `Le type de ticket \`${typeId}\` n'existe plus dans la configuration du serveur. Contactez un administrateur.`)],
      }).catch(() => {});
    }

    const result = await createTicketFallback(interaction.guild, interaction.member, {
      type: type.id,
    });

    if (result.success) {
      return await interaction.editReply({
        content: `<@${interaction.user.id}>, votre ticket a été créé : <#${result.channel.id}>`,
      }).catch(() => {});
    }

    return await interaction.editReply({
      embeds: [errorEmbed('Erreur', 'TF v4 — ' + (result.error || 'Impossible de créer le ticket.') + (result.debug ? `\n\n\`${result.debug}\`` : ''))],
    }).catch(() => {});
  } catch (error) {
    logger.error('Fallback ticket button failed:', error);
    await interaction.editReply({
      embeds: [errorEmbed('Erreur', 'TF v4 — Impossible de créer le ticket.')],
    }).catch(() => {});
  }
}

async function createTicketFallback(guild, member, options = {}) {
  let createdChannel = null;
  try {
    const config = await getGuildConfig(guild.client, guild.id);
    const type = getTicketTypeForGuild(config, options.type || 'support');

    const maxTicketsPerUser = config.maxTicketsPerUser ?? 3;
    const currentTicketCount = await getUserTicketCount(guild.id, member.id);
    if (currentTicketCount >= maxTicketsPerUser) {
      return {
        success: false,
        error: `Vous avez atteint le nombre maximum de tickets ouverts (${maxTicketsPerUser}).\nVeuillez fermer vos tickets existants avant d'en créer un nouveau.`,
      };
    }

    const category = config.ticketCategoryId
      ? guild.channels.cache.get(config.ticketCategoryId) ||
        (await guild.channels.fetch(config.ticketCategoryId).catch(() => null))
      : guild.channels.cache.find(
          (c) => c.type === ChannelType.GuildCategory && c.name.toLowerCase().includes('tickets'),
        );

    const ticketNumber = await incrementTicketCounter(guild.id);
    const channelName = `${type.emoji}-${type.slug}-ticket-${ticketNumber}`;
    const allowPerms = [
      PermissionFlagsBits.ViewChannel,
      PermissionFlagsBits.SendMessages,
      PermissionFlagsBits.AttachFiles,
      PermissionFlagsBits.ReadMessageHistory,
      PermissionFlagsBits.AddReactions,
      PermissionFlagsBits.MentionEveryone,
    ];

    createdChannel = await guild.channels.create({
      name: channelName,
      type: ChannelType.GuildText,
      parent: category?.id,
      permissionOverwrites: [
        { id: guild.id, deny: [PermissionFlagsBits.ViewChannel] },
        { id: guild.client.user.id, allow: allowPerms },
        { id: member.id, allow: allowPerms },
        ...(config.ticketStaffRoleId
          ? [{ id: config.ticketStaffRoleId, allow: allowPerms }]
          : []),
      ],
    });

    const ticketData = {
      id: createdChannel.id,
      ticketNumber,
      userId: member.id,
      guildId: guild.id,
      createdAt: new Date().toISOString(),
      status: 'open',
      claimedBy: null,
      ticketType: type.id,
      ticketTypeEmoji: type.emoji,
      ticketTypeLabel: type.label,
      reason: options.reason || 'Aucun motif précisé.',
    };

    await saveTicketData(guild.id, createdChannel.id, ticketData);

    const embed = createEmbed({
      title: `🎫 Ticket #${ticketNumber}`,
      description: `${member}, un membre de l'équipe va s'occuper de votre demande très vite.\n\nMerci de décrire précisément votre besoin dans ce salon.`,
      color: 'info',
      fields: [
        { name: '🟢 Statut', value: '🟢 Ouvert', inline: true },
      ],
      footer: { text: `Ticket #${ticketNumber} • ${guild?.name || ''}` },
      timestamp: false,
    });

    const embedMessage = await createdChannel.send({
      content: `${member.toString()}${config.ticketStaffRoleId ? ` <@&${config.ticketStaffRoleId}>` : ''}`,
      embeds: [embed],
      components: [
        new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId('ticket_close')
            .setLabel('Fermer')
            .setStyle(ButtonStyle.Danger)
            .setEmoji('🔒'),
        ),
      ],
    });

    await embedMessage.pin().catch(() => {});

    return { success: true, channel: createdChannel, ticketData };
  } catch (error) {
    if (createdChannel?.deletable) {
      try {
        await createdChannel.delete('Échec de la création du ticket');
      } catch (_) {}
    }
    const detail = error?.message || String(error);
    logger.error('Fallback createTicket failed:', detail);
    return {
      success: false,
      error: 'Impossible de créer le ticket. Réessayez dans un instant.',
      debug: detail,
    };
  }
}

async function fallbackTicketModal(interaction, client) {
  try {
    if (!interaction.inGuild()) return;

    const typeId = interaction.customId.split(':')[1] || 'support';
    const reason = interaction.fields?.getTextInputValue('reason');

    const result = await createTicketFallback(interaction.guild, interaction.member, {
      type: typeId,
      reason,
    });

    if (result.success) {
      return await interaction.reply({
        content: `<@${interaction.user.id}>, votre ticket a été créé : <#${result.channel.id}>`,
        flags: MessageFlags.Ephemeral,
      });
    }

    return await interaction.reply({
      embeds: [errorEmbed('Erreur', 'TF v4 — ' + (result.error || 'Impossible de créer le ticket.') + (result.debug ? `\n\n\`${result.debug}\`` : ''))],
      flags: MessageFlags.Ephemeral,
    });
  } catch (error) {
    logger.error('Fallback ticket modal failed:', error);
    try {
      await interaction.reply({
        embeds: [errorEmbed('Erreur', 'TF v4 — Une erreur est survenue lors de la création de votre ticket.')],
        flags: MessageFlags.Ephemeral,
      });
    } catch (_) { /* fallback already answered */ }
  }
}

async function closeTicketFallback(channel, closer) {
  try {
    const ticketData = await getTicketData(channel.guild.id, channel.id);
    if (!ticketData) {
      return { success: false, error: "Ce canal n'est pas un ticket." };
    }
    if (ticketData.status === 'closed') {
      return { success: false, error: 'Ce ticket est déjà fermé.' };
    }

    const ticketNumber = ticketData.ticketNumber || '';

    ticketData.status = 'closed';
    ticketData.closedBy = closer.id;
    ticketData.closedAt = new Date().toISOString();
    ticketData.closeReason = 'Aucun motif précisé.';
    await saveTicketData(channel.guild.id, channel.id, ticketData);

    try {
      const config = await getGuildConfig(channel.client, channel.guild.id);
      const closedCategoryId = config.ticketClosedCategoryId || null;
      if (closedCategoryId && channel.parentId !== closedCategoryId) {
        const closedCategory =
          channel.guild.channels.cache.get(closedCategoryId) ||
          (await channel.guild.channels.fetch(closedCategoryId).catch(() => null));
        if (closedCategory?.type === ChannelType.GuildCategory) {
          await channel.setParent(closedCategoryId, { lockPermissions: false });
        }
      }
    } catch (_) {}

    try {
      const ticketCreator = await channel.client.users.fetch(ticketData.userId).catch(() => null);
      if (ticketCreator) {
        await ticketCreator.send({
          embeds: [
            createEmbed({
              title: '🎫 Votre ticket a été fermé',
              description: `Votre ticket **${channel.name}** a été fermé.\n\n**Fermé par :** ${closer}\n**Fermé le :** <t:${Math.floor(Date.now() / 1000)}:F>\n\nMerci d'avoir utilisé notre support !`,
              color: '#e74c3c',
            }),
          ],
        });
      }
    } catch (_) {}

    try {
      const overwrite = channel.permissionOverwrites.cache.get(ticketData.userId);
      if (overwrite) {
        await overwrite.edit({ ViewChannel: false, SendMessages: false });
      }
    } catch (_) {}

    try {
      const messages = await channel.messages.fetch();
      const ticketMessage = messages.find((m) => m.embeds.length > 0 && m.embeds[0].title?.startsWith('🎫 Ticket #'));
      if (ticketMessage) {
        await ticketMessage.edit({
          embeds: [
            createEmbed({
              title: ticketNumber ? `🎫 Ticket #${ticketNumber}` : '🎫 Ticket Fermé',
              description: `🔒 Ce ticket a été **fermé**.\n\nMerci d'avoir utilisé notre support !`,
              color: '#e74c3c',
              timestamp: false,
            }),
          ],
          components: [],
        });
      }
    } catch (_) {}

    try {
      await channel.send({
        embeds: [
          createEmbed({
            title: '🔒 Ticket Fermé',
            description: `Ce ticket a été fermé par ${closer}.`,
            color: '#e74c3c',
          }),
        ],
        components: [
          new ActionRowBuilder().addComponents(
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
          ),
        ],
      });
    } catch (_) {}

    return { success: true, channel, ticketData };
  } catch (error) {
    const detail = error?.message || String(error);
    logger.error('Fallback closeTicket failed:', detail);
    return {
      success: false,
      error: 'Impossible de fermer le ticket. Réessayez dans un instant.',
      debug: detail,
    };
  }
}

async function deleteTicketFallback(interaction) {
  const channel = interaction.channel;
  try {
    if (!channel) return;
    if (!interaction.inGuild()) return;

    await interaction.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => {});

    const ticketData = await getTicketData(channel.guild.id, channel.id);
    if (ticketData) {
      ticketData.status = 'deleted';
      ticketData.deletedBy = interaction.member.id;
      ticketData.deletedAt = new Date().toISOString();
      await saveTicketData(channel.guild.id, channel.id, ticketData);
      await deleteTicketData(channel.guild.id, channel.id).catch(() => {});
    }

    await interaction.editReply({
      embeds: [successEmbed('Le ticket va être supprimé.', '✅ Ticket Supprimé')],
    });

    setTimeout(async () => {
      try {
        await channel.delete('Ticket supprimé');
      } catch (_) {}
    }, 800);
  } catch (error) {
    const detail = error?.message || String(error);
    logger.error('Fallback deleteTicket failed:', detail);
    try {
      await interaction.editReply({
        embeds: [errorEmbed('Erreur', 'TF v4 — Impossible de supprimer le ticket.' + `\n\n\`${detail}\``)],
      });
    } catch (_) {}
  }
}

async function reopenTicketFallback(interaction) {
  const channel = interaction.channel;
  try {
    if (!channel) return;
    if (!interaction.inGuild()) return;

    await interaction.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => {});

    const ticketData = await getTicketData(channel.guild.id, channel.id);
    if (!ticketData) {
      return await interaction.editReply({
        embeds: [errorEmbed('Erreur', "Ce canal n'est pas un ticket.")],
      });
    }
    if (ticketData.status !== 'closed') {
      return await interaction.editReply({
        embeds: [errorEmbed('Erreur', "Ce ticket n'est pas fermé.")],
      });
    }

    const ticketNumber = ticketData.ticketNumber || '';

    ticketData.status = 'open';
    ticketData.claimedBy = null;
    ticketData.openedAt = new Date().toISOString();
    await saveTicketData(channel.guild.id, channel.id, ticketData);

    try {
      await channel.permissionOverwrites.edit(interaction.member.id, {
        ViewChannel: true,
        SendMessages: true,
      });
    } catch (_) {}

    try {
      const config = await getGuildConfig(channel.client, channel.guild.id);
      const openCategoryId = config.ticketCategoryId || null;
      if (openCategoryId && channel.parentId !== openCategoryId) {
        const openCategory =
          channel.guild.channels.cache.get(openCategoryId) ||
          (await channel.guild.channels.fetch(openCategoryId).catch(() => null));
        if (openCategory?.type === ChannelType.GuildCategory) {
          await channel.setParent(openCategoryId, { lockPermissions: false });
        }
      }
    } catch (_) {}

    try {
      await channel.send({
        embeds: [
          createEmbed({
            title: ticketNumber ? `🎫 Ticket #${ticketNumber}` : '🎫 Ticket Réouvert',
            description: `☎️ Ce ticket a été **rouvert** par ${interaction.member}.`,
            color: 'info',
          }),
        ],
        components: [
          new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId('ticket_close')
              .setLabel('Fermer')
              .setStyle(ButtonStyle.Danger)
              .setEmoji('🔒'),
          ),
        ],
      });
    } catch (_) {}

    await interaction.editReply({
      embeds: [successEmbed('Le ticket a été rouvert.', '☎️ Ticket Rouvert')],
    });
  } catch (error) {
    const detail = error?.message || String(error);
    logger.error('Fallback reopenTicket failed:', detail);
    try {
      await interaction.editReply({
        embeds: [errorEmbed('Erreur', 'TF v4 — Impossible de rouvrir le ticket.' + `\n\n\`${detail}\``)],
      });
    } catch (_) {}
  }
}

async function fallbackTicketClose(interaction, client) {
  try {
    if (!interaction.inGuild()) return;

    await interaction.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => {});

    const result = await closeTicketFallback(interaction.channel, interaction.member);

    if (result.success) {
      return await interaction.editReply({
        embeds: [successEmbed('Le ticket a été fermé.', '✅ Ticket Fermé')],
      });
    }

    return await interaction.editReply({
      embeds: [errorEmbed('Erreur', 'TF v4 — ' + (result.error || 'Impossible de fermer le ticket.' + (result.debug ? `\n\n\`${result.debug}\`` : '')))],
    });
  } catch (error) {
    logger.error('Fallback ticket close failed:', error);
    try {
      await interaction.editReply({
        embeds: [errorEmbed('Erreur', 'TF v4 — Impossible de fermer le ticket.')],
      });
    } catch (_) { /* fallback already answered */ }
  }
}

async function fallbackTicketSelect(interaction, client) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => {});
  try {
    if (!interaction.inGuild()) return;

    const eligibility = await fallbackEligibility(interaction, client);
    if (!eligibility.ok) {
      if (eligibility.message) {
        await interaction.editReply({
          embeds: [errorEmbed(eligibility.title || 'Erreur', eligibility.message)],
        }).catch(() => {});
      }
      return;
    }

    const typeId = interaction.values?.[0] || 'support';
    const { config } = eligibility;
    const type = getTicketTypeForGuild(config, typeId);

    if (!type) {
      return await interaction.editReply({
        embeds: [errorEmbed('Type inconnu', `Le type de ticket \`${typeId}\` n'existe plus dans la configuration du serveur.`)],
      }).catch(() => {});
    }

    const result = await createTicketFallback(interaction.guild, interaction.member, {
      type: type.id,
    });

    if (result.success) {
      return await interaction.editReply({
        content: `<@${interaction.user.id}>, votre ticket a été créé : <#${result.channel.id}>`,
      }).catch(() => {});
    }

    return await interaction.editReply({
      embeds: [errorEmbed('Erreur', 'TF v4 — ' + (result.error || 'Impossible de créer le ticket.') + (result.debug ? `\n\n\`${result.debug}\`` : ''))],
    }).catch(() => {});
  } catch (error) {
    logger.error('Fallback ticket select failed:', error);
    await interaction.editReply({
      embeds: [errorEmbed('Erreur', 'TF v4 — Impossible de créer le ticket.')],
    }).catch(() => {});
  }
}

export default {
  name: Events.InteractionCreate,
  async execute(interaction, client) {
    const interactionTraceContext = createInteractionTraceContext(interaction);
    interaction.traceContext = interactionTraceContext;
    interaction.traceId = interactionTraceContext.traceId;

    return runWithTraceContext(interactionTraceContext, async () => {
      try {
        InteractionHelper.patchInteractionResponses(interaction);

        if (interaction.isChatInputCommand()) {
          await interaction.deferReply().catch(() => {});
          try {
            logger.info(`Command executed: /${interaction.commandName} by ${interaction.user.tag}`, {
              event: 'interaction.command.received',
              traceId: interactionTraceContext.traceId,
              guildId: interaction.guildId,
              userId: interaction.user?.id,
              command: interaction.commandName
            });

            validateChatInputPayloadOrThrow(interaction, withTraceContext({
              type: 'command_input_validation',
              commandName: interaction.commandName
            }, interactionTraceContext));

            const command = client.commands.get(interaction.commandName);

            if (!command) {
              throw createError(
                `No command matching ${interaction.commandName} was found.`,
                ErrorTypes.CONFIGURATION,
                'Désolé, cette commande n\'existe pas.',
                withTraceContext({ commandName: interaction.commandName }, interactionTraceContext)
              );
            }

            const abuseProtection = await enforceAbuseProtection(interaction, command, interaction.commandName);
            if (!abuseProtection.allowed) {
              const formattedCooldown = formatCooldownDuration(abuseProtection.remainingMs);
              throw createError(
                `Risky command cooldown active for ${interaction.commandName}`,
                ErrorTypes.RATE_LIMIT,
                `This command is on cooldown. Please wait ${formattedCooldown} before trying again.`,
                withTraceContext({
                  commandName: interaction.commandName,
                  subtype: 'command_cooldown',
                  expected: true,
                  cooldownMs: abuseProtection.remainingMs,
                  cooldownWindowMs: abuseProtection.policy?.windowMs,
                  cooldownMaxAttempts: abuseProtection.policy?.maxAttempts
                }, interactionTraceContext)
              );
            }

            let guildConfig = null;
            if (interaction.guild) {
              guildConfig = await getGuildConfig(client, interaction.guild.id, interactionTraceContext);
              if (guildConfig?.disabledCommands?.[interaction.commandName]) {
                throw createError(
                  `Command ${interaction.commandName} is disabled in this guild`,
                  ErrorTypes.CONFIGURATION,
                  'This command has been disabled for this server.',
                  withTraceContext({ commandName: interaction.commandName, guildId: interaction.guild.id }, interactionTraceContext)
                );
              }
            }

            await command.execute(interaction, guildConfig, client);
          } catch (error) {
            await handleInteractionError(interaction, error, withTraceContext({
              type: 'command',
              commandName: interaction.commandName
            }, interactionTraceContext));
          }
        } else if (interaction.isAutocomplete()) {
          // Handle autocomplete interactions
          const focusedOption = interaction.options.getFocused(true);
          
          if (interaction.commandName === 'apply' && focusedOption.name === 'application') {
            try {
              const { getApplicationRoles } = await import('../utils/database.js');
              const roles = await getApplicationRoles(client, interaction.guildId);
              const roleName = interaction.options.getString('application', false);
              
              // Filter: only show enabled applications
              const filtered = roles.filter(role =>
                role.enabled !== false && 
                role.name.toLowerCase().startsWith(roleName?.toLowerCase() || '')
              );
              
              await interaction.respond(
                filtered.slice(0, 25).map(role => ({
                  name: `${role.name}${role.enabled === false ? ' (disabled)' : ''}`,
                  value: role.name
                }))
              );
            } catch (error) {
              logger.error('Error handling autocomplete:', {
                error: error.message,
                guildId: interaction.guildId,
                commandName: interaction.commandName
              });
              await interaction.respond([]);
            }
          } else if (interaction.commandName === 'app-admin' && focusedOption.name === 'application') {
            try {
              const { getApplicationRoles } = await import('../utils/database.js');
              const roles = await getApplicationRoles(client, interaction.guildId);
              const appName = interaction.options.getString('application', false);
              
              // Show all applications (enabled and disabled), but mark disabled ones
              const filtered = roles.filter(role =>
                role.name.toLowerCase().startsWith(appName?.toLowerCase() || '')
              );
              
              await interaction.respond(
                filtered.slice(0, 25).map(role => ({
                  name: `${role.name}${role.enabled === false ? ' (disabled)' : ''}`,
                  value: role.name
                }))
              );
            } catch (error) {
              logger.error('Error handling app-admin autocomplete:', {
                error: error.message,
                guildId: interaction.guildId,
                commandName: interaction.commandName
              });
              await interaction.respond([]);
            }
          } else if (interaction.commandName === 'reactroles' && focusedOption.name === 'panel') {
            try {
              const { getAllReactionRoleMessages, deleteReactionRoleMessage } = await import('../services/reactionRoleService.js');
              const guildId = interaction.guildId;
              const guild = interaction.guild;
              
              let panels = await getAllReactionRoleMessages(client, guildId);
              
              if (!panels || panels.length === 0) {
                await interaction.respond([]);
                return;
              }
              
              // Filter out panels whose messages no longer exist
              const validPanels = [];
              for (const panel of panels) {
                if (!panel.messageId || !panel.channelId) {
                  continue;
                }
                
                const channel = guild.channels.cache.get(panel.channelId);
                if (!channel) {
                  await deleteReactionRoleMessage(client, guildId, panel.messageId).catch(() => {});
                  continue;
                }
                
                const msg = await channel.messages.fetch(panel.messageId).catch(() => null);
                if (!msg) {
                  await deleteReactionRoleMessage(client, guildId, panel.messageId).catch(() => {});
                  continue;
                }
                validPanels.push(panel);
              }
              
              if (validPanels.length === 0) {
                await interaction.respond([]);
                return;
              }
              
              const choices = await Promise.all(
                validPanels.slice(0, 25).map(async panel => {
                  try {
                    const channel = guild.channels.cache.get(panel.channelId);
                    if (!channel) return null;
                    
                    const msg = await channel.messages.fetch(panel.messageId).catch(() => null);
                    if (!msg) return null;
                    
                    const title = msg?.embeds?.[0]?.title ?? 'Untitled Panel';
                    const channelName = channel?.name ?? 'unknown';
                    
                    return {
                      name: `${title} (${channelName})`.substring(0, 100),
                      value: panel.messageId
                    };
                  } catch (e) {
                    return null;
                  }
                })
              );
              
              const validChoices = choices.filter(c => c !== null);
              await interaction.respond(validChoices);
            } catch (error) {
              logger.error('Error handling reactroles autocomplete:', {
                error: error.message,
                guildId: interaction.guildId,
                commandName: interaction.commandName
              });
              await interaction.respond([]);
            }
          }
        } else if (interaction.isButton()) {
          // Handle embed builder buttons
          if (interaction.customId.startsWith('embed_')) {
            try {
              await handleEmbedBuilderButtons(interaction, client);
            } catch (error) {
              await handleInteractionError(interaction, error, withTraceContext({
                type: 'button',
                customId: interaction.customId,
                handler: 'embed_builder'
              }, interactionTraceContext));
            }
            return;
          }

          const [customId, ...args] = interaction.customId.split(':');
          const button = client.buttons.get(customId);

          if (!button) {
            logger.warn('Unhandled button interaction (no registered handler or bot still starting):', {
              event: 'interaction.button.unhandled',
              customId: interaction.customId,
              traceId: interactionTraceContext.traceId,
              guildId: interaction.guildId,
              userId: interaction.user?.id
            });

            if (interaction.customId === 'ticket_close') {
              try {
                await fallbackTicketClose(interaction, client);
              } catch (_) {
                logger.warn('Fallback ticket close reply failed:', {
                  event: 'interaction.button.close_fallback_failed',
                  traceId: interactionTraceContext.traceId
                });
              }
            } else if (interaction.customId === 'ticket_delete') {
              try {
                await deleteTicketFallback(interaction);
              } catch (_) {
                logger.warn('Fallback ticket delete reply failed:', {
                  event: 'interaction.button.delete_fallback_failed',
                  traceId: interactionTraceContext.traceId
                });
              }
            } else if (interaction.customId === 'ticket_reopen') {
              try {
                await reopenTicketFallback(interaction);
              } catch (_) {
                logger.warn('Fallback ticket reopen reply failed:', {
                  event: 'interaction.button.reopen_fallback_failed',
                  traceId: interactionTraceContext.traceId
                });
              }
            } else if (interaction.customId.startsWith('create_ticket')) {
              try {
                await fallbackTicketButton(interaction, client);
              } catch (_) {
                logger.warn('Fallback ticket button reply failed:', {
                  event: 'interaction.button.unavailable_reply_failed',
                  traceId: interactionTraceContext.traceId
                });
              }
            }
            return;
          }

          try {
            await button.execute(interaction, client, args);
          } catch (error) {
            await handleInteractionError(interaction, error, withTraceContext({
              type: 'button',
              customId: interaction.customId,
              handler: 'general'
            }, interactionTraceContext));
          }
        } else if (interaction.isStringSelectMenu()) {
          const [customId, ...args] = interaction.customId.split(':');
          const selectMenu = client.selectMenus.get(customId);

          if (!selectMenu) {
            // No registered handler (e.g. inline-collected select menus like
            // ticket_config_<guildId>, or interactions received while the bot
            // is still starting). Log and use fallback for ticket type select.
            logger.warn('Unhandled select menu interaction (no registered handler or bot still starting):', {
              event: 'interaction.selectmenu.unhandled',
              customId: interaction.customId,
              traceId: interactionTraceContext.traceId,
              guildId: interaction.guildId,
              userId: interaction.user?.id
            });

            if (interaction.customId === 'ticket_type_select') {
              try {
                await fallbackTicketSelect(interaction, client);
              } catch (_) {
                logger.warn('Fallback ticket select reply failed:', {
                  event: 'interaction.selectmenu.fallback_failed',
                  traceId: interactionTraceContext.traceId
                });
              }
            }
            return;
          }

          try {
            await selectMenu.execute(interaction, client, args);
          } catch (error) {
            await handleInteractionError(interaction, error, withTraceContext({
              type: 'select_menu',
              customId: interaction.customId
            }, interactionTraceContext));
          }
        } else if (interaction.isModalSubmit()) {
          // Handle embed builder modals
          if (interaction.customId.startsWith('embed_') && interaction.customId.endsWith('_modal')) {
            try {
              await handleEmbedBuilderModals(interaction, client);
            } catch (error) {
              await handleInteractionError(interaction, error, withTraceContext({
                type: 'modal',
                customId: interaction.customId,
                handler: 'embed_builder'
              }, interactionTraceContext));
            }
            return;
          }

          if (interaction.customId.startsWith('app_modal_')) {
            try {
              await handleApplicationModal(interaction);
            } catch (error) {
              await handleInteractionError(interaction, error, withTraceContext({
                type: 'modal',
                customId: interaction.customId,
                handler: 'application'
              }, interactionTraceContext));
            }
            return;
          }

          if (interaction.customId.startsWith('app_review_')) {
            try {
              await handleApplicationReviewModal(interaction);
            } catch (error) {
              await handleInteractionError(interaction, error, withTraceContext({
                type: 'modal',
                customId: interaction.customId,
                handler: 'application_review'
              }, interactionTraceContext));
            }
            return;
          }

          if (interaction.customId.startsWith('jtc_')) {
            logger.debug(`Skipping modal handler lookup for inline-awaited modal: ${interaction.customId}`, {
              event: 'interaction.modal.inline_skipped',
              traceId: interactionTraceContext.traceId
            });
            return;
          }

          const [customId, ...args] = interaction.customId.split(':');
          const modal = client.modals.get(customId);

          if (!modal) {
            // No registered handler (e.g. inline-awaited modals via
            // awaitModalSubmit, or interactions received while the bot is
            // still starting). Log and use fallback for ticket creation modal.
            logger.warn('Unhandled modal interaction (no registered handler or bot still starting):', {
              event: 'interaction.modal.unhandled',
              customId: interaction.customId,
              traceId: interactionTraceContext.traceId,
              guildId: interaction.guildId,
              userId: interaction.user?.id
            });

            if (interaction.customId.startsWith('create_ticket_modal')) {
              try {
                await fallbackTicketModal(interaction, client);
              } catch (_) {
                logger.warn('Fallback ticket modal reply failed:', {
                  event: 'interaction.modal.fallback_failed',
                  traceId: interactionTraceContext.traceId
                });
              }
            }
            return;
          }

          try {
            await modal.execute(interaction, client, args);
          } catch (error) {
            await handleInteractionError(interaction, error, withTraceContext({
              type: 'modal',
              customId: interaction.customId,
              handler: 'general'
            }, interactionTraceContext));
          }
        }
      } catch (error) {
        logger.error('Unhandled error in interactionCreate:', {
          event: 'interaction.unhandled_error',
          errorCode: 'INTERACTION_UNHANDLED_ERROR',
          error,
          traceId: interactionTraceContext.traceId,
          interactionId: interaction.id,
          guildId: interaction.guildId,
          userId: interaction.user?.id,
          customId: interaction.customId,
          interactionType: interaction.type
        });

        try {
          await handleInteractionError(interaction, error, withTraceContext({
            type: 'unhandled',
            event: 'interaction.unhandled_error'
          }, interactionTraceContext));
        } catch (replyError) {
          logger.error('Failed to send fallback error response:', {
            event: 'interaction.error_response_failed',
            errorCode: 'INTERACTION_ERROR_RESPONSE_FAILED',
            error: replyError,
            traceId: interactionTraceContext.traceId
          });

          try {
            const genericEmbed = {
              embeds: [{
                title: '❓ Erreur inattendue',
                description: 'Une erreur inattendue est survenue. Merci de réessayer dans un instant.',
                color: 0xE74C3C,
                timestamp: new Date().toISOString()
              }],
              flags: MessageFlags.Ephemeral
            };

            if (interaction.deferred) {
              await interaction.editReply({ embeds: genericEmbed.embeds });
            } else if (interaction.replied) {
              await interaction.followUp(genericEmbed);
            } else {
              await interaction.reply(genericEmbed);
            }
          } catch (finalError) {
            logger.error('Final fallback reply failed:', {
              event: 'interaction.error_response_double_failed',
              errorCode: 'INTERACTION_ERROR_RESPONSE_DOUBLE_FAILED',
              error: finalError,
              traceId: interactionTraceContext.traceId
            });
          }
        }
      }
    });
  }
};
