import { getColor } from '../../../config/bot.js';
import {
    ActionRowBuilder,
    StringSelectMenuBuilder,
    StringSelectMenuOptionBuilder,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    ChannelSelectMenuBuilder,
    ButtonBuilder,
    ButtonStyle,
    ChannelType,
    MessageFlags,
    ComponentType,
    EmbedBuilder,
    LabelBuilder,
    FileUploadBuilder,
    TextDisplayBuilder,
} from 'discord.js';
import { InteractionHelper } from '../../../utils/interactionHelper.js';
import { successEmbed, errorEmbed } from '../../../utils/embeds.js';
import { logger } from '../../../utils/logger.js';
import { TitanBotError, ErrorTypes } from '../../../utils/errorHandler.js';
import { getWelcomeConfig, saveWelcomeConfig } from '../../../utils/database.js';
import { botHasPermission } from '../../../utils/permissionGuard.js';

// ─── Embed & Menu Builders ────────────────────────────────────────────────────

function buildDashboardEmbed(cfg, guild) {
    const welcomeChannel = cfg.channelId ? `<#${cfg.channelId}>` : '`Non défini`';
    const goodbyeChannel = cfg.goodbyeChannelId ? `<#${cfg.goodbyeChannelId}>` : '`Non défini`';

    const rawWelcome = cfg.welcomeMessage || 'Bienvenue {user} sur {server} !';
    const rawGoodbye = cfg.leaveMessage || '{user.tag} a quitté le serveur.';
    const welcomePreview = `\`${rawWelcome.length > 55 ? rawWelcome.substring(0, 55) + '…' : rawWelcome}\``;
    const goodbyePreview = `\`${rawGoodbye.length > 55 ? rawGoodbye.substring(0, 55) + '…' : rawGoodbye}\``;

    return new EmbedBuilder()
        .setTitle('👋 Tableau de bord des messages de bienvenue')
        .setDescription(
            `Gère les paramètres de bienvenue et d\'au revoir pour **${guild.name}**.\nUtilise les interrupteurs pour activer/désactiver chaque côté, puis sélectionne une option à modifier.`,
        )
        .setColor(getColor('info'))
        .addFields(
            { name: '🟢 Canal de bienvenue', value: welcomeChannel, inline: true },
            { name: '⚙️ Statut de bienvenue', value: cfg.enabled ? '✅ Activé' : '❌ Désactivé', inline: true },
            { name: '🔔 Mention de bienvenue', value: cfg.welcomePing ? '✅ Activée' : '❌ Désactivée', inline: true },
            { name: '🔴 Canal d\'au revoir', value: goodbyeChannel, inline: true },
            { name: '⚙️ Statut d\'au revoir', value: cfg.goodbyeEnabled ? '✅ Activé' : '❌ Désactivé', inline: true },
            { name: '🔔 Mention d\'au revoir', value: cfg.goodbyePing ? '✅ Activée' : '❌ Désactivée', inline: true },
            { name: '💬 Message de bienvenue', value: welcomePreview, inline: false },
            { name: '💬 Message d\'au revoir', value: goodbyePreview, inline: false },
        )
        .setFooter({ text: 'Le tableau de bord se ferme après 10 minutes d\'inactivité' })
        .setTimestamp();
}

function buildSelectMenu(guildId) {
    return new StringSelectMenuBuilder()
        .setCustomId(`greet_cfg_${guildId}`)
        .setPlaceholder('Sélectionne un paramètre à configurer...')
        .addOptions(
            new StringSelectMenuOptionBuilder()
                .setLabel('Canal de bienvenue')
                .setDescription('Définir le canal où les messages de bienvenue sont envoyés')
                .setValue('welcome_channel')
                .setEmoji('🟢'),
            new StringSelectMenuOptionBuilder()
                .setLabel('Message de bienvenue')
                .setDescription('Modifier le texte affiché à l\'arrivée d\'un membre')
                .setValue('welcome_message')
                .setEmoji('💬'),
            new StringSelectMenuOptionBuilder()
                .setLabel('Image de bienvenue')
                .setDescription('Définir l\'image pour les messages de bienvenue')
                .setValue('welcome_image')
                .setEmoji('🖼️'),
            new StringSelectMenuOptionBuilder()
                .setLabel('Canal d\'au revoir')
                .setDescription('Définir le canal où les messages d\'au revoir sont envoyés')
                .setValue('goodbye_channel')
                .setEmoji('🔴'),
            new StringSelectMenuOptionBuilder()
                .setLabel('Message d\'au revoir')
                .setDescription('Modifier le texte affiché au départ d\'un membre')
                .setValue('goodbye_message')
                .setEmoji('💬'),
            new StringSelectMenuOptionBuilder()
                .setLabel('Image d\'au revoir')
                .setDescription('Définir l\'image pour les messages d\'au revoir')
                .setValue('goodbye_image')
                .setEmoji('🖼️'),
        );
}

