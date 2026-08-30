import { MessageFlags } from 'discord.js';
import { createEmbed, errorEmbed, successEmbed } from '../utils/embeds.js';
import { performDeletionByCounterId } from '../commands/ServerStats/modules/serverstats_delete.js';
import { logger } from '../utils/logger.js';

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
        await interaction.editReply({
          embeds: [errorEmbed('Serveur uniquement', 'Cette action ne peut être utilisée que dans un serveur.')],
          components: []
        }).catch(logger.error);
        return;
      }

      if (!action || !counterId) {
        await interaction.editReply({
          embeds: [errorEmbed('Action invalide', 'Les données de suppression du compteur sont manquantes.')],
          components: []
        }).catch(logger.error);
        return;
      }

      if (ownerId && interaction.user.id !== ownerId) {
        await interaction.editReply({
          embeds: [errorEmbed('Non autorisé', 'Seul l\'utilisateur qui a lancé cette suppression peut utiliser ces boutons.')],
          components: []
        }).catch(logger.error);
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
        await interaction.editReply({
          embeds: [errorEmbed('Action invalide', 'Action de suppression de compteur inconnue.')],
          components: []
        }).catch(logger.error);
        return;
      }

      const result = await performDeletionByCounterId(client, interaction.guild, counterId);

      if (!result.success) {
        await interaction.editReply({
          embeds: [errorEmbed(result.message)],
          components: []
        }).catch(logger.error);
        return;
      }

      await interaction.editReply({
        embeds: [successEmbed(result.message)],
        components: []
      }).catch(logger.error);
    } catch (error) {
      logger.error('Error handling counter-delete button:', error);
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({
          embeds: [errorEmbed('Erreur', 'Une erreur est survenue lors du traitement de cette action.')],
          flags: MessageFlags.Ephemeral
        }).catch(() => null);
      } else {
        await interaction.editReply({
          embeds: [errorEmbed('Erreur', 'Une erreur est survenue lors du traitement de cette action.')],
          components: []
        }).catch(() => null);
      }
    }
  }
};

export default counterDeleteActionHandler;
