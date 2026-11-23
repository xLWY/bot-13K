import {
    ActionRowBuilder,
    StringSelectMenuBuilder,
    StringSelectMenuOptionBuilder,
    MessageFlags,
    ComponentType,
    ButtonBuilder,
    ButtonStyle
} from 'discord.js';
import { createEmbed } from '../../../utils/embeds.js';
import {
    brandFooter,
    formatNumber,
    progressBar,
} from '../../../ui/kit.js';
import { InteractionHelper } from '../../../utils/interactionHelper.js';
import { logger } from '../../../utils/logger.js';
import { XlwyBotError, ErrorTypes } from '../../../utils/errorHandler.js';
import { 
    getJoinToCreateConfig, 
    updateJoinToCreateConfig,
    removeJoinToCreateTrigger
} from '../../../utils/database.js';

export default {
    async execute(interaction, config, client) {
        try {
            const triggerChannel = interaction.options.getChannel('trigger_channel');
        const guildId = interaction.guild.id;

        const currentConfig = await getJoinToCreateConfig(client, guildId);

        if (!currentConfig.triggerChannels.includes(triggerChannel.id)) {
            throw new XlwyBotError(
                `Channel ${triggerChannel.id} is not a Join to Create trigger`,
                ErrorTypes.VALIDATION,
                `${triggerChannel} n’est pas configuré comme canal déclencheur Join to Create.`
            );
        }

        const bitrateKbps = (currentConfig.channelOptions?.[triggerChannel.id]?.bitrate || currentConfig.bitrate) / 1000;

        const embed = createEmbed({
            title: 'Configuration Join to Create',
            description: `Configurer les réglages de ${triggerChannel}`,
            color: 'info',
            fields: [
                {
                    name: 'Statut',
                    value: `⚙️ ${currentConfig.enabled ? '✅ Activé' : '❌ Désactivé'}`,
                    inline: false
                },
                {
                    name: 'Modèle de nom actuel',
                    value: `\`${currentConfig.channelOptions?.[triggerChannel.id]?.nameTemplate || currentConfig.channelNameTemplate}\``,
                    inline: false
                },
                {
                    name: 'Limite de membres actuelle',
                    value: `${currentConfig.channelOptions?.[triggerChannel.id]?.userLimit || currentConfig.userLimit === 0 ? 'Illimitée' : formatNumber(currentConfig.userLimit) + ' membres'}`,
                    inline: true
                },
                {
                    name: 'Débit binaire actuel',
                    value: `${formatNumber(bitrateKbps)} kbps ${progressBar(bitrateKbps - 8, 376, 8)}`,
                    inline: true
                }
            ],
            footer: brandFooter('Configuration Join to Create • choisis une option ci-dessous'),
        });

        const selectMenu = new StringSelectMenuBuilder()
            .setCustomId(`jointocreate_config_${triggerChannel.id}`)
            .setPlaceholder('Choisis une option de configuration')
            .addOptions(
                new StringSelectMenuOptionBuilder()
                    .setLabel('Modifier le modèle de nom')
                    .setDescription('Modifier le modèle utilisé pour les noms des salons temporaires')
                    .setValue('name_template'),
                new StringSelectMenuOptionBuilder()
                    .setLabel('Modifier la limite de membres')
                    .setDescription('Définir le nombre maximum de membres par salon temporaire')
                    .setValue('user_limit'),
                new StringSelectMenuOptionBuilder()
                    .setLabel('Modifier le débit binaire')
                    .setDescription("Ajuster la qualité audio des salons temporaires")
                    .setValue('bitrate'),
                new StringSelectMenuOptionBuilder()
                    .setLabel('Retirer ce canal déclencheur')
                    .setDescription('Retirer ce canal du système Join to Create')
                    .setValue('remove_trigger'),
                new StringSelectMenuOptionBuilder()
                    .setLabel('Voir les réglages actuels')
                    .setDescription('Afficher tous les détails de la configuration actuelle')
                    .setValue('view_settings')
            );

        const row = new ActionRowBuilder().addComponents(selectMenu);

        await InteractionHelper.safeEditReply(interaction, {
            embeds: [embed],
            components: [row],
            allowedMentions: { parse: [] },
        }).catch(error => {
            logger.error('Failed to edit reply in config_setup:', error);
        });

        const collector = interaction.channel.createMessageComponentCollector({
            componentType: ComponentType.StringSelect,
            filter: (i) => i.user.id === interaction.user.id && i.customId === `jointocreate_config_${triggerChannel.id}`,
            time: 60_000
        });

        collector.on('collect', async (selectInteraction) => {
            await selectInteraction.deferUpdate();

            const selectedOption = selectInteraction.values[0];

            try {
                switch (selectedOption) {
                    case 'name_template':
                        await handleNameTemplateChange(selectInteraction, triggerChannel, currentConfig, client);
                        break;
                    case 'user_limit':
                        await handleUserLimitChange(selectInteraction, triggerChannel, currentConfig, client);
                        break;
                    case 'bitrate':
                        await handleBitrateChange(selectInteraction, triggerChannel, currentConfig, client);
                        break;
                    case 'remove_trigger':
                        await handleRemoveTrigger(selectInteraction, triggerChannel, currentConfig, client);
                        break;
                    case 'view_settings':
                        await handleViewSettings(selectInteraction, triggerChannel, currentConfig, client);
                        break;
                }
            } catch (error) {
                if (error instanceof XlwyBotError) {
                    logger.debug(`Configuration validation error: ${error.message}`, error.context || {});
                } else {
                    logger.error('Unexpected configuration menu error:', error);
                }
                
                const errorMessage = error instanceof XlwyBotError 
                    ? error.userMessage || "Une erreur est survenue pendant le traitement de ta sélection."
                    : "Une erreur est survenue pendant le traitement de ta sélection.";
                    
                await InteractionHelper.sendErrorNotice(selectInteraction, errorMessage);
            }
        });

        collector.on('end', async (collected, reason) => {
            if (reason === 'time') {
                const disabledRow = new ActionRowBuilder().addComponents(
                    selectMenu.setDisabled(true)
                );
                
                await InteractionHelper.safeEditReply(interaction, {
                    components: [disabledRow],
                }).catch(() => {});
            }
        });
            } catch (error) {
            if (error instanceof XlwyBotError) {
                throw error;
            }
            logger.error('Unexpected error in config_setup:', error);
            throw new XlwyBotError(
                `Config setup failed: ${error.message}`,
                ErrorTypes.UNKNOWN,
                "Échec de la configuration du système Join to Create."
            );
        }
    }
};

