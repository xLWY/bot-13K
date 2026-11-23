import { SlashCommandBuilder, PermissionFlagsBits, MessageFlags, ChannelType } from 'discord.js';
import {
    getLevelingConfig,
    saveLevelingConfig,
    getUserLevelData,
    saveUserLevelData,
    getLevelFromXp,
    getXpForLevel,
    addLevels,
    removeLevels,
    setUserLevel,
    MAX_LEVEL
} from '../../services/leveling.js';
import { logEvent, EVENT_TYPES } from '../../services/loggingService.js';
import { createEmbed, errorEmbed, successEmbed } from '../../utils/embeds.js';
import { logger } from '../../utils/logger.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { isBotOwner } from '../../utils/ownerIds.js';
import { brandFooter, formatNumber, guildIconUrl, progressBar } from '../../ui/kit.js';

const NO_MENTIONS = { parse: [], repliedUser: false };
const FOOTER_CONTEXT = 'Configuration des niveaux';

function errorReply(interaction, message) {
    const embed = errorEmbed(message);
    embed.setFooter(brandFooter(FOOTER_CONTEXT));
    return InteractionHelper.safeEditReply(interaction, {
        embeds: [embed],
        allowedMentions: NO_MENTIONS,
        flags: MessageFlags.Ephemeral,
    });
}

function successReply(interaction, title, description, fields = []) {
    const embed = successEmbed(description, `✅ ${title}`);
    if (fields.length) embed.addFields(fields.slice(0, 6));
    embed.setFooter(brandFooter(FOOTER_CONTEXT));
    return InteractionHelper.safeEditReply(interaction, {
        embeds: [embed],
        allowedMentions: NO_MENTIONS,
        flags: MessageFlags.Ephemeral,
    });
}

