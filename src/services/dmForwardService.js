import { logger } from '../utils/logger.js';
import { createEmbed } from '../utils/embeds.js';
import { getGuildConfig } from './guildConfig.js';

function buildDmEmbed(message) {
    const attachmentUrls = [...(message.attachments?.values?.() || [])].map((a) => a.url);
    const lines = [];
    if (message.content) lines.push(message.content);
    if (attachmentUrls.length) {
        lines.push('');
        lines.push('**Pièces jointes :**');
        lines.push(...attachmentUrls);
    }
    return createEmbed({
        author: {
            name: `${message.author.tag} (${message.author.id})`,
            iconURL: message.author.displayAvatarURL({ extension: 'png', size: 64 })
        },
        description: lines.length ? lines.join('\n').substring(0, 4000) : '*(vidage envoyé)*',
        color: 'info',
        footer: { text: `DM reçu · message ${message.id}` }
    });
}

export async function forwardIncomingDm(client, message) {
    try {
        const embed = buildDmEmbed(message);
        let sent = false;

        for (const [guildId, guild] of client.guilds.cache) {
            try {
                const config = await getGuildConfig(client, guildId);
                const logChannelId = config?.logging?.channelId || config?.logChannelId;
                if (!logChannelId) continue;

                const channel = guild.channels.cache.get(logChannelId);
                if (!channel?.isTextBased?.()) continue;

                await channel.send({ embeds: [embed] });
                sent = true;
            } catch (error) {
                logger.debug(`Failed to forward DM to logs channel of guild ${guildId}:`, error.message);
            }
        }

        if (sent) return;

        const owners = String(process.env.OWNER_IDS || '')
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean);
        if (owners.length > 0) {
            const owner = await client.users.fetch(owners[0]).catch(() => null);
            if (owner) {
                const dm = await owner.createDM().catch(() => null);
                if (dm) await dm.send({ embeds: [embed] }).catch(() => null);
            }
        }
    } catch (error) {
        logger.debug('Failed to forward incoming DM:', error.message);
    }
}