function buildButtonRow(cfg, guildId, disabled = false) {
    const welcomeOn = cfg.enabled === true;
    const goodbyeOn = cfg.goodbyeEnabled === true;
    const welcomePingOn = cfg.welcomePing === true;
    const goodbyePingOn = cfg.goodbyePing === true;
    
    return [
        new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`greet_cfg_toggle_welcome_${guildId}`)
                .setLabel('Bienvenue')
                .setStyle(welcomeOn ? ButtonStyle.Success : ButtonStyle.Danger)
                .setEmoji('🟢')
                .setDisabled(disabled),
            new ButtonBuilder()
                .setCustomId(`greet_cfg_toggle_goodbye_${guildId}`)
                .setLabel('Au revoir')
                .setStyle(goodbyeOn ? ButtonStyle.Success : ButtonStyle.Danger)
                .setEmoji('🔴')
                .setDisabled(disabled),
        ),
        new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`greet_cfg_ping_welcome_${guildId}`)
                .setLabel('Mention bienvenue')
                .setStyle(welcomePingOn ? ButtonStyle.Primary : ButtonStyle.Secondary)
                .setEmoji('🔔')
                .setDisabled(disabled),
            new ButtonBuilder()
                .setCustomId(`greet_cfg_ping_goodbye_${guildId}`)
                .setLabel('Mention au revoir')
                .setStyle(goodbyePingOn ? ButtonStyle.Primary : ButtonStyle.Secondary)
                .setEmoji('🔔')
                .setDisabled(disabled),
        ),
    ];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function refreshDashboard(rootInteraction, cfg, guildId) {
    try {
        const selectMenu = buildSelectMenu(guildId);
        await InteractionHelper.safeEditReply(rootInteraction, {
            embeds: [buildDashboardEmbed(cfg, rootInteraction.guild)],
            components: [
                ...buildButtonRow(cfg, guildId),
                new ActionRowBuilder().addComponents(selectMenu),
            ],
            flags: MessageFlags.Ephemeral,
        });
    } catch (error) {
        logger.debug('Could not refresh greet dashboard (interaction may have expired):', error.message);
    }
}

// ─── Main Export ──────────────────────────────────────────────────────────────

