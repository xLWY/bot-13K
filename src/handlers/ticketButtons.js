import {
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  MessageFlags,
} from 'discord.js';
import { createEmbed, errorEmbed, successEmbed } from '../utils/embeds.js';
import { createTicket, closeTicket, claimTicket, getTicketTypeForGuild, resolveTicketTypes } from '../services/ticket.js';
import { getGuildConfig } from '../services/guildConfig.js';
import { logTicketEvent } from '../utils/ticketLogging.js';
import { logger } from '../utils/logger.js';
import { InteractionHelper } from '../utils/interactionHelper.js';
import { checkRateLimit } from '../utils/rateLimiter.js';
import { getTicketPermissionContext } from '../utils/ticketPermissions.js';

async function ensureGuildContext(interaction) {
  if (interaction.inGuild()) {
    return true;
  }

  if (!interaction.replied && !interaction.deferred) {
    await interaction.reply({
      embeds: [errorEmbed('Serveur uniquement', 'Cette action ne peut être utilisée que dans un serveur.')],
      flags: MessageFlags.Ephemeral,
    });
  }

  return false;
}

async function checkTicketPermissionWithTimeout(interaction, client, actionLabel, options = {}, timeoutMs = 2500) {
  const { allowTicketCreator = false } = options;

  try {
    const contextPromise = getTicketPermissionContext({ client, interaction });
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Timeout')), timeoutMs)
    );

    const context = await Promise.race([contextPromise, timeoutPromise]);

    if (!context.ticketData) {
      return { success: false, error: "Pas un salon de ticket", details: 'Cette action ne peut être utilisée que dans un salon de ticket valide.' };
    }

    const allowed = allowTicketCreator ? context.canCloseTicket : context.canManageTicket;
    if (!allowed) {
      const permissionMessage = allowTicketCreator
        ? 'Vous devez avoir la permission **Gérer les salons**, le **rôle Staff Tickets** configuré, ou être le **créateur du ticket**.'
        : 'Vous devez avoir la permission **Gérer les salons** ou le **rôle Staff Tickets** configuré.';
      return { success: false, error: 'Permission refusée', details: `${permissionMessage}\n\nVous ne pouvez pas ${actionLabel}.` };
    }

    return { success: true, context };
  } catch (error) {
    if (error.message === 'Timeout') {
      return { success: false, error: 'Délai dépassé', details: 'La vérification des permissions a pris trop de temps. Veuillez réessayer.' };
    }
    return { success: false, error: 'Erreur', details: `Échec de la vérification des permissions : ${error.message}` };
  }
}

export const createTicketHandler = {
  name: 'create_ticket',
  async execute(interaction, client) {
    try {
      if (!(await ensureGuildContext(interaction))) return;

      const rateLimitKey = `${interaction.user.id}:create_ticket`;
      const allowed = await checkRateLimit(rateLimitKey, 3, 60000);
      if (!allowed) {
        return await interaction.reply({
          embeds: [errorEmbed('Trop de tickets', 'Vous créez des tickets trop rapidement. Veuillez attendre une minute avant de réessayer.')],
          flags: MessageFlags.Ephemeral,
        });
      }

      const config = await getGuildConfig(client, interaction.guildId);
      const maxTicketsPerUser = config.maxTicketsPerUser || 3;

      const { getUserTicketCount } = await import('../services/ticket.js');
      const currentTicketCount = await getUserTicketCount(interaction.guildId, interaction.user.id);

      if (currentTicketCount >= maxTicketsPerUser) {
        return await interaction.reply({
          embeds: [
            errorEmbed(
              '🎫 Limite de tickets atteinte',
              `Vous avez atteint le nombre maximum de tickets ouverts (${maxTicketsPerUser}).\n\nVeuillez fermer vos tickets existants avant d'en créer un nouveau.\n\n**Tickets actuels :** ${currentTicketCount}/${maxTicketsPerUser}`,
            ),
          ],
          flags: MessageFlags.Ephemeral,
        });
      }

      const typeEmbed = createEmbed({
        title: '🎫 Nouveau ticket',
        description: 'Choisissez le type de ticket que vous souhaitez ouvrir.',
        color: 'info',
      });

      const typeSelect = new StringSelectMenuBuilder()
        .setCustomId('ticket_type_select')
        .setPlaceholder('Sélectionnez un type de ticket…')
        .addOptions(
          resolveTicketTypes(config).map((type) =>
            new StringSelectMenuOptionBuilder()
              .setLabel(type.label)
              .setDescription(type.description)
              .setValue(type.id)
              .setEmoji(type.emoji),
          ),
        );

      return await interaction.reply({
        embeds: [typeEmbed],
        components: [new ActionRowBuilder().addComponents(typeSelect)],
        flags: MessageFlags.Ephemeral,
      });
    } catch (error) {
      logger.error('Error opening ticket type menu:', error);
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({
          embeds: [errorEmbed('Erreur', 'Impossible d\'ouvrir le formulaire de création de ticket.')],
          flags: MessageFlags.Ephemeral,
        });
      }
    }
  }
};

