import { Events, EmbedBuilder, PermissionFlagsBits } from 'discord.js';
import { getColor } from '../config/bot.js';
import { getUserApplications, deleteApplication, getWelcomeConfig } from '../utils/database.js';
import { formatWelcomeMessageAsync } from '../utils/welcome.js';
import { logEvent, EVENT_TYPES } from '../services/loggingService.js';
import { getServerCounters, updateCounter } from '../services/serverstatsService.js';
import { getGuildBirthdays, deleteBirthday } from '../utils/database.js';
import { deleteUserLevelData } from '../services/leveling.js';
import { logger } from '../utils/logger.js';

export default {
  name: Events.GuildMemberRemove,
  once: false,
  
  async execute(member) {
    try {
        const { guild, user } = member;

        try {
            const welcomeConfig = await getWelcomeConfig(member.client, guild.id);
            const goodbyeChannelId = welcomeConfig?.goodbyeChannelId;

            if (welcomeConfig?.goodbyeEnabled && goodbyeChannelId) {
                let channel = guild.channels.cache.get(goodbyeChannelId);
                if (!channel) {
                    channel = await guild.channels.fetch(goodbyeChannelId).catch(() => null);
                }

                if (channel?.isTextBased?.()) {
                    const me = guild.members.me;
                    const permissions = me ? channel.permissionsFor(me) : null;

                    if (permissions?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages])) {
                        const formatData = { user, guild, member, config: welcomeConfig };
                        const goodbyeMessage = await formatWelcomeMessageAsync(
                            welcomeConfig.leaveMessage || welcomeConfig.leaveEmbed?.description || '{user.tag} a quitté le serveur.',
                            formatData,
                        );
                        const embedTitle = await formatWelcomeMessageAsync(
                            welcomeConfig.leaveEmbed?.title || '👋 Au revoir',
                            formatData,
                        );
                        const embedFooter = welcomeConfig.leaveEmbed?.footer
                            ? await formatWelcomeMessageAsync(welcomeConfig.leaveEmbed.footer, formatData)
                            : `Au revoir de la part de ${guild.name} !`;

                        const canEmbed = permissions.has(PermissionFlagsBits.EmbedLinks);
                        const allowedMentions = welcomeConfig.goodbyePing
                            ? { users: [user.id] }
                            : { parse: [] };
                        const mention = welcomeConfig.goodbyePing ? `<@${user.id}>` : null;

                        if (!canEmbed) {
                            const content = mention && !goodbyeMessage.includes(`<@${user.id}>`)
                                ? `${mention} ${goodbyeMessage}`
                                : goodbyeMessage;

                            await channel.send({ content, allowedMentions });
                        } else {
                            const embed = new EmbedBuilder()
                                .setTitle(embedTitle)
                                .setDescription(goodbyeMessage)
                                .setColor(welcomeConfig.leaveEmbed?.color || getColor('error'))
                                .setThumbnail(user.displayAvatarURL())
                                .addFields(
                                    { name: '👤 Membre', value: `${user.tag} (${user.id})`, inline: true },
                                    { name: '👥 Membres', value: guild.memberCount.toString(), inline: true },
                                )
                                .setTimestamp()
                                .setFooter({ text: embedFooter });

                            const leaveImage = (typeof welcomeConfig.leaveEmbed?.image === 'string' && welcomeConfig.leaveEmbed.image)
                                ? welcomeConfig.leaveEmbed.image
                                : welcomeConfig.leaveEmbed?.image?.url
                                    || (typeof welcomeConfig.leaveImage === 'string' ? welcomeConfig.leaveImage : null);

                            if (leaveImage) {
                                embed.setImage(leaveImage);
                            }

                            await channel.send({
                                content: mention,
                                allowedMentions,
                                embeds: [embed],
                            });
                        }
                    }
                }
            }
        } catch (error) {
            logger.debug('Error sending goodbye message:', error);
        }
        
        try {
            await logEvent({
                client: member.client,
                guildId: guild.id,
                eventType: EVENT_TYPES.MEMBER_LEAVE,
                data: {
                    description: `<@${user.id}> a quitté le serveur`,
                    userId: user.id,
                    fields: [
                        {
                            name: '👤 Membre',
                            value: `<@${user.id}>`,
                            inline: true
                        },
                        {
                            name: '👥 Membres',
                            value: guild.memberCount.toString(),
                            inline: true
                        },
                        {
                            name: '📅 A rejoint',
                            value: `<t:${Math.floor((member.joinedTimestamp || 0) / 1000)}:R>`,
                            inline: true
                        }
                    ]
                }
            });
        } catch (error) {
            logger.debug('Error logging member leave:', error);
        }
        
        
        try {
            const counters = await getServerCounters(member.client, guild.id);
            for (const counter of counters) {
                if (counter && counter.type && counter.channelId && counter.enabled !== false) {
                    await updateCounter(member.client, guild, counter);
                }
            }
        } catch (error) {
            logger.debug('Error updating counters on member leave:', error);
        }
        
        // Backup and remove birthday data when a member leaves
        try {
            const birthdays = await getGuildBirthdays(member.client, guild.id);
            if (birthdays[user.id]) {
                const backupKey = `guild:${guild.id}:birthdays:left`;
                const backup = (await member.client.db.get(backupKey)) || {};
                backup[user.id] = birthdays[user.id];
                await member.client.db.set(backupKey, backup);
                await deleteBirthday(member.client, guild.id, user.id);
                logger.debug(`Birthday backed up and removed for user ${user.id} in guild ${guild.id}`);
            }
        } catch (error) {
            logger.debug('Error handling birthday on member leave:', error);
        }
        
        // Remove all pending applications when a member leaves
        try {
            const userApplications = await getUserApplications(member.client, guild.id, user.id);
            if (userApplications && userApplications.length > 0) {
                for (const app of userApplications) {
                    await deleteApplication(member.client, guild.id, app.id, user.id);
                }
                logger.debug(`Removed ${userApplications.length} applications for user ${user.id} in guild ${guild.id}`);
            }
        } catch (error) {
            logger.debug('Error handling applications on member leave:', error);
        }

        // Remove leveling data when a member leaves
        try {
            await deleteUserLevelData(member.client, guild.id, user.id);
            logger.debug(`Removed leveling data for user ${user.id} in guild ${guild.id}`);
        } catch (error) {
            logger.debug('Error handling leveling data on member leave:', error);
        }
        
    } catch (error) {
        logger.error('Error in guildMemberRemove event:', error);
    }
  }
};



