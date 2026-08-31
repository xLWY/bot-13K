import { createEmbed, successEmbed } from '../utils/embeds.js';
import { performDeletionByCounterId } from '../commands/ServerStats/modules/serverstats_delete.js';
import { logger } from '../utils/logger.js';
import { InteractionHelper } from '../utils/interactionHelper.js';

export const counterDeleteActionHandler = {
  name: 'counter-delete',
  async execute(interaction, client, args = []) {
    try {
      // Defer update immediately to ensure interaction is acknowledged
      try {
        await interaction.deferUpdate();
      } catch (error) {
        logger.error("Failed to defer button interaction:", error);
        return;
      }

      const [action, counterId, ownerId] = args;

      if (!interaction.inGuild()) {
        await InteractionHelper.sendErrorNotice(interaction, 'Cette action ne peut être utilisée que dans un serveur.');
        return;
      }

      if (!action || !counterId) {
        await InteractionHelper.sendErrorNotice(interaction, 'Les données de suppression du compteur sont manquantes.');
        return;
      }

      if (ownerId && interaction.user.id !== ownerId) {
        await InteractionHelper.sendErrorNotice(interaction, 'Seul l\'utilisateur qui a lancé cette suppression peut utiliser ces boutons.');
        return;
      }

      if (action === 'cancel') {
        await interaction.editReply({
          embeds: [createEmbed({
            title: '❌ Annulé',
            description: 'Suppression du compteur annulée.',
            color: 'error'
          })],
          components: []
        }).catch(logger.error);
        return;
      }

      if (action !== 'confirm') {
        await InteractionHelper.sendErrorNotice(interaction, 'Action de suppression de compteur inconnue.');
        return;
      }

      const result = await performDeletionByCounterId(client, interaction.guild, counterId);

      if (!result.success) {
        await InteractionHelper.sendErrorNotice(interaction, result.message);
        return;
      }

      await interaction.editReply({
        embeds: [successEmbed(result.message)],
        components: []
      }).catch(logger.error);
    } catch (error) {
      logger.error('Error handling counter-delete button:', error);
      await InteractionHelper.sendErrorNotice(interaction, 'Une erreur est survenue lors du traitement de cette action.');
    }
  }
};

export default counterDeleteActionHandler;
