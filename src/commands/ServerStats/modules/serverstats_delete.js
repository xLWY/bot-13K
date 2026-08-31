import { getColor } from '../../../config/bot.js';
import { PermissionFlagsBits, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { createEmbed } from '../../../utils/embeds.js';
import { getServerCounters, saveServerCounters, getCounterEmoji, getCounterTypeLabel } from '../../../services/serverstatsService.js';
import { logger } from '../../../utils/logger.js';






import { InteractionHelper } from '../../../utils/interactionHelper.js';
export async function handleDelete(interaction, client) {
    const guild = interaction.guild;
    const counterId = interaction.options.getString("counter-id");
    
    // Defer reply immediately to ensure interaction is acknowledged
    try {
        await InteractionHelper.safeDefer(interaction);
    } catch (error) {
        logger.error("Failed to defer reply:", error);
        return;
    }

    // Check permissions after deferring
    if (!interaction.member.permissions.has(PermissionFlagsBits.ManageChannels)) {
        await InteractionHelper.sendErrorNotice(interaction, "Tu as besoin de la permission **Gérer les salons** pour supprimer des compteurs.").catch(logger.error);
        return;
    }

    try {
        const counters = await getServerCounters(client, guild.id);

        if (counters.length === 0) {
            await InteractionHelper.sendErrorNotice(interaction, "Aucun compteur à supprimer.").catch(logger.error);
            return;
        }

        const counterToDelete = counters.find(c => c.id === counterId);
        if (!counterToDelete) {
            await InteractionHelper.sendErrorNotice(interaction, `Aucun compteur avec l'identifiant \`${counterId}\` n'a été trouvé. Utilise \`/serverstats list\` pour voir tous les compteurs.`).catch(logger.error);
            return;
        }

        const channel = guild.channels.cache.get(counterToDelete.channelId);

        const embed = createEmbed({
            title: "⚠️ Supprimer le compteur et le salon",
            description: `Es-tu sûr de vouloir supprimer ce compteur et son salon ?\n\n**ID :** \`${counterToDelete.id}\`\n**Type :** ${getCounterTypeDisplay(counterToDelete.type)}\n**Salon :** ${channel || 'Salon supprimé'}\n\n⚠️ **Le salon sera définitivement supprimé !**`,
            color: getColor('error')
        });

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`counter-delete:confirm:${counterToDelete.id}:${interaction.user.id}`)
                .setLabel("Confirmer la suppression")
                .setStyle(ButtonStyle.Danger),
            new ButtonBuilder()
                .setCustomId(`counter-delete:cancel:${counterToDelete.id}:${interaction.user.id}`)
                .setLabel("Annuler")
                .setStyle(ButtonStyle.Secondary)
        );

        await InteractionHelper.safeEditReply(interaction, { embeds: [embed], components: [row] }).catch(logger.error);

    } catch (error) {
        logger.error("Error in handleDelete:", error);
        await InteractionHelper.sendErrorNotice(interaction, "Une erreur est survenue pendant la récupération des compteurs. Réessaie.").catch(logger.error);
    }
}







export async function performDeletionByCounterId(client, guild, counterId) {
    try {
        const counters = await getServerCounters(client, guild.id);

        const counter = counters.find(c => c.id === counterId);
        if (!counter) {
            return {
                success: false,
                message: `Aucun compteur avec l'identifiant \`${counterId}\` n'a été trouvé.`
            };
        }

        const updatedCounters = counters.filter(c => c.id !== counter.id);

        const saved = await saveServerCounters(client, guild.id, updatedCounters);
        if (!saved) {
            return {
                success: false,
                message: "Échec de la suppression du compteur. Réessaie."
            };
        }

        const channel = guild.channels.cache.get(counter.channelId);
        let channelDeleted = false;

        if (channel) {
            try {
                await channel.delete(`Compteur supprimé - suppression du salon : ${counter.id}`);
                channelDeleted = true;
            } catch (error) {
                logger.error("Error deleting channel:", error);
            }
        }

        let message = `✅ **Compteur supprimé avec succès !**\n\n**ID :** \`${counter.id}\`\n**Type :** ${getCounterTypeDisplay(counter.type)}`;
        
        if (channelDeleted) {
            message += `\n**Salon :** ${channel.name} (supprimé)`;
        } else if (channel) {
            message += `\n**Salon :** ${channel.name} (échec de la suppression)`;
        } else {
            message += `\n**Salon :** déjà supprimé`;
        }

        return {
            success: true,
            message
        };

    } catch (error) {
        logger.error("Error deleting counter:", error);
        return {
            success: false,
            message: "Une erreur est survenue pendant la suppression du compteur. Réessaie."
        };
    }
}






function getCounterTypeDisplay(type) {
    return `${getCounterEmoji(type)} ${getCounterTypeLabel(type)}`;
}



