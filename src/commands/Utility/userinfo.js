import { SlashCommandBuilder } from 'discord.js';
import { createEmbed, errorEmbed } from '../../utils/embeds.js';
import { logger } from '../../utils/logger.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { getUserLevelData, getXpForLevel, MAX_LEVEL } from '../../services/leveling.js';
import { brandFooter, discordTimestamp, formatNumber, progressBar } from '../../ui/kit.js';

const NO_MENTIONS = { parse: [], repliedUser: false };

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

const STATUS_LABELS = {
  online: '🟢 En ligne',
  idle: 'En attente',
  dnd: '🔴 Ne pas déranger',
  offline: 'Hors ligne',
  invisible: 'Hors ligne'
};

const ACTIVITY_LABELS = {
  PLAYING: 'Joue à',
  STREAMING: 'En direct',
  LISTENING: 'Écoute',
  WATCHING: 'Regarde',
  COMPETING: 'Compétit dans',
  Custom: 'Personnalisé'
};

function cleanName(value) {
  return String(value ?? 'Utilisateur').replace(/[`@]/g, '').slice(0, 80);
}

function truncate(value, max) {
  const text = String(value ?? '');
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

export default {
  data: new SlashCommandBuilder()
    .setName('userinfo')
    .setDescription('Obtenir des informations détaillées sur un utilisateur')
    .addUserOption((option) =>
      option
        .setName('target')
        .setDescription('L’utilisateur à inspecter (par défaut toi-même)'),
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
      if (!guild) {
        await InteractionHelper.safeEditReply(interaction, {
          embeds: [errorEmbed('Cette commande est disponible uniquement dans un serveur.')],
          allowedMentions: NO_MENTIONS,
        });
        return;
      }

      const user = interaction.options.getUser('target') || interaction.user;

      let member = guild.members.cache.get(user.id);
      if (!member) {
        member = await guild.members.fetch({ user: user.id, cache: false }).catch(() => null);
      }

      const fetchedUser = await user.fetch().catch(() => user);
      const flags = fetchedUser.flags?.toArray?.() || [];
      const badges = flags.map((flag) => BADGES[flag]).filter(Boolean);
      const badgeText = badges.length ? badges.join(' · ') : 'Aucune';

      const bannerURL = fetchedUser.bannerURL?.({ size: 1024 }) || null;

      const presence = member?.presence;
      const status = presence?.status || 'offline';
      const activity = presence?.activities?.find((a) => a.type !== 4) || presence?.activities?.[0];
      const activityText = activity
        ? `${ACTIVITY_LABELS[activity.type] || 'Activité'} : ${truncate([activity.name, activity.details, activity.state].filter(Boolean).join(' — '), 100)}`
        : null;

      let roleCount = 0;
      let rolesText = 'Pas dans le serveur';
      if (member) {
        const roles = member.roles.cache.filter((role) => role.id !== guild.id);
        roleCount = roles.size;
        rolesText = roleCount === 0
          ? '@everyone'
          : truncate(roles.map((role) => role.name).join(', '), 350);
      }

      let joinPosition = null;
      if (member?.joinedAt && guild.members.cache.size === guild.memberCount && guild.members.cache.size <= 1000) {
        joinPosition = [...guild.members.cache.values()]
          .filter((m) => m.joinedTimestamp)
          .sort((a, b) => a.joinedTimestamp - b.joinedTimestamp)
          .findIndex((m) => m.id === member.id) + 1;
      }

      const boosterText = member?.premiumSinceTimestamp
        ? `Depuis ${discordTimestamp(member.premiumSinceTimestamp)}`
        : 'Aucun';
      const timeoutText = member?.communicationDisabledUntilTimestamp
        ? `Jusqu’au ${discordTimestamp(member.communicationDisabledUntilTimestamp)}`
        : 'Aucun';

      let levelText = 'Pas encore de données de niveau';
      try {
        const data = await getUserLevelData(interaction.client, guild.id, user.id);
        if (data.totalXp > 0 || data.level > 0) {
          const nextLevelXp = data.level >= MAX_LEVEL ? null : getXpForLevel(data.level + 1);
          levelText = [
            `Niveau **${data.level}** • **${formatNumber(data.totalXp)}** XP au total`,
            data.level >= MAX_LEVEL
              ? 'Niveau max atteint'
              : `${progressBar(data.xp, nextLevelXp, 10)} \`${formatNumber(data.xp)} / ${formatNumber(nextLevelXp)} XP\``,
            data.rank > 0 ? `Rang **#${formatNumber(data.rank)}**` : null,
          ].filter(Boolean).join('\n');
        }
      } catch (error) {
        levelText = 'Données de niveau indisponibles';
      }

      const displayName = cleanName(member?.displayName || user.displayName || user.username);
      const embed = createEmbed({
        title: `Fiche de ${displayName}`,
        description: [
          `${user} • ${member ? 'Membre du serveur.' : 'Cette personne n’est pas membre du serveur.'}`,
          'Les données de niveau affichées proviennent de ce serveur.',
        ].join('\n'),
        color: 'info',
        thumbnail: user.displayAvatarURL({ size: 256 }),
        image: bannerURL,
        fields: [
          {
            name: 'Identité',
            value: [
              `ID : \`${user.id}\``,
              `Type : ${user.bot ? 'Bot' : 'Utilisateur'}`,
              `Badges : ${truncate(badgeText, 110)}`,
            ].join('\n'),
            inline: false,
          },
          {
            name: 'Dates',
            value: [
              `Créé : ${discordTimestamp(user.createdTimestamp, 'F')}`,
              `Rejoint : ${member?.joinedTimestamp ? discordTimestamp(member.joinedTimestamp, 'F') : 'Pas dans le serveur'}${joinPosition ? ` • position #${formatNumber(joinPosition)}` : ''}`,
            ].join('\n'),
            inline: false,
          },
          {
            name: 'Sur le serveur',
            value: [
              `Rôle le plus haut : ${truncate(member?.roles?.highest?.name ?? 'Aucun', 60)}`,
              `Boost : ${boosterText}`,
              `Timeout : ${timeoutText}`,
            ].join('\n'),
            inline: false,
          },
          { name: `Rôles (${formatNumber(roleCount)})`, value: rolesText, inline: false },
          {
            name: 'Statut',
            value: `${STATUS_LABELS[status] || 'Hors ligne'}${activityText ? `\n${activityText}` : ''}`,
            inline: false,
          },
          { name: 'Niveau', value: levelText, inline: false },
        ],
        footer: brandFooter('Fiche utilisateur'),
      });

      await InteractionHelper.safeEditReply(interaction, {
        embeds: [embed],
        allowedMentions: NO_MENTIONS,
      });

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
      await InteractionHelper.safeEditReply(interaction, {
        embeds: [errorEmbed('Impossible d’afficher les informations de cet utilisateur. Réessaie dans un instant.')],
        allowedMentions: NO_MENTIONS,
      });
    }
  },
};
