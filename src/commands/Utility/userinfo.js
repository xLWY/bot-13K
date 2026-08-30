import { SlashCommandBuilder } from 'discord.js';
import { createEmbed } from '../../utils/embeds.js';
import { logger } from '../../utils/logger.js';
import { handleInteractionError } from '../../utils/errorHandler.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { getUserLevelData, getXpForLevel, MAX_LEVEL } from '../../services/leveling.js';

const BADGES = {
  Staff: '🛠️ Staff Discord',
  Partner: '🤝 Partenaire',
  Hypesquad: '🏆 Événements HypeSquad',
  BugHunterLevel1: '🐛 Chasseur de bugs',
  BugHunterLevel2: '🐞 Chasseur de bugs doré',
  HypeSquadOnlineHouse1: '🟥 Bravery',
  HypeSquadOnlineHouse2: '🟨 Brilliance',
  HypeSquadOnlineHouse3: '🟩 Balance',
  PremiumEarlySupporter: '💎 Early Supporter',
  CertifiedModerator: '🛡️ Ancien Modérateur',
  VerifiedDeveloper: '🤖 Early Verified Bot Dev',
  ActiveDeveloper: '🔨 Développeur Actif',
  VerifiedBot: '✔️ Bot Vérifié',
  Speaker: '🔊 Orateur',
  Quarantined: '⚠️ Quarantaine',
  Spammer: '🚫 Spammeur'
};

const STATUS_EMOJIS = { online: '🟢', idle: '🟡', dnd: '🔴', offline: '⚫', invisible: '⚫' };

const ACTIVITY_LABELS = {
  PLAYING: 'Joue à',
  STREAMING: 'En direct',
  LISTENING: 'Écoute',
  WATCHING: 'Regarde',
  COMPETING: 'Compétit dans',
  Custom: 'Personnalisé'
};