async function handleNameTemplateChange(interaction, triggerChannel, currentConfig, client) {
    const embed = createEmbed({
        title: 'Configuration du modèle de nom',
        description: 'Saisis le nouveau modèle de nom de salon.',
        color: 'info',
        fields: [
            {
                name: 'Statut',
                value: '📝 Modification en cours',
                inline: false
            },
            {
                name: 'Variables disponibles',
                value: '• `{username}` - Nom d’utilisateur\n• `{display_name}` - Nom affiché\n• `{user_tag}` - Étiquette (User#1234)\n• `{guild_name}` - Nom du serveur',
                inline: false
            },
            {
                name: 'Modèle actuel',
                value: `\`${currentConfig.channelOptions?.[triggerChannel.id]?.nameTemplate || currentConfig.channelNameTemplate}\``,
                inline: false
            }
        ],
        footer: brandFooter('Modèle de nom • saisis le nouveau modèle dans le chat'),
    });

    await interaction.followUp({
        embeds: [embed],
        flags: MessageFlags.Ephemeral,
        allowedMentions: { parse: [] },
    });

    const collector = interaction.channel.createMessageCollector({
        filter: (m) => m.author.id === interaction.user.id,
time: 600_000,
        max: 1
    });

    collector.on('collect', async (message) => {
        try {
            const newTemplate = message.content.trim();
            
            if (!newTemplate || newTemplate.length > 100) {
                await InteractionHelper.sendErrorNotice(interaction, 'Le modèle doit contenir entre 1 et 100 caractères.');
                return;
            }

            const channelOptions = currentConfig.channelOptions || {};
            channelOptions[triggerChannel.id] = {
                ...channelOptions[triggerChannel.id],
                nameTemplate: newTemplate
            };

            await updateJoinToCreateConfig(client, interaction.guild.id, {
                channelOptions: channelOptions
            });

            await interaction.followUp({
                content: `✅ Modèle mis à jour — Le modèle de nom a été changé pour \`${newTemplate}\``,
                flags: MessageFlags.Ephemeral,
                allowedMentions: { parse: [] },
            });

            await message.delete().catch(() => {});
        } catch (error) {
            if (error instanceof XlwyBotError) {
                logger.debug(`Template validation error: ${error.message}`);
            } else {
                logger.error('Template update error:', error);
            }
            
            const errorMessage = error instanceof XlwyBotError
                ? error.userMessage || "Impossible de mettre à jour le modèle de nom."
                : "Impossible de mettre à jour le modèle de nom.";
                
            await InteractionHelper.sendErrorNotice(interaction, errorMessage);
        }
    });

    collector.on('end', (collected, reason) => {
        if (reason === 'time') {
            InteractionHelper.sendErrorNotice(interaction, 'Aucune réponse reçue. Mise à jour du modèle annulée.').catch(() => {});
        }
    });
}

