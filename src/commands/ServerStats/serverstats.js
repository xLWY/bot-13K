import { getColor } from '../../config/bot.js';
import { SlashCommandBuilder, PermissionFlagsBits, MessageFlags, ChannelType } from 'discord.js';
import { createEmbed, errorEmbed, successEmbed } from '../../utils/embeds.js';
import { logger } from '../../utils/logger.js';

import { handleCreate } from './modules/serverstats_create.js';
import { handleList } from './modules/serverstats_list.js';
import { handleUpdate } from './modules/serverstats_update.js';
import { handleDelete } from './modules/serverstats_delete.js';

import { InteractionHelper } from '../../utils/interactionHelper.js';
export default {
    data: new SlashCommandBuilder()
        .setName("serverstats")
        .setDescription("Gérer les statistiques du serveur (membres et salons)")
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
        .addSubcommand(subcommand =>
            subcommand
                .setName("create")
                .setDescription("Créer un nouveau salon de statistiques dans une catégorie")
                .addStringOption(option =>
                    option
                        .setName("type")
                        .setDescription("Type de statistiques à suivre")
                        .setRequired(true)
                        .addChoices(
                            { name: "membres + bots", value: "members" },
                            { name: "membres uniquement", value: "members_only" },
                            { name: "bots uniquement", value: "bots" },
                            { name: "membres en ligne", value: "online" },
                            { name: "membres en vocal", value: "voice" }
                        )
                )
                .addStringOption(option =>
                    option
                        .setName("channel_type")
                        .setDescription("Type de salon à créer pour ce compteur")
                        .setRequired(true)
                        .addChoices(
                            { name: "salon vocal (recommandé)", value: "voice" },
                            { name: "salon texte", value: "text" }
                        )
                )
                .addChannelOption(option =>
                    option
                        .setName("category")
                        .setDescription("La catégorie où le salon de statistiques sera créé")
                        .setRequired(true)
                        .addChannelTypes(ChannelType.GuildCategory)
                )
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName("list")
                .setDescription("Lister tous les compteurs de statistiques du serveur")
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName("update")
                .setDescription("Mettre à jour un compteur de statistiques existant")
                .addStringOption(option =>
                    option
                        .setName("counter-id")
                        .setDescription("L'identifiant du compteur à mettre à jour")
                        .setRequired(true)
                )
                .addStringOption(option =>
                    option
                        .setName("type")
                        .setDescription("Le nouveau type de compteur")
                        .setRequired(false)
                        .addChoices(
                            { name: "membres + bots", value: "members" },
                            { name: "membres uniquement", value: "members_only" },
                            { name: "bots uniquement", value: "bots" },
                            { name: "membres en ligne", value: "online" },
                            { name: "membres en vocal", value: "voice" }
                        )
                )
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName("delete")
                .setDescription("Supprimer un compteur de statistiques existant")
                .addStringOption(option =>
                    option
                        .setName("counter-id")
                        .setDescription("L'identifiant du compteur à supprimer")
                        .setRequired(true)
                )
        ),

    async execute(interaction, guildConfig, client) {
        const subcommand = interaction.options.getSubcommand();

        try {
            switch (subcommand) {
                case "create":
                    await handleCreate(interaction, client);
                    break;
                case "list":
                    await handleList(interaction, client);
                    break;
                case "update":
                    await handleUpdate(interaction, client);
                    break;
                case "delete":
                    await handleDelete(interaction, client);
                    break;
                default:
                    await InteractionHelper.safeReply(interaction, {
                        embeds: [errorEmbed("Sous-commande inconnue.")],
                        flags: MessageFlags.Ephemeral
                    });
            }
        } catch (error) {
            logger.error(`Error in serverstats ${subcommand}:`, error);
            
            const errorEmbedMsg = createEmbed({ 
                title: "❌ Erreur", 
                description: "Une erreur est survenue pendant le traitement de ta demande.",
                color: getColor('error')
            });

            if (!interaction.replied && !interaction.deferred) {
                await InteractionHelper.safeReply(interaction, { embeds: [errorEmbedMsg], flags: MessageFlags.Ephemeral }).catch(logger.error);
            } else {
                await interaction.followUp({ embeds: [errorEmbedMsg], flags: MessageFlags.Ephemeral }).catch(logger.error);
            }
        }
    }
};




