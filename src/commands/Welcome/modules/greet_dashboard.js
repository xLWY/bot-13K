import { getColor } from '../../../config/bot.js';
import {
    ActionRowBuilder,
    StringSelectMenuBuilder,
    StringSelectMenuOptionBuilder,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    ChannelSelectMenuBuilder,
    RoleSelectMenuBuilder,
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
import { successEmbed } from '../../../utils/embeds.js';
import { logger } from '../../../utils/logger.js';
import { TitanBotError, ErrorTypes } from '../../../utils/errorHandler.js';
import { getWelcomeConfig, saveWelcomeConfig } from '../../../utils/database.js';
import { botHasPermission } from '../../../utils/permissionGuard.js';

// ─── Embed & Menu Builders ────────────────────────────────────────────────────

function buildDashboardEmbed(cfg, guild) {
    const welcomeChannel = cfg.channelId ? `<#${cfg.channelId}>` : '`Non défini`';

    const rawWelcome = cfg.welcomeMessage || 'Bienvenue {user} sur {server} !';
    const rawArrival = cfg.arrivalMessage || "**{user}** vient d'arriver, dites-lui bonjour ! 👋";
    const welcomePreview = `\`${rawWelcome.length > 55 ? rawWelcome.substring(0, 55) + '…' : rawWelcome}\``;
    const arrivalPreview = `\`${rawArrival.length > 55 ? rawArrival.substring(0, 55) + '…' : rawArrival}\``;

    const autoRoleIds = Array.isArray(cfg.roleIds) ? cfg.roleIds : [];
    const autoRolePreview = autoRoleIds.length
        ? autoRoleIds.map(id => `<@&${id}>`).join(', ')
        : '`Aucun`';

            const arrivalChannelName = cfg.arrivalChannelId ? `<#${cfg.arrivalChannelId}>` : '`Non défini`';

    return new EmbedBuilder()
        .setTitle('👋 Tableau de bord des messages de bienvenue')
        .setDescription(
            `Gère les paramètres de bienvenue pour **${guild.name}**.\nUtilise les interrupteurs pour activer/désactiver, puis sélectionne une option à modifier.`,
        )
        .setColor(getColor('info'))
        .addFields(
            { name: '🟢 Canal de bienvenue', value: welcomeChannel, inline: true },
            { name: '⚙️ Statut de bienvenue', value: cfg.enabled ? '✅ Activé' : '❌ Désactivé', inline: true },
            { name: '🔔 Mention de bienvenue', value: cfg.welcomePing ? '✅ Activée' : '❌ Désactivée', inline: true },
            { name: '🎭 Rôle(s) auto', value: autoRolePreview, inline: true },
            { name: '💬 Message de bienvenue', value: welcomePreview, inline: false },
            { name: '👋 Message d\'arrivée (10 min)', value: arrivalPreview, inline: false },
            { name: '🚪 Salon d\'arrivée', value: arrivalChannelName, inline: true },
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
                .setLabel('Rôles auto')
                .setDescription('Ajouter ou retirer les rôles attribués automatiquement')
                .setValue('auto_role')
                .setEmoji('🎭'),
            new StringSelectMenuOptionBuilder()
                .setLabel('Image de bienvenue')
                .setDescription('Définir l\'image pour les messages de bienvenue')
                .setValue('welcome_image')
                .setEmoji('🖼️'),
            new StringSelectMenuOptionBuilder()
                .setLabel('Salon d\'arrivée')
                .setDescription('Salon où le message « X vient d\'arriver » est posté (10 min)')
                .setValue('arrival_channel')
                .setEmoji('🚪'),
            new StringSelectMenuOptionBuilder()
                .setLabel('Message d\'arrivée')
                .setDescription('Modifier le texte affiché à l\'arrivée d\'un membre')
                .setValue('arrival_message')
                .setEmoji('👋'),
        );
}

function buildButtonRow(cfg, guildId, disabled = false) {
    const welcomeOn = cfg.enabled === true;
    const welcomePingOn = cfg.welcomePing === true;
    
    return [
        new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`greet_cfg_toggle_welcome_${guildId}`)
                .setLabel('Bienvenue')
                .setStyle(welcomeOn ? ButtonStyle.Success : ButtonStyle.Danger)
                .setEmoji('🟢')
                .setDisabled(disabled),
        ),
        new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`greet_cfg_ping_welcome_${guildId}`)
                .setLabel('Mention bienvenue')
                .setStyle(welcomePingOn ? ButtonStyle.Primary : ButtonStyle.Secondary)
                .setEmoji('🔔')
                .setDisabled(disabled),
        ),
        new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`greet_cfg_back`)
                .setLabel('Retour au panel')
                .setEmoji('⬅️')
                .setStyle(ButtonStyle.Danger)
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
    async execute(interaction, config, client, onBack) {
        try {
            const guildId = interaction.guild.id;
            const cfg = await getWelcomeConfig(client, guildId);

            if (!cfg.channelId) {
                throw new TitanBotError(
                    'Greet system not configured',
                    ErrorTypes.CONFIGURATION,
                    'La bienvenue n\'a pas encore été configurée. Exécute `/welcome setup` d\'abord.',
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
                        case 'auto_role':
                            await handleAutoRole(selectInteraction, interaction, cfg, guildId, client);
                            break;
                        case 'welcome_image':
                            await handleWelcomeImage(selectInteraction, interaction, cfg, guildId, client);
                            break;
                        case 'arrival_channel':
                            await handlePingChannel(selectInteraction, interaction, cfg, guildId, client);
                            break;
                        case 'arrival_message':
                            await handlePingMessage(selectInteraction, interaction, cfg, guildId, client);
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

                    await InteractionHelper.sendErrorNotice(selectInteraction, errorMessage).catch(() => {});
                }
            });

            // ── Button collector for toggles ──────────────────────────────────
            const btnCollector = interaction.channel.createMessageComponentCollector({
                componentType: ComponentType.Button,
                filter: i =>
                    i.user.id === interaction.user.id &&
                    (i.customId === `greet_cfg_toggle_welcome_${guildId}` ||
                        i.customId === `greet_cfg_ping_welcome_${guildId}` ||
                        i.customId === `greet_cfg_back`),
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
                } else if (customId === `greet_cfg_back`) {
                    if (typeof onBack === 'function') {
                        await onBack(btnInteraction);
                    }
                    return;
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
            await InteractionHelper.sendErrorNotice(chanInteraction, `J\'ai besoin des permissions **Voir le canal**, **Envoyer des messages** et **Intégrer des liens** dans ${channel}.`);
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
            InteractionHelper.sendErrorNotice(selectInteraction, 'Aucun canal n\'a été sélectionné. Le paramètre n\'a pas été modifié.')
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
                await InteractionHelper.sendErrorNotice(submitted, 'L\'URL de l\'image doit commencer par `http://` ou `https://`.');
                return;
            }
        } catch {
            await InteractionHelper.sendErrorNotice(submitted, 'Veuillez fournir une URL d\'image valide.');
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
// ─── Auto Role ────────────────────────────────────────────────────────────────

async function handleAutoRole(selectInteraction, rootInteraction, cfg, guildId, client) {
    try {
        await selectInteraction.deferUpdate();
    } catch {
        return;
    }

    const currentIds = Array.isArray(cfg.roleIds) ? cfg.roleIds : [];

    const roleSelect = new RoleSelectMenuBuilder()
        .setCustomId('greet_cfg_auto_role')
        .setPlaceholder('Ajoute ou retire des rôles auto...')
        .setMinValues(0)
        .setMaxValues(25)
        .setDefaultRoles(currentIds);

    await selectInteraction.followUp({
        embeds: [
            new EmbedBuilder()
                .setTitle('🎭 Rôles auto')
                .setDescription(
                    `**Actuel :** ${currentIds.length ? currentIds.map(id => `<@&${id}>`).join(', ') : '`Aucun`'}.\n\nSélectionne les rôles à attribuer automatiquement aux nouveaux membres et valide.`,
                )
                .setColor(getColor('info')),
        ],
        components: [new ActionRowBuilder().addComponents(roleSelect)],
        flags: MessageFlags.Ephemeral,
    });

    const roleCollector = rootInteraction.channel.createMessageComponentCollector({
        componentType: ComponentType.RoleSelect,
        filter: i =>
            i.user.id === selectInteraction.user.id && i.customId === 'greet_cfg_auto_role',
        time: 60_000,
        max: 1,
    });

    roleCollector.on('collect', async roleInteraction => {
        await roleInteraction.deferUpdate();
        const selectedRoles = roleInteraction.values || [];
        const botHighest = roleInteraction.guild.members.me?.roles?.highest;
        const invalid = selectedRoles.filter(id => {
            const role = roleInteraction.guild.roles.cache.get(id);
            return botHighest && role && role.position >= botHighest.position;
        });

        if (invalid.length > 0) {
            await InteractionHelper.sendErrorNotice(roleInteraction, `Je ne peux pas attribuer (${invalid.map(id => `<@&${id}>`).join(', ')}) car ils sont plus hauts que mon rôle le plus haut.`);
            return;
        }

        cfg.roleIds = selectedRoles;
        await saveWelcomeConfig(client, guildId, cfg);

        await roleInteraction.followUp({
            embeds: [
                successEmbed(
                    '✅ Rôles auto mis à jour',
                    selectedRoles.length
                        ? `Les nouveaux membres recevront : ${selectedRoles.map(id => `<@&${id}>`).join(', ')}.`
                        : 'Aucun rôle auto n\'est désormais attribué.',
                ),
            ],
            flags: MessageFlags.Ephemeral,
        });

        await refreshDashboard(rootInteraction, cfg, guildId);
    });

    roleCollector.on('end', (collected, reason) => {
        if (reason === 'time' && collected.size === 0) {
            InteractionHelper.sendErrorNotice(selectInteraction, 'Aucun rôle n\'a été sélectionné. Le paramètre n\'a pas été modifié.')
                .catch(() => {});
        }
    });
}

// ─── Salon d'arrivée (channel) ────────────────────────────────────────────────

async function handlePingChannel(selectInteraction, rootInteraction, cfg, guildId, client) {
    try {
        await selectInteraction.deferUpdate();
    } catch {
        return;
    }

    const channelSelect = new ChannelSelectMenuBuilder()
        .setCustomId('greet_cfg_arrival_channel')
        .setPlaceholder('Sélectionne un canal texte...')
        .addChannelTypes(ChannelType.GuildText)
        .setMaxValues(1);

    await selectInteraction.followUp({
        embeds: [
            new EmbedBuilder()
                .setTitle('🚪 Salon d\'arrivée')
                .setDescription(
                    `**Actuel :** ${cfg.arrivalChannelId ? `<#${cfg.arrivalChannelId}>` : '`Non défini`'}\n\nSélectionne le salon où le message « X vient d\'arriver » sera posté. Il reste affiché 10 minutes puis disparaît.`,
                )
                .setColor(getColor('info')),
        ],
        components: [new ActionRowBuilder().addComponents(channelSelect)],
        flags: MessageFlags.Ephemeral,
    });

    const chanCollector = rootInteraction.channel.createMessageComponentCollector({
        componentType: ComponentType.ChannelSelect,
        filter: i =>
            i.user.id === selectInteraction.user.id && i.customId === 'greet_cfg_arrival_channel',
        time: 60_000,
        max: 1,
    });

    chanCollector.on('collect', async chanInteraction => {
        await chanInteraction.deferUpdate();
        const channel = chanInteraction.channels.first();

        if (!botHasPermission(channel, ['ViewChannel', 'SendMessages'])) {
            await InteractionHelper.sendErrorNotice(chanInteraction, `J\'ai besoin des permissions **Voir le canal** et **Envoyer des messages** dans ${channel}.`);
            return;
        }

        cfg.arrivalChannelId = channel.id;
        await saveWelcomeConfig(client, guildId, cfg);

        await chanInteraction.followUp({
            embeds: [successEmbed('✅ Salon d\'arrivée mis à jour', `Les messages « X vient d\'arriver » seront postés dans ${channel} pendant 10 minutes.`)],
            flags: MessageFlags.Ephemeral,
        });

        await refreshDashboard(rootInteraction, cfg, guildId);
    });

    chanCollector.on('end', (collected, reason) => {
        if (reason === 'time' && collected.size === 0) {
            InteractionHelper.sendErrorNotice(selectInteraction, 'Aucun canal n\'a été sélectionné. Le paramètre n\'a pas été modifié.')
                .catch(() => {});
        }
    });
}

// ─── Message d'arrivée (texte) ────────────────────────────────────────────────

async function handlePingMessage(selectInteraction, rootInteraction, cfg, guildId, client) {
    const modal = new ModalBuilder()
        .setCustomId('greet_cfg_arrival_message')
        .setTitle('Modifier le message d\'arrivée')
        .addComponents(
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('message_input')
                    .setLabel('Message (variables : {user}, {username}, {server})')
                    .setStyle(TextInputStyle.Paragraph)
                    .setValue(cfg.arrivalMessage || "**{user}** vient d'arriver, dites-lui bonjour ! 👋")
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
                i.customId === 'greet_cfg_arrival_message' && i.user.id === selectInteraction.user.id,
            time: 120_000,
        })
        .catch(() => null);

    if (!submitted) return;

    cfg.arrivalMessage = submitted.fields.getTextInputValue('message_input').trim() || "**{user}** vient d'arriver, dites-lui bonjour ! 👋";
    await saveWelcomeConfig(client, guildId, cfg);

    await submitted.reply({
        embeds: [successEmbed('✅ Message d\'arrivée mis à jour', 'Le message affiché à l\'arrivée d\'un membre a été enregistré.')],
        flags: MessageFlags.Ephemeral,
    });

    await refreshDashboard(rootInteraction, cfg, guildId);
}
