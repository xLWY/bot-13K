import { PermissionFlagsBits } from 'discord.js';
import { createEmbed, errorEmbed, successEmbed } from '../../../utils/embeds.js';
import { getServerCounters, saveServerCounters, updateCounter, getCounterEmoji, getCounterTypeLabel } from '../../../services/serverstatsService.js';
import { logger } from '../../../utils/logger.js';






import { InteractionHelper } from '../../../utils/interactionHelper.js';
export async function handleUpdate(interaction, client) {
    const guild = interaction.guild;
    const counterId = interaction.options.getString("counter-id");
    const newType = interaction.options.getString("type");

    // Defer reply immediately to ensure interaction is acknowledged
    try {
        await InteractionHelper.safeDefer(interaction);
    } catch (error) {
        logger.error("Failed to defer reply:", error);
        return;
    }

    // Check permissions after deferring
    if (!interaction.member.permissions.has(PermissionFlagsBits.ManageChannels)) {
        await InteractionHelper.safeEditReply(interaction, { 
            embeds: [errorEmbed("Tu as besoin de la permission **Gérer les salons** pour mettre à jour des compteurs.")]
        }).catch(logger.error);
        return;
    }

    if (!newType) {
        await InteractionHelper.safeEditReply(interaction, {
            embeds: [errorEmbed("Tu dois indiquer un nouveau type de compteur à mettre à jour.")]
        }).catch(logger.error);
        return;
    }

    try {
        const counters = await getServerCounters(client, guild.id);

        const counterIndex = counters.findIndex(c => c.id === counterId);
        if (counterIndex === -1) {
            await InteractionHelper.safeEditReply(interaction, {
                embeds: [errorEmbed(`Aucun compteur avec l'identifiant \`${counterId}\` n'a été trouvé. Utilise \`/serverstats list\` pour voir tous les compteurs.`)]
            }).catch(logger.error);
            return;
        }

        const counter = counters[counterIndex];
        const oldChannel = guild.channels.cache.get(counter.channelId);

        if (!oldChannel) {
            await InteractionHelper.safeEditReply(interaction, {
                embeds: [errorEmbed("Le salon de ce compteur n'existe plus. Tu ne peux pas mettre à jour un compteur dont le salon a été supprimé.")]
            }).catch(logger.error);
            return;
        }

        if (newType !== counter.type) {
            const existingTypeCounter = counters.find(c => c.type === newType && c.id !== counter.id);
            if (existingTypeCounter) {
                const existingChannel = guild.channels.cache.get(existingTypeCounter.channelId);
                await InteractionHelper.safeEditReply(interaction, {
                    embeds: [errorEmbed(`Un compteur **${getCounterTypeLabel(newType)}** existe déjà pour ce serveur${existingChannel ? ` dans ${existingChannel}` : ''}. Supprime-le d'abord avant de réutiliser ce type.`)]
                }).catch(logger.error);
                return;
            }
        }

        const oldType = counter.type;

        counter.type = newType;
        counter.updatedAt = new Date().toISOString();

        const saved = await saveServerCounters(client, guild.id, counters);
        if (!saved) {
            await InteractionHelper.safeEditReply(interaction, {
                embeds: [errorEmbed("Échec de l'enregistrement des données du compteur. Réessaie.")]
            }).catch(logger.error);
            return;
        }

        const updatedCounter = counters[counterIndex];
        const updated = await updateCounter(client, guild, updatedCounter);
        if (!updated) {
            await InteractionHelper.safeEditReply(interaction, {
                embeds: [errorEmbed("Le compteur a été mis à jour mais le nom du salon n'a pas pu être modifié. Il sera actualisé lors du prochain passage automatique.")]
            }).catch(logger.error);
            return;
        }

        const finalChannel = guild.channels.cache.get(updatedCounter.channelId);

        await InteractionHelper.safeEditReply(interaction, {
            embeds: [successEmbed(`✅ **Compteur mis à jour avec succès !**\n\n**Identifiant du compteur :** \`${counterId}\`\n**Type changé :** ${getCounterEmoji(oldType)} ${getCounterTypeLabel(oldType)} → ${getCounterEmoji(newType)} ${getCounterTypeLabel(newType)}\n\n**Réglages actuels :**\n**Type :** ${getCounterEmoji(updatedCounter.type)} ${getCounterTypeLabel(updatedCounter.type)}\n**Salon :** ${finalChannel}\n**Nom du salon :** ${finalChannel.name}\n\nLe compteur sera automatiquement actualisé toutes les 15 minutes.`)]
        }).catch(logger.error);

    } catch (error) {
        logger.error("Error updating counter:", error);
        await InteractionHelper.safeEditReply(interaction, {
            embeds: [errorEmbed("Une erreur est survenue pendant la mise à jour du compteur. Réessaie.")]
        }).catch(logger.error);
    }
}



