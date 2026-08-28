import {
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  MessageFlags,
} from 'discord.js';
import { getTicketType } from '../../services/ticket.js';
import { logger } from '../../utils/logger.js';

const ticketTypeSelectHandler = {
  name: 'ticket_type_select',

  async execute(interaction, client, args) {
    try {
      if (!interaction.inGuild()) return;

      const typeId = interaction.values?.[0] || 'support';
      const type = getTicketType(typeId);

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

      await interaction.showModal(modal);
    } catch (error) {
      logger.error('Error opening ticket type modal:', error);
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({
          content: 'Impossible d\'ouvrir le formulaire de création de ticket.',
          flags: MessageFlags.Ephemeral,
        }).catch(() => {});
      }
    }
  },
};

export default ticketTypeSelectHandler;