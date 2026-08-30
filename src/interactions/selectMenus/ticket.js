import {
  ActionRowBuilder,
  MessageFlags,
} from 'discord.js';
import { createTicket, getTicketTypeForGuild } from '../../services/ticket.js';
import { getGuildConfig } from '../../services/guildConfig.js';
import { logger } from '../../utils/logger.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';

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
        return await InteractionHelper.sendErrorNotice(interaction, `Le type de ticket \`${typeId}\` n'existe plus dans la configuration du serveur.`);
      }

      const result = await createTicket(interaction.guild, interaction.member, {
        type: type.id,
      });

      if (result.success) {
        return await interaction.editReply({
          content: `<@${interaction.user.id}>, votre ticket a été créé : <#${result.channel.id}>`,
        }).catch(() => {});
      }

      return await InteractionHelper.sendErrorNotice(interaction, 'TF v4 — ' + (result.error || 'Impossible de créer le ticket.') + (result.debug ? `\n\n\`${result.debug}\`` : ''));
    } catch (error) {
      logger.error('Error creating ticket from type select:', error);
      await InteractionHelper.sendErrorNotice(interaction, 'TF v4 — Impossible de créer le ticket.');
    }
  },
};

export default ticketTypeSelectHandler;