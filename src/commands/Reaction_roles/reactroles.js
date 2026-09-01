import { getColor } from '../../config/bot.js';
import { SlashCommandBuilder, PermissionFlagsBits, ChannelType, ActionRowBuilder, StringSelectMenuBuilder, StringSelectMenuOptionBuilder, RoleSelectMenuBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, ButtonBuilder, ButtonStyle, MessageFlags, ComponentType, EmbedBuilder, LabelBuilder, CheckboxBuilder, TextDisplayBuilder } from 'discord.js';
import { createEmbed, successEmbed, infoEmbed, warningEmbed } from '../../utils/embeds.js';
import { logger } from '../../utils/logger.js';
import { handleInteractionError, createError, TitanBotError, ErrorTypes } from '../../utils/errorHandler.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { createReactionRoleMessage, hasDangerousPermissions, getAllReactionRoleMessages, deleteReactionRoleMessage } from '../../services/reactionRoleService.js';
import { logEvent, EVENT_TYPES } from '../../services/loggingService.js';

export default {
    data: new SlashCommandBuilder()
        .setName('reactroles')
        .setDescription('* Gérer les panneaux de rôles par réaction')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addSubcommand(subcommand =>
            subcommand
                .setName('setup')
                .setDescription('Créer un nouveau panneau de rôles par réaction')
                .addChannelOption(option => 
                    option.setName('channel')
                        .setDescription('Le salon où envoyer le message du panneau de rôles')
                        .setRequired(true)
                )
                .addStringOption(option =>
                    option.setName('description')
                        .setDescription('Description du panneau de rôles par réaction')
                        .setRequired(true)
                )
                .addRoleOption(option =>
                    option.setName('role1')
                        .setDescription('Premier rôle à ajouter')
                        .setRequired(true)
                )
                .addRoleOption(option =>
                    option.setName('role2')
                        .setDescription('Deuxième rôle à ajouter')
                        .setRequired(false)
                )
                .addRoleOption(option =>
                    option.setName('role3')
                        .setDescription('Troisième rôle à ajouter')
                        .setRequired(false)
                )
                .addRoleOption(option =>
                    option.setName('role4')
                        .setDescription('Quatrième rôle à ajouter')
                        .setRequired(false)
                )
                .addRoleOption(option =>
                    option.setName('role5')
                        .setDescription('Cinquième rôle à ajouter')
                        .setRequired(false)
                )
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('dashboard')
                .setDescription('Gérer et configurer vos panneaux de rôles par réaction')
                .addStringOption(option =>
                    option
                        .setName('panel')
                        .setDescription('Sélectionner un panneau de rôles à gérer')
                        .setRequired(false)
                        .setAutocomplete(true)
                )
        ),

    async execute(interaction) {
        const subcommand = interaction.options.getSubcommand();

        try {
            if (subcommand === 'setup') {
                await handleSetup(interaction);
            } else if (subcommand === 'dashboard') {
                const selectedPanelId = interaction.options.getString('panel');
                await handleDashboard(interaction, selectedPanelId);
            }
        } catch (error) {
            await handleInteractionError(interaction, error, {
                type: 'command',
                commandName: 'reactroles',
                subcommand: subcommand
            });
        }
    },

    async autocomplete(interaction) {
        if (interaction.commandName !== 'reactroles') return;
        if (interaction.options.getSubcommand() !== 'dashboard') return;

        try {
            const guildId = interaction.guild.id;
            const client = interaction.client;
            
            let panels;
            try {
                panels = await getAllReactionRoleMessages(client, guildId);
            } catch (dbError) {
                // If database query fails, just respond with empty
                await interaction.respond([]).catch(() => {});
                return;
            }

            if (!panels || panels.length === 0) {
                await interaction.respond([]).catch(() => {});
                return;
            }

            const guild = interaction.guild;
            
            // Filter out panels whose messages no longer exist and clean up stale data
            const validPanels = [];
            for (const panel of panels) {
                // Validate panel structure
                if (!panel.messageId || !panel.channelId) {
                    continue;
                }

                const channel = guild.channels.cache.get(panel.channelId);
                if (!channel) {
                    await deleteReactionRoleMessage(client, guildId, panel.messageId).catch(() => {});
                    continue;
                }
                
                const msg = await channel.messages.fetch(panel.messageId).catch(() => null);
                if (!msg) {
                    await deleteReactionRoleMessage(client, guildId, panel.messageId).catch(() => {});
                    continue;
                }
                validPanels.push(panel);
            }

            if (validPanels.length === 0) {
                await interaction.respond([]).catch(() => {});
                return;
            }

            const choices = await Promise.all(
                validPanels.slice(0, 25).map(async panel => {
                    try {
                        const channel = guild.channels.cache.get(panel.channelId);
                        if (!channel) return null;
                        
                        const msg = await channel.messages.fetch(panel.messageId).catch(() => null);
                        if (!msg) return null;
                        
                        const title = panel.title || msg?.embeds?.[0]?.title || 'Panneau sans titre';
                        const channelName = channel?.name ?? 'unknown';
                        
                        return {
                            name: `${title} (${channelName})`.substring(0, 100),
                            value: panel.messageId
                        };
                    } catch (e) {
                        return null;
                    }
                })
            );

            const validChoices = choices.filter(c => c !== null);
            await interaction.respond(validChoices).catch(() => {});
        } catch (error) {
            await interaction.respond([]).catch(() => {});
        }
    }
};