export default {
  data: new SlashCommandBuilder()
    .setName("userinfo")
    .setDescription("Obtenir des informations détaillées sur un utilisateur")
    .addUserOption((option) =>
      option
        .setName("target")
        .setDescription("L'utilisateur à inspecter (par défaut vous-même)"),
    ),

  async execute(interaction) {
    try {
      const deferSuccess = await InteractionHelper.safeDefer(interaction);
      if (!deferSuccess) {
        logger.warn(`UserInfo interaction defer failed`, {
          userId: interaction.user.id,
          guildId: interaction.guildId,
          commandName: 'userinfo'
        });
        return;
      }

      const guild = interaction.guild;
      const user = interaction.options.getUser("target") || interaction.user;

      let member = guild.members.cache.get(user.id);
      if (!member) {
        member = await guild.members.fetch({ user: user.id, cache: false }).catch(() => null);
      }

      const fetchedUser = await user.fetch().catch(() => user);
      const flags = fetchedUser.flags?.toArray?.() || [];
      const badges = flags.map((flag) => BADGES[flag]).filter(Boolean);
      const badgeText = badges.length ? badges.join(' · ') : 'Aucune';

      const bannerURL = fetchedUser.bannerURL?.({ size: 1024 }) || null;

      const createdTs = Math.floor(user.createdTimestamp / 1000);
      const joinedTs = member?.joinedTimestamp ? Math.floor(member.joinedTimestamp / 1000) : null;

      const presence = member?.presence;
      const status = presence?.status || 'offline';
      const activity = presence?.activities?.find((a) => a.type !== 4) || presence?.activities?.[0];
      const activityText = activity
        ? `${ACTIVITY_LABELS[activity.type] || 'Activité'}: ${activity.name}` +
          (activity.details ? ` — ${activity.details}` : '') +
          (activity.state ? ` / ${activity.state}` : '')
        : null;
      const statusText =
        `${STATUS_EMOJIS[status] || '⚫'} ${status === 'offline' ? 'Hors ligne' : status.charAt(0).toUpperCase() + status.slice(1)}` +
        (activityText ? `\n${activityText}` : '');

      let rolesText = 'Pas dans le serveur';
      if (member) {
        const roles = member.roles.cache.filter((role) => role.id !== guild.id);
        if (roles.size === 0) {
          rolesText = '@everyone';
        } else {
          const joinedNames = roles.map((role) => role.name).join(', ');
          rolesText = joinedNames.length > 1000
            ? `${joinedNames.slice(0, joinedNames.lastIndexOf(',', 1000))} …`
            : joinedNames;
        }
      }

      let joinPosition = null;
      if (member?.joinedAt && guild.members.cache.size === guild.memberCount && guild.members.cache.size <= 1000) {
        joinPosition = [...guild.members.cache.values()]
          .filter((m) => m.joinedTimestamp)
          .sort((a, b) => a.joinedTimestamp - b.joinedTimestamp)
          .findIndex((m) => m.id === member.id) + 1;
      }

      const boosterText = member?.premiumSinceTimestamp
        ? `Depuis <t:${Math.floor(member.premiumSinceTimestamp / 1000)}:R>`
        : 'Aucun';
      const timeoutText = member?.communicationDisabledUntilTimestamp
        ? `Jusqu'au <t:${Math.floor(member.communicationDisabledUntilTimestamp / 1000)}:R>`
        : 'Aucun';

      let levelText = 'Pas encore de données de niveau';
      try {
        const data = await getUserLevelData(interaction.client, guild.id, user.id);
        if (data.totalXp > 0 || data.level > 0) {
          const progress = data.level >= MAX_LEVEL
            ? 'Niveau max atteint'
            : `${data.xp} / ${getXpForLevel(data.level + 1)} XP`;
          levelText = `Niveau **${data.level}**\n${progress}\n**${data.totalXp}** XP au total${data.rank > 0 ? `\nRang **#${data.rank}**` : ''}`;
        }
      } catch (error) {
        levelText = 'Données de niveau indisponibles';
      }

      const embed = createEmbed({ title: `👤 Infos Utilisateur : ${member?.displayName || user.displayName || user.username}` })
        .setDescription(`${user}`)
        .setThumbnail(user.displayAvatarURL({ size: 256 }))
        .addFields(
          { name: "ID", value: user.id, inline: true },
          { name: "Bot", value: user.bot ? "Oui" : "Non", inline: true },
          { name: "Badges", value: badgeText, inline: true },
          { name: "Compte Créé", value: `<t:${createdTs}:F> (<t:${createdTs}:R>)`, inline: false },
          {
            name: "A Rejoint le Serveur",
            value: joinedTs
              ? `<t:${joinedTs}:F> (<t:${joinedTs}:R>)${joinPosition ? `\nPosition de rejointe : #${joinPosition}` : ''}`
              : "Pas dans le serveur",
            inline: false,
          },
          { name: "Rôles", value: rolesText, inline: false },
          { name: "Rôle le Plus Haut", value: member?.roles?.highest?.name || "Aucun", inline: true },
          { name: "Booster du Serveur", value: boosterText, inline: true },
          { name: "Timeout", value: timeoutText, inline: true },
          { name: "Statut", value: statusText, inline: false },
          { name: "Leveling", value: levelText, inline: false },
        )
        .setFooter({ text: `Demandé par ${interaction.user.displayName}` });

      if (bannerURL) {
        embed.setImage(bannerURL);
      }

      await InteractionHelper.safeEditReply(interaction, { embeds: [embed] });
      logger.info(`UserInfo command executed`, {
        userId: interaction.user.id,
        targetUserId: user.id,
        guildId: interaction.guildId
      });
    } catch (error) {
      logger.error(`UserInfo command execution failed`, {
        error: error.message,
        stack: error.stack,
        userId: interaction.user.id,
        guildId: interaction.guildId,
        commandName: 'userinfo'
      });
      await handleInteractionError(interaction, error, {
        commandName: 'userinfo',
        source: 'userinfo_command'
      });
    }
  },
};