export default {
    async execute(interaction, config, client) {
        try {
            const guildId = interaction.guild.id;
            const cfg = await getWelcomeConfig(client, guildId);

            if (!cfg.channelId && !cfg.goodbyeChannelId) {
                throw new TitanBotError(
                    'Greet system not configured',
                    ErrorTypes.CONFIGURATION,
                    'Ni la bienvenue ni l\'au revoir n\'a encore été configuré. Exécute `/welcome setup` ou `/goodbye setup` d\'abord.',
                );
            }

            await InteractionHelper.safeDefer(interaction, { flags: MessageFlags.Ephemeral });

            const selectMenu = buildSelectMenu(guildId);

            await InteractionHelper.safeEditReply(interaction, {
                embeds: [buildDashboardEmbed(cfg, interaction.guild)],
                components: [
                    ...buildButtonRow(cfg, guildId),
                    new ActionRowBuilder().addComponents(selectMenu),
                ],
                flags: MessageFlags.Ephemeral,
            });

            // ── Select collector ──────────────────────────────────────────────
            const collector = interaction.channel.createMessageComponentCollector({
                componentType: ComponentType.StringSelect,
                filter: i =>
                    i.user.id === interaction.user.id && i.customId === `greet_cfg_${guildId}`,
                time: 600_000,
            });

            collector.on('collect', async selectInteraction => {
                const selectedOption = selectInteraction.values[0];
                try {
                    switch (selectedOption) {
                        case 'welcome_channel':
                            await handleWelcomeChannel(selectInteraction, interaction, cfg, guildId, client);
                            break;
                        case 'welcome_message':
                            await handleWelcomeMessage(selectInteraction, interaction, cfg, guildId, client);
                            break;
                        case 'welcome_image':
                            await handleWelcomeImage(selectInteraction, interaction, cfg, guildId, client);
                            break;
                        case 'goodbye_channel':
                            await handleGoodbyeChannel(selectInteraction, interaction, cfg, guildId, client);
                            break;
                        case 'goodbye_message':
                            await handleGoodbyeMessage(selectInteraction, interaction, cfg, guildId, client);
                            break;
                        case 'goodbye_image':
                            await handleGoodbyeImage(selectInteraction, interaction, cfg, guildId, client);
                            break;
                    }
                } catch (error) {
                    if (error instanceof TitanBotError) {
                        logger.debug(`Greet config validation error: ${error.message}`);
                    } else {
                        logger.error('Unexpected greet dashboard error:', error);
                    }

                    const errorMessage =
                        error instanceof TitanBotError
                            ? error.userMessage || 'Une erreur est survenue lors du traitement de ta sélection.'
                            : 'Une erreur inattendue est survenue lors de la mise à jour de la configuration.';

                    if (!selectInteraction.replied && !selectInteraction.deferred) {
                        await selectInteraction.deferUpdate().catch(() => {});
                    }

                    await selectInteraction
                        .followUp({
                            embeds: [errorEmbed('Erreur de configuration', errorMessage)],
                            flags: MessageFlags.Ephemeral,
                        })
                        .catch(() => {});
                }
            });

            // ── Button collector for toggles ──────────────────────────────────
            const btnCollector = interaction.channel.createMessageComponentCollector({
                componentType: ComponentType.Button,
                filter: i =>
                    i.user.id === interaction.user.id &&
                    (i.customId === `greet_cfg_toggle_welcome_${guildId}` ||
                        i.customId === `greet_cfg_toggle_goodbye_${guildId}` ||
                        i.customId === `greet_cfg_ping_welcome_${guildId}` ||
                        i.customId === `greet_cfg_ping_goodbye_${guildId}`),
                time: 600_000,
            });

            btnCollector.on('collect', async btnInteraction => {
                try {
                    await btnInteraction.deferUpdate().catch(() => null);
                } catch (err) {
                    logger.debug('Button interaction already expired:', err.message);
                    return;
                }
                const customId = btnInteraction.customId;

                if (customId === `greet_cfg_toggle_welcome_${guildId}`) {
                    cfg.enabled = !cfg.enabled;
                    await saveWelcomeConfig(client, guildId, cfg);
                    await btnInteraction.followUp({
                        embeds: [
                            successEmbed(
                                '✅ Bienvenue mise à jour',
                                `Les messages de bienvenue sont désormais **${cfg.enabled ? 'activés' : 'désactivés'}**.`,
                            ),
                        ],
                        flags: MessageFlags.Ephemeral,
                    });
                } else if (customId === `greet_cfg_toggle_goodbye_${guildId}`) {
                    cfg.goodbyeEnabled = !cfg.goodbyeEnabled;
                    await saveWelcomeConfig(client, guildId, cfg);
                    await btnInteraction.followUp({
                        embeds: [
                            successEmbed(
                                '✅ Au revoir mis à jour',
                                `Les messages d\'au revoir sont désormais **${cfg.goodbyeEnabled ? 'activés' : 'désactivés'}**.`,
                            ),
                        ],
                        flags: MessageFlags.Ephemeral,
                    });
                } else if (customId === `greet_cfg_ping_welcome_${guildId}`) {
                    cfg.welcomePing = !cfg.welcomePing;
                    await saveWelcomeConfig(client, guildId, cfg);
                    await btnInteraction.followUp({
                        embeds: [
                            successEmbed(
                                '✅ Mention de bienvenue mise à jour',
                                `Les nouveaux membres seront${cfg.welcomePing ? '' : ' **pas**'} mentionnés dans le message de bienvenue.`,
                            ),
                        ],
                        flags: MessageFlags.Ephemeral,
                    });
                } else if (customId === `greet_cfg_ping_goodbye_${guildId}`) {
                    cfg.goodbyePing = !cfg.goodbyePing;
                    await saveWelcomeConfig(client, guildId, cfg);
                    await btnInteraction.followUp({
                        embeds: [
                            successEmbed(
                                '✅ Mention d\'au revoir mise à jour',
                                `Les membres qui partent seront${cfg.goodbyePing ? '' : ' **pas**'} mentionnés dans le message d\'au revoir.`,
                            ),
                        ],
                        flags: MessageFlags.Ephemeral,
                    });
                }

                await refreshDashboard(interaction, cfg, guildId);
            });

            collector.on('end', async (collected, reason) => {
                if (reason === 'time') {
                    btnCollector.stop();
                    try {
                        await InteractionHelper.safeEditReply(interaction, {
                            embeds: [
                                new EmbedBuilder()
                                    .setTitle('⏰ Tableau de bord expiré')
                                    .setDescription('Ce tableau de bord a été fermé en raison d\'une inactivité. Relance la commande pour continuer.')
                                    .setColor(getColor('error'))
                            ],
                            components: [],
                            flags: MessageFlags.Ephemeral,
                        });
                    } catch (error) {
                        logger.debug('Could not update dashboard on timeout:', error.message);
                    }
                }
            });
        } catch (error) {
            if (error instanceof TitanBotError) throw error;
            logger.error('Unexpected error in greet_dashboard:', error);
            throw new TitanBotError(
                `Greet dashboard failed: ${error.message}`,
                ErrorTypes.UNKNOWN,
                'Impossible d\'ouvrir le tableau de bord des messages de bienvenue.',
            );
        }
    },
};

