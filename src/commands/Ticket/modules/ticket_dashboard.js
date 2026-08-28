import { getColor } from '../../../config/bot.js';
import {
    ActionRowBuilder,
    StringSelectMenuBuilder,
    StringSelectMenuOptionBuilder,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    RoleSelectMenuBuilder,
    ChannelSelectMenuBuilder,
    UserSelectMenuBuilder,
    ButtonBuilder,
    ButtonStyle,
    ChannelType,
    MessageFlags,
    ComponentType,
    EmbedBuilder,
} from 'discord.js';
import { InteractionHelper } from '../../../utils/interactionHelper.js';
import { successEmbed, errorEmbed } from '../../../utils/embeds.js';
import { logger } from '../../../utils/logger.js';
import { TitanBotError, ErrorTypes } from '../../../utils/errorHandler.js';
import { getGuildConfig } from '../../../services/guildConfig.js';
import { getGuildConfigKey } from '../../../utils/database.js';
import { getUserTicketCount, buildTicketTypeButtons, resolveTicketTypes } from '../../../services/ticket.js';

const DEFAULT_PANEL_MESSAGE =
    "Bonjour ! Besoin d'aide ou d'une question ? Cliquez sur le bouton ci-dessous pour ouvrir un ticket.";
const DEFAULT_BUTTON_LABEL = 'Ouvrir un ticket';

// ─── Embed & Menu Builders ────────────────────────────────────────────────────

function buildDashboardEmbed(config, guild) {
    const panelChannel = config.ticketPanelChannelId ? `<#${config.ticketPanelChannelId}>` : '`Non défini`';
    const staffRole = config.ticketStaffRoleId ? `<@&${config.ticketStaffRoleId}>` : '`Non défini`';
    const ticketLogsChannel = config.ticketLogsChannelId ? `<#${config.ticketLogsChannelId}>` : '`Non défini`';
    const transcriptChannel = config.ticketTranscriptChannelId ? `<#${config.ticketTranscriptChannelId}>` : '`Non défini`';

    // Get category names from guild
    const openCategoryChannel = config.ticketCategoryId ? guild.channels.cache.get(config.ticketCategoryId) : null;
    const openCategory = openCategoryChannel ? openCategoryChannel.toString() : '`Non défini`';

    const closedCategoryChannel = config.ticketClosedCategoryId ? guild.channels.cache.get(config.ticketClosedCategoryId) : null;
    const closedCategory = closedCategoryChannel ? closedCategoryChannel.toString() : '`Non défini`';

    const rawMsg = config.ticketPanelMessage || DEFAULT_PANEL_MESSAGE;
    const panelMsg = `\`${rawMsg.length > 60 ? rawMsg.substring(0, 60) + '…' : rawMsg}\``;
    const btnLabel = `\`${config.ticketButtonLabel || DEFAULT_BUTTON_LABEL}\``;
    const typesSummary =
        resolveTicketTypes(config).map((t) => `${t.emoji} ${t.label}`).join(' • ') || '`Aucun`';

    return new EmbedBuilder()
        .setTitle('🎫 Tableau de bord Tickets')
        .setDescription(`Gérez les paramètres du système de tickets de **${guild.name}**.\nSélectionnez une option ci-dessous pour modifier un réglage.`)
        .setColor(getColor('info'))
        .addFields(
            { name: '📢 Salon du panneau', value: panelChannel, inline: true },
            { name: '🛡️ Rôle staff', value: staffRole, inline: true },
            { name: '\u200B', value: '\u200B', inline: true },
            { name: '📁 Catégorie des tickets ouverts', value: openCategory, inline: true },
            { name: '📂 Catégorie des tickets fermés', value: closedCategory, inline: true },
            { name: '\u200B', value: '\u200B', inline: true },
            { name: '📝 Message du panneau', value: panelMsg, inline: false },
            { name: '🏷️ Libellé du bouton', value: btnLabel, inline: true },
            { name: '🔢 Tickets max/Utilisateur', value: String(config.maxTicketsPerUser || 3), inline: true },
            { name: '📬 MP à la fermeture', value: config.dmOnClose !== false ? '✅ Activé' : '❌ Désactivé', inline: true },
            { name: '🎫 Salon des logs tickets', value: ticketLogsChannel, inline: true },
            { name: '📜 Salon des transcripts', value: transcriptChannel, inline: true },
            { name: '🔘 Boutons du panneau', value: typesSummary, inline: false },
        )
        .setFooter({ text: 'Sélectionnez une option ci-dessous • Le tableau de bord se ferme après 10 minutes d\'inactivité' })
        .setTimestamp();
}

function buildSelectMenu(guildId) {
    return new StringSelectMenuBuilder()
        .setCustomId(`ticket_config_${guildId}`)
        .setPlaceholder('Sélectionnez un réglage à configurer…')
        .addOptions(
            new StringSelectMenuOptionBuilder()
                .setLabel('Modifier le message du panneau')
                .setDescription('Changez le message affiché sur le panneau de création de tickets')
                .setValue('panel_message')
                .setEmoji('📝'),
            new StringSelectMenuOptionBuilder()
                .setLabel('Modifier le libellé du bouton')
                .setDescription('Changez le libellé du bouton de création de ticket')
                .setValue('button_label')
                .setEmoji('🏷️'),
            new StringSelectMenuOptionBuilder()
                .setLabel('Changer la catégorie des tickets ouverts')
                .setDescription('Catégorie où les nouveaux tickets sont créés')
                .setValue('open_category')
                .setEmoji('📁'),
            new StringSelectMenuOptionBuilder()
                .setLabel('Changer la catégorie des tickets fermés')
                .setDescription('Catégorie où les tickets fermés sont déplacés')
                .setValue('closed_category')
                .setEmoji('📂'),
            new StringSelectMenuOptionBuilder()
                .setLabel('Définir le nombre max de tickets')
                .setDescription('Limite le nombre de tickets ouverts par utilisateur')
                .setValue('max_tickets')
                .setEmoji('🔢'),
            new StringSelectMenuOptionBuilder()
                .setLabel('Définir le salon des logs tickets')
                .setDescription('Salon recevant les retours et événements des tickets')
                .setValue('logs_channel')
                .setEmoji('🎫'),
            new StringSelectMenuOptionBuilder()
                .setLabel('Définir le salon des transcripts')
                .setDescription('Salon recevant les transcripts à la suppression')
                .setValue('transcript_channel')
                .setEmoji('📜'),
            new StringSelectMenuOptionBuilder()
                .setLabel('➕ Ajouter un bouton')
                .setDescription('Ajouter une nouvelle catégorie de ticket (bouton sur le panneau)')
                .setValue('add_type')
                .setEmoji('➕'),
            new StringSelectMenuOptionBuilder()
                .setLabel('➖ Supprimer un bouton')
                .setDescription('Retirer une catégorie de ticket du panneau')
                .setValue('remove_type')
                .setEmoji('➖'),
        );
}

