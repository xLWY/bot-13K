import { Events, ChannelType } from 'discord.js';
import { logger } from '../utils/logger.js';
import {
    getTemporaryChannelInfo,
    unregisterTemporaryChannel,
    getJoinToCreateConfig
} from '../utils/database.js';
import { removeTriggerChannel } from '../services/joinToCreateService.js';
import { logEvent, EVENT_TYPES } from '../services/loggingService.js';

const CHANNEL_TYPE_NAMES = {
    [ChannelType.GuildText]: 'Texte',
    [ChannelType.GuildVoice]: 'Vocal',
    [ChannelType.GuildCategory]: 'Categorie',
    [ChannelType.GuildAnnouncement]: 'Annonces',
    [ChannelType.PublicThread]: 'Fil public',
    [ChannelType.PrivateThread]: 'Fil prive',
    [ChannelType.GuildStageVoice]: 'Scene',
    [ChannelType.GuildForum]: 'Forum',
    [ChannelType.GuildMedia]: 'Media'
};

export default {
    name: Events.ChannelDelete,
    async execute(channel, client) {
        if (!channel?.guild) return;

        const guild = channel.guild;
        const guildId = guild.id;

        // Log avant le nettoyage : les salons temporaires sont supprimes ici
        // et le `return` du bloc tempInfo court-circuiterait le log.
        try {
            await logEvent({
                client,
                guildId,
                eventType: EVENT_TYPES.CHANNEL_DELETE,
                data: {
                    description: `Salon supprime : ${channel.name ?? 'inconnu'}`,
                    channelId: channel.id,
                    fields: [
                        { name: '\u{1F4DD} Nom', value: channel.name ?? '*inconnu*', inline: true },
                        { name: '\u{1F194} ID', value: channel.id, inline: true },
                        {
                            name: '\u{1F4C2} Type',
                            value: CHANNEL_TYPE_NAMES[channel.type] ?? `Type ${channel.type}`,
                            inline: true
                        },
                        ...(channel.parentId
                            ? [{
                                name: '\u{1F4C1} Categorie',
                                value: `<#${channel.parentId}>`,
                                inline: true
                            }]
                            : []),
                        {
                            name: '\u{1F51E} NSFW',
                            value: channel.nsfw ? 'Oui' : 'Non',
                            inline: true
                        }
                    ]
                }
            });
        } catch (error) {
            logger.error(`Error logging channel deletion for channel ${channel.id}:`, error);
        }

        try {
            const tempInfo = await getTemporaryChannelInfo(client, guildId, channel.id);

            if (tempInfo) {
                if (tempInfo.textChannelId && tempInfo.textChannelId !== channel.id) {
                    const textChannel = await guild.channels
                        .fetch(tempInfo.textChannelId)
                        .catch(() => null);
                    if (textChannel) {
                        await textChannel.delete('Salon textuel orphelin - salon vocal supprimé').catch(() => {});
                    }
                }

                await unregisterTemporaryChannel(client, guildId, channel.id);
                logger.info(`Cleaned up temporary channel ${channel.id} removed manually (guild ${guildId})`);
                return;
            }

            const config = await getJoinToCreateConfig(client, guildId);
            if (Array.isArray(config.triggerChannels) && config.triggerChannels.includes(channel.id)) {
                await removeTriggerChannel(client, guildId, channel.id);
                logger.info(`Removed deleted Join to Create trigger channel ${channel.id} (guild ${guildId})`);
            }
        } catch (error) {
            logger.error(`Error in channelDelete cleanup for channel ${channel.id}:`, error);
        }
    }
};