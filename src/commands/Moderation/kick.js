import { SlashCommandBuilder, PermissionFlagsBits, PermissionsBitField, ChannelType } from 'discord.js';
import { createEmbed, errorEmbed, successEmbed, infoEmbed, warningEmbed } from '../../utils/embeds.js';
import { logModerationAction } from '../../utils/moderation.js';
import { logger } from '../../utils/logger.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { TitanBotError, ErrorTypes } from '../../utils/errorHandler.js';

export default {
    data: new SlashCommandBuilder()
    .setName("kick")
    .setDescription("* Expulser un utilisateur du serveur")
    .addUserOption((option) =>
      option
        .setName("target")
        .setDescription("L'utilisateur à expulser")
        .setRequired(true),
    )
    .addStringOption((option) =>
      option.setName("reason").setDescription("Raison de l'expulsion"),
    )
.setDefaultMemberPermissions(PermissionFlagsBits.KickMembers),
  category: "moderation",

  async execute(interaction, config, client) {
    try {
      
      if (!interaction.member.permissions.has(PermissionFlagsBits.KickMembers)) {
        throw new TitanBotError(
          "User lacks permission",
          ErrorTypes.PERMISSION,
          "Tu n'as pas la permission d'expulser des membres."
        );
      }

      const targetUser = interaction.options.getUser("target");
      const member = interaction.options.getMember("target");
      const reason = interaction.options.getString("reason") || "Aucune raison fournie";

      
      if (targetUser.id === interaction.user.id) {
        throw new TitanBotError(
          "Cannot kick self",
          ErrorTypes.VALIDATION,
          "Tu ne peux pas t'expulser toi-même."
        );
      }

      
      if (targetUser.id === client.user.id) {
        throw new TitanBotError(
          "Cannot kick bot",
          ErrorTypes.VALIDATION,
          "Tu ne peux pas expulser le bot."
        );
      }

      
      if (!member) {
        throw new TitanBotError(
          "Target not found",
          ErrorTypes.USER_INPUT,
          "L'utilisateur ciblé n'est actuellement pas dans ce serveur.",
          { subtype: 'user_not_found' }
        );
      }

      
      if (interaction.member.roles.highest.position <= member.roles.highest.position) {
        throw new TitanBotError(
          "Cannot kick user",
          ErrorTypes.PERMISSION,
          "Tu ne peux pas expulser un utilisateur ayant un rôle égal ou supérieur au tien."
        );
      }

      
      if (!member.kickable) {
        throw new TitanBotError(
          "Bot cannot kick",
          ErrorTypes.PERMISSION,
          "Je ne peux pas expulser cet utilisateur. Vérifie ma position de rôle par rapport à l'utilisateur ciblé."
        );
      }

      
      await member.kick(reason);

      
      const caseId = await logModerationAction({
        client,
        guild: interaction.guild,
        event: {
          action: "Member Kicked",
          target: `${targetUser.tag} (${targetUser.id})`,
          executor: `${interaction.user.tag} (${interaction.user.id})`,
          reason,
          metadata: {
            userId: targetUser.id,
            moderatorId: interaction.user.id
          }
        }
      });

      
      await InteractionHelper.universalReply(interaction, {
        embeds: [
          successEmbed(
            `👢 **Expulsé** ${targetUser.tag}`,
            `**Raison :** ${reason}\n**ID de cas :** #${caseId}`,
          ),
        ],
      });
    } catch (error) {
      logger.error('Kick command error:', error);
      const errorEmbed_default = errorEmbed(
        "Une erreur inattendue est survenue en essayant d'expulser l'utilisateur.",
        error.message || "Impossible d'expulser l'utilisateur"
      );
      await InteractionHelper.universalReply(interaction, { embeds: [errorEmbed_default] });
    }
  }
};