function buildButtonRow(guildConfig, guildId, disabled = false) {
    const dmEnabled = guildConfig.dmOnClose !== false;
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`ticket_cfg_dm_toggle_${guildId}`)
            .setLabel('MP à la fermeture')
            .setStyle(dmEnabled ? ButtonStyle.Success : ButtonStyle.Danger)
            .setEmoji(dmEnabled ? '📬' : '📭')
            .setDisabled(disabled),
        new ButtonBuilder()
            .setCustomId(`ticket_cfg_staff_role_btn_${guildId}`)
            .setLabel('Rôle staff')
            .setStyle(ButtonStyle.Secondary)
            .setEmoji('🛡️')
            .setDisabled(disabled),
        new ButtonBuilder()
            .setCustomId(`ticket_cfg_delete_${guildId}`)
            .setLabel('Supprimer le système')
            .setStyle(ButtonStyle.Danger)
            .setEmoji('🗑️')
            .setDisabled(disabled),
    );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function refreshDashboard(rootInteraction, guildConfig, guildId) {
    const buttonRow = buildButtonRow(guildConfig, guildId);
    const selectRow = new ActionRowBuilder().addComponents(buildSelectMenu(guildId));
    await InteractionHelper.safeEditReply(rootInteraction, {
        embeds: [buildDashboardEmbed(guildConfig, rootInteraction.guild)],
        components: [buttonRow, selectRow],
    }).catch(() => {});
}

/**
 * Attempts to find and edit the live ticket panel message in the panel channel.
 * Returns true if the panel was found and updated, false otherwise.
 */
async function updateLivePanel(client, guild, config) {
    if (!config.ticketPanelChannelId) return false;
    try {
        const channel = await guild.channels.fetch(config.ticketPanelChannelId).catch(() => null);
        if (!channel) return false;

        const messages = await channel.messages.fetch({ limit: 50 });
        const panelMsg = messages.find(
            m =>
                m.author.id === client.user.id &&
                m.components?.length > 0 &&
                (m.components[0]?.components?.[0]?.customId === 'create_ticket' ||
                    m.components[0]?.components?.[0]?.customId?.startsWith('create_ticket_direct:')),
        );
        if (!panelMsg) return false;

        const updatedEmbed = new EmbedBuilder()
            .setTitle('🎫 Centre d\'aide')
            .setDescription(config.ticketPanelMessage || DEFAULT_PANEL_MESSAGE)
            .setColor(getColor('info'))
            .setFooter({ text: 'Cliquez sur le bouton ci-dessous pour ouvrir un ticket' });

        await panelMsg.edit({
            embeds: [updatedEmbed],
            components: buildTicketTypeButtons(config.ticketButtonLabel || 'Ouvrir un ticket'),
        });
        return true;
    } catch (error) {
        logger.warn('Failed to update live ticket panel:', error.message);
        return false;
    }
}

// ─── Main Export ──────────────────────────────────────────────────────────────