export const createTicketDirectHandler = {
  name: 'create_ticket_direct',
  async execute(interaction, client) {
    try {
      if (!(await ensureGuildContext(interaction))) return;

      const rateLimitKey = `${interaction.user.id}:create_ticket`;
      const allowed = await checkRateLimit(rateLimitKey, 3, 60000);
      if (!allowed) {
        return await interaction.reply({
          embeds: [errorEmbed('Trop de tickets', 'Vous créez des tickets trop rapidement. Veuillez attendre une minute avant de réessayer.')],
          flags: MessageFlags.Ephemeral,
        });
      }

      const config = await getGuildConfig(client, interaction.guildId);
      const maxTicketsPerUser = config.maxTicketsPerUser || 3;

      const { getUserTicketCount } = await import('../services/ticket.js');
      const currentTicketCount = await getUserTicketCount(interaction.guildId, interaction.user.id);

      if (currentTicketCount >= maxTicketsPerUser) {
        return await interaction.reply({
          embeds: [
            errorEmbed(
              '🎫 Limite de tickets atteinte',
              `Vous avez atteint le nombre maximum de tickets ouverts (${maxTicketsPerUser}).\n\nVeuillez fermer vos tickets existants avant d'en créer un nouveau.\n\n**Tickets actuels :** ${currentTicketCount}/${maxTicketsPerUser}`,
            ),
          ],
          flags: MessageFlags.Ephemeral,
        });
      }

      const typeId = interaction.customId.split(':')[1] || 'support';
      const type = getTicketTypeForGuild(config, typeId);

      const modal = new ModalBuilder()
        .setCustomId(`create_ticket_modal:${typeId}`)
        .setTitle(`${type.emoji} ${type.label}`);

      const reasonInput = new TextInputBuilder()
        .setCustomId('reason')
        .setLabel('Votre demande')
        .setStyle(TextInputStyle.Paragraph)
        .setPlaceholder(`Décrivez votre demande : ${type.description.toLowerCase()}…`)
        .setRequired(true)
        .setMaxLength(1000);

      modal.addComponents(new ActionRowBuilder().addComponents(reasonInput));

      return await interaction.showModal(modal);
    } catch (error) {
      logger.error('Error opening ticket type modal:', error);
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({
          embeds: [errorEmbed('Erreur', 'Impossible d\'ouvrir le formulaire de création de ticket.')],
          flags: MessageFlags.Ephemeral,
        });
      }
    }
  }
};

