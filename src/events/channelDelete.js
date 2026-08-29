import { logger } from '../utils/logger.js';
import {
    getTemporaryChannelInfo,
    unregisterTemporaryChannel,
    getJoinToCreateConfig
} from '../utils/database.js';
import { removeTriggerChannel } from '../services/joinToCreateService.js';

export default {
    name: 'channelDelete',
    async execute(channel, client) {
        if (!channel?.guild) return;

        const guild = channel.guild;
        const guildId = guild.id;

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