// ─── Welcome Channel ──────────────────────────────────────────────────────────

async function handleWelcomeChannel(selectInteraction, rootInteraction, cfg, guildId, client) {
    try {
        await selectInteraction.deferUpdate();
    } catch {
        return;
    }

    const channelSelect = new ChannelSelectMenuBuilder()
        .setCustomId('greet_cfg_welcome_channel')
        .setPlaceholder('Sélectionne un canal texte...')
        .addChannelTypes(ChannelType.GuildText)
        .setMaxValues(1);

    await selectInteraction.followUp({
        embeds: [
            new EmbedBuilder()
                .setTitle('🟢 Canal de bienvenue')
                .setDescription(
                    `**Actuel :** ${cfg.channelId ? `<#${cfg.channelId}>` : '`Non défini`'}\n\nSélectionne le canal où les messages de bienvenue seront envoyés.`,
                )
                .setColor(getColor('info')),
        ],
        components: [new ActionRowBuilder().addComponents(channelSelect)],
        flags: MessageFlags.Ephemeral,
    });

    const chanCollector = rootInteraction.channel.createMessageComponentCollector({
        componentType: ComponentType.ChannelSelect,
        filter: i =>
            i.user.id === selectInteraction.user.id && i.customId === 'greet_cfg_welcome_channel',
        time: 60_000,
        max: 1,
    });

    chanCollector.on('collect', async chanInteraction => {
        await chanInteraction.deferUpdate();
        const channel = chanInteraction.channels.first();

        if (!botHasPermission(channel, ['ViewChannel', 'SendMessages', 'EmbedLinks'])) {
            await chanInteraction.followUp({
                embeds: [
                    errorEmbed(
                        'Permissions manquantes',
                        `J\'ai besoin des permissions **Voir le canal**, **Envoyer des messages** et **Intégrer des liens** dans ${channel}.`,
                    ),
                ],
                flags: MessageFlags.Ephemeral,
            });
            return;
        }

        cfg.channelId = channel.id;
        await saveWelcomeConfig(client, guildId, cfg);

        await chanInteraction.followUp({
            embeds: [successEmbed('✅ Canal mis à jour', `Les messages de bienvenue seront désormais envoyés dans ${channel}.`)],
            flags: MessageFlags.Ephemeral,
        });

        await refreshDashboard(rootInteraction, cfg, guildId);
    });

    chanCollector.on('end', (collected, reason) => {
        if (reason === 'time' && collected.size === 0) {
            selectInteraction
                .followUp({
                    embeds: [errorEmbed('Expiré', 'Aucun canal n\'a été sélectionné. Le paramètre n\'a pas été modifié.')],
                    flags: MessageFlags.Ephemeral,
                })
                .catch(() => {});
        }
    });
}

// ─── Welcome Message ──────────────────────────────────────────────────────────