export const createTicketModalHandler = {
  name: 'create_ticket_modal',
  async execute(interaction, client) {
    try {
      if (!(await ensureGuildContext(interaction))) return;

      const deferSuccess = await InteractionHelper.safeDefer(interaction, { flags: MessageFlags.Ephemeral });
      if (!deferSuccess) return;

      const reason = interaction.fields?.getTextInputValue('reason');
      const typeId = interaction.customId.split(':')[1] || 'support';

      const result = await createTicket(interaction.guild, interaction.member, {
        type: typeId,
        reason,
      });

      if (result.success) {
        await interaction.editReply({
          embeds: [successEmbed(`Votre ticket a été créé dans ${result.channel} !`, '✅ Ticket Créé')],
        });
      } else {
        await interaction.editReply({
          embeds: [errorEmbed('Erreur', result.error || 'Impossible de créer le ticket.' + (result.debug ? `\n\n\`${result.debug}\`` : ''))],
          flags: MessageFlags.Ephemeral,
        });
      }
    } catch (error) {
      logger.error('Error creating ticket:', error);
      if (interaction.deferred) {
        await interaction.editReply({
          embeds: [errorEmbed('Erreur', 'Une erreur est survenue lors de la création de votre ticket.')],
          flags: MessageFlags.Ephemeral,
        });
      } else if (!interaction.replied) {
        await interaction.reply({
          embeds: [errorEmbed('Erreur', 'Une erreur est survenue lors de la création de votre ticket.')],
          flags: MessageFlags.Ephemeral,
        });
      }
    }
  }
};

export const closeTicketHandler = {
  name: 'ticket_close',
  async execute(interaction, client) {
    try {
      if (!(await ensureGuildContext(interaction))) return;

      const permissionCheck = await checkTicketPermissionWithTimeout(
        interaction,
        client,
        'fermer ce ticket',
        { allowTicketCreator: true },
        2000,
      );

      if (!permissionCheck.success) {
        if (!interaction.replied && !interaction.deferred) {
          await interaction.reply({
            embeds: [errorEmbed(permissionCheck.error, permissionCheck.details)],
            flags: MessageFlags.Ephemeral,
          });
        }
        return;
      }

      const modal = new ModalBuilder()
        .setCustomId('ticket_close_modal')
        .setTitle('Fermer le ticket');

      const reasonInput = new TextInputBuilder()
        .setCustomId('reason')
        .setLabel('Motif de fermeture (facultatif)')
        .setStyle(TextInputStyle.Paragraph)
        .setPlaceholder('Ajoutez un motif éventuel de fermeture…')
        .setRequired(false)
        .setMaxLength(1000);

      const actionRow = new ActionRowBuilder().addComponents(reasonInput);
      modal.addComponents(actionRow);

      await interaction.showModal(modal);
    } catch (error) {
      logger.error('Error closing ticket:', error);

      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({
          embeds: [errorEmbed('Erreur', 'Impossible d\'ouvrir le formulaire de fermeture.')],
          flags: MessageFlags.Ephemeral,
        });
      }
    }
  }
};

export const closeTicketModalHandler = {
  name: 'ticket_close_modal',
  async execute(interaction, client) {
    try {
      if (!(await ensureGuildContext(interaction))) return;

      const permissionCheck = await checkTicketPermissionWithTimeout(
        interaction,
        client,
        'fermer ce ticket',
        { allowTicketCreator: true },
        2000,
      );

      if (!permissionCheck.success) {
        if (!interaction.replied && !interaction.deferred) {
          await interaction.reply({
            embeds: [errorEmbed(permissionCheck.error, permissionCheck.details)],
            flags: MessageFlags.Ephemeral,
          });
        }
        return;
      }

      const deferSuccess = await InteractionHelper.safeDefer(interaction, { flags: MessageFlags.Ephemeral });
      if (!deferSuccess) return;

      const providedReason = interaction.fields?.getTextInputValue('reason')?.trim();
      const reason = providedReason || 'Fermé via le bouton du ticket sans motif précisé.';

      const result = await closeTicket(interaction.channel, interaction.user, reason);

      if (result.success) {
        await interaction.editReply({
          embeds: [successEmbed('Ce ticket a été fermé.', '🔒 Ticket Fermé')],
          flags: MessageFlags.Ephemeral,
        });
      } else {
        await interaction.editReply({
          embeds: [errorEmbed('Erreur', result.error || 'Impossible de fermer le ticket.')],
          flags: MessageFlags.Ephemeral,
        });
      }
    } catch (error) {
      logger.error('Error submitting close ticket modal:', error);
      if (interaction.deferred) {
        await interaction.editReply({
          embeds: [errorEmbed('Erreur', 'Une erreur est survenue lors de la fermeture du ticket.')],
          flags: MessageFlags.Ephemeral,
        });
      } else if (!interaction.replied) {
        await interaction.reply({
          embeds: [errorEmbed('Erreur', 'Une erreur est survenue lors de la fermeture du ticket.')],
          flags: MessageFlags.Ephemeral,
        });
      }
    }
  }
};

