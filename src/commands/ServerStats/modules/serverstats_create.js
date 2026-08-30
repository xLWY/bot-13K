import { PermissionFlagsBits, ChannelType } from 'discord.js';
import { createEmbed, errorEmbed, successEmbed } from '../../../utils/embeds.js';
import { getServerCounters, saveServerCounters, updateCounter, getCounterBaseName, getCounterEmoji, getCounterTypeLabel } from '../../../services/serverstatsService.js';
import { logger } from '../../../utils/logger.js';






import { InteractionHelper } from '../../../utils/interactionHelper.js';
export async function handleCreate(interaction, client) {
    const guild = interaction.guild;
    const type = interaction.options.getString("type");
    const channelType = interaction.options.getString("channel_type");
    const category = interaction.options.getChannel("category");

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
            embeds: [errorEmbed("Tu as besoin de la permission **Gérer les salons** pour créer des compteurs.")]
        }).catch(logger.error);
        return;
    }

    try {
        if (!category || category.type !== ChannelType.GuildCategory) {
            await InteractionHelper.safeEditReply(interaction, {
                embeds: [errorEmbed("Choisis une catégorie valide pour le salon du compteur.")]
            }).catch(logger.error);
            return;
        }

        const targetChannelType = channelType === 'voice' ? ChannelType.GuildVoice : ChannelType.GuildText;
        const baseChannelName = getCounterBaseName(type);

        const counters = await getServerCounters(client, guild.id);

        const duplicateType = counters.find(counter => counter.type === type);

        if (duplicateType) {
            const duplicateChannel = guild.channels.cache.get(duplicateType.channelId);
            await InteractionHelper.safeEditReply(interaction, {
                embeds: [errorEmbed(`Un compteur **${getCounterTypeLabel(type)}** existe déjà pour ce serveur${duplicateChannel ? ` dans ${duplicateChannel}` : ''}. Supprime-le d'abord avant d'en créer un autre.`)]
            }).catch(logger.error);
            return;
        }

        const targetChannel = await guild.channels.create({
            name: `${getCounterEmoji(type)}・${baseChannelName}`,
            type: targetChannelType,
            parent: category.id,
            reason: `Salon de compteur créé par ${interaction.user.tag}`
        });

        if (targetChannelType === ChannelType.GuildVoice) {
            await targetChannel.permissionOverwrites.edit(guild.id, {
                ViewChannel: true,
                Connect: false,
                Speak: null,
                Stream: null
            });
        }

        const existingCounter = counters.find(c => c.channelId === targetChannel.id);
        if (existingCounter) {
            await InteractionHelper.safeEditReply(interaction, {
                embeds: [errorEmbed(`Un compteur existe déjà pour le salon **${targetChannel.name}**. Supprime-le d'abord ou choisis un autre type.`)]
            }).catch(logger.error);
            return;
        }

        const newCounter = {
            id: Date.now().toString(),
            type: type,
            channelId: targetChannel.id,
            guildId: guild.id,
            createdAt: new Date().toISOString(),
            enabled: true
        };

        counters.push(newCounter);

        const saved = await saveServerCounters(client, guild.id, counters);
        if (!saved) {
            await targetChannel.delete('Échec de création du compteur pendant l\'enregistrement').catch(() => null);
            await InteractionHelper.safeEditReply(interaction, {
                embeds: [errorEmbed("Échec de l'enregistrement des données du compteur. Réessaie.")]
            }).catch(logger.error);
            return;
        }

        const updated = await updateCounter(client, guild, newCounter);
        if (!updated) {
            await InteractionHelper.safeEditReply(interaction, {
                embeds: [errorEmbed("Le compteur a été créé mais le nom du salon n'a pas pu être modifié. Il sera actualisé lors du prochain passage automatique.")]
            }).catch(logger.error);
            return;
        }

        await InteractionHelper.safeEditReply(interaction, {
            embeds: [successEmbed(`✅ **Compteur créé avec succès !**\n\n**Type :** ${getCounterTypeLabel(type)}\n**Type de salon :** ${targetChannel.type === ChannelType.GuildVoice ? 'vocal' : 'texte'}\n**Catégorie :** ${category}\n**Salon :** ${targetChannel}\n**Nom du salon :** ${targetChannel.name}\n**Identifiant du compteur :** \`${newCounter.id}\`\n\nLe compteur sera automatiquement actualisé toutes les 15 minutes.\n\nUtilise \`/serverstats list\` pour voir tous les compteurs.`)]
        }).catch(logger.error);

    } catch (error) {
        logger.error("Error creating counter:", error);
        await InteractionHelper.safeEditReply(interaction, {
            embeds: [errorEmbed("Une erreur est survenue pendant la création du compteur. Réessaie.")]
        }).catch(logger.error);
    }
}