async function handleWelcomeMessage(selectInteraction, rootInteraction, cfg, guildId, client) {
    const modal = new ModalBuilder()
        .setCustomId('greet_cfg_welcome_message')
        .setTitle('Modifier le message de bienvenue')
        .addComponents(
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('message_input')
                    .setLabel('Message (variables : {user}, {server}, etc.)')
                    .setStyle(TextInputStyle.Paragraph)
                    .setValue(cfg.welcomeMessage || 'Bienvenue {user} sur {server} !')
                    .setMaxLength(2000)
                    .setMinLength(1)
                    .setRequired(true),
            ),
        );

    try {
        await selectInteraction.showModal(modal);
    } catch {
        return;
    }

    const submitted = await selectInteraction
        .awaitModalSubmit({
            filter: i =>
                i.customId === 'greet_cfg_welcome_message' && i.user.id === selectInteraction.user.id,
            time: 120_000,
        })
        .catch(() => null);

    if (!submitted) return;

    cfg.welcomeMessage = submitted.fields.getTextInputValue('message_input').trim();
    await saveWelcomeConfig(client, guildId, cfg);

    await submitted.reply({
        embeds: [successEmbed('✅ Message de bienvenue mis à jour', 'Le message de bienvenue a été enregistré.')],
        flags: MessageFlags.Ephemeral,
    });

    await refreshDashboard(rootInteraction, cfg, guildId);
}

// ─── Welcome Image ────────────────────────────────────────────────────────────

async function handleWelcomeImage(selectInteraction, rootInteraction, cfg, guildId, client) {
    const modal = new ModalBuilder()
        .setCustomId('greet_cfg_welcome_image')
        .setTitle('Définir l\'image de bienvenue');

    const imageHint = new TextDisplayBuilder()
        .setContent('Fournis une URL d\'image directe **ou** téléverse un fichier ci-dessous. Si les deux sont fournis, le fichier téléversé est prioritaire. Laisse l\'URL vide et ignore le téléversement pour supprimer l\'image.');

    const urlLabel = new LabelBuilder()
        .setLabel('URL de l\'image (facultatif)')
        .setTextInputComponent(
            new TextInputBuilder()
                .setCustomId('image_input')
                .setPlaceholder('https://example.com/welcome.png')
                .setStyle(TextInputStyle.Short)
                .setValue(cfg.welcomeImage || '')
                .setRequired(false),
        );

    const uploadLabel = new LabelBuilder()
        .setLabel('Ou téléverse un fichier image (facultatif)')
        .setFileUploadComponent(
            new FileUploadBuilder()
                .setCustomId('image_upload')
                .setRequired(false),
        );

    modal
        .addTextDisplayComponents(imageHint)
        .addLabelComponents(urlLabel, uploadLabel);

    try {
        await selectInteraction.showModal(modal);
    } catch {
        return;
    }

    const submitted = await selectInteraction
        .awaitModalSubmit({
            filter: i =>
                i.customId === 'greet_cfg_welcome_image' && i.user.id === selectInteraction.user.id,
            time: 120_000,
        })
        .catch(() => null);

    if (!submitted) return;

    // File upload takes priority over URL
    const uploadedFiles = submitted.fields.getUploadedFiles('image_upload');
    let imageUrl = uploadedFiles?.at(0)?.url ?? submitted.fields.getTextInputValue('image_input').trim();

    // Validate URL if provided
    if (imageUrl) {
        try {
            new URL(imageUrl);
            if (!['http:', 'https:'].includes(new URL(imageUrl).protocol)) {
                await submitted.reply({
                    embeds: [errorEmbed('URL invalide', 'L\'URL de l\'image doit commencer par `http://` ou `https://`.')],
                    flags: MessageFlags.Ephemeral,
                });
                return;
            }
        } catch {
            await submitted.reply({
                embeds: [errorEmbed('URL invalide', 'Veuillez fournir une URL d\'image valide.')],
                flags: MessageFlags.Ephemeral,
            });
            return;
        }
    }

    cfg.welcomeImage = imageUrl || null;
    await saveWelcomeConfig(client, guildId, cfg);

    await submitted.reply({
        embeds: [successEmbed('✅ Image de bienvenue mise à jour', `Image ${imageUrl ? 'mise à jour' : 'supprimée'} avec succès.`)],
        flags: MessageFlags.Ephemeral,
    });

    await refreshDashboard(rootInteraction, cfg, guildId);
}

// ─── Welcome Ping ─────────────────────────────────────────────────────────────

