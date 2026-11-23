import { SlashCommandBuilder } from 'discord.js';
import { createEmbed, errorEmbed } from '../../utils/embeds.js';
import { logger } from '../../utils/logger.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { brandFooter, discordTimestamp, formatNumber, guildIconUrl } from '../../ui/kit.js';

const NO_MENTIONS = { parse: [], repliedUser: false };

function cleanName(value) {
    return String(value ?? 'Serveur sans nom').replace(/[`@]/g, '').slice(0, 80);
}

export default {
    data: new SlashCommandBuilder()
        .setName('serverinfo')
        .setDescription('Obtenir des informations détaillées sur le serveur'),

    async execute(interaction) {
        try {
            const deferSuccess = await InteractionHelper.safeDefer(interaction);
            if (!deferSuccess) {
                logger.warn(`ServerInfo interaction defer failed`, {
                    userId: interaction.user.id,
                    guildId: interaction.guildId,
                    commandName: 'serverinfo'
                });
                return;
            }

            const guild = interaction.guild;
            if (!guild) {
                await InteractionHelper.safeEditReply(interaction, {
                    embeds: [errorEmbed('Cette commande est disponible uniquement dans un serveur.')],
                    allowedMentions: NO_MENTIONS,
                });
                return;
            }

            let ownerText = `\`${guild.ownerId}\``;
            try {
                const owner = await guild.fetchOwner();
                if (owner?.user?.tag) ownerText = `${owner.user.tag} (\`${owner.user.id}\`)`;
            } catch (error) {
                logger.debug(`[ServerInfo] propriétaire indisponible pour ${guild.id} : ${error.message}`);
            }

            const embed = createEmbed({
                title: 'Fiche du serveur',
                description: `**${cleanName(guild.name)}**\nID : \`${guild.id}\``,
                color: 'info',
                thumbnail: guildIconUrl(guild, 256),
                fields: [
                    { name: 'Membres', value: formatNumber(guild.memberCount ?? 0), inline: true },
                    { name: 'Salons', value: formatNumber(guild.channels?.cache?.size ?? 0), inline: true },
                    { name: 'Rôles', value: formatNumber(guild.roles?.cache?.size ?? 0), inline: true },
                    {
                        name: 'Boosts',
                        value: `Niveau \`${guild.premiumTier ?? 0}\` • ${formatNumber(guild.premiumSubscriptionCount ?? 0)} boost(s)`,
                        inline: true,
                    },
                    { name: 'Propriétaire', value: ownerText, inline: false },
                    {
                        name: 'Création',
                        value: `${discordTimestamp(guild.createdAt, 'F')} (${discordTimestamp(guild.createdAt)})`,
                        inline: false,
                    },
                ],
                footer: brandFooter('Fiche serveur'),
            });

            await InteractionHelper.safeEditReply(interaction, {
                embeds: [embed],
                allowedMentions: NO_MENTIONS,
            });

            logger.info(`ServerInfo command executed`, {
                userId: interaction.user.id,
                guildId: guild.id,
                guildName: guild.name,
                memberCount: guild.memberCount
            });
        } catch (error) {
            logger.error(`ServerInfo command execution failed`, {
                error: error.message,
                stack: error.stack,
                userId: interaction.user.id,
                guildId: interaction.guildId,
                commandName: 'serverinfo'
            });
            await InteractionHelper.safeEditReply(interaction, {
                embeds: [errorEmbed('Impossible d’afficher les informations du serveur. Réessaie dans un instant.')],
                allowedMentions: NO_MENTIONS,
            });
        }
    },
};
