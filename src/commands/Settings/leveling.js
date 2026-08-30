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
import { errorEmbed, successEmbed, infoEmbed } from '../../utils/embeds.js';
import { logger } from '../../utils/logger.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';

export default {
    data: new SlashCommandBuilder()
        .setName('leveling')
        .setDescription('* Gérer le système de leveling, l\'XP, les niveaux et les notifications de montée de niveau')
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
                .setDescription('Définir l\'XP gagnée par message (min/max)')
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
                .setDescription('Définir le délai entre deux gains d\'XP (en secondes)')
                .addIntegerOption(option =>
                    option.setName('seconds')
                        .setDescription('Délai en secondes (0-3600)')
                        .setRequired(true)
                        .setMinValue(0)
                        .setMaxValue(3600)))
        .addSubcommand(sub =>
            sub.setName('add')
                .setDescription('Ajouter de l\'XP à un utilisateur')
                .addUserOption(option =>
                    option.setName('user')
                        .setDescription('L\'utilisateur')
                        .setRequired(true))
                .addIntegerOption(option =>
                    option.setName('xp')
                        .setDescription('Quantité d\'XP à ajouter')
                        .setRequired(true)
                        .setMinValue(1)))
        .addSubcommand(sub =>
            sub.setName('remove')
                .setDescription('Retirer de l\'XP à un utilisateur')
                .addUserOption(option =>
                    option.setName('user')
                        .setDescription('L\'utilisateur')
                        .setRequired(true))
                .addIntegerOption(option =>
                    option.setName('xp')
                        .setDescription('Quantité d\'XP à retirer')
                        .setRequired(true)
                        .setMinValue(1)))
        .addSubcommand(sub =>
            sub.setName('setlevel')
                .setDescription('Définir le niveau d\'un utilisateur')
                .addUserOption(option =>
                    option.setName('user')
                        .setDescription('L\'utilisateur')
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
                        .setDescription('L\'utilisateur')
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
                        .setDescription('L\'utilisateur')
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

        if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
            return InteractionHelper.safeEditReply(interaction, {
                embeds: [errorEmbed('Tu as besoin de la permission **Gérer le serveur** pour gérer le leveling.')],
                flags: MessageFlags.Ephemeral
            });
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
                    return InteractionHelper.safeEditReply(interaction, {
                        embeds: [successEmbed(`Les notifications de montée de niveau seront désormais envoyées dans ${channel}.`, '📈 Canal de Leveling')],
                        flags: MessageFlags.Ephemeral
                    });
                }

                case 'enable':
                case 'disable': {
                    const leveling = await getLevelingConfig(client, guildId);
                    leveling.enabled = subcommand === 'enable';
                    await saveLevelingConfig(client, guildId, leveling);

                    await logLvlChange(client, guildId, EVENT_TYPES.LEVELING_CONFIG_UPDATE, {
                        userId: interaction.user.id,
                        title: subcommand === 'enable' ? '📈 Leveling Activé' : '📈 Leveling Désactivé',
                        description: `Le système de leveling est désormais **${subcommand === 'enable' ? 'activé' : 'désactivé'}** pour ce serveur.`,
                        fields: [{ name: 'Par', value: `${interaction.user}`, inline: true }]
                    });

                    return InteractionHelper.safeEditReply(interaction, {
                        embeds: [successEmbed(
                            subcommand === 'enable' ? 'Le système de leveling est désormais **activé**.' : 'Le système de leveling est désormais **désactivé**.',
                            '📈 Leveling'
                        )],
                        flags: MessageFlags.Ephemeral
                    });
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

                    return InteractionHelper.safeEditReply(interaction, {
                        embeds: [successEmbed(
                            enabled ? 'Les notifications de montée de niveau sont **activées**.' : 'Les notifications de montée de niveau sont **désactivées**.',
                            '📈 Annonces'
                        )],
                        flags: MessageFlags.Ephemeral
                    });
                }

                case 'xprange': {
                    const min = interaction.options.getInteger('min');
                    const max = interaction.options.getInteger('max');
                    if (min > max) {
                        return InteractionHelper.safeEditReply(interaction, {
                            embeds: [errorEmbed('L\'XP minimum doit être inférieur ou égal à l\'XP maximum.')],
                            flags: MessageFlags.Ephemeral
                        });
                    }

                    const leveling = await getLevelingConfig(client, guildId);
                    leveling.xpRange = { min, max };
                    await saveLevelingConfig(client, guildId, leveling);

                    await logLvlChange(client, guildId, EVENT_TYPES.LEVELING_CONFIG_UPDATE, {
                        userId: interaction.user.id,
                        title: '⚙️ Plage d\'XP Mise à Jour',
                        description: `Chaque message valide accorde désormais entre **${min}** et **${max}** XP.`,
                        fields: [
                            { name: 'XP Min', value: `${min}`, inline: true },
                            { name: 'XP Max', value: `${max}`, inline: true },
                            { name: 'Par', value: `${interaction.user}`, inline: true }
                        ]
                    });

                    return InteractionHelper.safeEditReply(interaction, {
                        embeds: [successEmbed(`Chaque message valide accorde désormais entre **${min}** et **${max}** XP.`, '📈 Plage d\'XP')],
                        flags: MessageFlags.Ephemeral
                    });
                }

                case 'cooldown': {
                    const seconds = interaction.options.getInteger('seconds');
                    const leveling = await getLevelingConfig(client, guildId);
                    leveling.xpCooldown = seconds;
                    await saveLevelingConfig(client, guildId, leveling);

                    await logLvlChange(client, guildId, EVENT_TYPES.LEVELING_CONFIG_UPDATE, {
                        userId: interaction.user.id,
                        title: '⚙️ Délai d\'XP Mis à Jour',
                        description: `Un utilisateur peut désormais gagner de l'XP toutes les **${seconds}** seconde(s).`,
                        fields: [{ name: 'Par', value: `${interaction.user}`, inline: true }]
                    });

                    return InteractionHelper.safeEditReply(interaction, {
                        embeds: [successEmbed(`Un utilisateur peut désormais gagner de l'XP toutes les **${seconds}** seconde(s).`, '📈 Délai')],
                        flags: MessageFlags.Ephemeral
                    });
                }

                case 'add':
                case 'remove': {
                    const target = interaction.options.getUser('user');
                    if (target.bot) {
                        return InteractionHelper.safeEditReply(interaction, {
                            embeds: [errorEmbed('Tu ne peux pas modifier l\'XP des bots.')],
                            flags: MessageFlags.Ephemeral
                        });
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

                    return InteractionHelper.safeEditReply(interaction, {
                        embeds: [successEmbed(
                            `${subcommand === 'add' ? 'Ajout' : 'Retir'} **${amount} XP** ${subcommand === 'add' ? 'à' : 'à'} ${target}.\nMaintenant : niveau **${data.level}**, **${data.totalXp} XP au total** (${data.xp}/${xpNeeded} XP pour le prochain niveau).`,
                            '📈 XP Mis à Jour'
                        )],
                        flags: MessageFlags.Ephemeral
                    });
                }

                case 'setlevel': {
                    const target = interaction.options.getUser('user');
                    if (target.bot) {
                        return InteractionHelper.safeEditReply(interaction, {
                            embeds: [errorEmbed('Tu ne peux pas modifier les niveaux des bots.')],
                            flags: MessageFlags.Ephemeral
                        });
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

                    return InteractionHelper.safeEditReply(interaction, {
                        embeds: [successEmbed(`${target} est désormais au niveau **${data.level}** (**${data.totalXp} XP au total**).`, '📈 Niveau Défini')],
                        flags: MessageFlags.Ephemeral
                    });
                }

                case 'addlevel':
                case 'removelevel': {
                    const target = interaction.options.getUser('user');
                    if (target.bot) {
                        return InteractionHelper.safeEditReply(interaction, {
                            embeds: [errorEmbed('Tu ne peux pas modifier les niveaux des bots.')],
                            flags: MessageFlags.Ephemeral
                        });
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

                    return InteractionHelper.safeEditReply(interaction, {
                        embeds: [successEmbed(
                            `${subcommand === 'addlevel' ? 'Ajout' : 'Retir'} **${levels} niveau(x)** ${subcommand === 'addlevel' ? 'à' : 'à'} ${target}.\nMaintenant : niveau **${data.level}** (**${data.totalXp} XP au total**).`,
                            '📈 Niveaux Mis à Jour'
                        )],
                        flags: MessageFlags.Ephemeral
                    });
                }

                default:
                    return InteractionHelper.safeEditReply(interaction, {
                        embeds: [errorEmbed('Action de leveling inconnue.')],
                        flags: MessageFlags.Ephemeral
                    });
            }
        } catch (error) {
            logger.error(`[Leveling] Command error for guild ${guildId}:`, error);
            await InteractionHelper.safeEditReply(interaction, {
                embeds: [errorEmbed(error.userMessage || 'Une erreur est survenue lors de la gestion du leveling. Veuillez réessayer.', error, { showDetails: true })],
                flags: MessageFlags.Ephemeral
            });
        }
    }
};