// ─── Panel Content Builder ────────────────────────────────────────────────────

function buildPanelContent(title, description, roleObjects) {
    const roleList = roleObjects.length > 0
        ? roleObjects.map(r => `• ${r}`).join('\n')
        : 'Aucun rôle disponible';

    const body = description || roleList;

    if (description) {
        return `${description}\n\n${roleList}`.substring(0, 2000);
    }

    return roleList.substring(0, 2000);
}

// ─── Setup Subcommand ─────────────────────────────────────────────────────────

async function handleSetup(interaction) {
    const deferSuccess = await InteractionHelper.safeDefer(interaction);
    if (!deferSuccess) return;
    
    logger.info(`Reaction role setup initiated by ${interaction.user.tag} in guild ${interaction.guild.name}`);
    
    const channel = interaction.options.getChannel('channel');
    const description = interaction.options.getString('description');
    const title = '';
    
    // Validate channel type
    if (channel.type !== ChannelType.GuildText && channel.type !== ChannelType.GuildAnnouncement) {
        throw createError(
            `Invalid channel type: ${channel.type}`,
            ErrorTypes.VALIDATION,
            'Veuillez sélectionner un salon textuel ou une annonce de canal.',
            { channelType: channel.type }
        );
    }
    
    // Check bot permissions
    if (!interaction.guild.members.me.permissions.has(PermissionFlagsBits.ManageRoles)) {
        throw createError(
            'Bot missing ManageRoles permission',
            ErrorTypes.PERMISSION,
            'J\'ai besoin de la permission `Gérer les rôles` pour configurer des rôles par réaction.',
            { permission: 'ManageRoles' }
        );
    }
    
    if (!channel.permissionsFor(interaction.guild.members.me).has(PermissionFlagsBits.SendMessages)) {
        throw createError(
            `Bot cannot send messages in ${channel.name}`,
            ErrorTypes.PERMISSION,
            `Je n'ai pas la permission d'envoyer des messages dans ${channel}.`,
            { channelId: channel.id }
        );
    }

    // Check if guild has reached max of 5 panels
    const existingPanels = await getAllReactionRoleMessages(interaction.client, interaction.guildId);
    if (existingPanels && existingPanels.length >= 5) {
        throw createError(
            'Panel limit reached',
            ErrorTypes.VALIDATION,
            'Votre serveur a atteint le maximum de 5 panneaux de rôles par réaction. Supprimez un panneau existant pour en créer un nouveau.',
            { maxPanels: 5, currentPanels: existingPanels.length }
        );
    }
    
    // Collect and validate roles
    const roles = [];
    const roleValidationErrors = [];
    
    for (let i = 1; i <= 5; i++) {
        const role = interaction.options.getRole(`role${i}`);
        if (role) {
            if (role.position >= interaction.guild.members.me.roles.highest.position) {
                roleValidationErrors.push(`**${role.name}** - Le rôle de mon bot est positionné plus bas que ce rôle dans la hiérarchie de votre serveur et ne peut pas l'attribuer`);
                continue;
            }
            
            if (hasDangerousPermissions(role)) {
                roleValidationErrors.push(`**${role.name}** - Ce rôle possède des permissions sensibles (Administrateur, Gérer le serveur, etc.)`);
                continue;
            }
            
            if (role.managed) {
                roleValidationErrors.push(`**${role.name}** - Ce rôle est géré (rôle d'intégration ou de bot)`);
                continue;
            }
            
            if (role.id === interaction.guild.id) {
                roleValidationErrors.push(`**${role.name}** - Impossible d'utiliser le rôle @everyone`);
                continue;
            }
            
            roles.push(role);
        }
    }
    
    if (roleValidationErrors.length > 0) {
        const errorMsg = `Les rôles suivants ne peuvent pas être ajoutés :\n${roleValidationErrors.join('\n')}`;
        
        if (roles.length === 0) {
            throw createError(
                'No valid roles provided',
                ErrorTypes.VALIDATION,
                errorMsg,
                { errors: roleValidationErrors }
            );
        }
        
        await interaction.followUp({
            embeds: [warningEmbed('Avertissement de validation des rôles', errorMsg)],
            ephemeral: true
        });
    }

    if (roles.length < 1) {
        throw createError(
            'No roles provided',
            ErrorTypes.VALIDATION,
            'Vous devez fournir au moins un rôle valide.',
            {}
        );
    }

    // Create the reaction role message
    const row = new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
            .setCustomId('reaction_roles')
            .setPlaceholder('Sélectionnez vos rôles')
            .setMinValues(0)
            .setMaxValues(roles.length)
            .addOptions(
                roles.map(role => ({
                    label: role.name,
                    description: `Ajouter/retirer le rôle ${role.name}`,
                    value: role.id,
                    emoji: '🎭'
                }))
            )
    );

    const message = await channel.send({
        content: buildPanelContent(title, description, roles),
        components: [row]
    });

    const roleIds = roles.map(role => role.id);
    await createReactionRoleMessage(
        interaction.client,
        interaction.guildId,
        channel.id,
        message.id,
        roleIds,
        title,
        description
    );
    
    logger.info(`Reaction role message created: ${message.id} with ${roles.length} roles by ${interaction.user.tag}`);

    try {
        await logEvent({
            client: interaction.client,
            guildId: interaction.guildId,
            eventType: EVENT_TYPES.REACTION_ROLE_CREATE,
            data: {
                description: `Panneau de rôles par réaction créé par ${interaction.user.tag}`,
                userId: interaction.user.id,
                channelId: channel.id,
                fields: [
                    {
                        name: '📝 Titre',
                        value: title,
                        inline: false
                    },
                    {
                        name: '📍 Salon',
                        value: channel.toString(),
                        inline: true
                    },
                    {
                        name: '📊 Rôles',
                        value: `${roles.length} rôles`,
                        inline: true
                    },
                    {
                        name: '🏷️ Liste des rôles',
                        value: roles.map(r => r.toString()).join(', '),
                        inline: false
                    },
                    {
                        name: '🔗 Lien du message',
                        value: message.url,
                        inline: false
                    }
                ]
            }
        });
    } catch (logError) {
        logger.warn('Failed to log reaction role creation:', logError);
    }

    await InteractionHelper.safeEditReply(interaction, {
        embeds: [successEmbed('Succès', `✅ Panneau de rôles par réaction créé dans ${channel} !\n\n${message.url}`)]
    });
}