export default {
    data: new SlashCommandBuilder()
        .setName('leveling')
        .setDescription("Gérer le système de leveling, l’XP, les niveaux et les notifications de montée de niveau")
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
        .addSubcommand(sub =>
            sub.setName('status')
                .setDescription('Afficher la configuration actuelle du leveling'))
        .addSubcommand(sub =>
            sub.setName('setchannel')
                .setDescription('Définir où sont envoyées les notifications de montée de niveau')
                .addChannelOption(option =>
                    option.setName('channel')
                        .setDescription('Le canal textuel pour les notifications de montée de niveau')
                        .setRequired(true)
                        .addChannelTypes(ChannelType.GuildText)))
        .addSubcommand(sub =>
            sub.setName('enable')
                .setDescription('Activer le système de leveling'))
        .addSubcommand(sub =>
            sub.setName('disable')
                .setDescription('Désactiver le système de leveling'))
        .addSubcommand(sub =>
            sub.setName('announce')
                .setDescription('Activer ou désactiver les notifications de montée de niveau')
                .addBooleanOption(option =>
                    option.setName('enabled')
                        .setDescription('Doit-on annoncer les montées de niveau')
                        .setRequired(true)))
        .addSubcommand(sub =>
            sub.setName('xprange')
                .setDescription("Définir l’XP gagnée par message (min/max)")
                .addIntegerOption(option =>
                    option.setName('min')
                        .setDescription('XP minimum par message')
                        .setRequired(true)
                        .setMinValue(1)
                        .setMaxValue(100))
                .addIntegerOption(option =>
                    option.setName('max')
                        .setDescription('XP maximum par message')
                        .setRequired(true)
                        .setMinValue(1)
                        .setMaxValue(100)))
        .addSubcommand(sub =>
            sub.setName('cooldown')
                .setDescription("Définir le délai entre deux gains d’XP (en secondes)")
                .addIntegerOption(option =>
                    option.setName('seconds')
                        .setDescription('Délai en secondes (0-3600)')
                        .setRequired(true)
                        .setMinValue(0)
                        .setMaxValue(3600)))
        .addSubcommand(sub =>
            sub.setName('add')
                .setDescription("Ajouter de l’XP à un utilisateur")
                .addUserOption(option =>
                    option.setName('user')
                        .setDescription('L’utilisateur')
                        .setRequired(true))
                .addIntegerOption(option =>
                    option.setName('xp')
                        .setDescription('Quantité d’XP à ajouter')
                        .setRequired(true)
                        .setMinValue(1)))
        .addSubcommand(sub =>
            sub.setName('remove')
                .setDescription("Retirer de l’XP à un utilisateur")
                .addUserOption(option =>
                    option.setName('user')
                        .setDescription('L’utilisateur')
                        .setRequired(true))
                .addIntegerOption(option =>
                    option.setName('xp')
                        .setDescription('Quantité d’XP à retirer')
                        .setRequired(true)
                        .setMinValue(1)))
        .addSubcommand(sub =>
            sub.setName('setlevel')
                .setDescription("Définir le niveau d’un utilisateur")
                .addUserOption(option =>
                    option.setName('user')
                        .setDescription('L’utilisateur')
                        .setRequired(true))
                .addIntegerOption(option =>
                    option.setName('level')
                        .setDescription('Le nouveau niveau (0-1000)')
                        .setRequired(true)
                        .setMinValue(0)
                        .setMaxValue(MAX_LEVEL)))
        .addSubcommand(sub =>
            sub.setName('addlevel')
                .setDescription('Ajouter des niveaux à un utilisateur')
                .addUserOption(option =>
                    option.setName('user')
                        .setDescription('L’utilisateur')
                        .setRequired(true))
                .addIntegerOption(option =>
                    option.setName('levels')
                        .setDescription('Nombre de niveaux à ajouter')
                        .setRequired(true)
                        .setMinValue(1)
                        .setMaxValue(MAX_LEVEL)))
        .addSubcommand(sub =>
            sub.setName('removelevel')
                .setDescription('Retirer des niveaux à un utilisateur')
                .addUserOption(option =>
                    option.setName('user')
                        .setDescription('L’utilisateur')
                        .setRequired(true))
                .addIntegerOption(option =>
                    option.setName('levels')
                        .setDescription('Nombre de niveaux à retirer')
                        .setRequired(true)
                        .setMinValue(1)
                        .setMaxValue(MAX_LEVEL))),

    category: 'settings',

    async execute(interaction, config, client) {
        const deferSuccess = await InteractionHelper.safeDefer(interaction, { flags: MessageFlags.Ephemeral });
        if (!deferSuccess) {
            logger.warn('Leveling interaction defer failed', {
                userId: interaction.user.id,
                guildId: interaction.guildId,
                commandName: 'leveling'
            });
            return;
        }

        if (!isBotOwner(interaction.user.id) && !interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
            return errorReply(interaction, 'Tu as besoin de la permission **Gérer le serveur** pour gérer le leveling.');
        }

        const guildId = interaction.guild.id;
        const subcommand = interaction.options.getSubcommand();

        try {
            switch (subcommand) {
                case 'status':
                    return await showStatus(interaction, client, guildId);

                case 'setchannel': {
                    const channel = interaction.options.getChannel('channel');
                    const leveling = await getLevelingConfig(client, guildId);
                    const oldChannelId = leveling.levelUpChannel;
                    leveling.levelUpChannel = channel.id;
                    await saveLevelingConfig(client, guildId, leveling);

                    logger.info(`[Leveling] Set level-up channel to ${channel.id} in ${interaction.guild.id} by ${interaction.user.tag}`);
                    await logLvlChange(client, guildId, EVENT_TYPES.LEVELING_CONFIG_UPDATE, {
                        userId: interaction.user.id,
                        title: '⚙️ Canal de Leveling Mis à Jour',
                        description: `Les notifications de montée de niveau seront désormais envoyées dans ${channel}.`,
                        fields: [
                            { name: 'Ancien Canal', value: oldChannelId ? `<#${oldChannelId}>` : 'Aucun', inline: true },
                            { name: 'Nouveau Canal', value: `${channel}`, inline: true },
                            { name: 'Par', value: `${interaction.user}`, inline: true }
                        ]
                    });
                    return successReply(
                        interaction,
                        'Canal de montée de niveau',
                        `Les annonces iront désormais dans ${channel}.`,
                        [
                            { name: 'Ancien canal', value: oldChannelId ? `<#${oldChannelId}>` : 'Aucun', inline: true },
                            { name: 'Nouveau canal', value: `${channel}`, inline: true },
                        ],
                    );
                }

                case 'enable':
                case 'disable': {
                    const enabled = subcommand === 'enable';
                    const leveling = await getLevelingConfig(client, guildId);
                    leveling.enabled = enabled;
                    await saveLevelingConfig(client, guildId, leveling);

                    await logLvlChange(client, guildId, EVENT_TYPES.LEVELING_CONFIG_UPDATE, {
                        userId: interaction.user.id,
                        title: enabled ? '📈 Leveling Activé' : '📈 Leveling Désactivé',
                        description: `Le système de leveling est désormais **${enabled ? 'activé' : 'désactivé'}** pour ce serveur.`,
                        fields: [{ name: 'Par', value: `${interaction.user}`, inline: true }]
                    });

                    return successReply(
                        interaction,
                        enabled ? 'Leveling activé' : 'Leveling désactivé',
                        `Le système de leveling est désormais **${enabled ? 'activé' : 'désactivé'}**.`,
                    );
                }

                case 'announce': {
                    const enabled = interaction.options.getBoolean('enabled');
                    const leveling = await getLevelingConfig(client, guildId);
                    leveling.announceLevelUp = enabled;
                    await saveLevelingConfig(client, guildId, leveling);

                    await logLvlChange(client, guildId, EVENT_TYPES.LEVELING_CONFIG_UPDATE, {
                        userId: interaction.user.id,
                        title: enabled ? '📈 Notifications de Montée de Niveau Activées' : '📈 Notifications de Montée de Niveau Désactivées',
                        description: `Les annonces de montée de niveau sont désormais **${enabled ? 'activées' : 'désactivées'}**.`,
                        fields: [{ name: 'Par', value: `${interaction.user}`, inline: true }]
                    });

                    return successReply(
                        interaction,
                        enabled ? 'Notifications activées' : 'Notifications désactivées',
                        `Les annonces de montée de niveau sont désormais **${enabled ? 'activées' : 'désactivées'}**.`,
                    );
                }

                case 'xprange': {
                    const min = interaction.options.getInteger('min');
                    const max = interaction.options.getInteger('max');
                    if (min > max) {
                        return errorReply(interaction, 'L’XP minimum doit être inférieur ou égal à l’XP maximum.');
                    }

                    const leveling = await getLevelingConfig(client, guildId);
                    leveling.xpRange = { min, max };
                    await saveLevelingConfig(client, guildId, leveling);

                    await logLvlChange(client, guildId, EVENT_TYPES.LEVELING_CONFIG_UPDATE, {
                        userId: interaction.user.id,
                        title: '⚙️ Plage d’XP Mise à Jour',
                        description: `Chaque message valide accorde désormais entre **${min}** et **${max}** XP.`,
                        fields: [
                            { name: 'XP Min', value: `${min}`, inline: true },
                            { name: 'XP Max', value: `${max}`, inline: true },
                            { name: 'Par', value: `${interaction.user}`, inline: true }
                        ]
                    });

                    return successReply(
                        interaction,
                        'Plage d’XP mise à jour',
                        `Chaque message valide accorde désormais entre **${min}** et **${max}** XP.`,
                        [
                            { name: 'Minimum', value: `\`${formatNumber(min)}\``, inline: true },
                            { name: 'Maximum', value: `\`${formatNumber(max)}\``, inline: true },
                        ],
                    );
                }

                case 'cooldown': {
                    const seconds = interaction.options.getInteger('seconds');
                    const leveling = await getLevelingConfig(client, guildId);
                    leveling.xpCooldown = seconds;
                    await saveLevelingConfig(client, guildId, leveling);

                    await logLvlChange(client, guildId, EVENT_TYPES.LEVELING_CONFIG_UPDATE, {
                        userId: interaction.user.id,
                        title: '⚙️ Délai d’XP Mis à Jour',
                        description: `Un utilisateur peut désormais gagner de l'XP toutes les **${seconds}** seconde(s).`,
                        fields: [{ name: 'Par', value: `${interaction.user}`, inline: true }]
                    });

                    return successReply(
                        interaction,
                        'Délai d’XP mis à jour',
                        `Un utilisateur peut désormais gagner de l’XP toutes les **${seconds}** seconde(s).`,
                        [{ name: 'Délai', value: `\`${formatNumber(seconds)} s\``, inline: true }],
                    );
                }

                case 'add':
                case 'remove': {
                    const target = interaction.options.getUser('user');
                    if (target.bot) {
                        return errorReply(interaction, 'Tu ne peux pas modifier l’XP des bots.');
                    }

                    const amount = interaction.options.getInteger('xp');
                    const data = await getUserLevelData(client, guildId, target.id);
                    const previousTotal = data.totalXp;
                    const delta = subcommand === 'add' ? amount : -amount;
                    data.totalXp = Math.max(0, data.totalXp + delta);

                    const result = getLevelFromXp(data.totalXp);
                    data.level = result.level;
                    data.xp = result.currentXp;
                    await saveUserLevelData(client, guildId, target.id, data);

                    const xpNeeded = getXpForLevel(data.level + 1);
                    await logLvlChange(client, guildId, EVENT_TYPES.LEVELING_XP_CHANGE, {
                        userId: interaction.user.id,
                        title: subcommand === 'add' ? '⭐ XP Ajouté' : '⭐ XP Retiré',
                        description: `${subcommand === 'add' ? 'Ajout' : 'Retir'} **${amount} XP** ${subcommand === 'add' ? 'à' : 'à'} ${target}.`,
                        fields: [
                            { name: 'Utilisateur', value: `${target}`, inline: true },
                            { name: 'Quantité', value: `${subcommand === 'add' ? '+' : '-'}${amount} XP`, inline: true },
                            { name: 'XP Total', value: `${previousTotal} → ${data.totalXp}`, inline: true },
                            { name: 'Par', value: `${interaction.user}`, inline: true }
                        ]
                    });

                    return successReply(
                        interaction,
                        subcommand === 'add' ? 'XP ajoutée' : 'XP retirée',
                        `**${formatNumber(amount)} XP** ${subcommand === 'add' ? 'ajoutés à' : 'retirés à'} ${target}.`,
                        [
                            { name: 'Utilisateur', value: `${target}`, inline: true },
                            { name: 'Niveau', value: `\`${data.level}\``, inline: true },
                            { name: 'XP total', value: `\`${formatNumber(data.totalXp)}\``, inline: true },
                            {
                                name: 'Vers le niveau suivant',
                                value: `\`${formatNumber(data.xp)} / ${formatNumber(xpNeeded)}\` ${progressBar(data.xp, xpNeeded, 10)}`,
                            },
                        ],
                    );
                }

                case 'setlevel': {
                    const target = interaction.options.getUser('user');
                    if (target.bot) {
                        return errorReply(interaction, 'Tu ne peux pas modifier les niveaux des bots.');
                    }

                    const newLevel = interaction.options.getInteger('level');
                    const data = await setUserLevel(client, guildId, target.id, newLevel);

                    await logLvlChange(client, guildId, EVENT_TYPES.LEVELING_LEVEL_CHANGE, {
                        userId: interaction.user.id,
                        title: '🔺 Niveau Défini',
                        description: `${target} a été défini au niveau **${newLevel}**.`,
                        fields: [
                            { name: 'Utilisateur', value: `${target}`, inline: true },
                            { name: 'Nouveau Niveau', value: `${data.level}`, inline: true },
                            { name: 'XP Total', value: `${data.totalXp}`, inline: true },
                            { name: 'Par', value: `${interaction.user}`, inline: true }
                        ]
                    });

                    return successReply(
                        interaction,
                        'Niveau défini',
                        `${target} est désormais au niveau **${data.level}**.`,
                        [
                            { name: 'Utilisateur', value: `${target}`, inline: true },
                            { name: 'Niveau', value: `\`${data.level}\``, inline: true },
                            { name: 'XP total', value: `\`${formatNumber(data.totalXp)}\``, inline: true },
                        ],
                    );
                }

                case 'addlevel':
                case 'removelevel': {
                    const target = interaction.options.getUser('user');
                    if (target.bot) {
                        return errorReply(interaction, 'Tu ne peux pas modifier les niveaux des bots.');
                    }

                    const levels = interaction.options.getInteger('levels');
                    const data = subcommand === 'addlevel'
                        ? await addLevels(client, guildId, target.id, levels)
                        : await removeLevels(client, guildId, target.id, levels);

                    await logLvlChange(client, guildId, EVENT_TYPES.LEVELING_LEVEL_CHANGE, {
                        userId: interaction.user.id,
                        title: subcommand === 'addlevel' ? '🔺 Niveaux Ajoutés' : '🔺 Niveaux Retirés',
                        description: `${subcommand === 'addlevel' ? 'Ajout' : 'Retir'} **${levels} niveau(x)** ${subcommand === 'addlevel' ? 'à' : 'à'} ${target}.`,
                        fields: [
                            { name: 'Utilisateur', value: `${target}`, inline: true },
                            { name: 'Niveaux', value: `${subcommand === 'addlevel' ? '+' : '-'}${levels}`, inline: true },
                            { name: 'Nouveau Niveau', value: `${data.level}`, inline: true },
                            { name: 'XP Total', value: `${data.totalXp}`, inline: true },
                            { name: 'Par', value: `${interaction.user}`, inline: true }
                        ]
                    });

                    return successReply(
                        interaction,
                        subcommand === 'addlevel' ? 'Niveaux ajoutés' : 'Niveaux retirés',
                        `${subcommand === 'addlevel' ? 'Ajout' : 'Retir'} de **${levels} niveau(x)** ${subcommand === 'addlevel' ? 'à' : 'à'} ${target}.`,
                        [
                            { name: 'Utilisateur', value: `${target}`, inline: true },
                            { name: 'Niveau', value: `\`${data.level}\``, inline: true },
                            { name: 'XP total', value: `\`${formatNumber(data.totalXp)}\``, inline: true },
                        ],
                    );
                }

                default:
                    return errorReply(interaction, 'Action de leveling inconnue.');
            }
        } catch (error) {
            logger.error(`[Leveling] Command error for guild ${guildId}:`, error);
            await errorReply(
                interaction,
                error.userMessage || 'Une erreur est survenue lors de la gestion du leveling. Veuillez réessayer.',
            );
        }
    }
};