async function showStatus(interaction, client, guildId) {
    const leveling = await getLevelingConfig(client, guildId);

    const channelMention = leveling.levelUpChannel
        ? (interaction.guild.channels.cache.get(leveling.levelUpChannel)?.toString() || `\`${leveling.levelUpChannel}\``)
        : (interaction.guild.systemChannel?.toString() || 'Aucun canal configuré (utilise le canal système du serveur)');

    const xpRange = leveling.xpRange || leveling.xpPerMessage || { min: 15, max: 25 };

    const description = [
        `**Activé :** ${leveling.enabled ? '✅ Oui' : '❌ Non'}`,
        `**XP par message :** ${xpRange.min} - ${xpRange.max}`,
        `**Délai :** ${leveling.xpCooldown ?? 20} secondes`,
        `**Notifications de montée de niveau :** ${leveling.announceLevelUp ? '✅ Activées' : '❌ Désactivées'}`,
        `**Canal de notification :** ${channelMention}`,
        `**Multiplicateur d'XP :** ${leveling.xpMultiplier ?? 1}`,
        `**Récompenses de rôle :** ${leveling.roleRewards && Object.keys(leveling.roleRewards).length > 0 ? Object.keys(leveling.roleRewards).join(', ') : 'Aucune'}`
    ].join('\n');

    return InteractionHelper.safeEditReply(interaction, {
        embeds: [infoEmbed(description, '📈 Statut du Leveling')],
        flags: MessageFlags.Ephemeral
    });
}

async function logLvlChange(client, guildId, eventType, data) {
    try {
        await logEvent({ client, guildId, eventType, data });
    } catch (error) {
        logger.error(`[Leveling] Failed to log event ${eventType}:`, error);
    }
}