async function handleWelcomePing(selectInteraction, rootInteraction, cfg, guildId, client) {
    await selectInteraction.deferUpdate();

    cfg.welcomePing = !cfg.welcomePing;
    await saveWelcomeConfig(client, guildId, cfg);

    await selectInteraction.followUp({
        embeds: [
            successEmbed(
                '✅ Welcome Ping Updated',
                `Joining users will${cfg.welcomePing ? '' : ' **not**'} be pinged in the welcome message.`,
            ),
        ],
        flags: MessageFlags.Ephemeral,
    });

    await refreshDashboard(rootInteraction, cfg, guildId);
}

// ─── Goodbye Channel ─────────────────────────────────────────────────────────

async function handleGoodbyeChannel(selectInteraction, rootInteraction, cfg, guildId, client) {
    try {
        await selectInteraction.deferUpdate();
    } catch {
        return;
    }

    const channelSelect = new ChannelSelectMenuBuilder()
        .setCustomId('greet_cfg_goodbye_channel')
        .setPlaceholder('Sélectionne un canal texte...')
        .addChannelTypes(ChannelType.GuildText)
        .setMaxValues(1);

    await selectInteraction.followUp({
        embeds: [
            new EmbedBuilder()
                .setTitle('🔴 Canal d\'au revoir')
                .setDescription(
                    `**Actuel :** ${cfg.goodbyeChannelId ? `<#${cfg.goodbyeChannelId}>` : '`Non défini`'}\n\nSélectionne le canal où les messages d\'au revoir seront envoyés.`,
                )
                .setColor(getColor('info')),
        ],
        components: [new ActionRowBuilder().addComponents(channelSelect)],
        flags: MessageFlags.Ephemeral,
    });

    const chanCollector = rootInteraction.channel.createMessageComponentCollector({
        componentType: ComponentType.ChannelSelect,
        filter: i =>
            i.user.id === selectInteraction.user.id && i.customId === 'greet_cfg_goodbye_channel',
        time: 60_000,
        max: 1,
    });

    chanCollector.on('collect', async chanInteraction => {
        await chanInteraction.deferUpdate();
        const channel = chanInteraction.channels.first();

        if (!botHasPermission(channel, ['ViewChannel', 'SendMessages', 'EmbedLinks'])) {
            await chanInteraction.followUp({
                embeds: [
                    errorEmbed(
                        'Permissions manquantes',
                        `J\'ai besoin des permissions **Voir le canal**, **Envoyer des messages** et **Intégrer des liens** dans ${channel}.`,
                    ),
                ],
                flags: MessageFlags.Ephemeral,
            });
            return;
        }

        cfg.goodbyeChannelId = channel.id;
        await saveWelcomeConfig(client, guildId, cfg);

        await chanInteraction.followUp({
            embeds: [successEmbed('✅ Canal mis à jour', `Les messages d\'au revoir seront désormais envoyés dans ${channel}.`)],
            flags: MessageFlags.Ephemeral,
        });

        await refreshDashboard(rootInteraction, cfg, guildId);
    });

    chanCollector.on('end', (collected, reason) => {
        if (reason === 'time' && collected.size === 0) {
            selectInteraction
                .followUp({
                    embeds: [errorEmbed('Expiré', 'Aucun canal n\'a été sélectionné. Le paramètre n\'a pas été modifié.')],
                    flags: MessageFlags.Ephemeral,
                })
                .catch(() => {});
        }
    });
}

// ─── Goodbye Message ──────────────────────────────────────────────────────────

async function handleGoodbyeMessage(selectInteraction, rootInteraction, cfg, guildId, client) {
    const modal = new ModalBuilder()
        .setCustomId('greet_cfg_goodbye_message')
        .setTitle('Modifier le message d\'au revoir')
        .addComponents(
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('message_input')
                    .setLabel('Message (variables : {user}, {server}, etc.)')
                    .setStyle(TextInputStyle.Paragraph)
                    .setValue(cfg.leaveMessage || '{user.tag} a quitté le serveur.')
                    .setMaxLength(2000)
                    .setMinLength(1)
                    .setRequired(true),
            ),
        );

    try {
        await selectInteraction.showModal(modal);
    } catch {
        return;
    }

    const submitted = await selectInteraction
        .awaitModalSubmit({
            filter: i =>
                i.customId === 'greet_cfg_goodbye_message' && i.user.id === selectInteraction.user.id,
            time: 120_000,
        })
        .catch(() => null);

    if (!submitted) return;

    cfg.leaveMessage = submitted.fields.getTextInputValue('message_input').trim();
    await saveWelcomeConfig(client, guildId, cfg);

    await submitted.reply({
        embeds: [successEmbed('✅ Message d\'au revoir mis à jour', 'Le message d\'au revoir a été enregistré.')],
        flags: MessageFlags.Ephemeral,
    });

    await refreshDashboard(rootInteraction, cfg, guildId);
}