// ─── Dashboard Subcommand ─────────────────────────────────────────────────────

async function handleDashboard(interaction, selectedPanelId) {
    const deferSuccess = await InteractionHelper.safeDefer(interaction, { flags: ['Ephemeral'] });
    if (!deferSuccess) return;

    const guildId = interaction.guild.id;
    const guild = interaction.guild;
    const client = interaction.client;

    let panels = await getAllReactionRoleMessages(client, guildId);

    if (!panels || panels.length === 0) {
        return await InteractionHelper.sendErrorNotice(interaction, 'Aucun panneau de rôles par réaction n\'existe encore. Utilisez `/reactroles setup` pour en créer un.');
    }

    // Filter out panels whose messages no longer exist
    const validPanels = [];
    for (const panel of panels) {
        const channel = guild.channels.cache.get(panel.channelId);
        if (!channel) {
            await deleteReactionRoleMessage(client, guildId, panel.messageId).catch(() => {});
            continue;
        }
        
        const msg = await channel.messages.fetch(panel.messageId).catch(() => null);
        if (!msg) {
            await deleteReactionRoleMessage(client, guildId, panel.messageId).catch(() => {});
            continue;
        }
        validPanels.push(panel);
    }

    if (validPanels.length === 0) {
        return await InteractionHelper.sendErrorNotice(interaction, 'Aucun panneau de rôles par réaction n\'existe encore. Utilisez `/reactroles setup` pour en créer un.');
    }

    // If a panel was selected, use it. Otherwise, pick a random one.
    let activePanelData = null;
    if (selectedPanelId) {
        activePanelData = validPanels.find(p => p.messageId === selectedPanelId);
        if (!activePanelData) {
            return await InteractionHelper.sendErrorNotice(interaction, 'Ce panneau n\'existe plus ou a été supprimé.');
        }
    } else {
        // Pick a random panel from valid panels
        activePanelData = validPanels[Math.floor(Math.random() * validPanels.length)];
    }

    const discordMsg = await fetchPanelDiscordMessage(guild, activePanelData);
    await showPanelDashboard(interaction, activePanelData, discordMsg, guildId, guild);

    let rootInteraction = interaction;
    const collector = interaction.channel.createMessageComponentCollector({
        filter: i =>
            i.user.id === interaction.user.id &&
            (i.customId === `rr_opts_${guildId}`),
        time: 600_000,
    });

    const buttonCollector = interaction.channel.createMessageComponentCollector({
        componentType: ComponentType.Button,
        filter: i =>
            i.user.id === interaction.user.id &&
            (i.customId === `rr_edit_text_${guildId}` ||
                i.customId === `rr_delete_${guildId}`),
        time: 600_000,
    });

    collector.on('collect', async ci => {
        try {
            if (ci.customId === `rr_opts_${guildId}`) {
                const option = ci.values[0];
                switch (option) {
                    case 'add_role':
                        await handleAddRole(ci, rootInteraction, activePanelData, guildId, guild, client);
                        break;
                    case 'remove_role':
                        await handleRemoveRole(ci, rootInteraction, activePanelData, validPanels, guildId, guild, client);
                        break;
                }
            }
        } catch (error) {
            logger.error('Error in reactroles dashboard collector:', error);
            const msg =
                error instanceof TitanBotError
                    ? error.userMessage || 'Une erreur est survenue.'
                    : 'Une erreur inattendue est survenue.';
            if (!ci.replied && !ci.deferred) await ci.deferUpdate().catch(() => {});
            await InteractionHelper.sendErrorNotice(ci, msg);
        }
    });

    buttonCollector.on('collect', async btnInteraction => {
        try {
            if (btnInteraction.customId === `rr_edit_text_${guildId}`) {
                await handleEditText(btnInteraction, rootInteraction, activePanelData, guildId, guild, client);
            } else if (btnInteraction.customId === `rr_delete_${guildId}`) {
                await handleDeletePanel(btnInteraction, rootInteraction, activePanelData, validPanels, guildId, guild, client, collector, buttonCollector);
            }
        } catch (error) {
            logger.error('Error in reactroles button collector:', error);
            const msg =
                error instanceof TitanBotError
                    ? error.userMessage || 'Une erreur est survenue.'
                    : 'Une erreur inattendue est survenue.';
            if (!btnInteraction.replied && !btnInteraction.deferred) await btnInteraction.deferUpdate().catch(() => {});
            await InteractionHelper.sendErrorNotice(btnInteraction, msg);
        }
    });

    collector.on('end', async (_, reason) => {
        buttonCollector.stop();
        if (reason === 'time') {
            await InteractionHelper.sendErrorNotice(interaction, 'Cette session du tableau de bord a expiré après 10 minutes d\'inactivité. Relancez `/reactroles dashboard` pour continuer.');
        }
    });
}

