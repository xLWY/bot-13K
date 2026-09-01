import { Events, EmbedBuilder, PermissionFlagsBits } from 'discord.js';
import { getColor } from '../config/bot.js';
import { getGuildConfig } from '../services/guildConfig.js';
import { getWelcomeConfig } from '../utils/database.js';
import { formatWelcomeMessage } from '../utils/welcome.js';
import { logEvent, EVENT_TYPES } from '../services/loggingService.js';
import { getServerCounters, updateCounter } from '../services/serverstatsService.js';
import { setBirthday as dbSetBirthday } from '../utils/database.js';
import { logger } from '../utils/logger.js';

const WELCOME_PING_DELETE_MS = 3000;
const WELCOME_ARRIVAL_DELETE_MS = 600_000;

export default {
  name: Events.GuildMemberAdd,
  once: false,
  
  async execute(member) {
    try {
        const { guild, user } = member;
        
        const config = await getGuildConfig(member.client, guild.id);
        
        const welcomeConfig = await getWelcomeConfig(member.client, guild.id);
        
        const welcomeChannelId = welcomeConfig?.channelId;

        if (welcomeConfig?.enabled && welcomeChannelId) {
            let channel = guild.channels.cache.get(welcomeChannelId);
            if (!channel) {
                try { channel = await guild.channels.fetch(welcomeChannelId).catch(() => null); } catch (_) { channel = null; }
            }

            if (!channel?.isTextBased?.()) {
                if (welcomeConfig.enabled) {
                    await notifyBrokenWelcomeChannel(member.client, guild, 'bienvenue', welcomeChannelId);
                }
            } else {
                const me = guild.members.me;
                const permissions = me ? channel.permissionsFor(me) : null;
                if (!permissions?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages])) {
                    return;
                }

                const formatData = { user, guild, member };
                const welcomeMessage = formatWelcomeMessage(
                    welcomeConfig.welcomeMessage || welcomeConfig.welcomeEmbed?.description || 'Welcome {user} to {server}!',
                    formatData
                );

                const messageContent = welcomeConfig.welcomePing ? user.toString() : null;

                const embedTitle = formatWelcomeMessage(
                    welcomeConfig.welcomeEmbed?.title || '🎉 Bienvenue !',
                    formatData
                );

                const canEmbed = permissions.has(PermissionFlagsBits.EmbedLinks);

                if (!canEmbed) {
                    await channel.send({
                        content: messageContent || welcomeMessage
                    });
                } else {
                    const embed = new EmbedBuilder()
                        .setColor(welcomeConfig.welcomeEmbed?.color || getColor('success'))
                        .setTitle(embedTitle)
                        .setDescription(welcomeMessage)
                        .setThumbnail(user.displayAvatarURL())
                        .setTimestamp();

                    if (typeof welcomeConfig.welcomeImage === 'string') {
                        embed.setImage(welcomeConfig.welcomeImage);
                    } else if (welcomeConfig.welcomeEmbed?.image?.url) {
                        embed.setImage(welcomeConfig.welcomeEmbed.image.url);
                    }
                    
                    await channel.send({ 
                        content: messageContent,
                        embeds: [embed] 
                    });
                }
            }
        }
        
        if (welcomeConfig?.enabled && welcomeConfig.pingChannelId) {
            let pingChannel = guild.channels.cache.get(welcomeConfig.pingChannelId);
            if (!pingChannel) {
                try { pingChannel = await guild.channels.fetch(welcomeConfig.pingChannelId).catch(() => null); } catch (_) { pingChannel = null; }
            }
            if (pingChannel?.isTextBased?.()) {
                const pingMe = guild.members.me;
                const pingPerms = pingMe ? pingChannel.permissionsFor(pingMe) : null;
                if (pingPerms?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages])) {
                    try {
                        const pingMessage = await pingChannel.send(user.toString());
                        setTimeout(async () => {
                            try { await pingMessage.delete(); } catch (_) {
                                // already deleted
                            }
                        }, WELCOME_PING_DELETE_MS).unref?.();
                    } catch (error) {
                        logger.debug(`[Welcome] Could not send welcome ping in ${pingChannel?.name}:`, error.message);
                    }
                }
            } else {
                await notifyBrokenWelcomeChannel(member.client, guild, 'salon de ping', welcomeConfig.pingChannelId);
            }
        }
        
        if (welcomeConfig?.enabled && welcomeConfig.arrivalChannelId) {
            let arrivalChannel = guild.channels.cache.get(welcomeConfig.arrivalChannelId);
            if (!arrivalChannel) {
                try { arrivalChannel = await guild.channels.fetch(welcomeConfig.arrivalChannelId).catch(() => null); } catch (_) { arrivalChannel = null; }
            }
            if (arrivalChannel?.isTextBased?.()) {
                const arrivalMe = guild.members.me;
                const arrivalPerms = arrivalMe ? arrivalChannel.permissionsFor(arrivalMe) : null;
                if (arrivalPerms?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages])) {
                    try {
                        const arrivalMsg = await arrivalChannel.send(
                            formatWelcomeMessage(
                                welcomeConfig.arrivalMessage || "**{user}** vient d'arriver, dites-lui bonjour ! 👋",
                                { user, guild, member }
                            )
                        );
                        setTimeout(async () => {
                            try { await arrivalMsg.delete(); } catch (_) {
                                // already deleted
                            }
                        }, WELCOME_ARRIVAL_DELETE_MS).unref?.();
                    } catch (error) {
                        logger.debug(`[Welcome] Could not send welcome arrival in ${arrivalChannel?.name}:`, error.message);
                    }
                }
            } else {
                await notifyBrokenWelcomeChannel(member.client, guild, "salon d'arrivée", welcomeConfig.arrivalChannelId);
            }
        }
        
        if (welcomeConfig?.roleIds && welcomeConfig.roleIds.length > 0) {
            const delay = welcomeConfig.autoRoleDelay || 0;
            const roleIdsToAssign = [...welcomeConfig.roleIds];

            const applyRoles = async () => {
                for (const roleId of roleIdsToAssign) {
                    const role = guild.roles.cache.get(roleId);
                    if (role) {
                        await assignRoleSafely(member, role);
                    }
                }
            };

            if (delay > 0) {
                const timeout = setTimeout(applyRoles, delay * 1000);
                if (typeof timeout.unref === 'function') {
                    timeout.unref();
                }
            } else {
                await applyRoles();
            }
        }
        
        try {
            await logEvent({
                client: member.client,
                guildId: guild.id,
                eventType: EVENT_TYPES.MEMBER_JOIN,
                data: {
                    description: `${user.tag} a rejoint le serveur`,
                    userId: user.id,
                    fields: [
                        {
                            name: '👤 Member',
                            value: `${user.tag} (${user.id})`,
                            inline: true
                        },
                        {
                            name: '👥 Member Count',
                            value: guild.memberCount.toString(),
                            inline: true
                        },
                        {
                            name: '📅 Account Created',
                            value: `<t:${Math.floor(user.createdTimestamp / 1000)}:R>`,
                            inline: true
                        }
                    ]
                }
            });
        } catch (error) {
            logger.debug('Error logging member join:', error);
        }
        
        
        try {
            const counters = await getServerCounters(member.client, guild.id);
            for (const counter of counters) {
                if (counter && counter.type && counter.channelId && counter.enabled !== false) {
                    await updateCounter(member.client, guild, counter);
                }
            }
        } catch (error) {
            logger.debug('Error updating counters on member join:', error);
        }
        
        // Restore birthday data if the member previously left
        try {
            const backupKey = `guild:${guild.id}:birthdays:left`;
            const backup = (await member.client.db.get(backupKey)) || {};
            if (backup[user.id]) {
                const { month, day } = backup[user.id];
                await dbSetBirthday(member.client, guild.id, user.id, month, day);
                delete backup[user.id];
                await member.client.db.set(backupKey, backup);
                logger.debug(`Birthday restored for user ${user.id} in guild ${guild.id}`);
            }
        } catch (error) {
            logger.debug('Error restoring birthday on member join:', error);
        }
        
    } catch (error) {
        logger.error('Error in guildMemberAdd event:', error);
    }
  }
};

