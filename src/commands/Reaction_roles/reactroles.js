import { getColor } from '../../config/bot.js';
import { SlashCommandBuilder, PermissionFlagsBits, ChannelType, ActionRowBuilder, ChannelSelectMenuBuilder, StringSelectMenuBuilder, StringSelectMenuOptionBuilder, RoleSelectMenuBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, ButtonBuilder, ButtonStyle, MessageFlags, ComponentType, EmbedBuilder, LabelBuilder, CheckboxBuilder, TextDisplayBuilder } from 'discord.js';
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
                        .setMaxLength(2000)
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

const MAX_PANEL_TITLE = 256;
const MAX_PANEL_DESCRIPTION = 2000;

function normalizePanelTitle(title) {
    return String(title || '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, MAX_PANEL_TITLE);
}

function normalizePanelDescription(description) {
    return String(description || '').slice(0, MAX_PANEL_DESCRIPTION);
}

function buildPanelContent(title, description, roleObjects) {
    return normalizePanelDescription(description);
}

function buildReactionRoleSelect(roleObjects) {
    return new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
            .setCustomId('reaction_roles')
            .setPlaceholder('Sélectionnez vos rôles')
            .setMinValues(0)
            .setMaxValues(Math.min(roleObjects.length, 25))
            .addOptions(
                roleObjects.map(role => ({
                    label: role.name.substring(0, 100),
                    value: role.id
                }))
            )
    );
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
    const row = buildReactionRoleSelect(roles);

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
                description: `Panneau de rôles par réaction créé par <@${interaction.user.id}>`,
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
}

// ─── Dashboard Subcommand ─────────────────────────────────────────────────────