export default {
    async execute(interaction, config, client) {
        try {
            const guildId = interaction.guild.id;
            const guildConfig = await getGuildConfig(client, guildId);

            if (!guildConfig.ticketPanelChannelId) {
                throw new TitanBotError(
                    'Système de tickets non configuré',
                    ErrorTypes.CONFIGURATION,
                    'Le système de tickets n\'a pas encore été configuré. Lancez `/ticket setup` pour le configurer.',
                );
            }

            const selectMenu = buildSelectMenu(guildId);
            const selectRow = new ActionRowBuilder().addComponents(selectMenu);
            const buttonRow = buildButtonRow(guildConfig, guildId);

            await InteractionHelper.safeEditReply(interaction, {
                embeds: [buildDashboardEmbed(guildConfig, interaction.guild)],
                components: [buttonRow, selectRow],
            });

            const replyMessage = await interaction.fetchReply().catch(() => null);
            const replyMessageId = replyMessage?.id;

            const collector = interaction.channel.createMessageComponentCollector({
                componentType: ComponentType.StringSelect,
                filter: i =>
                    i.user.id === interaction.user.id &&
                    i.customId === `ticket_config_${guildId}` &&
                    (!replyMessageId || i.message.id === replyMessageId),
                time: 600_000,
            });

            const buttonCollector = interaction.channel.createMessageComponentCollector({
                componentType: ComponentType.Button,
                filter: i =>
                    i.user.id === interaction.user.id &&
                    (!replyMessageId || i.message.id === replyMessageId) &&
                    (i.customId === `ticket_cfg_dm_toggle_${guildId}` ||
                        i.customId === `ticket_cfg_staff_role_btn_${guildId}` ||
                        i.customId === `ticket_cfg_delete_${guildId}`),

                time: 600_000,
            });

            collector.on('collect', async (selectInteraction) => {
                const selectedOption = selectInteraction.values[0];
                try {
                    switch (selectedOption) {
                        case 'panel_message':
                            await handlePanelMessage(selectInteraction, interaction, guildConfig, guildId, client);
                            break;
                        case 'button_label':
                            await handleButtonLabel(selectInteraction, interaction, guildConfig, guildId, client);
                            break;
                        case 'staff_role':
                            await handleStaffRole(selectInteraction, interaction, guildConfig, guildId, client);
                            break;
                        case 'open_category':
                            await handleOpenCategory(selectInteraction, interaction, guildConfig, guildId, client);
                            break;
                        case 'closed_category':
                            await handleClosedCategory(selectInteraction, interaction, guildConfig, guildId, client);
                            break;
                        case 'max_tickets':
                            await handleMaxTickets(selectInteraction, interaction, guildConfig, guildId, client);
                            break;
                        case 'logs_channel':
                            await handleLogsChannel(selectInteraction, interaction, guildConfig, guildId, client);
                            break;
                        case 'transcript_channel':
                            await handleTranscriptChannel(selectInteraction, interaction, guildConfig, guildId, client);
                            break;
                        case 'add_type':
                            await handleAddType(selectInteraction, interaction, guildConfig, guildId, client);
                            break;
                        case 'remove_type':
                            await handleRemoveType(selectInteraction, interaction, guildConfig, guildId, client);
                            break;
                    }
                } catch (error) {
                    if (error instanceof TitanBotError) {
                        logger.debug(`Ticket config validation error: ${error.message}`);
                    } else {
                        logger.error('Unexpected ticket config menu error:', error);
                    }

                    const errorMessage =
                        error instanceof TitanBotError
                            ? error.userMessage || 'Une erreur est survenue lors du traitement de votre sélection.'
                            : 'Une erreur inattendue est survenue lors de la mise à jour de la configuration.';

                    // Already deferred at the top of the collector
                    await selectInteraction
                        .followUp({
                            embeds: [errorEmbed('Erreur de configuration', errorMessage)],
                            flags: MessageFlags.Ephemeral,
                        })
                        .catch(() => {});
                }
            });

            buttonCollector.on('collect', async (btnInteraction) => {
                try {
                    if (btnInteraction.customId === `ticket_cfg_dm_toggle_${guildId}`) {
                        await handleDmOnClose(btnInteraction, interaction, guildConfig, guildId, client);
                    } else if (btnInteraction.customId === `ticket_cfg_staff_role_btn_${guildId}`) {
                        await handleStaffRole(btnInteraction, interaction, guildConfig, guildId, client);
                    } else if (btnInteraction.customId === `ticket_cfg_delete_${guildId}`) {
                        await handleDeleteSystem(btnInteraction, interaction, guildConfig, guildId, client);
                    }
                } catch (error) {
                    if (error.code === 40060) return;
                    if (error instanceof TitanBotError) {
                        logger.debug(`Ticket config button error: ${error.message}`);
                    } else {
                        logger.error('Unexpected ticket config button error:', error);
                    }
                    const errorMessage =
                        error instanceof TitanBotError
                            ? error.userMessage || 'Une erreur est survenue lors du traitement de votre action.'
                            : 'Une erreur inattendue est survenue lors de la mise à jour de la configuration.';

                    // Already deferred at the top of the collector
                    await btnInteraction
                        .followUp({
                            embeds: [errorEmbed('Erreur de configuration', errorMessage)],
                            flags: MessageFlags.Ephemeral,
                        })
                        .catch(() => {});
                }
            });

            collector.on('end', async (collected, reason) => {
                buttonCollector.stop();
                if (reason === 'time') {
                    const timeoutEmbed = new EmbedBuilder()
                        .setTitle('⏰ Tableau de bord expiré')
                        .setDescription('Ce tableau de bord a été fermé pour inactivité. Relancez la commande pour continuer.')
                        .setColor(getColor('error'));
                    await InteractionHelper.safeEditReply(interaction, {
                        embeds: [timeoutEmbed],
                        components: [],
                    }).catch(() => {});
                }
            });
        } catch (error) {
            if (error instanceof TitanBotError) throw error;
            logger.error('Unexpected error in ticket_config:', error);
            throw new TitanBotError(
                `Ticket config failed: ${error.message}`,
                ErrorTypes.UNKNOWN,
                'Impossible d\'ouvrir le tableau de bord de configuration des tickets.',
            );
        }
    },
};

// ─── Panel Message ────────────────────────────────────────────────────────────

async function handlePanelMessage(selectInteraction, rootInteraction, guildConfig, guildId, client) {
    const modal = new ModalBuilder()
        .setCustomId('ticket_cfg_panel_msg')
        .setTitle('Modifier le message du panneau')
        .addComponents(
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('panel_msg_input')
                    .setLabel('Message du panneau')
                    .setStyle(TextInputStyle.Paragraph)
                    .setValue(guildConfig.ticketPanelMessage || DEFAULT_PANEL_MESSAGE)
                    .setMaxLength(2000)
                    .setMinLength(1)
                    .setRequired(true)
                    .setPlaceholder(DEFAULT_PANEL_MESSAGE),
            ),
        );

    await selectInteraction.showModal(modal);

    const submitted = await selectInteraction
        .awaitModalSubmit({
            filter: i =>
                i.customId === 'ticket_cfg_panel_msg' && i.user.id === selectInteraction.user.id,
            time: 120_000,
        })
        .catch(() => null);

    if (!submitted) return;

    const newMessage = submitted.fields.getTextInputValue('panel_msg_input').trim();
    guildConfig.ticketPanelMessage = newMessage;
    await client.db.set(getGuildConfigKey(guildId), guildConfig);

    const panelUpdated = await updateLivePanel(client, rootInteraction.guild, guildConfig);

    await submitted.reply({
        embeds: [
            successEmbed(
                '✅ Message du panneau mis à jour',
                `Le message du panneau a été mis à jour.${
                    panelUpdated
                        ? '\nLe panneau de tickets en direct a également été actualisé.'
                        : '\n> **Remarque :** le panneau en direct n\'a pas pu être localisé. Le nouveau message s\'appliquera à la prochaine exécution de `/ticket setup`.'
                }`,
            ),
        ],
        flags: MessageFlags.Ephemeral,
    });

    await refreshDashboard(rootInteraction, guildConfig, guildId);
}

// ─── Button Label ─────────────────────────────────────────────────────────────

