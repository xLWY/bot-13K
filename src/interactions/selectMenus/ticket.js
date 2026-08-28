import {
  ActionRowBuilder,
  MessageFlags,
} from 'discord.js';
import { createTicket, getTicketTypeForGuild } from '../../services/ticket.js';
import { getGuildConfig } from '../../services/guildConfig.js';
import { errorEmbed, successEmbed } from '../../utils/embeds.js';
import { logger } from '../../utils/logger.js';

const ticketTypeSelectHandler = {
  name: 'ticket_type_select',

  async execute(interaction, client, args) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => {});
    try {
      if (!interaction.inGuild()) return;

      const typeId = interaction.values?.[0] || 'support';
      const guildConfig = await getGuildConfig(client, interaction.guildId);
      const type = getTicketTypeForGuild(guildConfig, typeId);

      if (!type) {
        return await interaction.editReply({
          embeds: [errorEmbed('Type inconnu', `Le type de ticket \`${typeId}\` n'existe plus dans la configuration du serveur.`)],
        }).catch(() => {});
      }

      const result = await createTicket(interaction.guild, interaction.member, {
        type: type.id,
      });

      if (result.success) {
        return await interaction.editReply({
          embeds: [successEmbed(`Votre ticket a été créé dans ${result.channel} !`, '✅ Ticket Créé (TF v4)')],
        }).catch(() => {});
      }

      return await interaction.editReply({
        embeds: [errorEmbed('Erreur', 'TF v4 — ' + (result.error || 'Impossible de créer le ticket.' + (result.debug ? `\n\n\`${result.debug}\`` : '')))],
      }).catch(() => {});
    } catch (error) {
      logger.error('Error creating ticket from type select:', error);
      await interaction.editReply({
        embeds: [errorEmbed('Erreur', 'TF v4 — Impossible de créer le ticket.')],
      }).catch(() => {});
    }
  },
};

export default ticketTypeSelectHandler;