async function handleDashboard(interaction, selectedPanelId, onBack = null) {
    const deferSuccess = await InteractionHelper.safeDeferOrUpdate(interaction, {});
    if (!deferSuccess) return;

    const guildId = interaction.guild.id;
    const guild = interaction.guild;
    const client = interaction.client;

    let panels = await getAllReactionRoleMessages(client, guildId);

    // Filter out panels whose messages no longer exist
    const validPanels = [];
    for (const panel of panels || []) {
        const normalized = {
            ...panel,
            roles: Array.isArray(panel.roles)
                ? panel.roles
                : (panel.roles && typeof panel.roles === 'object' ? Object.values(panel.roles) : []),
        };

        const channel = guild.channels.cache.get(normalized.channelId);
        if (!channel) {
            await deleteReactionRoleMessage(client, guildId, normalized.messageId).catch(() => {});
            continue;
        }
        
        const msg = await channel.messages.fetch(normalized.messageId).catch(() => null);
        if (!msg) {
            await deleteReactionRoleMessage(client, guildId, normalized.messageId).catch(() => {});
            continue;
        }
        validPanels.push(normalized);
    }

    let activePanelData = null;
    if (validPanels.length > 0) {
        if (selectedPanelId) {
            activePanelData = validPanels.find(p => p.messageId === selectedPanelId) || null;
        } else {
            activePanelData = validPanels[0];
        }
    } else if (selectedPanelId) {
        return await InteractionHelper.sendErrorNotice(interaction, 'Ce panneau n\'existe plus ou a été supprimé.');
    }

    const discordMsg = activePanelData ? await fetchPanelDiscordMessage(guild, activePanelData) : null;
    await showPanelDashboard(interaction, activePanelData, discordMsg, guildId, guild, onBack, validPanels);

    InteractionHelper.armDashboardSession(interaction);

    let rootInteraction = interaction;
    const collector = interaction.channel.createMessageComponentCollector({
        filter: i =>
            i.user.id === interaction.user.id &&
            (i.customId === `rr_opts_${guildId}` || i.customId === `rr_switch_${guildId}`),
        time: 300_000,
    });

    const buttonCollector = interaction.channel.createMessageComponentCollector({
        componentType: ComponentType.Button,
        filter: i =>
            i.user.id === interaction.user.id &&
            (i.customId === `rr_edit_text_${guildId}` ||
                i.customId === `rr_delete_${guildId}` ||
                i.customId === `rr_create_${guildId}` ||
                i.customId === `rr_list_${guildId}` ||
                (onBack && i.customId === `rr_back_${guildId}`)),
        time: 300_000,
    });

    collector.on('collect', async ci => {
        InteractionHelper.armDashboardSession(interaction);
        try {
            if (ci.customId === `rr_switch_${guildId}`) {
                await ci.deferUpdate().catch(() => {});

                const next = validPanels.find(p => p.messageId === ci.values[0]);
                if (!next) {
                    await sendPanelNotice(ci, 'Ce panneau n\'existe plus.');
                    return;
                }

                activePanelData = next;
                await showPanelDashboard(
                    rootInteraction,
                    next,
                    await fetchPanelDiscordMessage(guild, next),
                    guildId,
                    guild,
                    onBack,
                    validPanels,
                );
                return;
            }

            if (ci.customId === `rr_opts_${guildId}`) {
                if (!activePanelData) {
                    await sendPanelNotice(ci, 'Aucun panneau sélectionné. Clique sur **➕ Créer un panneau** pour en ajouter un.');
                    return;
                }

                const option = ci.values[0];
                switch (option) {
                    case 'add_role':
                        await handleAddRole(ci, rootInteraction, activePanelData, guildId, guild, client, onBack, validPanels);
                        break;
                    case 'remove_role':
                        await handleRemoveRole(ci, rootInteraction, activePanelData, validPanels, guildId, guild, client, onBack);
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
        InteractionHelper.armDashboardSession(interaction);
        try {
            if (btnInteraction.customId === `rr_list_${guildId}`) {
                await btnInteraction.deferUpdate().catch(() => {});
                await showPanelList(rootInteraction, guildId, guild, validPanels);
                return;
            }

            if (onBack && btnInteraction.customId === `rr_back_${guildId}`) {
                await btnInteraction.deferUpdate().catch(() => {});
                await onBack(btnInteraction);
                return;
            }

            if (btnInteraction.customId === `rr_create_${guildId}`) {
                const created = await handleCreatePanel(btnInteraction, rootInteraction, guildId, guild, client, onBack);
                if (created) {
                    activePanelData = created.panelData;
                    validPanels.length = 0;
                    validPanels.push(...created.panels);
                }
                return;
            }

            if (!activePanelData) {
                await sendPanelNotice(btnInteraction, 'Aucun panneau sélectionné. Clique sur **➕ Créer un panneau** pour en ajouter un.');
                return;
            }

            if (btnInteraction.customId === `rr_edit_text_${guildId}`) {
                await handleEditText(btnInteraction, rootInteraction, activePanelData, guildId, guild, client, onBack, validPanels);
            } else if (btnInteraction.customId === `rr_delete_${guildId}`) {
                const remaining = await handleDeletePanel(
                    btnInteraction,
                    rootInteraction,
                    activePanelData,
                    validPanels,
                    guildId,
                    guild,
                    client,
                    onBack,
                );

                if (Array.isArray(remaining)) {
                    activePanelData = remaining[0] || null;
                    await showPanelDashboard(
                        rootInteraction,
                        activePanelData,
                        activePanelData ? await fetchPanelDiscordMessage(guild, activePanelData) : null,
                        guildId,
                        guild,
                        onBack,
                        remaining,
                    );
                }
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
        if (reason !== 'manual') {
            buttonCollector.stop();
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

        await msg.edit({
            content: buildPanelContent(panelData.title, panelData.description, roleObjects),
            components: [buildReactionRoleSelect(roleObjects)],
        });
    } catch (error) {
        logger.warn('Could not rebuild live reaction role panel:', error.message);
    }
}

// ─── Create Panel Flow ─────────────────────────────────────────────────────────

function validateSelectableRole(role, guild) {
    if (!role) return 'Rôle introuvable.';
    if (role.id === guild.id) return 'Impossible d\'utiliser @everyone.';
    if (role.managed) return 'Les rôles gérés (intégration/bot) ne peuvent pas être utilisés.';
    if (hasDangerousPermissions(role)) return 'Ce rôle possède des permissions sensibles (Administrateur, Gérer le serveur, etc.).';
    if (role.position >= guild.members.me.roles.highest.position) return 'Ce rôle est au-dessus de mon rôle le plus haut. Place mon rôle au-dessus d\'abord.';
    return null;
}

async function handleCreatePanel(btnInteraction, rootInteraction, guildId, guild, client, onBack = null) {
    const me = guild.members.me;

    if (!me.permissions.has(PermissionFlagsBits.ManageRoles)) {
        await btnInteraction.deferUpdate().catch(() => {});
        await sendPanelNotice(btnInteraction, 'J\'ai besoin de la permission **Gérer les rôles** pour créer un panneau.');
        return;
    }

    if (!me.permissions.has(PermissionFlagsBits.ManageChannels)) {
        await btnInteraction.deferUpdate().catch(() => {});
        await sendPanelNotice(btnInteraction, 'J\'ai besoin de la permission **Gérer les salons** pour créer un panneau.');
        return;
    }

    // ── Étape 1 : salon ──────────────────────────────────────────────────────
    const channelSelect = new ChannelSelectMenuBuilder()
        .setCustomId('rr_create_channel')
        .setPlaceholder('Étape 1/3 — Choisis le salon du panneau…')
        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
        .setMaxValues(1);

    await btnInteraction.deferUpdate().catch(() => {});
    await btnInteraction.followUp({
        embeds: [
            new EmbedBuilder()
                .setTitle('➕ Nouveau panneau — Étape 1/3')
                .setDescription('Choisis le **salon** où le panneau de rôles sera publié.')
                .setColor(getColor('info')),
        ],
        components: [new ActionRowBuilder().addComponents(channelSelect)],
        flags: MessageFlags.Ephemeral,
    }).catch(() => {});

    const channelCollector = rootInteraction.channel.createMessageComponentCollector({
        componentType: ComponentType.ChannelSelect,
        filter: i => i.user.id === btnInteraction.user.id && i.customId === 'rr_create_channel',
        time: 120_000,
        max: 1,
    });

    const channelStep = await new Promise(resolve => {
        channelCollector.on('collect', async chanInteraction => {
            const channel = chanInteraction.channels.first();

            // Ne pas déférer : l'interaction doit rester disponible pour showModal()
            const reject = async message => {
                channelCollector.stop('invalid');
                resolve({ ok: false, message });
            };

            if (!channel) {
                await reject('Salon invalide.');
                return;
            }
            if (!channel.permissionsFor(me).has(PermissionFlagsBits.SendMessages)) {
                await reject(`Je n'ai pas la permission d'envoyer des messages dans ${channel}.`);
                return;
            }
            if (!channel.permissionsFor(me).has(PermissionFlagsBits.AddReactions)) {
                await reject(`Je n'ai pas la permission d'ajouter des réactions dans ${channel}.`);
                return;
            }

            channelCollector.stop('picked');
            resolve({ ok: true, channel, modalHost: chanInteraction });
        });
        channelCollector.on('end', (c, reason) => {
            if (c.size === 0) resolve({ ok: false, reason });
        });
    });

    if (!channelStep.ok) {
        if (channelStep.message) {
            await sendPanelNotice(btnInteraction, channelStep.message);
        } else {
            await sendPanelNotice(btnInteraction, '⏱️ Étape 1 expirée. Aucun panneau n\'a été créé. Clique à nouveau sur **➕ Créer un panneau**.');
        }
        return;
    }

    const targetChannel = channelStep.channel;

    // ── Étape 2 : description ───────────────────────────────────────────────
    const textModal = new ModalBuilder()
        .setCustomId('rr_create_text')
        .setTitle('Étape 2/3 — Texte du panneau')
        .addComponents(
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('description_input')
                    .setLabel('Description affichée au-dessus du menu')
                    .setStyle(TextInputStyle.Paragraph)
                    .setPlaceholder('Choisis tes rôles ci-dessous 👇')
                    .setMaxLength(2000)
                    .setMinLength(1)
                    .setRequired(true),
            ),
        );

    try {
        await channelStep.modalHost.showModal(textModal);
    } catch {
        await sendPanelNotice(btnInteraction, '⏱️ La fenêtre de saisie a expiré. Aucun panneau n\'a été créé.');
        return;
    }

    const textSubmitted = await channelStep.modalHost
        .awaitModalSubmit({
            filter: i => i.customId === 'rr_create_text' && i.user.id === btnInteraction.user.id,
            time: 120_000,
        })
        .catch(() => null);

    if (!textSubmitted) {
        await sendPanelNotice(btnInteraction, '⏱️ Étape 2 expirée. Aucun panneau n\'a été créé.');
        return;
    }

    const description = textSubmitted.fields.getTextInputValue('description_input').trim();
    await textSubmitted.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => {});

    // ── Étape 3 : rôles ─────────────────────────────────────────────────────
    const roleSelect = new RoleSelectMenuBuilder()
        .setCustomId('rr_create_roles')
        .setPlaceholder('Étape 3/3 — Choisis tes rôles…')
        .setMinValues(1)
        .setMaxValues(25);

    await textSubmitted.editReply({
        embeds: [
            new EmbedBuilder()
                .setTitle('➕ Nouveau panneau — Étape 3/3')
                .setDescription(
                    `**Salon :** ${targetChannel}\n\nSélectionne entre **1 et 25 rôles** à proposer. Ils apparaîtront dans le menu du panneau.`,
                )
                .setColor(getColor('info')),
        ],
        components: [new ActionRowBuilder().addComponents(roleSelect)],
    }).catch(() => {});

    const roleCollector = rootInteraction.channel.createMessageComponentCollector({
        componentType: ComponentType.RoleSelect,
        filter: i => i.user.id === btnInteraction.user.id && i.customId === 'rr_create_roles',
        time: 120_000,
        max: 1,
    });

    const roleStep = await new Promise(resolve => {
        roleCollector.on('collect', async roleInteraction => {
            await roleInteraction.deferUpdate().catch(() => {});

            const picked = roleInteraction.roles;
            const rejected = [];
            const accepted = [];

            for (const role of picked.values()) {
                const problem = validateSelectableRole(role, guild);
                if (problem) rejected.push(`**${role.name}** — ${problem}`);
                else if (accepted.some(r => r.id === role.id)) continue;
                else accepted.push(role);
            }

            if (accepted.length === 0) {
                await roleInteraction.followUp({
                    embeds: [warningEmbed('Aucun rôle valide', rejected.join('\n'))],
                    flags: MessageFlags.Ephemeral,
                });
                return;
            }

            roleCollector.stop('picked');
            resolve({ ok: true, roles: accepted, rejected });
        });
        roleCollector.on('end', (c, reason) => {
            if (c.size === 0) resolve({ ok: false, reason });
        });
    });

    if (!roleStep.ok) {
        await sendPanelNotice(textSubmitted, '⏱️ Étape 3 expirée. Aucun panneau n\'a été créé.');
        return;
    }

    const roles = roleStep.roles;

    // ── Création ────────────────────────────────────────────────────────────
    let message;
    try {
        message = await targetChannel.send({
            content: buildPanelContent('', description, roles),
            components: [buildReactionRoleSelect(roles)],
        });
    } catch (error) {
        logger.error('Could not send reaction role panel message:', error);
        await sendPanelNotice(textSubmitted, 'Impossible d\'envoyer le message dans ce salon. Vérifie mes permissions.');
        return;
    }

    try {
        await createReactionRoleMessage(
            client,
            guildId,
            targetChannel.id,
            message.id,
            roles.map(r => r.id),
            '',
            description,
        );
    } catch (error) {
        logger.error('Could not persist reaction role panel:', error);
        await message.delete().catch(() => {});
        await sendPanelNotice(textSubmitted, 'Erreur lors de l\'enregistrement du panneau. Le message a été supprimé, réessaie.');
        return;
    }

    const roleMentions = roles.map(r => r.toString()).join(', ');

    await textSubmitted.editReply({
        embeds: [
            successEmbed(
                '✅ Panneau créé',
                `**Salon :** ${targetChannel}\n**Rôles :** ${roles.length}\n**Liste :** ${roleMentions}\n\n[Voir le panneau](${message.url})`,
            ),
        ],
        components: [],
    }).catch(() => {});

    if (roleStep.rejected.length > 0) {
        await sendPanelNotice(
            textSubmitted,
            `Rôles ignorés :\n${roleStep.rejected.join('\n')}`,
        );
    }

    try {
        await logEvent({
            client,
            guildId,
            eventType: EVENT_TYPES.REACTION_ROLE_CREATE,
            data: {
                description: `Panneau de rôles par réaction créé par <@${btnInteraction.user.id}>`,
                userId: btnInteraction.user.id,
                channelId: targetChannel.id,
                fields: [
                    { name: '📍 Salon', value: targetChannel.toString(), inline: true },
                    { name: '📊 Rôles', value: `${roles.length} rôles`, inline: true },
                    { name: '🏷️ Liste des rôles', value: roleMentions, inline: false },
                    { name: '🔗 Lien du message', value: message.url, inline: false },
                ],
            },
        });
    } catch (logError) {
        logger.warn('Failed to log reaction role creation:', logError);
    }

    // Rafraîchit le dashboard racine pour afficher le nouveau panneau
    const refreshedPanels = await getAllReactionRoleMessages(client, guildId).catch(() => []);
    const newPanelData = (refreshedPanels || []).find(p => p.messageId === message.id) || {
        messageId: message.id,
        channelId: targetChannel.id,
        roles: roles.map(r => r.id),
        title: '',
        description,
    };

    if (rootInteraction.message && rootInteraction.message.editable) {
        await rootInteraction.message.edit({
            embeds: [buildPanelDashboardEmbed(newPanelData, message, guild, refreshedPanels || [])],
            components: buildPanelDashboardComponents(
                newPanelData,
                guildId,
                guild,
                onBack,
                refreshedPanels || [],
            ),
        }).catch(() => {});
    }

    return { panelData: newPanelData, panels: refreshedPanels || [] };
}

// ─── View Builders ────────────────────────────────────────────────────────────

function buildPanelDashboardEmbed(panelData, discordMsg, guild, allPanels) {
    if (!panelData) {
        return new EmbedBuilder()
            .setTitle('🎭 Tableau de bord des rôles par réaction')
            .setDescription(
                allPanels.length > 1
                    ? `**${allPanels.length}** panneaux existent, mais aucun n'est valide. Utilise **➕ Créer un panneau** pour en ajouter un nouveau.`
                    : 'Aucun panneau n\'existe encore.\n\nClique sur **➕ Créer un panneau** ci-dessous : je te guiderai pour choisir le salon, le texte et les rôles.',
            )
            .setColor(getColor('info'))
            .addFields(
                { name: '🎭 Rôles', value: '`Aucun`', inline: true },
            )
            .setFooter({ text: 'Le tableau de bord se ferme après 5 minutes d\'inactivité' })
            .setTimestamp();
    }

    const channel = guild.channels.cache.get(panelData.channelId);
    const title = panelData.title || discordMsg?.embeds?.[0]?.title || 'Panneau sans titre';
    const roleList =
        panelData.roles.length > 0
            ? panelData.roles.map(id => `<@&${id}>`).join(', ')
            : '`Aucun`';

    return new EmbedBuilder()
        .setTitle('🎭 Tableau de bord des rôles par réaction')
        .setDescription(
            `**Titre :** ${title}\n\nSélectionnez une option ci-dessous pour modifier un réglage.${discordMsg ? `\n[Cliquez ici pour voir le panneau](${discordMsg.url})` : ''}`,
        )
        .setColor(getColor('info'))
        .addFields(
            { name: '📍 Salon', value: channel ? `<#${channel.id}>` : '`Introuvable`', inline: true },
            { name: '🎭 Rôles', value: `\`${panelData.roles.length} / 25\``, inline: true },
            { name: '📊 Panneaux', value: `\`${allPanels.length}\``, inline: true },
            { name: '🏷️ Liste des rôles', value: roleList, inline: false },
        )
        .setFooter({ text: 'Le tableau de bord se ferme après 5 minutes d\'inactivité' })
        .setTimestamp();
}

function buildPanelDashboardComponents(panelData, guildId, guild, onBack, allPanels) {
    const backButton = typeof onBack === 'function'
        ? new ButtonBuilder()
            .setCustomId(`rr_back_${guildId}`)
            .setLabel('Retour au panel')
            .setStyle(ButtonStyle.Danger)
            .setEmoji('↩️')
        : null;

    const createButton = new ButtonBuilder()
        .setCustomId(`rr_create_${guildId}`)
        .setLabel('Créer un panneau')
        .setStyle(ButtonStyle.Success)
        .setEmoji('➕');

    const listButton = new ButtonBuilder()
        .setCustomId(`rr_list_${guildId}`)
        .setLabel('Voir les panneaux')
        .setStyle(ButtonStyle.Secondary)
        .setEmoji('📋');

    if (!panelData) {
        return [
            new ActionRowBuilder().addComponents(
                ...(backButton ? [createButton, listButton, backButton] : [createButton, listButton]),
            ),
        ];
    }

    const editTextButton = new ButtonBuilder()
        .setCustomId(`rr_edit_text_${guildId}`)
        .setLabel('Modifier le texte')
        .setStyle(ButtonStyle.Primary)
        .setEmoji('✏️');

    const deleteButton = new ButtonBuilder()
        .setCustomId(`rr_delete_${guildId}`)
        .setLabel('Supprimer')
        .setStyle(ButtonStyle.Danger)
        .setEmoji('🗑️');

    const rows = [
        new ActionRowBuilder().addComponents(editTextButton, deleteButton),
        new ActionRowBuilder().addComponents(
            ...(backButton ? [createButton, listButton, backButton] : [createButton, listButton])
        ),
    ];

    if (allPanels.length > 1) {
        const panelSelect = new StringSelectMenuBuilder()
            .setCustomId(`rr_switch_${guildId}`)
            .setPlaceholder('Panneau affiché actuellement…')
            .addOptions(
                allPanels.slice(0, 25).map(p => {
                    const ch = guild.channels.cache.get(p.channelId);
                    const isCurrent = p.messageId === panelData.messageId;
                    return new StringSelectMenuOptionBuilder()
                        .setLabel(`${isCurrent ? '📍 ' : ''}${(ch ? ch.name : 'salon inconnu').substring(0, 90)}`)
                        .setDescription(`${p.roles.length} rôle(s) • ${ch ? `<#${ch.id}>` : 'introuvable'}`.substring(0, 100))
                        .setValue(p.messageId)
                        .setDefault(isCurrent);
                })
            );
        rows.push(new ActionRowBuilder().addComponents(panelSelect));
    }

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
            ] : []),
        );

    rows.push(new ActionRowBuilder().addComponents(optionsSelect));

    return rows;
}

async function showPanelDashboard(interaction, panelData, discordMsg, guildId, guild, onBack = null, allPanels = []) {
    await InteractionHelper.safeEditReply(interaction, {
        embeds: [buildPanelDashboardEmbed(panelData, discordMsg, guild, allPanels)],
        components: buildPanelDashboardComponents(panelData, guildId, guild, onBack, allPanels),
    });
}

export async function openReactionRolesPanel(interaction, onBack) {
    return await handleDashboard(interaction, null, onBack);
}

// ─── Panel List View ──────────────────────────────────────────────────────────

function buildPanelListEmbed(guild, allPanels) {
    if (!allPanels.length) {
        return new EmbedBuilder()
            .setTitle('📋 Panneaux de rôles par réaction')
            .setDescription('Aucun panneau actif pour le moment.\n\nClique sur **➕ Créer un panneau** pour en ajouter un.')
            .setColor(getColor('info'))
            .setTimestamp();
    }

    const lines = allPanels.slice(0, 20).map((panel, index) => {
        const channel = guild.channels.cache.get(panel.channelId);
        const title = panel.title || 'Panneau sans titre';
        const roleCount = Array.isArray(panel.roles) ? panel.roles.length : 0;
        const channelLabel = channel ? `<#${channel.id}>` : '`salon introuvable`';
        return `**${index + 1}.** ${title}\n↪ Salon : ${channelLabel} • Rôles : \`${roleCount}\`\n↪ [Voir le message](https://discord.com/channels/${guild.id}/${panel.channelId}/${panel.messageId})`;
    });

    if (allPanels.length > 20) {
        lines.push(`\n*+${allPanels.length - 20} autre(s) panneau(x).*`);
    }

    return new EmbedBuilder()
        .setTitle('📋 Panneaux de rôles par réaction')
        .setDescription(lines.join('\n\n'))
        .setColor(getColor('info'))
        .setFooter({ text: `${allPanels.length} panneau(x) actif(s) • Sélectionne un panneau pour le gérer` })
        .setTimestamp();
}

function buildPanelListComponents(guildId, guild, allPanels) {
    const rows = [];

    if (allPanels.length > 0) {
        rows.push(new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder()
                .setCustomId(`rr_switch_${guildId}`)
                .setPlaceholder('Gérer un panneau…')
                .addOptions(
                    allPanels.slice(0, 25).map(p => {
                        const ch = guild.channels.cache.get(p.channelId);
                        const roleCount = Array.isArray(p.roles) ? p.roles.length : 0;
                        return new StringSelectMenuOptionBuilder()
                            .setLabel((p.title || (ch ? ch.name : 'Panneau sans titre')).substring(0, 90))
                            .setDescription(`${roleCount} rôle(s) • ${ch ? ch.name : 'introuvable'}`.substring(0, 100))
                            .setValue(p.messageId);
                    })
                )
        ));
    }

    rows.push(new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`rr_create_${guildId}`)
            .setLabel('Créer un panneau')
            .setStyle(ButtonStyle.Success)
            .setEmoji('➕'),
        new ButtonBuilder()
            .setCustomId(`rr_list_${guildId}`)
            .setLabel('Actualiser la liste')
            .setStyle(ButtonStyle.Secondary)
            .setEmoji('🔄')
    ));

    return rows;
}