export const claimTicketHandler = {
  name: 'ticket_claim',
  async execute(interaction, client) {
    try {
      if (!(await ensureGuildContext(interaction))) return;

      const permissionCheck = await checkTicketPermissionWithTimeout(
        interaction,
        client,
        'réclamer les tickets',
        {},
        2000,
      );

      if (!permissionCheck.success) {
        if (!interaction.replied && !interaction.deferred) {
          await interaction.reply({
            embeds: [errorEmbed(permissionCheck.error, permissionCheck.details)],
            flags: MessageFlags.Ephemeral,
          });
        }
        return;
      }

      const deferSuccess = await InteractionHelper.safeDefer(interaction, { flags: MessageFlags.Ephemeral });
      if (!deferSuccess) return;

      const result = await claimTicket(interaction.channel, interaction.user);

      if (result.success) {
        await interaction.editReply({
          embeds: [successEmbed('Vous avez réclamé ce ticket.', '🙋 Ticket Réclamé')],
          flags: MessageFlags.Ephemeral,
        });
      } else {
        await interaction.editReply({
          embeds: [errorEmbed('Erreur', result.error || 'Impossible de réclamer le ticket.')],
          flags: MessageFlags.Ephemeral,
        });
      }
    } catch (error) {
      logger.error('Error claiming ticket:', error);
      if (interaction.deferred) {
        await interaction.editReply({
          embeds: [errorEmbed('Erreur', 'Une erreur est survenue lors de la réclamation du ticket.')],
          flags: MessageFlags.Ephemeral,
        });
      } else if (!interaction.replied) {
        await interaction.reply({
          embeds: [errorEmbed('Erreur', 'Une erreur est survenue lors de la réclamation du ticket.')],
          flags: MessageFlags.Ephemeral,
        });
      }
    }
  }
};

