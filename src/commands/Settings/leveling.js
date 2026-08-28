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
import { errorEmbed, successEmbed, infoEmbed } from '../../utils/embeds.js';
import { logger } from '../../utils/logger.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';

export default {
    data: new SlashCommandBuilder()
        .setName('leveling')
        .setDescription('Manage the leveling system, XP, levels and level-up notifications')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
        .addSubcommand(sub =>
            sub.setName('status')
                .setDescription('Show the current leveling configuration'))
        .addSubcommand(sub =>
            sub.setName('setchannel')
                .setDescription('Set where level-up notifications are sent')
                .addChannelOption(option =>
                    option.setName('channel')
                        .setDescription('The text channel for level-up notifications')
                        .setRequired(true)
                        .addChannelTypes(ChannelType.GuildText)))
        .addSubcommand(sub =>
            sub.setName('enable')
                .setDescription('Enable the leveling system'))
        .addSubcommand(sub =>
            sub.setName('disable')
                .setDescription('Disable the leveling system'))
        .addSubcommand(sub =>
            sub.setName('announce')
                .setDescription('Toggle level-up notifications')
                .addBooleanOption(option =>
                    option.setName('enabled')
                        .setDescription('Whether to announce level-ups')
                        .setRequired(true)))
        .addSubcommand(sub =>
            sub.setName('xprange')
                .setDescription('Set the XP gained per message (min/max)')
                .addIntegerOption(option =>
                    option.setName('min')
                        .setDescription('Minimum XP per message')
                        .setRequired(true)
                        .setMinValue(1)
                        .setMaxValue(100))
                .addIntegerOption(option =>
                    option.setName('max')
                        .setDescription('Maximum XP per message')
                        .setRequired(true)
                        .setMinValue(1)
                        .setMaxValue(100)))
        .addSubcommand(sub =>
            sub.setName('cooldown')
                .setDescription('Set the cooldown between XP gains (in seconds)')
                .addIntegerOption(option =>
                    option.setName('seconds')
                        .setDescription('Cooldown in seconds (0-3600)')
                        .setRequired(true)
                        .setMinValue(0)
                        .setMaxValue(3600)))
        .addSubcommand(sub =>
            sub.setName('add')
                .setDescription('Add XP to a user')
                .addUserOption(option =>
                    option.setName('user')
                        .setDescription('The user')
                        .setRequired(true))
                .addIntegerOption(option =>
                    option.setName('xp')
                        .setDescription('Amount of XP to add')
                        .setRequired(true)
                        .setMinValue(1)))
        .addSubcommand(sub =>
            sub.setName('remove')
                .setDescription('Remove XP from a user')
                .addUserOption(option =>
                    option.setName('user')
                        .setDescription('The user')
                        .setRequired(true))
                .addIntegerOption(option =>
                    option.setName('xp')
                        .setDescription('Amount of XP to remove')
                        .setRequired(true)
                        .setMinValue(1)))
        .addSubcommand(sub =>
            sub.setName('setlevel')
                .setDescription('Set a user\'s level')
                .addUserOption(option =>
                    option.setName('user')
                        .setDescription('The user')
                        .setRequired(true))
                .addIntegerOption(option =>
                    option.setName('level')
                        .setDescription('The new level (0-1000)')
                        .setRequired(true)
                        .setMinValue(0)
                        .setMaxValue(MAX_LEVEL)))
        .addSubcommand(sub =>
            sub.setName('addlevel')
                .setDescription('Add levels to a user')
                .addUserOption(option =>
                    option.setName('user')
                        .setDescription('The user')
                        .setRequired(true))
                .addIntegerOption(option =>
                    option.setName('levels')
                        .setDescription('Number of levels to add')
                        .setRequired(true)
                        .setMinValue(1)
                        .setMaxValue(MAX_LEVEL)))
        .addSubcommand(sub =>
            sub.setName('removelevel')
                .setDescription('Remove levels from a user')
                .addUserOption(option =>
                    option.setName('user')
                        .setDescription('The user')
                        .setRequired(true))
                .addIntegerOption(option =>
                    option.setName('levels')
                        .setDescription('Number of levels to remove')
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
                embeds: [errorEmbed('You need the **Manage Server** permission to manage leveling.')],
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
                    leveling.levelUpChannel = channel.id;
                    await saveLevelingConfig(client, guildId, leveling);

                    logger.info(`[Leveling] Set level-up channel to ${channel.id} in ${interaction.guild.id} by ${interaction.user.tag}`);
                    return InteractionHelper.safeEditReply(interaction, {
                        embeds: [successEmbed(`Level-up notifications will now be sent to ${channel}.`, '📈 Leveling Channel')],
                        flags: MessageFlags.Ephemeral
                    });
                }

                case 'enable':
                case 'disable': {
                    const leveling = await getLevelingConfig(client, guildId);
                    leveling.enabled = subcommand === 'enable';
                    await saveLevelingConfig(client, guildId, leveling);

                    return InteractionHelper.safeEditReply(interaction, {
                        embeds: [successEmbed(
                            subcommand === 'enable' ? 'The leveling system is now **enabled**.' : 'The leveling system is now **disabled**.',
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

                    return InteractionHelper.safeEditReply(interaction, {
                        embeds: [successEmbed(
                            enabled ? 'Level-up notifications are **enabled**.' : 'Level-up notifications are **disabled**.',
                            '📈 Announcements'
                        )],
                        flags: MessageFlags.Ephemeral
                    });
                }

                case 'xprange': {
                    const min = interaction.options.getInteger('min');
                    const max = interaction.options.getInteger('max');
                    if (min > max) {
                        return InteractionHelper.safeEditReply(interaction, {
                            embeds: [errorEmbed('The minimum XP must be lower than or equal to the maximum XP.')],
                            flags: MessageFlags.Ephemeral
                        });
                    }

                    const leveling = await getLevelingConfig(client, guildId);
                    leveling.xpRange = { min, max };
                    await saveLevelingConfig(client, guildId, leveling);

                    return InteractionHelper.safeEditReply(interaction, {
                        embeds: [successEmbed(`Each valid message now grants between **${min}** and **${max}** XP.`, '📈 XP Range')],
                        flags: MessageFlags.Ephemeral
                    });
                }

                case 'cooldown': {
                    const seconds = interaction.options.getInteger('seconds');
                    const leveling = await getLevelingConfig(client, guildId);
                    leveling.xpCooldown = seconds;
                    await saveLevelingConfig(client, guildId, leveling);

                    return InteractionHelper.safeEditReply(interaction, {
                        embeds: [successEmbed(`A user can now gain XP every **${seconds}** second(s).`, '📈 Cooldown')],
                        flags: MessageFlags.Ephemeral
                    });
                }

                case 'add':
                case 'remove': {
                    const target = interaction.options.getUser('user');
                    if (target.bot) {
                        return InteractionHelper.safeEditReply(interaction, {
                            embeds: [errorEmbed('You cannot modify XP for bots.')],
                            flags: MessageFlags.Ephemeral
                        });
                    }

                    const amount = interaction.options.getInteger('xp');
                    const data = await getUserLevelData(client, guildId, target.id);
                    const delta = subcommand === 'add' ? amount : -amount;
                    data.totalXp = Math.max(0, data.totalXp + delta);

                    const result = getLevelFromXp(data.totalXp);
                    data.level = result.level;
                    data.xp = result.currentXp;
                    await saveUserLevelData(client, guildId, target.id, data);

                    const xpNeeded = getXpForLevel(data.level + 1);
                    return InteractionHelper.safeEditReply(interaction, {
                        embeds: [successEmbed(
                            `${subcommand === 'add' ? 'Added' : 'Removed'} **${amount} XP** ${subcommand === 'add' ? 'to' : 'from'} ${target}.\nNow: level **${data.level}**, **${data.totalXp} total XP** (${data.xp}/${xpNeeded} XP to next level).`,
                            '📈 XP Updated'
                        )],
                        flags: MessageFlags.Ephemeral
                    });
                }

                case 'setlevel': {
                    const target = interaction.options.getUser('user');
                    if (target.bot) {
                        return InteractionHelper.safeEditReply(interaction, {
                            embeds: [errorEmbed('You cannot modify levels for bots.')],
                            flags: MessageFlags.Ephemeral
                        });
                    }

                    const newLevel = interaction.options.getInteger('level');
                    const data = await setUserLevel(client, guildId, target.id, newLevel);

                    return InteractionHelper.safeEditReply(interaction, {
                        embeds: [successEmbed(`${target} is now level **${data.level}** (**${data.totalXp} total XP**).`, '📈 Level Set')],
                        flags: MessageFlags.Ephemeral
                    });
                }

                case 'addlevel':
                case 'removelevel': {
                    const target = interaction.options.getUser('user');
                    if (target.bot) {
                        return InteractionHelper.safeEditReply(interaction, {
                            embeds: [errorEmbed('You cannot modify levels for bots.')],
                            flags: MessageFlags.Ephemeral
                        });
                    }

                    const levels = interaction.options.getInteger('levels');
                    const data = subcommand === 'addlevel'
                        ? await addLevels(client, guildId, target.id, levels)
                        : await removeLevels(client, guildId, target.id, levels);

                    return InteractionHelper.safeEditReply(interaction, {
                        embeds: [successEmbed(
                            `${subcommand === 'addlevel' ? 'Added' : 'Removed'} **${levels} level(s)** ${subcommand === 'addlevel' ? 'to' : 'from'} ${target}.\nNow: level **${data.level}** (**${data.totalXp} total XP**).`,
                            '📈 Levels Updated'
                        )],
                        flags: MessageFlags.Ephemeral
                    });
                }

                default:
                    return InteractionHelper.safeEditReply(interaction, {
                        embeds: [errorEmbed('Unknown leveling action.')],
                        flags: MessageFlags.Ephemeral
                    });
            }
        } catch (error) {
            logger.error(`[Leveling] Command error for guild ${guildId}:`, error);
            await InteractionHelper.safeEditReply(interaction, {
                embeds: [errorEmbed(error.userMessage || 'An error occurred while managing leveling. Please try again.', error, { showDetails: true })],
                flags: MessageFlags.Ephemeral
            });
        }
    }
};

async function showStatus(interaction, client, guildId) {
    const leveling = await getLevelingConfig(client, guildId);

    const channelMention = leveling.levelUpChannel
        ? (interaction.guild.channels.cache.get(leveling.levelUpChannel)?.toString() || `\`${leveling.levelUpChannel}\``)
        : (interaction.guild.systemChannel?.toString() || 'No channel configured (uses the server system channel)');

    const xpRange = leveling.xpRange || leveling.xpPerMessage || { min: 15, max: 25 };

    const description = [
        `**Enabled:** ${leveling.enabled ? '✅ Yes' : '❌ No'}`,
        `**XP per message:** ${xpRange.min} - ${xpRange.max}`,
        `**Cooldown:** ${leveling.xpCooldown ?? 20} seconds`,
        `**Level-up notifications:** ${leveling.announceLevelUp ? '✅ On' : '❌ Off'}`,
        `**Notification channel:** ${channelMention}`,
        `**XP multiplier:** ${leveling.xpMultiplier ?? 1}`,
        `**Role rewards:** ${leveling.roleRewards && Object.keys(leveling.roleRewards).length > 0 ? Object.keys(leveling.roleRewards).join(', ') : 'None'}`
    ].join('\n');

    return InteractionHelper.safeEditReply(interaction, {
        embeds: [infoEmbed(description, '📈 Leveling Status')],
        flags: MessageFlags.Ephemeral
    });
}