async function handleUserLimitChange(interaction, triggerChannel, currentConfig, client) {
    const embed = createEmbed({
        title: 'Configuration de la limite de membres',
        description: 'Saisis la nouvelle limite de membres (0-99, où 0 = illimité).',
        color: 'info',
        fields: [
            {
                name: 'Statut',
                value: '👥 Modification en cours',
                inline: false
            },
            {
                name: 'Limite actuelle',
                value: `${currentConfig.channelOptions?.[triggerChannel.id]?.userLimit || currentConfig.userLimit === 0 ? 'Illimitée' : formatNumber(currentConfig.userLimit) + ' membres'}`,
                inline: false
            }
        ],
        footer: brandFooter('Limite de membres • saisis la nouvelle limite dans le chat'),
    });

    await interaction.followUp({
        embeds: [embed],
        flags: MessageFlags.Ephemeral,
        allowedMentions: { parse: [] },
    });

    const collector = interaction.channel.createMessageCollector({
        filter: (m) => m.author.id === interaction.user.id && /^\d+$/.test(m.content.trim()),
        time: 600_000,
        max: 1
    });

    collector.on('collect', async (message) => {
        try {
            const newLimit = parseInt(message.content.trim());
            
            if (newLimit < 0 || newLimit > 99) {
                await InteractionHelper.sendErrorNotice(interaction, 'La limite de membres doit être comprise entre 0 et 99.');
                return;
            }

            const channelOptions = currentConfig.channelOptions || {};
            channelOptions[triggerChannel.id] = {
                ...channelOptions[triggerChannel.id],
                userLimit: newLimit
            };

            await updateJoinToCreateConfig(client, interaction.guild.id, {
                channelOptions: channelOptions
            });

            await interaction.followUp({
                content: `✅ Limite mise à jour — La limite a été changée : ${newLimit === 0 ? 'illimitée' : formatNumber(newLimit) + ' membres'}`,
                flags: MessageFlags.Ephemeral,
                allowedMentions: { parse: [] },
            });

            await message.delete().catch(() => {});
        } catch (error) {
            if (error instanceof XlwyBotError) {
                logger.debug(`User limit validation error: ${error.message}`);
            } else {
                logger.error('User limit update error:', error);
            }
            
            const errorMessage = error instanceof XlwyBotError
                ? error.userMessage || "Impossible de mettre à jour la limite de membres."
                : "Impossible de mettre à jour la limite de membres.";
                
            await InteractionHelper.sendErrorNotice(interaction, errorMessage);
        }
    });

    collector.on('end', (collected, reason) => {
        if (reason === 'time') {
            InteractionHelper.sendErrorNotice(interaction, 'Aucune réponse valide reçue. Mise à jour annulée.').catch(() => {});
        }
    });
}

