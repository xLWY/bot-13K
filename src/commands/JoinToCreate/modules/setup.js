import { ChannelType, MessageFlags, PermissionFlagsBits } from 'discord.js';
import { createEmbed } from '../../../utils/embeds.js';
import { brandFooter, formatNumber } from '../../../ui/kit.js';
import { logger } from '../../../utils/logger.js';
import { XlwyBotError, ErrorTypes } from '../../../utils/errorHandler.js';
import { addJoinToCreateTrigger } from '../../../utils/database.js';

import { InteractionHelper } from '../../../utils/interactionHelper.js';
export default {
    async execute(interaction, config, client) {
        const category = interaction.options.getChannel('category');
        const nameTemplate = interaction.options.getString('channel_name') || "{username} · Salon";
        const userLimit = interaction.options.getInteger('user_limit') || 0;
        const bitrate = interaction.options.getInteger('bitrate') || 64;
        const guildId = interaction.guild.id;

        try {
            const triggerChannel = await interaction.guild.channels.create({
                name: '➕ Créer ton salon',
                type: ChannelType.GuildVoice,
                parent: category?.id,
                userLimit: userLimit,
                bitrate: bitrate * 1000,
                permissionOverwrites: [
                    {
                        id: interaction.guild.id,
                        allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect],
                    },
                ],
            });

            await addJoinToCreateTrigger(client, guildId, triggerChannel.id, {
                nameTemplate: nameTemplate,
                userLimit: userLimit,
                bitrate: bitrate * 1000,
                categoryId: category?.id
            });

            const embed = createEmbed({
                title: 'Configuration terminée',
                description: `Le canal déclencheur ${triggerChannel} est prêt. Lorsqu’un membre le rejoint, un salon vocal temporaire est créé pour lui.`,
                fields: [
                    { name: 'Modèle de nom', value: `\`${nameTemplate}\``, inline: false },
                    { name: 'Limite de membres', value: userLimit === 0 ? 'Illimitée' : formatNumber(userLimit), inline: true },
                    { name: 'Débit binaire', value: `${formatNumber(bitrate)} kbps`, inline: true },
                    { name: 'Catégorie', value: category ? `${category.name}` : 'Racine', inline: true },
                ],
                footer: brandFooter('Join to Create'),
            });
            const payload = { embeds: [embed], allowedMentions: { parse: [] } };

            try {
                if (interaction.deferred) {
                    await InteractionHelper.safeEditReply(interaction, payload);
                } else {
                    await InteractionHelper.safeReply(interaction, { ...payload, flags: MessageFlags.Ephemeral });
                }
            } catch (responseError) {
                logger.error('Error responding to interaction:', responseError);

                try {
                    if (!interaction.replied) {
                        await InteractionHelper.safeReply(interaction, { ...payload, flags: MessageFlags.Ephemeral });
                    }
                } catch (e) {
                    logger.error('All response attempts failed:', e);
                }
            }
        } catch (error) {
            if (error instanceof XlwyBotError) {
                throw error;
            }
            logger.error('Error in JoinToCreate setup:', error);
            throw new XlwyBotError(
                `Setup failed: ${error.message}`,
                ErrorTypes.DISCORD_API,
                "Échec de la configuration du système Join to Create."
            );
        }
    }
};