async function handleButtonLabel(selectInteraction, rootInteraction, guildConfig, guildId, client) {
    const modal = new ModalBuilder()
        .setCustomId('ticket_cfg_btn_label')
        .setTitle('Modifier le libellé du bouton')
        .addComponents(
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('btn_label_input')
                    .setLabel('Libellé du bouton (80 caractères max)')
                    .setStyle(TextInputStyle.Short)
                    .setValue(guildConfig.ticketButtonLabel || DEFAULT_BUTTON_LABEL)
                    .setMaxLength(80)
                    .setMinLength(1)
                    .setRequired(true)
                    .setPlaceholder(DEFAULT_BUTTON_LABEL),
            ),
        );

    await selectInteraction.showModal(modal);

    const submitted = await selectInteraction
        .awaitModalSubmit({
            filter: i =>
                i.customId === 'ticket_cfg_btn_label' && i.user.id === selectInteraction.user.id,
            time: 120_000,
        })
        .catch(() => null);

    if (!submitted) return;

    const newLabel = submitted.fields.getTextInputValue('btn_label_input').trim();
    guildConfig.ticketButtonLabel = newLabel;
    await client.db.set(getGuildConfigKey(guildId), guildConfig);

    const panelUpdated = await updateLivePanel(client, rootInteraction.guild, guildConfig);

    await submitted.reply({
        embeds: [
            successEmbed(
                '✅ Libellé du bouton mis à jour',
                `Libellé du bouton modifié en \`${newLabel}\`.${
                    panelUpdated
                        ? '\nLe bouton du panneau en direct a également été actualisé.'
                        : '\n> **Remarque :** le panneau en direct n\'a pas pu être localisé. Le nouveau libellé s\'appliquera à la prochaine exécution de `/ticket setup`.'
                }`,
            ),
        ],
        flags: MessageFlags.Ephemeral,
    });

    await refreshDashboard(rootInteraction, guildConfig, guildId);
}

// ─── Staff Role ───────────────────────────────────────────────────────────────

async function handleStaffRole(selectInteraction, rootInteraction, guildConfig, guildId, client) {
    await selectInteraction.deferUpdate();

    const roleSelect = new RoleSelectMenuBuilder()
        .setCustomId('ticket_cfg_staff_role')
        .setPlaceholder('Sélectionnez le rôle staff…')
        .setMaxValues(1);

    const row = new ActionRowBuilder().addComponents(roleSelect);

    await selectInteraction.followUp({
        embeds: [
            new EmbedBuilder()
                .setTitle('🛡️ Changer le rôle staff')
                .setDescription(
                    `**Actuel :** ${guildConfig.ticketStaffRoleId ? `<@&${guildConfig.ticketStaffRoleId}>` : '`Non défini`'}\n\nSélectionnez le rôle qui doit avoir accès à la gestion des tickets.`,
                )
                .setColor(getColor('info')),
        ],
        components: [row],
        flags: MessageFlags.Ephemeral,
    });

    const roleCollector = rootInteraction.channel.createMessageComponentCollector({
        componentType: ComponentType.RoleSelect,
        filter: i =>
            i.user.id === selectInteraction.user.id && i.customId === 'ticket_cfg_staff_role',
        time: 60_000,
        max: 1,
    });

    roleCollector.on('collect', async roleInteraction => {
        await roleInteraction.deferUpdate();
        const role = roleInteraction.roles.first();

        guildConfig.ticketStaffRoleId = role.id;
        await client.db.set(getGuildConfigKey(guildId), guildConfig);

        await roleInteraction.followUp({
            embeds: [successEmbed('✅ Rôle staff défini', `Le rôle staff est désormais ${role}.`)],
            flags: MessageFlags.Ephemeral,
        });

        await refreshDashboard(rootInteraction, guildConfig, guildId);
    });

    roleCollector.on('end', (collected, reason) => {
        if (reason === 'time' && collected.size === 0) {
            selectInteraction
                .followUp({
                    embeds: [errorEmbed('Délai dépassé', 'Aucun rôle sélectionné. Le rôle staff n\'a pas été modifié.')],
                    flags: MessageFlags.Ephemeral,
                })
                .catch(() => {});
        }
    });
}

// ─── Open Tickets Category ────────────────────────────────────────────────────

async function handleOpenCategory(selectInteraction, rootInteraction, guildConfig, guildId, client) {
    await selectInteraction.deferUpdate();

    const channelSelect = new ChannelSelectMenuBuilder()
        .setCustomId('ticket_cfg_open_cat')
        .setPlaceholder('Sélectionnez une catégorie…')
        .addChannelTypes(ChannelType.GuildCategory)
        .setMaxValues(1);

    const row = new ActionRowBuilder().addComponents(channelSelect);

    await selectInteraction.followUp({
        embeds: [
            new EmbedBuilder()
                .setTitle('📁 Changer la catégorie des tickets ouverts')
                .setDescription(
                    `**Actuelle :** ${guildConfig.ticketCategoryId ? `<#${guildConfig.ticketCategoryId}>` : '`Non définie`'}\n\nSélectionnez la catégorie où les nouveaux tickets seront créés.`,
                )
                .setColor(getColor('info')),
        ],
        components: [row],
        flags: MessageFlags.Ephemeral,
    });

    const catCollector = rootInteraction.channel.createMessageComponentCollector({
        componentType: ComponentType.ChannelSelect,
        filter: i =>
            i.user.id === selectInteraction.user.id && i.customId === 'ticket_cfg_open_cat',
        time: 60_000,
        max: 1,
    });

    catCollector.on('collect', async catInteraction => {
        await catInteraction.deferUpdate();
        const category = catInteraction.channels.first();

        guildConfig.ticketCategoryId = category.id;
        await client.db.set(getGuildConfigKey(guildId), guildConfig);

        await catInteraction.followUp({
            embeds: [
                successEmbed(
                    '✅ Catégorie ouverte mise à jour',
                    `Les nouveaux tickets seront créés dans **${category.name}**.`,
                ),
            ],
            flags: MessageFlags.Ephemeral,
        });

        await refreshDashboard(rootInteraction, guildConfig, guildId);
    });

    catCollector.on('end', (collected, reason) => {
        if (reason === 'time' && collected.size === 0) {
            selectInteraction
                .followUp({
                    embeds: [
                        errorEmbed('Délai dépassé', 'Aucune catégorie sélectionnée. Le réglage n\'a pas été modifié.'),
                    ],
                    flags: MessageFlags.Ephemeral,
                })
                .catch(() => {});
        }
    });
}