export const pinTicketHandler = {
  name: 'ticket_pin',
  async execute(interaction, client) {
    try {
      if (!(await ensureGuildContext(interaction))) return;

      const permissionCheck = await checkTicketPermissionWithTimeout(
        interaction,
        client,
        'épingler les tickets',
        {},
        2000,
      );

      if (!permissionCheck.success) {
        if (!interaction.replied && !interaction.deferred) {
          await interaction.reply({
            embeds: [errorEmbed(permissionCheck.error, permissionCheck.details)],
            flags: MessageFlags.Ephemeral,
          });
        }
        return;
      }

      const deferSuccess = await InteractionHelper.safeDefer(interaction, { flags: MessageFlags.Ephemeral });
      if (!deferSuccess) return;

      const channel = interaction.channel;
      const category = channel.parent;

      if (!category) {
        await interaction.editReply({
          embeds: [errorEmbed('Erreur', 'Ce ticket n\'est dans aucune catégorie.')],
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      const hasPinEmoji = channel.name.startsWith('📌');

      if (hasPinEmoji) {
        const newName = channel.name.replace(/^📌\s*/, '');
        await channel.edit({
          name: newName,
          position: 999,
        });

        await interaction.editReply({
          embeds: [createEmbed({
            title: '📌 Ticket Désépinglé',
            description: 'Ce ticket a été désépinglé et replacé en position normale.',
            color: 0x95A5A6,
          })],
          flags: MessageFlags.Ephemeral,
        });

        logger.info('Ticket unpinned', {
          guildId: interaction.guildId,
          channelId: channel.id,
          channelName: newName,
          userId: interaction.user.id,
        });
      } else {
        const newName = `📌 ${channel.name}`;
        await channel.edit({
          name: newName,
          position: 0,
        });

        await interaction.editReply({
          embeds: [createEmbed({
            title: '📌 Ticket Épinglé',
            description: 'Ce ticket a été épinglé en haut de la catégorie.',
            color: 0x3498db,
          })],
          flags: MessageFlags.Ephemeral,
        });

        logger.info('Ticket pinned', {
          guildId: interaction.guildId,
          channelId: channel.id,
          channelName: newName,
          userId: interaction.user.id,
        });
      }

      await logTicketEvent({
        client: interaction.client,
        guildId: interaction.guildId,
        event: {
          type: hasPinEmoji ? 'unpin' : 'pin',
          ticketId: channel.id,
          ticketNumber: channel.name.replace(/[^0-9]/g, ''),
          userId: interaction.user.id,
          executorId: interaction.user.id,
          metadata: {
            isPinned: !hasPinEmoji,
            newChannelName: hasPinEmoji ? channel.name.replace(/^📌\s*/, '') : `📌 ${channel.name}`,
          },
        },
      });
    } catch (error) {
      logger.error('Error pinning/unpinning ticket:', error);
      if (interaction.deferred) {
        await interaction.editReply({
          embeds: [errorEmbed('Erreur', 'Impossible d\'épingler/désépingler le ticket.')],
          flags: MessageFlags.Ephemeral,
        });
      } else if (!interaction.replied) {
        await interaction.reply({
          embeds: [errorEmbed('Erreur', 'Impossible d\'épingler/désépingler le ticket.')],
          flags: MessageFlags.Ephemeral,
        });
      }
    }
  }
};

export const unclaimTicketHandler = {
  name: 'ticket_unclaim',
  async execute(interaction, client) {
    try {
      if (!(await ensureGuildContext(interaction))) return;

      const permissionCheck = await checkTicketPermissionWithTimeout(
        interaction,
        client,
        'retirer la réclamation',
        {},
        2000,
      );

      if (!permissionCheck.success) {
        if (!interaction.replied && !interaction.deferred) {
          await interaction.reply({
            embeds: [errorEmbed(permissionCheck.error, permissionCheck.details)],
            flags: MessageFlags.Ephemeral,
          });
        }
        return;
      }

      const deferSuccess = await InteractionHelper.safeDefer(interaction, { flags: MessageFlags.Ephemeral });
      if (!deferSuccess) return;

      const { unclaimTicket } = await import('../services/ticket.js');
      const result = await unclaimTicket(interaction.channel, interaction.member);

      if (result.success) {
        await interaction.editReply({
          embeds: [successEmbed('Vous ne réclamez plus ce ticket.', '🔓 Réclamation Retirée')],
          flags: MessageFlags.Ephemeral,
        });
      } else {
        await interaction.editReply({
          embeds: [errorEmbed('Erreur', result.error || 'Impossible de retirer la réclamation.')],
          flags: MessageFlags.Ephemeral,
        });
      }
    } catch (error) {
      logger.error('Error unclaiming ticket:', error);
      if (interaction.deferred) {
        await interaction.editReply({
          embeds: [errorEmbed('Erreur', 'Une erreur est survenue.')],
          flags: MessageFlags.Ephemeral,
        });
      } else if (!interaction.replied) {
        await interaction.reply({
          embeds: [errorEmbed('Erreur', 'Une erreur est survenue.')],
          flags: MessageFlags.Ephemeral,
        });
      }
    }
  }
};

export const reopenTicketHandler = {
  name: 'ticket_reopen',
  async execute(interaction, client) {
    try {
      if (!(await ensureGuildContext(interaction))) return;

      const permissionCheck = await checkTicketPermissionWithTimeout(
        interaction,
        client,
        'rouvrir ce ticket',
        {},
        2000,
      );

      if (!permissionCheck.success) {
        if (!interaction.replied && !interaction.deferred) {
          await interaction.reply({
            embeds: [errorEmbed(permissionCheck.error, permissionCheck.details)],
            flags: MessageFlags.Ephemeral,
          });
        }
        return;
      }

      const deferSuccess = await InteractionHelper.safeDefer(interaction, { flags: MessageFlags.Ephemeral });
      if (!deferSuccess) return;

      const { reopenTicket } = await import('../services/ticket.js');
      const result = await reopenTicket(interaction.channel, interaction.member);

      if (result.success) {
        let reopenMessage = 'Le ticket a été rouvert avec succès !';
        if (result.openCategoryMoveFailed) {
          reopenMessage += '\n\n⚠️ Le ticket a été rouvert, mais il n\'a pas pu être déplacé vers la catégorie configurée des tickets ouverts.';
        }

        await interaction.editReply({
          embeds: [successEmbed(reopenMessage, '🔓 Ticket Rouvert')],
          flags: MessageFlags.Ephemeral,
        });
      } else {
        await interaction.editReply({
          embeds: [errorEmbed('Erreur', result.error || 'Impossible de rouvrir le ticket.')],
          flags: MessageFlags.Ephemeral,
        });
      }
    } catch (error) {
      logger.error('Error reopening ticket:', error);
      if (interaction.deferred) {
        await interaction.editReply({
          embeds: [errorEmbed('Erreur', 'Une erreur est survenue lors de la réouverture du ticket.')],
          flags: MessageFlags.Ephemeral,
        });
      } else if (!interaction.replied) {
        await interaction.reply({
          embeds: [errorEmbed('Erreur', 'Une erreur est survenue lors de la réouverture du ticket.')],
          flags: MessageFlags.Ephemeral,
        });
      }
    }
  }
};

export const deleteTicketHandler = {
  name: 'ticket_delete',
  async execute(interaction, client) {
    try {
      if (!(await ensureGuildContext(interaction))) return;

      const permissionCheck = await checkTicketPermissionWithTimeout(
        interaction,
        client,
        'supprimer les tickets',
        {},
        2000,
      );

      if (!permissionCheck.success) {
        if (!interaction.replied && !interaction.deferred) {
          await interaction.reply({
            embeds: [errorEmbed(permissionCheck.error, permissionCheck.details)],
            flags: MessageFlags.Ephemeral,
          });
        }
        return;
      }

      const deferSuccess = await InteractionHelper.safeDefer(interaction, { flags: MessageFlags.Ephemeral });
      if (!deferSuccess) return;

      const { deleteTicket } = await import('../services/ticket.js');
      const result = await deleteTicket(interaction.channel, interaction.member);

      if (result.success) {
        await interaction.editReply({
          embeds: [successEmbed('Ce ticket sera définitivement supprimé dans 3 secondes.', '🗑️ Ticket Supprimé')],
          flags: MessageFlags.Ephemeral,
        });
      } else {
        await interaction.editReply({
          embeds: [errorEmbed('Erreur', result.error || 'Impossible de supprimer le ticket.')],
          flags: MessageFlags.Ephemeral,
        });
      }
    } catch (error) {
      logger.error('Error deleting ticket:', error);
      if (interaction.deferred) {
        await interaction.editReply({
          embeds: [errorEmbed('Erreur', 'Une erreur est survenue lors de la suppression du ticket.')],
          flags: MessageFlags.Ephemeral,
        });
      } else if (!interaction.replied) {
        await interaction.reply({
          embeds: [errorEmbed('Erreur', 'Une erreur est survenue lors de la suppression du ticket.')],
          flags: MessageFlags.Ephemeral,
        });
      }
    }
  }
};

export default createTicketHandler;
export {
  createTicketModalHandler,
  closeTicketModalHandler,
  closeTicketHandler,
  claimTicketHandler,
  pinTicketHandler,
  unclaimTicketHandler,
  reopenTicketHandler,
  deleteTicketHandler,
};