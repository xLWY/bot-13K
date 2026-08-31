import { MessageFlags } from 'discord.js';
import { getJoinToCreateConfig, getTemporaryChannelInfo } from '../../utils/database.js';
import { canControlMember, refreshControlPanel } from '../../services/tempVoiceService.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';

async function resolveChannel(interaction, client, args) {
    const voiceChannelId = args?.[0];
    if (!voiceChannelId) return null;

    const voiceChannel =
        interaction.guild?.channels.cache.get(voiceChannelId) ??
        (await interaction.guild?.channels.fetch(voiceChannelId).catch(() => null));
    if (!voiceChannel) return null;

    const tempInfo = await getTemporaryChannelInfo(client, interaction.guild.id, voiceChannelId);
    if (!tempInfo) return null;

    const config = await getJoinToCreateConfig(client, interaction.guild.id);
    if (!canControlMember(interaction.member, tempInfo, config)) return null;

    return { voiceChannel, tempInfo };
}

async function replyError(interaction, text) {
    await InteractionHelper.sendErrorNotice(interaction, text);
}

const blacklistSelect = {
    name: 'tv_blacklist_select',
    async execute(interaction, client, args) {
        const resolved = await resolveChannel(interaction, client, args);
        if (!resolved) {
            return replyError(interaction, "Tu ne peux plus contrôler ce salon.");
        }

        const targetId = interaction.values?.[0];
        if (!targetId) {
            return replyError(interaction, "Aucun membre sélectionné.");
        }

        if (targetId === interaction.user.id) {
            return replyError(interaction, "Tu ne peux pas te bannir toi-même.");
        }
        if (targetId === client.user.id) {
            return replyError(interaction, "Tu ne peux pas bannir le robot.");
        }

        const { voiceChannel, tempInfo } = resolved;

        try {
            await voiceChannel.permissionOverwrites.edit(targetId, {
                Connect: false,
                Speak: null,
                ViewChannel: null
            });

            const member = voiceChannel.members.get(targetId);
            if (member && member.voice?.channelId) {
                await member.voice.disconnect().catch(() => {});
            }

            await refreshControlPanel(client, interaction.guild, voiceChannel.id, tempInfo);

            await interaction.reply({
                content: `🚫 <@${targetId}> a été **banni** de <#${voiceChannel.id}>. Il ne peut plus le rejoindre.`,
                flags: MessageFlags.Ephemeral
            });
        } catch (error) {
            logger.error(`Failed to blacklist member ${targetId} on channel ${voiceChannel.id}:`, error);
            return replyError(interaction, "Impossible de bannir ce membre. Vérifie les permissions du robot.");
        }
    }
};

const unblacklistSelect = {
    name: 'tv_unblacklist_select',
    async execute(interaction, client, args) {
        const resolved = await resolveChannel(interaction, client, args);
        if (!resolved) {
            return replyError(interaction, "Tu ne peux plus contrôler ce salon.");
        }

        const targetId = interaction.values?.[0];
        if (!targetId) {
            return replyError(interaction, "Aucun membre sélectionné.");
        }

        const { voiceChannel, tempInfo } = resolved;

        try {
            await voiceChannel.permissionOverwrites.edit(targetId, {
                Connect: null
            });

            await refreshControlPanel(client, interaction.guild, voiceChannel.id, tempInfo);

            await interaction.reply({
                content: `✅ <@${targetId}> peut de nouveau rejoindre <#${voiceChannel.id}>.`,
                flags: MessageFlags.Ephemeral
            });
        } catch (error) {
            logger.error(`Failed to unblacklist member ${targetId} on channel ${voiceChannel.id}:`, error);
            return replyError(interaction, "Impossible de débannir ce membre. Vérifie les permissions du robot.");
        }
    }
};

export default [blacklistSelect, unblacklistSelect];