// ─── Closed Tickets Category ──────────────────────────────────────────────────

async function handleClosedCategory(
    selectInteraction,
    rootInteraction,
    guildConfig,
    guildId,
    client,
) {
    await selectInteraction.deferUpdate();

    const channelSelect = new ChannelSelectMenuBuilder()
        .setCustomId('ticket_cfg_closed_cat')
        .setPlaceholder('Sélectionnez une catégorie…')
        .addChannelTypes(ChannelType.GuildCategory)
        .setMaxValues(1);

    const row = new ActionRowBuilder().addComponents(channelSelect);

    await selectInteraction.followUp({
        embeds: [
            new EmbedBuilder()
                .setTitle('📂 Changer la catégorie des tickets fermés')
                .setDescription(
                    `**Actuelle :** ${guildConfig.ticketClosedCategoryId ? `<#${guildConfig.ticketClosedCategoryId}>` : '`Non définie`'}\n\nSélectionnez la catégorie où les tickets fermés seront déplacés.`,
                )
                .setColor(getColor('info')),
        ],
        components: [row],
        flags: MessageFlags.Ephemeral,
    });

    const catCollector = rootInteraction.channel.createMessageComponentCollector({
        componentType: ComponentType.ChannelSelect,
        filter: i =>
            i.user.id === selectInteraction.user.id && i.customId === 'ticket_cfg_closed_cat',
        time: 60_000,
        max: 1,
    });

    catCollector.on('collect', async catInteraction => {
        await catInteraction.deferUpdate();
        const category = catInteraction.channels.first();

        guildConfig.ticketClosedCategoryId = category.id;
        await client.db.set(getGuildConfigKey(guildId), guildConfig);

        await catInteraction.followUp({
            embeds: [
                successEmbed(
                    '✅ Catégorie fermée mise à jour',
                    `Les tickets fermés seront déplacés vers **${category.name}**.`,
                ),
            ],
            flags: MessageFlags.Ephemeral,
        });

        await refreshDashboard(rootInteraction, guildConfig, guildId);
    });

    catCollector.on('end', (collected, reason) => {
        if (reason === 'time' && collected.size === 0) {
            selectInteraction
                .followUp({
                    embeds: [
                        errorEmbed('Délai dépassé', 'Aucune catégorie sélectionnée. Le réglage n\'a pas été modifié.'),
                    ],
                    flags: MessageFlags.Ephemeral,
                })
                .catch(() => {});
        }
    });
}

// ─── Max Tickets per User ─────────────────────────────────────────────────────

async function handleMaxTickets(selectInteraction, rootInteraction, guildConfig, guildId, client) {
    const modal = new ModalBuilder()
        .setCustomId('ticket_cfg_max_tickets')
        .setTitle('Définir le nombre max de tickets')
        .addComponents(
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('max_tickets_input')
                    .setLabel('Tickets ouverts max (1–10)')
                    .setStyle(TextInputStyle.Short)
                    .setValue(String(guildConfig.maxTicketsPerUser || 3))
                    .setMaxLength(2)
                    .setMinLength(1)
                    .setRequired(true)
                    .setPlaceholder('3'),
            ),
        );

    await selectInteraction.showModal(modal);

    const submitted = await selectInteraction
        .awaitModalSubmit({
            filter: i =>
                i.customId === 'ticket_cfg_max_tickets' && i.user.id === selectInteraction.user.id,
            time: 120_000,
        })
        .catch(() => null);

    if (!submitted) return;

    const raw = submitted.fields.getTextInputValue('max_tickets_input').trim();
    const newMax = parseInt(raw, 10);

    if (isNaN(newMax) || newMax < 1 || newMax > 10) {
        await submitted.reply({
            embeds: [errorEmbed('Valeur invalide', 'Le nombre maximum de tickets doit être un entier compris entre **1** et **10**.')],
            flags: MessageFlags.Ephemeral,
        });
        return;
    }

    guildConfig.maxTicketsPerUser = newMax;
    await client.db.set(getGuildConfigKey(guildId), guildConfig);

    await submitted.reply({
        embeds: [
            successEmbed(
                '✅ Nombre max de tickets mis à jour',
                `Les utilisateurs peuvent avoir au plus **${newMax}** ticket${newMax !== 1 ? 's' : ''} ouvert${newMax !== 1 ? 's' : ''} à la fois.`,
            ),
        ],
        flags: MessageFlags.Ephemeral,
    });

    await refreshDashboard(rootInteraction, guildConfig, guildId);
}

// ─── Ticket Type Buttons ──────────────────────────────────────────────────────

function slugifyLabel(label) {
    return label
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '') || 'ticket';
}