async function showStatus(interaction, client, guildId) {
    const leveling = await getLevelingConfig(client, guildId);

    const channelMention = leveling.levelUpChannel
        ? (interaction.guild.channels.cache.get(leveling.levelUpChannel)?.toString() || `\`${leveling.levelUpChannel}\``)
        : (interaction.guild.systemChannel?.toString() || 'Aucun canal configuré (canal système du serveur)');

    const rawRange = leveling.xpRange || leveling.xpPerMessage || { min: 15, max: 25 };
    const min = rawRange.min ?? 15;
    const max = rawRange.max ?? 25;
    const rewardIds = Object.keys(leveling.roleRewards ?? {});
    const configured = [
        leveling.enabled,
        leveling.announceLevelUp,
        leveling.levelUpChannel,
        leveling.xpRange,
        leveling.xpCooldown,
    ].filter(Boolean).length;

    const rewards = rewardIds.length
        ? `${rewardIds.slice(0, 8).map((id) => `\`${id}\``).join(', ')}${rewardIds.length > 8 ? ' …' : ''}`
        : 'Aucune';

    const embed = createEmbed({
        title: '📈 Statut du leveling',
        description: 'Voici la configuration actuelle. Utilise une sous-commande `/leveling` pour la modifier.',
        color: leveling.enabled ? 'success' : 'warning',
        thumbnail: guildIconUrl(interaction.guild, 128),
        fields: [
            {
                name: 'État',
                value: `${leveling.enabled ? '🟢 Activé' : '🔴 Désactivé'} • Annonces ${leveling.announceLevelUp ? '✅' : '❌'}`,
            },
            {
                name: 'Gain d’XP',
                value: `Par message : \`${formatNumber(min)} – ${formatNumber(max)}\` • Délai : \`${formatNumber(leveling.xpCooldown ?? 20)} s\` • Multiplicateur : \`${leveling.xpMultiplier ?? 1}\``,
            },
            { name: 'Canal de notification', value: channelMention },
            { name: 'Récompenses de rôle', value: rewards },
            {
                name: 'Configuration renseignée',
                value: `${progressBar(configured, 5, 10)} \`${configured}/5\``,
            },
        ],
        footer: brandFooter(FOOTER_CONTEXT),
    });

    return InteractionHelper.safeEditReply(interaction, {
        embeds: [embed],
        allowedMentions: NO_MENTIONS,
        flags: MessageFlags.Ephemeral,
    });
}

async function logLvlChange(client, guildId, eventType, data) {
    try {
        await logEvent({ client, guildId, eventType, data });
    } catch (error) {
        logger.error(`[Leveling] Failed to log event ${eventType}:`, error);
    }
}