async function showPanelList(interaction, guildId, guild, allPanels) {
    await InteractionHelper.safeEditReply(interaction, {
        embeds: [buildPanelListEmbed(guild, allPanels)],
        components: buildPanelListComponents(guildId, guild, allPanels),
    });
}

// ─── Panel Notices ────────────────────────────────────────────────────────────

async function sendPanelNotice(interaction, text) {
    try {
        if (interaction.replied || interaction.deferred) {
            await interaction.followUp({
                content: `<@${interaction.user.id}> ${text}`,
                flags: MessageFlags.Ephemeral,
            });
        } else {
            await interaction.reply({
                content: text,
                flags: MessageFlags.Ephemeral,
            });
        }
    } catch (error) {
        logger.debug('Reaction role panel notice failed:', error.message);
    }
}

// ─── Edit Panel Text ──────────────────────────────────────────────────────────

async function handleEditText(buttonInteraction, rootInteraction, panelData, guildId, guild, client, onBack = null, allPanels = []) {
    const MAX_TITLE = MAX_PANEL_TITLE;
    const MAX_DESC = MAX_PANEL_DESCRIPTION;

    const channel = guild.channels.cache.get(panelData.channelId);
    const discordMsg = channel
        ? await channel.messages.fetch(panelData.messageId).catch(() => null)
        : null;

    const fallbackTitle = discordMsg?.embeds?.[0]?.title || '';
    const fallbackDesc = discordMsg?.embeds?.[0]?.description || discordMsg?.content || '';

    // Discord rejette la modal si une valeur dépasse maxLength ou contient des sauts de ligne
    const currentTitle = String(panelData.title || fallbackTitle || 'Panneau de rôles')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, MAX_TITLE);
    const currentDesc = String(panelData.description || fallbackDesc || 'Choisis tes rôles ci-dessous 👇')
        .slice(0, MAX_DESC);

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
                    .setMaxLength(MAX_TITLE)
                    .setMinLength(1)
                    .setRequired(true),
            ),
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('panel_description')
                    .setLabel('Description')
                    .setStyle(TextInputStyle.Paragraph)
                    .setValue(currentDesc)
                    .setMaxLength(MAX_DESC)
                    .setMinLength(1)
                    .setRequired(true),
            ),
        );

    try {
        await buttonInteraction.showModal(modal);
    } catch (error) {
        logger.error('Error showing edit text modal:', {
            code: error?.code,
            message: error?.message,
            titleLength: currentTitle.length,
            descLength: currentDesc.length,
        });
        await fallbackEditTextPrompt(buttonInteraction, rootInteraction, panelData, guildId, guild, client, onBack, allPanels);
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
    await showPanelDashboard(rootInteraction, panelData, refreshedMsg, guildId, guild, onBack, allPanels);
}