async function handleAddType(selectInteraction, rootInteraction, guildConfig, guildId, client) {
    const modal = new ModalBuilder()
        .setCustomId('ticket_cfg_add_type')
        .setTitle('➕ Ajouter un bouton')
        .addComponents(
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('type_emoji_input')
                    .setLabel('Emoji du bouton')
                    .setStyle(TextInputStyle.Short)
                    .setPlaceholder('🎁')
                    .setMaxLength(40)
                    .setMinLength(1)
                    .setRequired(true),
            ),
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('type_label_input')
                    .setLabel('Nom du bouton (80 caractères max)')
                    .setStyle(TextInputStyle.Short)
                    .setPlaceholder('Lot du concours')
                    .setMaxLength(80)
                    .setMinLength(1)
                    .setRequired(true),
            ),
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('type_desc_input')
                    .setLabel('Description (optionnelle)')
                    .setStyle(TextInputStyle.Paragraph)
                    .setPlaceholder('Fait apparaître ce texte dans la modale de création')
                    .setMaxLength(100)
                    .setRequired(false),
            ),
        );

    await selectInteraction.showModal(modal);

    const submitted = await selectInteraction
        .awaitModalSubmit({
            filter: i => i.customId === 'ticket_cfg_add_type' && i.user.id === selectInteraction.user.id,
            time: 120_000,
        })
        .catch(() => null);

    if (!submitted) return;

    const emoji = submitted.fields.getTextInputValue('type_emoji_input').trim();
    const label = submitted.fields.getTextInputValue('type_label_input').trim();
    const description = submitted.fields.getTextInputValue('type_desc_input').trim();

    if (emoji.length === 0 || /\s/.test(emoji) || emoji.length > 40) {
        await submitted.reply({
            embeds: [errorEmbed('Emoji invalide', 'L\'emoji doit être un seul emoji ou une emoji personnalisée (ex. `🎁` ou `<:nom:123456789>`).')],
            flags: MessageFlags.Ephemeral,
        });
        return;
    }

    if (label.length === 0 || label.length > 80) {
        await submitted.reply({
            embeds: [errorEmbed('Nom invalide', 'Le nom du bouton doit contenir entre **1** et **80** caractères.')],
            flags: MessageFlags.Ephemeral,
        });
        return;
    }

    const currentTypes = resolveTicketTypes(guildConfig);
    const baseSlug = slugifyLabel(label);
    let slug = baseSlug;
    let n = 2;
    while (currentTypes.some((t) => t.slug === slug || t.id === slug)) {
        slug = `${baseSlug}-${n++}`;
    }

    const newType = { id: slug, emoji, label, description, slug };
    guildConfig.ticketTypes = [...currentTypes, newType];
    await client.db.set(getGuildConfigKey(guildId), guildConfig);

    const panelUpdated = await updateLivePanel(client, rootInteraction.guild, guildConfig);

    await submitted.reply({
        embeds: [
            successEmbed(
                '✅ Bouton ajouté',
                `Le bouton **${emoji} ${label}** a été ajouté au panneau.${
                    panelUpdated
                        ? '\nLe panneau de tickets en direct a été actualisé.'
                        : '\n> **Remarque :** le panneau en direct n\'a pas pu être localisé. Le bouton apparaîtra à la prochaine exécution de `/ticket setup`.'
                }`,
            ),
        ],
        flags: MessageFlags.Ephemeral,
    });

    await refreshDashboard(rootInteraction, guildConfig, guildId);
}

async function handleRemoveType(selectInteraction, rootInteraction, guildConfig, guildId, client) {
    const currentTypes = resolveTicketTypes(guildConfig);

    if (currentTypes.length <= 1) {
        await selectInteraction.reply({
            embeds: [errorEmbed('Impossible', 'Au moins un bouton doit rester sur le panneau.')],
            flags: MessageFlags.Ephemeral,
        });
        return;
    }

    await selectInteraction.deferUpdate();

    const typeSelect = new StringSelectMenuBuilder()
        .setCustomId('ticket_cfg_remove_type')
        .setPlaceholder('Sélectionnez le bouton à supprimer…')
        .setMinValues(1)
        .setMaxValues(1)
        .addOptions(
            currentTypes.map((t) =>
                new StringSelectMenuOptionBuilder()
                    .setLabel(`${t.emoji} ${t.label}`)
                    .setDescription(t.description ? t.description.substring(0, 100) : t.id)
                    .setValue(t.id),
            ),
        );

    await selectInteraction.followUp({
        embeds: [
            new EmbedBuilder()
                .setTitle('➖ Supprimer un bouton')
                .setDescription('Sélectionnez la catégorie de ticket à retirer du panneau.')
                .setColor(getColor('info')),
        ],
        components: [new ActionRowBuilder().addComponents(typeSelect)],
        flags: MessageFlags.Ephemeral,
    });

    const typeCollector = rootInteraction.channel.createMessageComponentCollector({
        componentType: ComponentType.StringSelect,
        filter: i => i.user.id === selectInteraction.user.id && i.customId === 'ticket_cfg_remove_type',
        time: 60_000,
        max: 1,
    });

    typeCollector.on('collect', async (typeInteraction) => {
        await typeInteraction.deferUpdate();
        const removedId = typeInteraction.values[0];

        const remaining = resolveTicketTypes(guildConfig).filter((t) => t.id !== removedId);
        guildConfig.ticketTypes = remaining;
        await client.db.set(getGuildConfigKey(guildId), guildConfig);

        const panelUpdated = await updateLivePanel(client, rootInteraction.guild, guildConfig);

        await typeInteraction.followUp({
            embeds: [
                successEmbed(
                    '✅ Bouton supprimé',
                    `Le bouton a été retiré du panneau.${
                        panelUpdated
                            ? '\nLe panneau de tickets en direct a été actualisé.'
                            : '\n> **Remarque :** le panneau en direct n\'a pas pu être localisé.'
                    }`,
                ),
            ],
            flags: MessageFlags.Ephemeral,
        });

        await refreshDashboard(rootInteraction, guildConfig, guildId);
    });

    typeCollector.on('end', (collected, reason) => {
        if (reason === 'time' && collected.size === 0) {
            selectInteraction
                .followUp({
                    embeds: [errorEmbed('Délai dépassé', 'Aucun bouton sélectionné. Aucune modification n\'a été effectuée.')],
                    flags: MessageFlags.Ephemeral,
                })
                .catch(() => {});
        }
    });
}

// ─── DM on Close Toggle ───────────────────────────────────────────────────────

async function handleDmOnClose(btnInteraction, rootInteraction, guildConfig, guildId, client) {
    await btnInteraction.deferUpdate();

    const newState = guildConfig.dmOnClose === false;
    guildConfig.dmOnClose = newState;
    await client.db.set(getGuildConfigKey(guildId), guildConfig);

    await btnInteraction.followUp({
        embeds: [
            successEmbed(
                '✅ MP à la fermeture mis à jour',
                `Les utilisateurs **${newState ? 'recevront désormais' : 'ne recevront plus'}** un message privé à la fermeture de leur ticket.`,
            ),
        ],
        flags: MessageFlags.Ephemeral,
    });

    await refreshDashboard(rootInteraction, guildConfig, guildId);
}

