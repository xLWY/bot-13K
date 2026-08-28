import { SlashCommandBuilder } from 'discord.js';
import { createEmbed } from '../../utils/embeds.js';
import { logger } from '../../utils/logger.js';
import { handleInteractionError } from '../../utils/errorHandler.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { getUserLevelData, getXpForLevel, MAX_LEVEL } from '../../services/leveling.js';

const BADGES = {
  Staff: '🛠️ Discord Staff',
  Partner: '🤝 Partner',
  Hypesquad: '🏆 HypeSquad Events',
  BugHunterLevel1: '🐛 Bug Hunter',
  BugHunterLevel2: '🐞 Golden Bug Hunter',
  HypeSquadOnlineHouse1: '🟥 Bravery',
  HypeSquadOnlineHouse2: '🟨 Brilliance',
  HypeSquadOnlineHouse3: '🟩 Balance',
  PremiumEarlySupporter: '💎 Early Supporter',
  CertifiedModerator: '🛡️ Moderator Alumni',
  VerifiedDeveloper: '🤖 Early Verified Bot Dev',
  ActiveDeveloper: '🔨 Active Developer',
  VerifiedBot: '✔️ Verified Bot',
  Speaker: '🔊 Speaker',
  Quarantined: '⚠️ Quarantined',
  Spammer: '🚫 Spammer'
};

const STATUS_EMOJIS = { online: '🟢', idle: '🟡', dnd: '🔴', offline: '⚫', invisible: '⚫' };

const ACTIVITY_LABELS = {
  PLAYING: 'Playing',
  STREAMING: 'Streaming',
  LISTENING: 'Listening',
  WATCHING: 'Watching',
  COMPETING: 'Competing',
  Custom: 'Custom'
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
      const badgeText = badges.length ? badges.join(' · ') : 'None';

      const bannerURL = fetchedUser.bannerURL?.({ size: 1024 }) || null;

      const createdTs = Math.floor(user.createdTimestamp / 1000);
      const joinedTs = member?.joinedTimestamp ? Math.floor(member.joinedTimestamp / 1000) : null;

      const presence = member?.presence;
      const status = presence?.status || 'offline';
      const activity = presence?.activities?.find((a) => a.type !== 4) || presence?.activities?.[0];
      const activityText = activity
        ? `${ACTIVITY_LABELS[activity.type] || 'Activity'}: ${activity.name}` +
          (activity.details ? ` — ${activity.details}` : '') +
          (activity.state ? ` / ${activity.state}` : '')
        : null;
      const statusText =
        `${STATUS_EMOJIS[status] || '⚫'} ${status === 'offline' ? 'Offline' : status.charAt(0).toUpperCase() + status.slice(1)}` +
        (activityText ? `\n${activityText}` : '');

      let rolesText = 'Not in server';
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
        ? `Since <t:${Math.floor(member.premiumSinceTimestamp / 1000)}:R>`
        : 'None';
      const timeoutText = member?.communicationDisabledUntilTimestamp
        ? `Until <t:${Math.floor(member.communicationDisabledUntilTimestamp / 1000)}:R>`
        : 'None';

      let levelText = 'No level data yet';
      try {
        const data = await getUserLevelData(interaction.client, guild.id, user.id);
        if (data.totalXp > 0 || data.level > 0) {
          const progress = data.level >= MAX_LEVEL
            ? 'Maxed out'
            : `${data.xp} / ${getXpForLevel(data.level + 1)} XP`;
          levelText = `Level **${data.level}**\n${progress}\n**${data.totalXp}** total XP${data.rank > 0 ? `\nRank **#${data.rank}**` : ''}`;
        }
      } catch (error) {
        levelText = 'Level data unavailable';
      }

      const embed = createEmbed({ title: `👤 User Info: ${member?.displayName || user.displayName || user.username}` })
        .setDescription(`${user}`)
        .setThumbnail(user.displayAvatarURL({ size: 256 }))
        .addFields(
          { name: "ID", value: user.id, inline: true },
          { name: "Bot", value: user.bot ? "Yes" : "No", inline: true },
          { name: "Badges", value: badgeText, inline: true },
          { name: "Account Created", value: `<t:${createdTs}:F> (<t:${createdTs}:R>)`, inline: false },
          {
            name: "Joined Server",
            value: joinedTs
              ? `<t:${joinedTs}:F> (<t:${joinedTs}:R>)${joinPosition ? `\nJoin position: #${joinPosition}` : ''}`
              : "Not in server",
            inline: false,
          },
          { name: "Roles", value: rolesText, inline: false },
          { name: "Highest Role", value: member?.roles?.highest?.name || "None", inline: true },
          { name: "Server Booster", value: boosterText, inline: true },
          { name: "Timeout", value: timeoutText, inline: true },
          { name: "Status", value: statusText, inline: false },
          { name: "Leveling", value: levelText, inline: false },
        )
        .setFooter({ text: `Requested by ${interaction.user.displayName}` });

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