async function handleBitrateChange(interaction, triggerChannel, currentConfig, client) {
    const bitrateKbps = (currentConfig.channelOptions?.[triggerChannel.id]?.bitrate || currentConfig.bitrate) / 1000;

    const embed = createEmbed({
        title: 'Configuration du débit binaire',
        description: 'Saisis le nouveau débit binaire en kbps (8-384).',
        color: 'info',
        fields: [
            {
                name: 'Statut',
                value: '🎵 Modification en cours',
                inline: false
            },
            {
                name: 'Débit actuel',
                value: `${formatNumber(bitrateKbps)} kbps ${progressBar(bitrateKbps - 8, 376, 8)}`,
                inline: false
            },
            {
                name: 'Valeurs courantes',
                value: '• 64 kbps - Qualité normale\n• 96 kbps - Bonne qualité\n• 128 kbps - Haute qualité\n• 256 kbps - Très haute qualité',
                inline: false
            }
        ],
        footer: brandFooter('Débit binaire • saisis le nouveau débit dans le chat'),
    });

    await interaction.followUp({
        embeds: [embed],
        flags: MessageFlags.Ephemeral,
        allowedMentions: { parse: [] },
    });

    const collector = interaction.channel.createMessageCollector({
        filter: (m) => m.author.id === interaction.user.id && /^\d+$/.test(m.content.trim()),
        time: 600_000,
        max: 1
    });

    collector.on('collect', async (message) => {
        try {
            const newBitrate = parseInt(message.content.trim());
            
            if (newBitrate < 8 || newBitrate > 384) {
                await InteractionHelper.sendErrorNotice(interaction, 'Le débit binaire doit être compris entre 8 et 384 kbps.');
                return;
            }

            const channelOptions = currentConfig.channelOptions || {};
            channelOptions[triggerChannel.id] = {
                ...channelOptions[triggerChannel.id],
                bitrate: newBitrate * 1000
            };

            await updateJoinToCreateConfig(client, interaction.guild.id, {
                channelOptions: channelOptions
            });

            await interaction.followUp({
                content: `✅ Débit mis à jour — Débit binaire changé à ${formatNumber(newBitrate)} kbps`,
                flags: MessageFlags.Ephemeral,
                allowedMentions: { parse: [] },
            });

            await message.delete().catch(() => {});
        } catch (error) {
            if (error instanceof XlwyBotError) {
                logger.debug(`Bitrate validation error: ${error.message}`);
            } else {
                logger.error('Bitrate update error:', error);
            }
            
            const errorMessage = error instanceof XlwyBotError
                ? error.userMessage || "Impossible de mettre à jour le débit binaire."
                : "Impossible de mettre à jour le débit binaire.";
                
            await InteractionHelper.sendErrorNotice(interaction, errorMessage);
        }
    });

    collector.on('end', (collected, reason) => {
        if (reason === 'time') {
            InteractionHelper.sendErrorNotice(interaction, 'Aucune réponse valide reçue. Mise à jour annulée.').catch(() => {});
        }
    });
}