// ─── Feedback Logs Channel ────────────────────────────────────────────────────

async function handleLogsChannel(selectInteraction, rootInteraction, guildConfig, guildId, client) {
    await selectInteraction.deferUpdate();

    const channelSelect = new ChannelSelectMenuBuilder()
        .setCustomId('ticket_cfg_logs_channel')
        .setPlaceholder('Sélectionnez un salon…')
        .addChannelTypes(ChannelType.GuildText)
        .setMaxValues(1);

    await selectInteraction.followUp({
        embeds: [
            new EmbedBuilder()
                .setTitle('🎫 Sélectionner le salon des logs tickets')
                .setDescription('Choisissez où les retours et événements des tickets (ouverture, fermeture, réclamation, etc.) seront envoyés.')
                .setColor(getColor('info'))
        ],
        components: [new ActionRowBuilder().addComponents(channelSelect)],
        flags: MessageFlags.Ephemeral
    });

    const collector = rootInteraction.channel.createMessageComponentCollector({
        componentType: ComponentType.ChannelSelect,
        filter: i => i.user.id === selectInteraction.user.id && i.customId === 'ticket_cfg_logs_channel',
        time: 60_000,
        max: 1
    });

    collector.on('collect', async channelInteraction => {
        await channelInteraction.deferUpdate();
        const channel = channelInteraction.channels.first();

        guildConfig.ticketLogsChannelId = channel.id;
        await client.db.set(getGuildConfigKey(guildId), guildConfig);

        await channelInteraction.followUp({
            embeds: [successEmbed('✅ Salon des logs mis à jour', `Les logs de tickets seront envoyés dans ${channel}`)],
            flags: MessageFlags.Ephemeral
        });

        await refreshDashboard(rootInteraction, guildConfig, guildId);
    });

    collector.on('end', (collected, reason) => {
        if (reason === 'time' && collected.size === 0) {
            selectInteraction.followUp({
                embeds: [errorEmbed('Délai dépassé', 'Aucun salon sélectionné. Aucune modification n\'a été effectuée.')],
                flags: MessageFlags.Ephemeral
            }).catch(() => {});
        }
    });
}

// ─── Transcript Channel ───────────────────────────────────────────────────────

async function handleTranscriptChannel(selectInteraction, rootInteraction, guildConfig, guildId, client) {
    await selectInteraction.deferUpdate();

    const channelSelect = new ChannelSelectMenuBuilder()
        .setCustomId('ticket_cfg_transcript_channel')
        .setPlaceholder('Sélectionnez un salon…')
        .addChannelTypes(ChannelType.GuildText)
        .setMaxValues(1);

    await selectInteraction.followUp({
        embeds: [
            new EmbedBuilder()
                .setTitle('📜 Sélectionner le salon des transcripts')
                .setDescription('Choisissez où les transcripts générés seront envoyés à la suppression des tickets.')
                .setColor(getColor('info'))
        ],
        components: [new ActionRowBuilder().addComponents(channelSelect)],
        flags: MessageFlags.Ephemeral
    });

    const collector = rootInteraction.channel.createMessageComponentCollector({
        componentType: ComponentType.ChannelSelect,
        filter: i => i.user.id === selectInteraction.user.id && i.customId === 'ticket_cfg_transcript_channel',
        time: 60_000,
        max: 1
    });

    collector.on('collect', async channelInteraction => {
        await channelInteraction.deferUpdate();
        const channel = channelInteraction.channels.first();

        guildConfig.ticketTranscriptChannelId = channel.id;
        await client.db.set(getGuildConfigKey(guildId), guildConfig);

        await channelInteraction.followUp({
            embeds: [successEmbed('✅ Salon des transcripts mis à jour', `Les transcripts seront envoyés dans ${channel}`)],
            flags: MessageFlags.Ephemeral
        });

        await refreshDashboard(rootInteraction, guildConfig, guildId);
    });

    collector.on('end', (collected, reason) => {
        if (reason === 'time' && collected.size === 0) {
            selectInteraction.followUp({
                embeds: [errorEmbed('Délai dépassé', 'Aucun salon sélectionné. Aucune modification n\'a été effectuée.')],
                flags: MessageFlags.Ephemeral
            }).catch(() => {});
        }
    });
}

// ─── Check User Tickets ───────────────────────────────────────────────────────

async function handleCheckUser(selectInteraction, rootInteraction, guildConfig, guildId, client) {
    await selectInteraction.deferUpdate();

    const userSelect = new UserSelectMenuBuilder()
        .setCustomId('ticket_cfg_check_user')
        .setPlaceholder('Sélectionnez un utilisateur…')
        .setMaxValues(1);

    const row = new ActionRowBuilder().addComponents(userSelect);

    await selectInteraction.followUp({
        embeds: [
            new EmbedBuilder()
                .setTitle('🔍 Vérifier les tickets d\'un utilisateur')
                .setDescription('Sélectionnez un utilisateur pour voir son nombre actuel de tickets ouverts.')
                .setColor(getColor('info')),
        ],
        components: [row],
        flags: MessageFlags.Ephemeral,
    });

    const userCollector = rootInteraction.channel.createMessageComponentCollector({
        componentType: ComponentType.UserSelect,
        filter: i =>
            i.user.id === selectInteraction.user.id && i.customId === 'ticket_cfg_check_user',
        time: 60_000,
        max: 1,
    });

    userCollector.on('collect', async userInteraction => {
        await userInteraction.deferUpdate();
        const targetUser = userInteraction.users.first();
        const maxTickets = guildConfig.maxTicketsPerUser || 3;
        const openCount = await getUserTicketCount(guildId, targetUser.id);
        const atLimit = openCount >= maxTickets;

        await userInteraction.followUp({
            embeds: [
                new EmbedBuilder()
                    .setTitle(`🎫 Vérification — ${targetUser.username}`)
                    .setDescription(
                        `**Tickets ouverts :** ${openCount} / ${maxTickets}\n` +
                            `**Restants :** ${Math.max(0, maxTickets - openCount)}\n\n` +
                            (atLimit
                                ? '⚠️ Cet utilisateur a atteint sa limite de tickets.'
                                : '✅ Cet utilisateur peut encore ouvrir des tickets.'),
                    )
                    .setColor(atLimit ? getColor('error') : getColor('success'))
                    .setThumbnail(targetUser.displayAvatarURL({ size: 64 }))
                    .setTimestamp(),
            ],
            flags: MessageFlags.Ephemeral,
        });
    });

    userCollector.on('end', (collected, reason) => {
        if (reason === 'time' && collected.size === 0) {
            selectInteraction
                .followUp({
                    embeds: [errorEmbed('Délai dépassé', 'Aucun utilisateur sélectionné.')],
                    flags: MessageFlags.Ephemeral,
                })
                .catch(() => {});
        }
    });
}

