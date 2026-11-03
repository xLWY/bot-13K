import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  EmbedBuilder,
  MessageFlags
} from 'discord.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { logger } from '../../utils/logger.js';
import {
  formatDuration,
  getAntiSpamConfig,
  getMissingAntiSpamPermissions,
  saveAntiSpamConfig
} from '../../services/antiSpamService.js';
import { successEmbed, warningEmbed } from '../../utils/embeds.js';
import { isBotOwner } from '../../utils/ownerIds.js';

function buildStatusEmbed(config) {
  const embed = new EmbedBuilder()
    .setColor(config.enabled ? 0x2ecc71 : 0xe74c3c)
    .setTitle('🛡️ Anti-spam')
    .setDescription(
      config.enabled
        ? 'La protection anti-spam est **activée**.'
        : 'La protection anti-spam est **désactivée**. Active-la avec `/antispam enable`.'
    )
    .addFields(
      {
        name: 'Messages',
        value: `${config.messagesPerWindow} max en ${config.windowSeconds} s`,
        inline: true
      },
      {
        name: 'Doublons',
        value: `${config.duplicateThreshold} max en ${config.duplicateWindowSeconds} s`,
        inline: true
      },
      {
        name: 'Mentions',
        value: `${config.mentionLimit} max par message`,
        inline: true
      },
      {
        name: 'Silence',
        value: formatDuration(config.timeoutSeconds),
        inline: true
      },
      {
        name: 'Suppression',
        value: config.deleteMessages ? 'Oui' : 'Non',
        inline: true
      },
      {
        name: 'Notification',
        value: config.notify ? 'Oui' : 'Non',
        inline: true
      }
    )
    .setFooter({ text: 'xlwy bot • Anti-spam' })
    .setTimestamp();

  if (config.ignoredChannels.length > 0) {
    embed.addFields({
      name: 'Salons ignorés',
      value: config.ignoredChannels
        .slice(0, 10)
        .map((channelId) => `<#${channelId}>`)
        .join(', ')
    });
  }

  return embed;
}