// ─── Add Role ─────────────────────────────────────────────────────────────────

async function fallbackEditTextPrompt(buttonInteraction, rootInteraction, panelData, guildId, guild, client, onBack, allPanels) {
    await buttonInteraction.deferUpdate().catch(() => {});

    const retryButton = new ButtonBuilder()
        .setCustomId('rr_edit_text')
        .setLabel('📝 Modifier le texte')
        .setStyle(ButtonStyle.Primary);

    await buttonInteraction.followUp({
        embeds: [
            warningEmbed(
                'Édition du texte indisponible',
                'Clique sur le bouton ci-dessous pour rouvrir l\'éditeur.',
            ),
        ],
        components: [new ActionRowBuilder().addComponents(retryButton)],
        flags: MessageFlags.Ephemeral,
    }).catch(() => {});

    const collector = rootInteraction.channel.createMessageComponentCollector({
        componentType: ComponentType.Button,
        filter: i => i.user.id === buttonInteraction.user.id && i.customId === 'rr_edit_text',
        time: 120_000,
        max: 1,
    });

    collector.on('collect', async retryInteraction => {
        collector.stop('retried');
        await handleEditText(retryInteraction, rootInteraction, panelData, guildId, guild, client, onBack, allPanels);
    });

    collector.on('end', c => {
        if (c.size === 0) {
            sendPanelNotice(buttonInteraction, '⏱️ Édition annulée. Le panneau n\'a pas été modifié.');
        }
    });
}