// ─── Delete Ticket System ─────────────────────────────────────────────────────

async function handleDeleteSystem(btnInteraction, rootInteraction, guildConfig, guildId, client) {
    const deleteModal = new ModalBuilder()
        .setCustomId('ticket_delete_confirm_modal')
        .setTitle('Supprimer le système de tickets')
        .addComponents(
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('delete_confirmation')
                    .setLabel('Tapez "SUPPRIMER" pour confirmer')
                    .setStyle(TextInputStyle.Short)
                    .setPlaceholder('SUPPRIMER')
                    .setMaxLength(9)
                    .setMinLength(9)
                    .setRequired(true),
            ),
        );

    await btnInteraction.showModal(deleteModal);

    const submitted = await btnInteraction
        .awaitModalSubmit({
            filter: i => i.customId === 'ticket_delete_confirm_modal' && i.user.id === btnInteraction.user.id,
            time: 120_000,
        })
        .catch(() => null);

    if (!submitted) {
        await refreshDashboard(rootInteraction, guildConfig, guildId);
        return;
    }

    const confirmation = submitted.fields.getTextInputValue('delete_confirmation').trim();

    if (confirmation !== 'SUPPRIMER') {
        await submitted.reply({
            embeds: [errorEmbed('Confirmation incorrecte', 'Vous devez taper "SUPPRIMER" exactement pour confirmer la suppression.')],
            flags: MessageFlags.Ephemeral,
        });
        await refreshDashboard(rootInteraction, guildConfig, guildId);
        return;
    }

    await submitted.deferUpdate();

    const keysToDelete = [
        'ticketPanelChannelId',
        'ticketPanelMessageId',
        'ticketStaffRoleId',
        'ticketCategoryId',
        'ticketClosedCategoryId',
        'ticketPanelMessage',
        'ticketButtonLabel',
        'maxTicketsPerUser',
        'dmOnClose',
        'ticketLogsChannelId',
        'ticketTranscriptChannelId',
    ];

    // Delete the panel embed from Discord
    if (guildConfig.ticketPanelChannelId) {
        try {
            const panelChannel = await client.guilds.cache.get(guildId)?.channels.fetch(guildConfig.ticketPanelChannelId).catch(() => null);
            if (panelChannel) {
                if (guildConfig.ticketPanelMessageId) {
                    const panelMessage = await panelChannel.messages.fetch(guildConfig.ticketPanelMessageId).catch(() => null);
                    if (panelMessage) await panelMessage.delete().catch(() => {});
                } else {
                    // Fallback: scan for the panel by button customId
                    const messages = await panelChannel.messages.fetch({ limit: 50 }).catch(() => null);
                    if (messages) {
                        const found = messages.find(
                            m => m.author.id === client.user.id &&
                                (m.components?.[0]?.components?.[0]?.customId === 'create_ticket' ||
                                    m.components?.[0]?.components?.[0]?.customId?.startsWith('create_ticket_direct:'))
                        );
                        if (found) await found.delete().catch(() => {});
                    }
                }
            }
        } catch (panelDeleteError) {
            logger.warn('Could not delete ticket panel message:', panelDeleteError.message);
        }
    }

    // Clear all open ticket records for the guild from the database
    try {
        const { pgConfig } = await import('../../../config/postgres.js');
        if (client.db?.db?.pool && typeof client.db.db.isAvailable === 'function' && client.db.db.isAvailable()) {
            await client.db.db.pool.query(
                `DELETE FROM ${pgConfig.tables.tickets} WHERE guild_id = $1`,
                [guildId]
            );
        }
    } catch (ticketDeleteError) {
        logger.warn('Could not clear ticket records from database:', ticketDeleteError.message);
    }

    // Also remove key-based ticket records + reset the ticket counter
    try {
        const { getTicketCounterKey } = await import('../../../utils/database.js');
        if (typeof client.db?.list === 'function') {
            const ticketKeys = await client.db.list(`guild:${guildId}:ticket:`).catch(() => []);
            for (const key of ticketKeys) {
                await client.db.delete(key).catch(() => {});
            }
        }
        if (typeof client.db?.delete === 'function') {
            await client.db.delete(getTicketCounterKey(guildId)).catch(() => {});
        }
    } catch (cleanupError) {
        logger.warn('Could not clear key-based ticket records:', cleanupError.message);
    }

    for (const key of keysToDelete) {
        delete guildConfig[key];
    }
    await client.db.set(getGuildConfigKey(guildId), guildConfig);

    await submitted.followUp({
        embeds: [
            successEmbed(
                '✅ Système de tickets supprimé',
                'Toute la configuration du système de tickets a été effacée. Lancez `/ticket setup` pour le reconfigurer.',
            ),
        ],
        flags: MessageFlags.Ephemeral,
    });

    await InteractionHelper.safeEditReply(rootInteraction, {
        embeds: [
            new EmbedBuilder()
                .setTitle('🗑️ Système de tickets supprimé')
                .setDescription('La configuration du système de tickets a été effacée.')
                .setColor(getColor('error'))
                .setTimestamp(),
        ],
        components: [],
    }).catch(() => {});
}