// ─── Discord Message Helpers ──────────────────────────────────────────────────

async function fetchPanelDiscordMessage(guild, panelData) {
    try {
        const channel = guild.channels.cache.get(panelData.channelId);
        if (!channel) return null;
        return await channel.messages.fetch(panelData.messageId).catch(() => null);
    } catch {
        return null;
    }
}

async function rebuildLivePanelMessage(guild, panelData) {
    try {
        const channel = guild.channels.cache.get(panelData.channelId);
        if (!channel) return;
        const msg = await channel.messages.fetch(panelData.messageId).catch(() => null);
        if (!msg) return;

        const roleObjects = panelData.roles
            .map(id => guild.roles.cache.get(id))
            .filter(Boolean);

        if (roleObjects.length === 0) return;

        const selectRow = new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder()
                .setCustomId('reaction_roles')
                .setPlaceholder('Sélectionnez vos rôles')
                .setMinValues(0)
                .setMaxValues(roleObjects.length)
                .addOptions(
                    roleObjects.map(r => ({
                        label: r.name.substring(0, 100),
                        description: `Ajouter/retirer le rôle ${r.name}`.substring(0, 100),
                        value: r.id,
                        emoji: '🎭',
                    })),
                ),
        );

        await msg.edit({
            content: buildPanelContent(panelData.title, panelData.description, roleObjects),
            components: [selectRow],
        });
    } catch (error) {
        logger.warn('Could not rebuild live reaction role panel:', error.message);
    }
}