async function handleAddRole(selectInteraction, rootInteraction, panelData, guildId, guild, client, onBack = null, allPanels = []) {
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
        await showPanelDashboard(rootInteraction, panelData, discordMsg, guildId, guild, onBack, allPanels);
    });

    roleCollector.on('end', (collected, reason) => {
        if (reason === 'time' && collected.size === 0) {
            InteractionHelper.sendErrorNotice(selectInteraction, 'Aucun rôle sélectionné. Aucune modification n\'a été effectuée.');
        }
    });
}

// ─── Remove Role ──────────────────────────────────────────────────────────────

async function handleRemoveRole(selectInteraction, rootInteraction, panelData, panels, guildId, guild, client, onBack = null) {
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
            await showPanelDashboard(rootInteraction, panelData, discordMsg, guildId, guild, onBack, panels);
        }
    });

    removeCollector.on('end', (collected, reason) => {
        if (reason === 'time' && collected.size === 0) {
            InteractionHelper.sendErrorNotice(selectInteraction, 'Aucun rôle sélectionné. Aucune modification n\'a été effectuée.');
        }
    });
}

// ─── Delete Panel ─────────────────────────────────────────────────────────────

async function handleDeletePanel(btnInteraction, rootInteraction, panelData, panels, guildId, guild, client, onBack = null) {
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
        await showPanelDashboard(rootInteraction, panelData, discordMsg, guildId, guild, onBack, panels);
        return;
    }

    const confirmed = submitted.fields.getCheckbox('delete_confirmation');

    if (!confirmed) {
        await InteractionHelper.sendErrorNotice(submitted, 'Vous devez cocher la case de confirmation pour supprimer le panneau.');
        await showPanelDashboard(rootInteraction, panelData, discordMsg, guildId, guild, onBack, panels);
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
                description: `Panneau de rôles par réaction supprimé par <@${submitted.user.id}>`,
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

    return panels;
}