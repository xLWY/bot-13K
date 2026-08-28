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
    try {
      if (!interaction.inGuild()) return;

      const typeId = interaction.values?.[0] || 'support';
      const guildConfig = await getGuildConfig(client, interaction.guildId);
      const type = getTicketTypeForGuild(guildConfig, typeId);

      if (!type) {
        return await interaction.reply({
          embeds: [errorEmbed('Type inconnu', `Le type de ticket \`${typeId}\` n'existe plus dans la configuration du serveur.`)],
          flags: MessageFlags.Ephemeral,
        });
      }

      const result = await createTicket(interaction.guild, interaction.member, {
        type: type.id,
      });

      if (result.success) {
        return await interaction.reply({
          embeds: [successEmbed(`Votre ticket a été créé dans ${result.channel} !`, '✅ Ticket Créé')],
          flags: MessageFlags.Ephemeral,
        });
      }

      return await interaction.reply({
        embeds: [errorEmbed('Erreur', result.error || 'Impossible de créer le ticket.' + (result.debug ? `\n\n\`${result.debug}\`` : ''))],
        flags: MessageFlags.Ephemeral,
      });
    } catch (error) {
      logger.error('Error creating ticket from type select:', error);
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({
          embeds: [errorEmbed('Erreur', 'Impossible de créer le ticket.')],
          flags: MessageFlags.Ephemeral,
        }).catch(() => {});
      }
    }
  },
};

export default ticketTypeSelectHandler;