// ─── View Builders ────────────────────────────────────────────────────────────

async function showPanelDashboard(interaction, panelData, discordMsg, guildId, guild) {
    const channel = guild.channels.cache.get(panelData.channelId);
    const title = panelData.title || discordMsg?.embeds?.[0]?.title || 'Panneau sans titre';
    const roleList =
        panelData.roles.length > 0
            ? panelData.roles.map(id => `<@&${id}>`).join(', ')
            : '`Aucun`';

    const embed = new EmbedBuilder()
        .setTitle('🎭 Tableau de bord des rôles par réaction')
        .setDescription(
            `**Titre :** ${title}\n\nSélectionnez une option ci-dessous pour modifier un réglage.${discordMsg ? `\n[Cliquez ici pour voir le panneau](${discordMsg.url})` : ''}`,
        )
        .setColor(getColor('info'))
        .addFields(
            { name: '📍 Salon', value: channel ? `<#${channel.id}>` : '`Introuvable`', inline: true },
            { name: '🎭 Rôles', value: `\`${panelData.roles.length} / 25\``, inline: true },
            { name: '\u200B', value: '\u200B', inline: true },
            { name: '🏷️ Liste des rôles', value: roleList, inline: false },
        )
        .setFooter({ text: 'Le tableau de bord se ferme après 10 minutes d\'inactivité' })
        .setTimestamp();

    const editTextButton = new ButtonBuilder()
        .setCustomId(`rr_edit_text_${guildId}`)
        .setLabel('Modifier le texte du panneau')
        .setStyle(ButtonStyle.Primary)
        .setEmoji('✏️');

    const deleteButton = new ButtonBuilder()
        .setCustomId(`rr_delete_${guildId}`)
        .setLabel('Supprimer le panneau')
        .setStyle(ButtonStyle.Danger)
        .setEmoji('🗑️');

    const optionsSelect = new StringSelectMenuBuilder()
        .setCustomId(`rr_opts_${guildId}`)
        .setPlaceholder('Sélectionnez une action…')
        .addOptions(
            new StringSelectMenuOptionBuilder()
                .setLabel('Ajouter un rôle')
                .setDescription('Ajouter un rôle à ce panneau (jusqu\'à 25 au total)')
                .setValue('add_role')
                .setEmoji('➕'),
            ...(panelData.roles.length > 0 ? [
                new StringSelectMenuOptionBuilder()
                    .setLabel('Retirer un rôle')
                    .setDescription('Retirer un rôle de ce panneau')
                    .setValue('remove_role')
                    .setEmoji('➖')
            ] : [])
        );

    await InteractionHelper.safeEditReply(interaction, {
        embeds: [embed],
        components: [
            new ActionRowBuilder().addComponents(editTextButton, deleteButton),
            new ActionRowBuilder().addComponents(optionsSelect),
        ],
    });
}

// ─── Edit Panel Text ──────────────────────────────────────────────────────────

async function handleEditText(buttonInteraction, rootInteraction, panelData, guildId, guild, client) {
    const channel = guild.channels.cache.get(panelData.channelId);
    const discordMsg = channel
        ? await channel.messages.fetch(panelData.messageId).catch(() => null)
        : null;

    const currentTitle = panelData.title || discordMsg?.embeds?.[0]?.title || '';
    const currentDesc = panelData.description || discordMsg?.embeds?.[0]?.description || '';

    const modal = new ModalBuilder()
        .setCustomId('rr_edit_text')
        .setTitle('Modifier le texte du panneau')
        .addComponents(
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('panel_title')
                    .setLabel('Titre')
                    .setStyle(TextInputStyle.Short)
                    .setValue(currentTitle)
                    .setMaxLength(256)
                    .setMinLength(1)
                    .setRequired(true),
            ),
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('panel_description')
                    .setLabel('Description')
                    .setStyle(TextInputStyle.Paragraph)
                    .setValue(currentDesc)
                    .setMaxLength(2048)
                    .setMinLength(1)
                    .setRequired(true),
            ),
        );

    try {
        await buttonInteraction.showModal(modal);
    } catch (error) {
        logger.error('Error showing edit text modal:', error);
        await InteractionHelper.sendErrorNotice(buttonInteraction, 'Impossible d\'afficher la modale d\'édition du texte du panneau. Veuillez réessayer.');
        return;
    }

    const submitted = await buttonInteraction
        .awaitModalSubmit({
            filter: i =>
                i.customId === 'rr_edit_text' && i.user.id === buttonInteraction.user.id,
            time: 120_000,
        })
        .catch(() => null);

    if (!submitted) return;

    const newTitle = submitted.fields.getTextInputValue('panel_title').trim();
    const newDesc = submitted.fields.getTextInputValue('panel_description').trim();

    panelData.title = newTitle;
    panelData.description = newDesc;
    const key = `reaction_roles:${guildId}:${panelData.messageId}`;
    await client.db.set(key, panelData).catch(err => {
        logger.warn('Could not save updated panel text:', err.message);
    });

    if (discordMsg) {
        const roleObjects = panelData.roles
            .map(id => guild.roles.cache.get(id))
            .filter(Boolean);
        await discordMsg
            .edit({ content: buildPanelContent(newTitle, newDesc, roleObjects) })
            .catch(err => {
                logger.warn('Could not edit live panel message:', err.message);
            });
    }

    await submitted.reply({
        embeds: [successEmbed('✅ Panneau mis à jour', 'Le titre et la description ont été mis à jour.')],
        flags: MessageFlags.Ephemeral,
    });

    const refreshedMsg = channel
        ? await channel.messages.fetch(panelData.messageId).catch(() => null)
        : null;
    await showPanelDashboard(rootInteraction, panelData, refreshedMsg, guildId, guild);
}