// ─── Goodbye Image ────────────────────────────────────────────────────────────

async function handleGoodbyeImage(selectInteraction, rootInteraction, cfg, guildId, client) {
    const modal = new ModalBuilder()
        .setCustomId('greet_cfg_goodbye_image')
        .setTitle('Définir l\'image d\'au revoir');

    const imageHint = new TextDisplayBuilder()
        .setContent('Fournis une URL d\'image directe **ou** téléverse un fichier ci-dessous. Si les deux sont fournis, le fichier téléversé est prioritaire. Laisse l\'URL vide et ignore le téléversement pour supprimer l\'image.');

    const urlLabel = new LabelBuilder()
        .setLabel('URL de l\'image (facultatif)')
        .setTextInputComponent(
            new TextInputBuilder()
                .setCustomId('image_input')
                .setPlaceholder('https://example.com/goodbye.png')
                .setStyle(TextInputStyle.Short)
                .setValue(
                    typeof cfg.leaveEmbed?.image === 'string'
                        ? cfg.leaveEmbed.image
                        : cfg.leaveEmbed?.image?.url || ''
                )
                .setRequired(false),
        );

    const uploadLabel = new LabelBuilder()
        .setLabel('Ou téléverse un fichier image (facultatif)')
        .setFileUploadComponent(
            new FileUploadBuilder()
                .setCustomId('image_upload')
                .setRequired(false),
        );

    modal
        .addTextDisplayComponents(imageHint)
        .addLabelComponents(urlLabel, uploadLabel);

    try {
        await selectInteraction.showModal(modal);
    } catch {
        return;
    }

    const submitted = await selectInteraction
        .awaitModalSubmit({
            filter: i =>
                i.customId === 'greet_cfg_goodbye_image' && i.user.id === selectInteraction.user.id,
            time: 120_000,
        })
        .catch(() => null);

    if (!submitted) return;

    // File upload takes priority over URL
    const uploadedFiles = submitted.fields.getUploadedFiles('image_upload');
    let imageUrl = uploadedFiles?.at(0)?.url ?? submitted.fields.getTextInputValue('image_input').trim();

    // Validate URL if provided
    if (imageUrl) {
        try {
            new URL(imageUrl);
            if (!['http:', 'https:'].includes(new URL(imageUrl).protocol)) {
                await submitted.reply({
                    embeds: [errorEmbed('URL invalide', 'L\'URL de l\'image doit commencer par `http://` ou `https://`.')],
                    flags: MessageFlags.Ephemeral,
                });
                return;
            }
        } catch {
            await submitted.reply({
                embeds: [errorEmbed('URL invalide', 'Veuillez fournir une URL d\'image valide.')],
                flags: MessageFlags.Ephemeral,
            });
            return;
        }
    }

    const nextLeaveEmbed = { ...(cfg.leaveEmbed || {}) };
    if (imageUrl) {
        nextLeaveEmbed.image = imageUrl;
    } else {
        delete nextLeaveEmbed.image;
    }

    cfg.leaveEmbed = nextLeaveEmbed;
    await saveWelcomeConfig(client, guildId, cfg);

    await submitted.reply({
        embeds: [successEmbed('✅ Image d\'au revoir mise à jour', `Image ${imageUrl ? 'mise à jour' : 'supprimée'} avec succès.`)],
        flags: MessageFlags.Ephemeral,
    });

    await refreshDashboard(rootInteraction, cfg, guildId);
}

// ─── Goodbye Ping ─────────────────────────────────────────────────────────────

async function handleGoodbyePing(selectInteraction, rootInteraction, cfg, guildId, client) {
    await selectInteraction.deferUpdate();

    cfg.goodbyePing = !cfg.goodbyePing;
    await saveWelcomeConfig(client, guildId, cfg);

    await selectInteraction.followUp({
        embeds: [
            successEmbed(
                '✅ Mention d\'au revoir mise à jour',
                `Les membres qui partent seront${cfg.goodbyePing ? '' : ' **pas**'} mentionnés dans le message d\'au revoir.`,
            ),
        ],
        flags: MessageFlags.Ephemeral,
    });

    await refreshDashboard(rootInteraction, cfg, guildId);
}