export default {
  data: new SlashCommandBuilder()
    .setName('antispam')
    .setDescription('* Configurer la protection anti-spam du serveur')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false)
    .addSubcommand((subcommand) =>
      subcommand
        .setName('status')
        .setDescription('Afficher la configuration anti-spam actuelle')
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('enable')
        .setDescription('Activer la protection anti-spam')
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('disable')
        .setDescription('Désactiver la protection anti-spam')
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('settings')
        .setDescription('Modifier les seuils de détection')
        .addIntegerOption((option) =>
          option
            .setName('messages')
            .setDescription('Nombre maximum de messages par fenêtre (3-50)')
            .setMinValue(3)
            .setMaxValue(50)
        )
        .addIntegerOption((option) =>
          option
            .setName('window')
            .setDescription('Fenêtre de détection en secondes (2-60)')
            .setMinValue(2)
            .setMaxValue(60)
        )
        .addIntegerOption((option) =>
          option
            .setName('duplicates')
            .setDescription('Nombre maximum de messages identiques (2-20)')
            .setMinValue(2)
            .setMaxValue(20)
        )
        .addIntegerOption((option) =>
          option
            .setName('duplicatewindow')
            .setDescription('Fenêtre des doublons en secondes (5-120)')
            .setMinValue(5)
            .setMaxValue(120)
        )
        .addIntegerOption((option) =>
          option
            .setName('mentions')
            .setDescription('Nombre maximum de mentions par message (1-25)')
            .setMinValue(1)
            .setMaxValue(25)
        )
        .addIntegerOption((option) =>
          option
            .setName('timeout')
            .setDescription('Durée du silence en minutes (1-40320)')
            .setMinValue(1)
            .setMaxValue(40320)
        )
        .addBooleanOption((option) =>
          option
            .setName('deletemessages')
            .setDescription('Supprimer les messages détectés')
        )
        .addBooleanOption((option) =>
          option
            .setName('notify')
            .setDescription('Prévenir dans le salon lorsqu’un spam est détecté')
        )
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('ignore')
        .setDescription('Ignorer ou surveiller à nouveau un salon')
        .addChannelOption((option) =>
          option
            .setName('channel')
            .setDescription('Salon à ignorer ou à surveiller')
            .setRequired(true)
        )
        .addBooleanOption((option) =>
          option
            .setName('remove')
            .setDescription('Retirer ce salon de la liste des exemptions')
        )
    ),

  category: 'moderation',

  async execute(interaction, config, client) {
    if (!interaction.guildId) {
      await InteractionHelper.sendErrorNotice(
        interaction,
        'Cette commande doit être utilisée dans un serveur.'
      );
      return;
    }

    const isOwner = isBotOwner(interaction.user.id);
    const hasPermission =
      isOwner ||
      interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild) ||
      interaction.member?.permissions?.has(PermissionFlagsBits.ManageGuild);

    if (!hasPermission) {
      await InteractionHelper.sendErrorNotice(
        interaction,
        'Tu dois avoir la permission **Gérer le serveur** pour configurer l’anti-spam.'
      );
      return;
    }

    const deferred = await InteractionHelper.safeDefer(interaction, {
      flags: MessageFlags.Ephemeral
    });
    if (!deferred) {
      return;
    }

    let subcommand = 'status';
    try {
      subcommand = interaction.options.getSubcommand() || 'status';
    } catch {
      subcommand = 'status';
    }

    try {
      const guildId = interaction.guildId;
      const current = await getAntiSpamConfig(client, guildId, { force: true });

      if (subcommand === 'status') {
        const embed = buildStatusEmbed(current);
        const missingPermissions = getMissingAntiSpamPermissions(interaction.guild.members.me);

        if (missingPermissions.length > 0) {
          embed.addFields({
            name: '⚠️ Permissions manquantes',
            value: missingPermissions.join('\n')
          });
        }

        embed.addFields({
          name: '🎛️ Configuration',
          value: 'Utilise `/panel` → **Anti-spam** pour modifier tous les réglages.'
        });

        await InteractionHelper.safeEditReply(interaction, {
          embeds: [embed]
        });
        return;
      }

      if (subcommand === 'enable' || subcommand === 'disable') {
        const enabled = subcommand === 'enable';
        await saveAntiSpamConfig(client, guildId, current, { enabled });

        await InteractionHelper.safeEditReply(interaction, {
          embeds: [
            enabled
              ? successEmbed(
                  'La protection anti-spam est maintenant **activée**.',
                  '🛡️ Anti-spam activé'
                )
              : warningEmbed(
                  'La protection anti-spam est maintenant **désactivée**.',
                  '🛡️ Anti-spam désactivé'
                )
          ]
        });
        return;
      }

      if (subcommand === 'settings') {
        const updates = {};
        const messages = interaction.options.getInteger('messages');
        const window = interaction.options.getInteger('window');
        const duplicates = interaction.options.getInteger('duplicates');
        const duplicateWindow = interaction.options.getInteger('duplicatewindow');
        const mentions = interaction.options.getInteger('mentions');
        const timeout = interaction.options.getInteger('timeout');
        const deleteMessages = interaction.options.getBoolean('deletemessages');
        const notify = interaction.options.getBoolean('notify');

        if (messages !== null) updates.messagesPerWindow = messages;
        if (window !== null) updates.windowSeconds = window;
        if (duplicates !== null) updates.duplicateThreshold = duplicates;
        if (duplicateWindow !== null) updates.duplicateWindowSeconds = duplicateWindow;
        if (mentions !== null) updates.mentionLimit = mentions;
        if (timeout !== null) updates.timeoutSeconds = timeout * 60;
        if (deleteMessages !== null) updates.deleteMessages = deleteMessages;
        if (notify !== null) updates.notify = notify;

        if (Object.keys(updates).length === 0) {
          await InteractionHelper.safeEditReply(interaction, {
            embeds: [
              warningEmbed(
                'Indique au moins un réglage à modifier.',
                'Aucun changement'
              )
            ]
          });
          return;
        }

        const updated = await saveAntiSpamConfig(client, guildId, current, updates);
        await InteractionHelper.safeEditReply(interaction, {
          embeds: [
            successEmbed(
              `Configuration mise à jour.\n\n` +
                `**Messages :** ${updated.messagesPerWindow} en ${updated.windowSeconds} s\n` +
                `**Doublons :** ${updated.duplicateThreshold} en ${updated.duplicateWindowSeconds} s\n` +
                `**Mentions :** ${updated.mentionLimit} max\n` +
                `**Silence :** ${formatDuration(updated.timeoutSeconds)}\n` +
                `**Suppression :** ${updated.deleteMessages ? 'Oui' : 'Non'}\n` +
                `**Notification :** ${updated.notify ? 'Oui' : 'Non'}`,
              '🛡️ Anti-spam configuré'
            )
          ]
        });
        return;
      }

      if (subcommand === 'ignore') {
        const channel = interaction.options.getChannel('channel');
        const remove = interaction.options.getBoolean('remove') ?? false;

        if (!channel || channel.guildId !== guildId) {
          await InteractionHelper.sendErrorNotice(
            interaction,
            'Ce salon n’appartient pas à ce serveur.'
          );
          return;
        }

        const ignoredChannels = new Set(current.ignoredChannels);
        if (remove) {
          ignoredChannels.delete(channel.id);
        } else {
          ignoredChannels.add(channel.id);
        }

        await saveAntiSpamConfig(client, guildId, current, {
          ignoredChannels: [...ignoredChannels]
        });

        await InteractionHelper.safeEditReply(interaction, {
          embeds: [
            successEmbed(
              remove
                ? `Le salon <#${channel.id}> est de nouveau surveillé.`
                : `Le salon <#${channel.id}> est maintenant ignoré par l’anti-spam.`,
              '🛡️ Anti-spam'
            )
          ]
        });
      }
    } catch (error) {
      logger.error('Erreur dans la commande antispam :', error);
      await InteractionHelper.sendErrorNotice(
        interaction,
        'Impossible de mettre à jour la configuration anti-spam.'
      );
    }
  }
};