// ─── Add Role ─────────────────────────────────────────────────────────────────

async function handleAddRole(selectInteraction, rootInteraction, panelData, guildId, guild, client) {
    await selectInteraction.deferUpdate();

    if (panelData.roles.length >= 25) {
        await InteractionHelper.sendErrorNotice(selectInteraction, 'Ce panneau a déjà atteint le maximum de 25 rôles.');
        return;
    }

    const roleSelect = new RoleSelectMenuBuilder()
        .setCustomId('rr_add_role_pick')
        .setPlaceholder('Sélectionnez un rôle à ajouter…')
        .setMaxValues(1);

    await selectInteraction.followUp({
        embeds: [
            new EmbedBuilder()
                .setTitle('➕ Ajouter un rôle')
                .setDescription(
                    `**Rôles actuels :** ${panelData.roles.length}/25\n\nSélectionnez un rôle à ajouter à ce panneau.`,
                )
                .setColor(getColor('info')),
        ],
        components: [new ActionRowBuilder().addComponents(roleSelect)],
        flags: MessageFlags.Ephemeral,
    });

    const roleCollector = rootInteraction.channel.createMessageComponentCollector({
        componentType: ComponentType.RoleSelect,
        filter: i =>
            i.user.id === selectInteraction.user.id && i.customId === 'rr_add_role_pick',
        time: 60_000,
        max: 1,
    });

    roleCollector.on('collect', async roleInteraction => {
        await roleInteraction.deferUpdate();
        const role = roleInteraction.roles.first();

        if (panelData.roles.includes(role.id)) {
            await InteractionHelper.sendErrorNotice(roleInteraction, `${role} est déjà dans ce panneau.`);
            return;
        }
        if (role.id === guild.id) {
            await InteractionHelper.sendErrorNotice(roleInteraction, 'Vous ne pouvez pas utiliser @everyone.');
            return;
        }
        if (role.managed) {
            await InteractionHelper.sendErrorNotice(roleInteraction, 'Les rôles gérés (intégration/bot) ne peuvent pas être utilisés.');
            return;
        }
        if (hasDangerousPermissions(role)) {
            await InteractionHelper.sendErrorNotice(roleInteraction, 'Ce rôle possède des permissions sensibles (Administrateur, Gérer le serveur, etc.) et ne peut pas être utilisé.');
            return;
        }
        if (role.position >= guild.members.me.roles.highest.position) {
            await InteractionHelper.sendErrorNotice(roleInteraction, "Ce rôle est au-dessus de mon rôle le plus haut dans la hiérarchie. Placez mon rôle au-dessus d'abord.");
            return;
        }

        panelData.roles.push(role.id);
        const key = `reaction_roles:${guildId}:${panelData.messageId}`;
        await client.db.set(key, panelData);

        await rebuildLivePanelMessage(guild, panelData);

        await roleInteraction.followUp({
            embeds: [successEmbed('✅ Rôle ajouté', `${role} a été ajouté au panneau.`)],
            flags: MessageFlags.Ephemeral,
        });

        const channel = guild.channels.cache.get(panelData.channelId);
        const discordMsg = channel
            ? await channel.messages.fetch(panelData.messageId).catch(() => null)
            : null;
        await showPanelDashboard(rootInteraction, panelData, discordMsg, guildId, guild);
    });

    roleCollector.on('end', (collected, reason) => {
        if (reason === 'time' && collected.size === 0) {
            InteractionHelper.sendErrorNotice(selectInteraction, 'Aucun rôle sélectionné. Aucune modification n\'a été effectuée.');
        }
    });
}