async function handleRemoveTrigger(interaction, triggerChannel, currentConfig, client) {
    const embed = createEmbed({
        title: 'Retirer le canal déclencheur',
        description: `Es-tu sûr de vouloir retirer ${triggerChannel} du système Join to Create ?`,
        color: 'warning',
        fields: [
            {
                name: 'Statut',
                value: '⚠️ Confirmation requise',
                inline: false
            }
        ],
        footer: brandFooter('Action sensible • cette action est irréversible'),
    });

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`confirm_remove_${triggerChannel.id}`)
            .setLabel('Supprimer le canal')
            .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
            .setCustomId(`cancel_remove_${triggerChannel.id}`)
            .setLabel('Annuler')
            .setStyle(ButtonStyle.Secondary)
    );

    await interaction.followUp({
        embeds: [embed],
        components: [row],
        flags: MessageFlags.Ephemeral,
        allowedMentions: { parse: [] },
    });

    const collector = interaction.channel.createMessageComponentCollector({
        componentType: ComponentType.Button,
        filter: (i) => i.user.id === interaction.user.id && 
                     (i.customId === `confirm_remove_${triggerChannel.id}` || i.customId === `cancel_remove_${triggerChannel.id}`),
        time: 600_000,
        max: 1
    });

    collector.on('collect', async (buttonInteraction) => {
        await buttonInteraction.deferUpdate();

        if (buttonInteraction.customId === `confirm_remove_${triggerChannel.id}`) {
            try {
                const success = await removeJoinToCreateTrigger(client, interaction.guild.id, triggerChannel.id);
                
                if (success) {
                    await buttonInteraction.followUp({
                        content: `✅ Canal retiré — ${triggerChannel} a été retiré du système Join to Create.`,
                        flags: MessageFlags.Ephemeral,
                        allowedMentions: { parse: [] },
                    });
                } else {
                    await InteractionHelper.sendErrorNotice(buttonInteraction, "Impossible de retirer le canal déclencheur.");
                }
            } catch (error) {
                if (error instanceof XlwyBotError) {
                    logger.debug(`Trigger removal validation error: ${error.message}`);
                } else {
                    logger.error('Remove trigger error:', error);
                }
                
                const errorMessage = error instanceof XlwyBotError
                    ? error.userMessage || "Une erreur est survenue pendant le retrait du canal déclencheur."
                    : "Une erreur est survenue pendant le retrait du canal déclencheur.";
                    
                await InteractionHelper.sendErrorNotice(buttonInteraction, errorMessage);
            }
        } else {
            await buttonInteraction.followUp({
                content: '✅ Annulé — Le retrait du canal a été annulé.',
                flags: MessageFlags.Ephemeral,
                allowedMentions: { parse: [] },
            });
        }
    });

    collector.on('end', (collected, reason) => {
        if (reason === 'time') {
            InteractionHelper.sendErrorNotice(interaction, 'Aucune réponse reçue. Retrait annulé.').catch(() => {});
        }
    });
}

async function handleViewSettings(interaction, triggerChannel, currentConfig, client) {
    const channelConfig = currentConfig.channelOptions?.[triggerChannel.id] || {};
    
    const embed = createEmbed({
        title: 'Réglages actuels',
        description: `Configuration de ${triggerChannel}`,
        color: 'info',
        fields: [
            {
                name: 'Statut',
                value: `📋 ${currentConfig.enabled ? '✅ Activé' : '❌ Désactivé'}`,
                inline: true
            },
            {
                name: 'Canal déclencheur',
                value: `${triggerChannel} (${triggerChannel.id})`,
                inline: false
            },
            {
                name: 'Modèle de nom',
                value: `\`${channelConfig.nameTemplate || currentConfig.channelNameTemplate}\``,
                inline: false
            },
            {
                name: 'Limite de membres',
                value: `${channelConfig.userLimit || currentConfig.userLimit === 0 ? 'Illimitée' : formatNumber(channelConfig.userLimit || currentConfig.userLimit) + ' membres'}`,
                inline: true
            },
            {
                name: 'Débit binaire',
                value: `${formatNumber((channelConfig.bitrate || currentConfig.bitrate) / 1000)} kbps`,
                inline: true
            },
            {
                name: 'Catégorie',
                value: currentConfig.categoryId ? `<#${currentConfig.categoryId}>` : 'Non définie',
                inline: true
            },
            {
                name: 'Salons temporaires actifs',
                value: formatNumber(Object.keys(currentConfig.temporaryChannels || {}).length),
                inline: true
            }
        ],
        footer: brandFooter('Join to Create • réglages actuels'),
    });

    await interaction.followUp({
        embeds: [embed],
        flags: MessageFlags.Ephemeral,
        allowedMentions: { parse: [] },
    });
}