async function assignRoleSafely(member, role) {
    try {
        await member.roles.add(role);
    } catch (error) {
        logger.warn(`Failed to assign role ${role.id} to member ${member.id}:`, error);
    }
}

const brokenWelcomeAlerts = new Map();
const BROKEN_WELCOME_COOLDOWN_MS = 30 * 60 * 1000;

async function notifyBrokenWelcomeChannel(client, guild, typeLabel, missingChannelId) {
    const guildId = guild.id;
    const now = Date.now();
    const lastAlert = brokenWelcomeAlerts.get(guildId) || 0;

    if (now - lastAlert < BROKEN_WELCOME_COOLDOWN_MS) {
        return;
    }
    brokenWelcomeAlerts.set(guildId, now);

    const label = typeLabel === 'bienvenue' ? 'canal de bienvenue' : 'salon de ping';
    const description = `Le **${label}** de bienvenue configuré n'existe plus ou n'est plus accessible.\n\n**Ancien ID :** \`${missingChannelId || 'inconnu'}\`\n\nReconfigure-le avec **\`/welcome setup\`** ou **\`/welcome dashboard\`**.`;

    try {
        await logEvent({
            client,
            guildId,
            eventType: EVENT_TYPES.CONFIGURATION_CHANGE,
            data: {
                title: '⚠️ Canal de bienvenue introuvable',
                description,
                fields: [
                    { name: 'Serveur', value: guild.name, inline: true },
                    { name: 'Type', value: typeLabel === 'bienvenue' ? 'Message de bienvenue' : 'Salon de ping', inline: true }
                ]
            }
        });
    } catch (error) {
        logger.debug('Could not log broken welcome channel:', error.message);
    }

    try {
        const owner = await guild.fetchOwner().catch(() => null);
        if (owner) {
            await owner.send({
                embeds: [new EmbedBuilder()
                    .setColor(getColor('error'))
                    .setTitle('⚠️ Canal de bienvenue introuvable')
                    .setDescription(description)
                    .addFields(
                        { name: 'Serveur', value: guild.name, inline: true },
                        { name: 'Type', value: typeLabel === 'bienvenue' ? 'Message de bienvenue' : 'Salon de ping', inline: true }
                    )
                    .setTimestamp()]
            }).catch(() => {});
        }
    } catch (error) {
        logger.debug('Could not DM owner about broken welcome channel:', error.message);
    }
}