// ─── Remove Role ──────────────────────────────────────────────────────────────

async function handleRemoveRole(selectInteraction, rootInteraction, panelData, panels, guildId, guild, client) {
    await selectInteraction.deferUpdate();

    const roleOptions = panelData.roles
        .map(id => {
            const role = guild.roles.cache.get(id);
            return role ? { label: role.name.substring(0, 100), value: id } : null;
        })
        .filter(Boolean);

    if (roleOptions.length === 0) {
        await InteractionHelper.sendErrorNotice(selectInteraction, 'Les rôles de ce panneau n\'existent plus sur le serveur.');
        return;
    }

    const removeSelect = new StringSelectMenuBuilder()
        .setCustomId('rr_remove_role_pick')
        .setPlaceholder('Sélectionnez un rôle à retirer…')
        .setMaxValues(1)
        .addOptions(
            roleOptions.map(r =>
                new StringSelectMenuOptionBuilder().setLabel(r.label).setValue(r.value).setEmoji('🎭'),
            ),
        );

    await selectInteraction.followUp({
        embeds: [
            new EmbedBuilder()
                .setTitle('➖ Retirer un rôle')
                .setDescription('Sélectionnez le rôle que vous souhaitez retirer de ce panneau.')
                .setColor(getColor('info')),
        ],
        components: [new ActionRowBuilder().addComponents(removeSelect)],
        flags: MessageFlags.Ephemeral,
    });

    const removeCollector = rootInteraction.channel.createMessageComponentCollector({
        componentType: ComponentType.StringSelect,
        filter: i =>
            i.user.id === selectInteraction.user.id && i.customId === 'rr_remove_role_pick',
        time: 60_000,
        max: 1,
    });

    removeCollector.on('collect', async removeInteraction => {
        await removeInteraction.deferUpdate();
        const roleId = removeInteraction.values[0];
        const role = guild.roles.cache.get(roleId);

        panelData.roles = panelData.roles.filter(id => id !== roleId);

        if (panelData.roles.length === 0) {
            const channel = guild.channels.cache.get(panelData.channelId);
            if (channel) {
                const msg = await channel.messages.fetch(panelData.messageId).catch(() => null);
                if (msg) await msg.delete().catch(() => {});
            }
            await deleteReactionRoleMessage(client, guildId, panelData.messageId);

            await removeInteraction.followUp({
                embeds: [
                    successEmbed(
                        '✅ Rôle retiré',
                        'C\'était le dernier rôle du panneau. Le panneau a été supprimé.',
                    ),
                ],
                flags: MessageFlags.Ephemeral,
            });

            // Remove the deleted panel from the array
            const panelIndex = panels.findIndex(p => p.messageId === panelData.messageId);
            if (panelIndex > -1) {
                panels.splice(panelIndex, 1);
            }

            if (panels.length === 0) {
                await InteractionHelper.safeEditReply(rootInteraction, {
                    embeds: [
                        new EmbedBuilder()
                            .setTitle('📋 Tableau de bord des rôles par réaction')
                            .setDescription('Aucun panneau ne subsiste. Utilisez `/reactroles setup` pour en créer un.')
                            .setColor(getColor('info')),
                    ],
                    components: [],
                });
            } else {
                // Dashboard closed after last role removed
                await InteractionHelper.safeEditReply(rootInteraction, {
                    embeds: [
                        new EmbedBuilder()
                            .setTitle('📋 Tableau de bord des rôles par réaction')
                            .setDescription('Panneau supprimé. Lancez `/reactroles dashboard` pour gérer un autre panneau.')
                            .setColor(getColor('success')),
                    ],
                    components: [],
                });
            }
        } else {
            const key = `reaction_roles:${guildId}:${panelData.messageId}`;
            await client.db.set(key, panelData);
            await rebuildLivePanelMessage(guild, panelData);

            await removeInteraction.followUp({
                embeds: [
                    successEmbed(
                        '✅ Rôle retiré',
                        `${role ? role.toString() : `<@&${roleId}>`} a été retiré du panneau.`,
                    ),
                ],
                flags: MessageFlags.Ephemeral,
            });

            const channel = guild.channels.cache.get(panelData.channelId);
            const discordMsg = channel
                ? await channel.messages.fetch(panelData.messageId).catch(() => null)
                : null;
            await showPanelDashboard(rootInteraction, panelData, discordMsg, guildId, guild);
        }
    });

    removeCollector.on('end', (collected, reason) => {
        if (reason === 'time' && collected.size === 0) {
            InteractionHelper.sendErrorNotice(selectInteraction, 'Aucun rôle sélectionné. Aucune modification n\'a été effectuée.');
        }
    });
}

