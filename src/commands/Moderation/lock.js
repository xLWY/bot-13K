import { SlashCommandBuilder, PermissionFlagsBits, PermissionsBitField, ChannelType } from 'discord.js';
import { createEmbed, successEmbed } from '../../utils/embeds.js';
import { logEvent } from '../../utils/moderation.js';
import { logger } from '../../utils/logger.js';
import { getColor } from '../../config/bot.js';

import { InteractionHelper } from '../../utils/interactionHelper.js';
export default {
    data: new SlashCommandBuilder()
    .setName("lock")
    .setDescription(
      "* Verrouille le salon actuel (empêche @everyone d'envoyer des messages).",
    )
.setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),
  category: "moderation",

  async execute(interaction, config, client) {
    const deferSuccess = await InteractionHelper.safeDefer(interaction);
    if (!deferSuccess) {
      logger.warn(`Lock interaction defer failed`, {
        userId: interaction.user.id,
        guildId: interaction.guildId,
        commandName: 'lock'
      });
      return;
    }

    if (!interaction.member.permissions.has(PermissionFlagsBits.ManageChannels))
      return await InteractionHelper.sendErrorNotice(interaction, "Tu as besoin de la permission `Gérer les salons` pour verrouiller des salons.");

    const channel = interaction.channel;
    const everyoneRole = interaction.guild.roles.everyone;

    try {
      const currentPermissions = channel.permissionsFor(everyoneRole);
      if (currentPermissions.has(PermissionFlagsBits.SendMessages) === false) {
        return await InteractionHelper.sendErrorNotice(interaction, `${channel} est déjà verrouillé.`);
      }

      await channel.permissionOverwrites.edit(
        everyoneRole,
        { SendMessages: false },
{ type: 0, reason: `Salon verrouillé par ${interaction.user.tag}` },
      );

      const lockEmbed = createEmbed(
        "🔒 Salon verrouillé (Journal d'actions)",
        `${channel} a été verrouillé par ${interaction.user}.`,
      )
.setColor(getColor('moderation'))
        .addFields(
          { name: "Salon", value: channel.toString(), inline: true },
          {
            name: "Modérateur",
            value: `${interaction.user.tag} (${interaction.user.id})`,
            inline: true,
          },
        );

      await logEvent({
        client,
        guild: interaction.guild,
        event: {
          action: "Channel Locked",
          target: channel.toString(),
          executor: `${interaction.user.tag} (${interaction.user.id})`,
          metadata: {
            channelId: channel.id,
            category: channel.parent?.name || 'None',
            moderatorId: interaction.user.id
          }
        }
      });

      await InteractionHelper.safeEditReply(interaction, {
        embeds: [
          successEmbed(
            `🔒 **Salon verrouillé**`,
            `${channel} est maintenant verrouillé. Plus personne ne peut y parler.`,
          ),
        ],
      });
    } catch (error) {
      logger.error('Lock command error:', error);
      return await InteractionHelper.sendErrorNotice(interaction, "Une erreur inattendue est survenue en essayant de verrouiller le salon. Vérifie mes permissions (j'ai besoin de « Gérer les salons »).");
    }
  }
};