// ─── Delete Panel ─────────────────────────────────────────────────────────────

async function handleDeletePanel(btnInteraction, rootInteraction, panelData, panels, guildId, guild, client, collector, buttonCollector) {
    const channel = guild.channels.cache.get(panelData.channelId);
    const discordMsg = channel
        ? await channel.messages.fetch(panelData.messageId).catch(() => null)
        : null;
    const title = panelData.title || discordMsg?.embeds?.[0]?.title || 'ce panneau';

    const deleteModal = new ModalBuilder()
        .setCustomId('rr_delete_confirm_modal')
        .setTitle('Supprimer le panneau de rôles par réaction');

    const deleteWarningText = new TextDisplayBuilder()
        .setContent(`⚠️ Vous êtes sur le point de supprimer définitivement le panneau **${title}**. Cela supprimera le message Discord et toutes les attributions de rôles associées.`);

    const deleteCheckbox = new CheckboxBuilder()
        .setCustomId('delete_confirmation')
        .setDefault(false);

    const deleteCheckboxLabel = new LabelBuilder()
        .setLabel('Je confirme — cette action est irréversible')
        .setCheckboxComponent(deleteCheckbox);

    deleteModal
        .addTextDisplayComponents(deleteWarningText)
        .addLabelComponents(deleteCheckboxLabel);

    await btnInteraction.showModal(deleteModal);

    const submitted = await btnInteraction
        .awaitModalSubmit({
            filter: i => i.customId === 'rr_delete_confirm_modal' && i.user.id === btnInteraction.user.id,
            time: 120_000,
        })
        .catch(() => null);

    if (!submitted) {
        await showPanelDashboard(rootInteraction, panelData, discordMsg, guildId, guild);
        return;
    }

    const confirmed = submitted.fields.getCheckbox('delete_confirmation');

    if (!confirmed) {
        await InteractionHelper.sendErrorNotice(submitted, 'Vous devez cocher la case de confirmation pour supprimer le panneau.');
        await showPanelDashboard(rootInteraction, panelData, discordMsg, guildId, guild);
        return;
    }

    await submitted.deferUpdate();

    if (discordMsg) {
        await discordMsg.delete().catch(() => {});
    }
    await deleteReactionRoleMessage(client, guildId, panelData.messageId);

    try {
        await logEvent({
            client,
            guildId,
            eventType: EVENT_TYPES.REACTION_ROLE_DELETE,
            data: {
                description: `Panneau de rôles par réaction supprimé par ${submitted.user.tag}`,
                userId: submitted.user.id,
                channelId: panelData.channelId,
                fields: [
                    { name: '📋 Panneau', value: title, inline: true },
                    { name: '📍 Salon', value: channel ? channel.toString() : 'Inconnu', inline: true },
                ],
            },
        });
    } catch (logErr) {
        logger.warn('Failed to log reaction role deletion:', logErr);
    }

    await submitted.followUp({
        embeds: [successEmbed('✅ Panneau supprimé', `**${title}** a été supprimé.`)],
        flags: MessageFlags.Ephemeral,
    });

    // Remove the deleted panel from the array
    const panelIndex = panels.findIndex(p => p.messageId === panelData.messageId);
    if (panelIndex > -1) {
        panels.splice(panelIndex, 1);
    }

    if (panels.length === 0) {
        collector.stop();
        buttonCollector.stop();
        await InteractionHelper.safeEditReply(rootInteraction, {
            embeds: [
                new EmbedBuilder()
                    .setTitle('📋 Tableau de bord des rôles par réaction')
                    .setDescription('Aucun panneau ne subsiste. Utilisez `/reactroles setup` pour en créer un.')
                    .setColor(getColor('info')),
            ],
            components: [],
        });
    } else {
        // Close the dashboard after deletion
        collector.stop();
        buttonCollector.stop();
        await InteractionHelper.safeEditReply(rootInteraction, {
            embeds: [
                new EmbedBuilder()
                    .setTitle('📋 Tableau de bord des rôles par réaction')
                    .setDescription('Panneau supprimé. Lancez `/reactroles dashboard` pour gérer un autre panneau.')
                    .setColor(getColor('success')),
            ],
            components: [],
        });
    }
}