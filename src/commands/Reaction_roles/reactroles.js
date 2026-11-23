import { SlashCommandBuilder, PermissionFlagsBits, ChannelType, ActionRowBuilder, ChannelSelectMenuBuilder, StringSelectMenuBuilder, StringSelectMenuOptionBuilder, RoleSelectMenuBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, ButtonBuilder, ButtonStyle, MessageFlags, ComponentType, LabelBuilder, CheckboxBuilder, TextDisplayBuilder } from 'discord.js';
import { logger } from '../../utils/logger.js';
import { handleInteractionError, createError, XlwyBotError, ErrorTypes } from '../../utils/errorHandler.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { createEmbed, errorEmbed, infoEmbed, successEmbed, warningEmbed } from '../../utils/embeds.js';
import {
    brandFooter,
    buildNavRow,
    buildPageJumpRow,
    formatNumber,
    guildIconUrl,
    progressBar,
} from '../../ui/kit.js';
import { createReactionRoleMessage, hasDangerousPermissions, getAllReactionRoleMessages, deleteReactionRoleMessage } from '../../services/reactionRoleService.js';
import { logEvent, EVENT_TYPES } from '../../services/loggingService.js';

const MENTION_OPTIONS = { parse: [] };
const PANEL_LIST_PAGE_SIZE = 5;
const RR_LIST_PREV = 'rr_list_prev';
const RR_LIST_NEXT = 'rr_list_next';
const RR_LIST_JUMP = 'rr_list_jump';
const UI_CONTEXT = 'Rôles par réaction';

function noticeEmbed(kind, message, context = UI_CONTEXT, title = null) {
    const embed = kind === 'success'
        ? successEmbed(message, title ?? '✅ Succès')
        : kind === 'warning'
            ? warningEmbed(message, title ?? '⚠️ Avertissement')
            : kind === 'error'
                ? errorEmbed(message)
                : infoEmbed(message, title ?? 'ℹ️ Informations');
    if (title) embed.setTitle(title);
    embed.setFooter(brandFooter(context));
    return embed;
}

function stepEmbed(step, description) {
    return createEmbed({
        title: `Nouveau panneau · étape ${step}/3`,
        description: `\`${progressBar(step, 3, 3)}\` ${description}`,
        color: 'info',
        footer: brandFooter('Création de panneau'),
    });
}

function shortRoleList(roleIds, guild, max = 6) {
    const names = (Array.isArray(roleIds) ? roleIds : [])
        .map((id) => guild.roles.cache.get(id)?.name)
        .filter(Boolean);
    if (names.length === 0) return '`Aucun`';
    const shown = names.slice(0, max).map((name) => `\`${String(name).slice(0, 40)}\``).join(', ');
    const extra = names.length - max;
    return extra > 0 ? `${shown} • +${formatNumber(extra)} autre(s)` : shown;
}

function panelUrl(guild, panel) {
    return `https://discord.com/channels/${guild.id}/${panel.channelId}/${panel.messageId}`;
}

export default {
    data: new SlashCommandBuilder()
        .setName('reactroles')
        .setDescription('Gérer les panneaux de rôles par réaction')
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
                        const channelName = channel?.name ?? 'inconnu';
                        
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
            .setPlaceholder('Sélectionne tes rôles')
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
            'Sélectionne un salon textuel ou un salon d’annonces.',
            { channelType: channel.type }
        );
    }
    
    // Check bot permissions
    if (!interaction.guild.members.me.permissions.has(PermissionFlagsBits.ManageRoles)) {
        throw createError(
            'Bot missing ManageRoles permission',
            ErrorTypes.PERMISSION,
            'J’ai besoin de la permission `Gérer les rôles` pour configurer des rôles par réaction.',
            { permission: 'ManageRoles' }
        );
    }
    
    if (!channel.permissionsFor(interaction.guild.members.me).has(PermissionFlagsBits.SendMessages)) {
        throw createError(
            `Bot cannot send messages in ${channel.name}`,
            ErrorTypes.PERMISSION,
            `Je n’ai pas la permission d’envoyer des messages dans ${channel}.`,
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
                roleValidationErrors.push(`**${role.name}** — mon rôle est placé plus bas dans la hiérarchie : je ne peux pas l’attribuer.`);
                continue;
            }

            if (hasDangerousPermissions(role)) {
                roleValidationErrors.push(`**${role.name}** — ce rôle possède des permissions sensibles (Administrateur, Gérer le serveur, etc.).`);
                continue;
            }

            if (role.managed) {
                roleValidationErrors.push(`**${role.name}** — ce rôle est géré (intégration ou bot).`);
                continue;
            }

            if (role.id === interaction.guild.id) {
                roleValidationErrors.push(`**${role.name}** — impossible d’utiliser le rôle @everyone.`);
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
            embeds: [noticeEmbed('warning', errorMsg, 'Validation des rôles', '⚠️ Rôles ignorés')],
            flags: MessageFlags.Ephemeral,
            allowedMentions: MENTION_OPTIONS,
        });
    }

    if (roles.length < 1) {
        throw createError(
            'No roles provided',
            ErrorTypes.VALIDATION,
            'Tu dois fournir au moins un rôle valide.',
            {}
        );
    }

    // Create the reaction role message
    const row = buildReactionRoleSelect(roles);

    const message = await channel.send({
        content: buildPanelContent(title, description, roles),
        components: [row],
        allowedMentions: MENTION_OPTIONS,
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

    const panelEmbed = noticeEmbed(
        'success',
        `Panneau publié dans ${channel} avec ${formatNumber(roles.length)} rôle(s).`,
        'Création de panneau',
        '✅ Panneau créé',
    );
    panelEmbed.addFields({
        name: '🔗 Lien du panneau',
        value: `[Ouvrir le message](${message.url})`,
        inline: false,
    });
    await InteractionHelper.safeEditReply(interaction, {
        embeds: [panelEmbed],
        allowedMentions: MENTION_OPTIONS,
    });
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
        return await InteractionHelper.safeReply(interaction, {
            embeds: [noticeEmbed(
                'error',
                'Ce panneau n’existe plus ou a été supprimé. Relance `/reactroles dashboard` pour voir les panneaux actifs.',
                UI_CONTEXT,
                '❌ Panneau introuvable',
            )],
            flags: MessageFlags.Ephemeral,
            allowedMentions: MENTION_OPTIONS,
        });
    }

    const discordMsg = activePanelData ? await fetchPanelDiscordMessage(guild, activePanelData) : null;
    await showPanelDashboard(interaction, activePanelData, discordMsg, guildId, guild, onBack, validPanels);

    InteractionHelper.armDashboardSession(interaction);

    let rootInteraction = interaction;
    let listPage = 0;
    const navIds = [
        `${RR_LIST_PREV}_${guildId}`,
        `${RR_LIST_NEXT}_${guildId}`,
        `${RR_LIST_JUMP}_${guildId}`,
    ];
    const collector = interaction.channel.createMessageComponentCollector({
        filter: i =>
            i.user.id === interaction.user.id &&
            (i.customId === `rr_opts_${guildId}` || i.customId === `rr_switch_${guildId}` || navIds.includes(i.customId)),
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
            if (navIds.includes(ci.customId)) {
                await ci.deferUpdate().catch(() => {});

                const pageCount = Math.max(1, Math.ceil(validPanels.length / PANEL_LIST_PAGE_SIZE));
                if (ci.customId === `${RR_LIST_PREV}_${guildId}`) {
                    listPage = Math.max(0, listPage - 1);
                } else if (ci.customId === `${RR_LIST_NEXT}_${guildId}`) {
                    listPage = Math.min(pageCount - 1, listPage + 1);
                } else {
                    const requested = Number(ci.values?.[0]);
                    if (!Number.isInteger(requested)) return;
                    listPage = Math.min(pageCount - 1, Math.max(0, requested));
                }

                await showPanelList(rootInteraction, guildId, guild, validPanels, listPage);
                return;
            }

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
                error instanceof XlwyBotError
                    ? error.userMessage || 'Une erreur est survenue. Réessaie dans un instant.'
                    : 'Une erreur inattendue est survenue. Réessaie dans un instant.';
            if (!ci.replied && !ci.deferred) await ci.deferUpdate().catch(() => {});
            await sendPanelNotice(ci, msg, 'error');
        }
    });

    buttonCollector.on('collect', async btnInteraction => {
        InteractionHelper.armDashboardSession(interaction);
        try {
            if (btnInteraction.customId === `rr_list_${guildId}`) {
                await btnInteraction.deferUpdate().catch(() => {});
                listPage = 0;
                await showPanelList(rootInteraction, guildId, guild, validPanels, listPage);
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
                error instanceof XlwyBotError
                    ? error.userMessage || 'Une erreur est survenue. Réessaie dans un instant.'
                    : 'Une erreur inattendue est survenue. Réessaie dans un instant.';
            if (!btnInteraction.replied && !btnInteraction.deferred) await btnInteraction.deferUpdate().catch(() => {});
            await sendPanelNotice(btnInteraction, msg, 'error');
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
    if (role.id === guild.id) return 'Impossible d’utiliser @everyone.';
    if (role.managed) return 'Les rôles gérés (intégration/bot) ne peuvent pas être utilisés.';
    if (hasDangerousPermissions(role)) return 'Ce rôle possède des permissions sensibles (Administrateur, Gérer le serveur, etc.).';
    if (role.position >= guild.members.me.roles.highest.position) return 'Ce rôle est au-dessus de mon rôle le plus haut. Place mon rôle au-dessus d’abord.';
    return null;
}

async function handleCreatePanel(btnInteraction, rootInteraction, guildId, guild, client, onBack = null) {
    const me = guild.members.me;

    if (!me.permissions.has(PermissionFlagsBits.ManageRoles)) {
        await btnInteraction.deferUpdate().catch(() => {});
        await sendPanelNotice(btnInteraction, 'J’ai besoin de la permission **Gérer les rôles** pour créer un panneau.', 'warning');
        return;
    }

    if (!me.permissions.has(PermissionFlagsBits.ManageChannels)) {
        await btnInteraction.deferUpdate().catch(() => {});
        await sendPanelNotice(btnInteraction, 'J’ai besoin de la permission **Gérer les salons** pour créer un panneau.', 'warning');
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
        embeds: [stepEmbed(1, 'Choisis le **salon** où le panneau de rôles sera publié.')],
        components: [new ActionRowBuilder().addComponents(channelSelect)],
        flags: MessageFlags.Ephemeral,
        allowedMentions: MENTION_OPTIONS,
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
                await reject(`Je n’ai pas la permission d’envoyer des messages dans ${channel}.`);
                return;
            }
            if (!channel.permissionsFor(me).has(PermissionFlagsBits.AddReactions)) {
                await reject(`Je n’ai pas la permission d’ajouter des réactions dans ${channel}.`);
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
            await sendPanelNotice(btnInteraction, channelStep.message, 'error');
        } else {
            await sendPanelNotice(
                btnInteraction,
                'Étape 1 expirée. Aucun panneau n’a été créé. Clique à nouveau sur **➕ Créer un panneau**.',
                'warning',
            );
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
        await sendPanelNotice(
            btnInteraction,
            'La fenêtre de saisie a expiré. Aucun panneau n’a été créé.',
            'warning',
        );
        return;
    }

    const textSubmitted = await channelStep.modalHost
        .awaitModalSubmit({
            filter: i => i.customId === 'rr_create_text' && i.user.id === btnInteraction.user.id,
            time: 120_000,
        })
        .catch(() => null);

    if (!textSubmitted) {
        await sendPanelNotice(btnInteraction, 'Étape 2 expirée. Aucun panneau n’a été créé.', 'warning');
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
        embeds: [stepEmbed(
            3,
            `**Salon :** ${targetChannel}\n\nSélectionne entre **1 et 25 rôles** à proposer. Ils apparaîtront dans le menu du panneau.`,
        )],
        components: [new ActionRowBuilder().addComponents(roleSelect)],
        allowedMentions: MENTION_OPTIONS,
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
                    embeds: [noticeEmbed(
                        'warning',
                        rejected.join('\n') || 'Aucun rôle valide n’a été sélectionné.',
                        'Création de panneau',
                        '⚠️ Aucun rôle valide',
                    )],
                    flags: MessageFlags.Ephemeral,
                    allowedMentions: MENTION_OPTIONS,
                });
                // max: 1 arrête déjà le collecteur : il faut résoudre ici,
                // sinon le `end` (c.size > 0) ne résout jamais la promesse.
                roleCollector.stop('invalid');
                resolve({ ok: false, reason: 'invalid' });
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
        await sendPanelNotice(textSubmitted, 'Étape 3 expirée. Aucun panneau n’a été créé.', 'warning');
        return;
    }

    const roles = roleStep.roles;

    // ── Création ────────────────────────────────────────────────────────────
    let message;
    try {
        message = await targetChannel.send({
            content: buildPanelContent('', description, roles),
            components: [buildReactionRoleSelect(roles)],
            allowedMentions: MENTION_OPTIONS,
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
    const createdEmbed = noticeEmbed(
        'success',
        `Panneau publié dans ${targetChannel}.`,
        'Création de panneau',
        '✅ Panneau créé',
    );
    createdEmbed.addFields(
        { name: '🎭 Rôles', value: `${formatNumber(roles.length)}\n\`${progressBar(roles.length, 25, 10)}\``, inline: true },
        { name: '📍 Salon', value: `${targetChannel}`, inline: true },
        { name: '🔗 Lien du panneau', value: `[Ouvrir le message](${message.url})`, inline: false },
    );

    await textSubmitted.editReply({
        embeds: [createdEmbed],
        components: [],
        allowedMentions: MENTION_OPTIONS,
    }).catch(() => {});

    if (roleStep.rejected.length > 0) {
        await sendPanelNotice(
            textSubmitted,
            `Rôles ignorés :\n${roleStep.rejected.join('\n')}`,
            'warning',
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
            allowedMentions: MENTION_OPTIONS,
        }).catch(() => {});
    }

    return { panelData: newPanelData, panels: refreshedPanels || [] };
}

// ─── View Builders ────────────────────────────────────────────────────────────

function buildPanelDashboardEmbed(panelData, discordMsg, guild, allPanels) {
    if (!panelData) {
        return createEmbed({
            title: '🎭 Tableau de bord des rôles',
            description: allPanels.length > 1
                ? `${formatNumber(allPanels.length)} panneaux existent, mais aucun n’est valide. Utilise **➕ Créer un panneau** pour en ajouter un nouveau.`
                : 'Aucun panneau n’existe encore.\n\nClique sur **➕ Créer un panneau** ci-dessous : je te guiderai pour choisir le salon, le texte et les rôles.',
            color: 'info',
            thumbnail: guildIconUrl(guild, 128),
            fields: [
                { name: '🎭 Rôles', value: '`Aucun`', inline: true },
            ],
            footer: brandFooter('Tableau de bord'),
        });
    }

    const channel = guild.channels.cache.get(panelData.channelId);
    const title = panelData.title || discordMsg?.embeds?.[0]?.title || 'Panneau sans titre';
    const roleCount = Array.isArray(panelData.roles) ? panelData.roles.length : 0;

    return createEmbed({
        title: '🎭 Tableau de bord des rôles',
        description: [
            `**Titre :** ${String(title).slice(0, 120)}`,
            'Sélectionne une option ci-dessous pour modifier un réglage.',
            discordMsg ? `[Voir le panneau](${discordMsg.url})` : null,
        ].filter(Boolean).join('\n'),
        color: 'info',
        thumbnail: guildIconUrl(guild, 128),
        fields: [
            { name: '📍 Salon', value: channel ? `<#${channel.id}>` : '`Introuvable`', inline: true },
            {
                name: '🎭 Rôles',
                value: `${formatNumber(roleCount)} / 25\n\`${progressBar(roleCount, 25, 10)}\``,
                inline: true,
            },
            { name: '📊 Panneaux', value: formatNumber(allPanels.length), inline: true },
            { name: '🏷️ Liste des rôles', value: shortRoleList(panelData.roles, guild), inline: false },
        ],
        footer: brandFooter('Tableau de bord'),
    });
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
        .setPlaceholder('Sélectionne une action…')
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
        allowedMentions: MENTION_OPTIONS,
    });
}

export async function openReactionRolesPanel(interaction, onBack) {
    return await handleDashboard(interaction, null, onBack);
}

// ─── Panel List View ──────────────────────────────────────────────────────────

function buildPanelListEmbed(guild, allPanels, page = 0, pageCount = 1) {
    if (!allPanels.length) {
        return createEmbed({
            title: '📋 Panneaux de rôles',
            description: 'Aucun panneau actif pour le moment.\n\nClique sur **➕ Créer un panneau** pour en ajouter un.',
            color: 'info',
            thumbnail: guildIconUrl(guild, 128),
            fields: [
                { name: '📊 Panneaux', value: '`0`', inline: true },
            ],
            footer: brandFooter('Liste des panneaux'),
        });
    }

    const currentPage = Math.min(Math.max(0, page), Math.max(0, pageCount - 1));
    const slice = allPanels.slice(
        currentPage * PANEL_LIST_PAGE_SIZE,
        (currentPage + 1) * PANEL_LIST_PAGE_SIZE,
    );
    const fields = slice.map((panel, index) => {
        const channel = guild.channels.cache.get(panel.channelId);
        const roleCount = Array.isArray(panel.roles) ? panel.roles.length : 0;
        const position = String(currentPage * PANEL_LIST_PAGE_SIZE + index + 1).padStart(2, '0');
        return {
            name: `${position} · ${String(panel.title || 'Panneau sans titre').slice(0, 200)}`.slice(0, 256),
            value: [
                `Salon : ${channel ? `<#${channel.id}>` : '`introuvable`'} • Rôles : \`${formatNumber(roleCount)}\``,
                `[Ouvrir le panneau](${panelUrl(guild, panel)})`,
            ].join('\n'),
            inline: false,
        };
    });

    return createEmbed({
        title: '📋 Panneaux de rôles',
        description: [
            `${formatNumber(allPanels.length)} panneau(x) actif(s). Sélectionne un panneau pour le gérer.`,
            `Page **${currentPage + 1}/${pageCount}** \`${progressBar(currentPage + 1, pageCount, 10)}\``,
        ].join('\n'),
        color: 'info',
        thumbnail: guildIconUrl(guild, 128),
        fields,
        footer: brandFooter('Liste des panneaux'),
    });
}

function buildPanelListComponents(guildId, guild, allPanels, page = 0, pageCount = 1) {
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

    if (pageCount > 1) {
        rows.push(...buildNavRow({
            page,
            pageCount,
            prevId: `${RR_LIST_PREV}_${guildId}`,
            nextId: `${RR_LIST_NEXT}_${guildId}`,
            indicatorId: `${RR_LIST_JUMP}_${guildId}_indicator`,
        }));
        rows.push(...buildPageJumpRow({
            page,
            pageCount,
            customId: `${RR_LIST_JUMP}_${guildId}`,
        }));
    }

    return rows;
}

async function showPanelList(interaction, guildId, guild, allPanels, page = 0) {
    const pageCount = Math.max(1, Math.ceil(allPanels.length / PANEL_LIST_PAGE_SIZE));
    const currentPage = Math.min(Math.max(0, page), pageCount - 1);

    await InteractionHelper.safeEditReply(interaction, {
        embeds: [buildPanelListEmbed(guild, allPanels, currentPage, pageCount)],
        components: buildPanelListComponents(guildId, guild, allPanels, currentPage, pageCount),
        allowedMentions: MENTION_OPTIONS,
    });
}

// ─── Panel Notices ────────────────────────────────────────────────────────────

async function sendPanelNotice(interaction, text, kind = 'info') {
    const payload = {
        embeds: [noticeEmbed(kind, text, UI_CONTEXT)],
        flags: MessageFlags.Ephemeral,
        allowedMentions: MENTION_OPTIONS,
    };

    try {
        if (interaction.replied || interaction.deferred) {
            await interaction.followUp(payload);
        } else {
            await interaction.reply(payload);
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

    if (!submitted) {
        await sendPanelNotice(buttonInteraction, 'Édition annulée. Le panneau n’a pas été modifié.', 'warning');
        return;
    }

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
        embeds: [noticeEmbed(
            'success',
            'Le titre et la description du panneau ont été mis à jour.',
            'Édition de panneau',
            '✅ Panneau mis à jour',
        )],
        flags: MessageFlags.Ephemeral,
        allowedMentions: MENTION_OPTIONS,
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
        embeds: [noticeEmbed(
            'warning',
            'Clique sur le bouton ci-dessous pour rouvrir l’éditeur.',
            'Édition de panneau',
            '⚠️ Édition du texte indisponible',
        )],
        components: [new ActionRowBuilder().addComponents(retryButton)],
        flags: MessageFlags.Ephemeral,
        allowedMentions: MENTION_OPTIONS,
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
            sendPanelNotice(buttonInteraction, 'Édition annulée. Le panneau n’a pas été modifié.', 'warning');
        }
    });
}

async function handleAddRole(selectInteraction, rootInteraction, panelData, guildId, guild, client, onBack = null, allPanels = []) {
    await selectInteraction.deferUpdate();

    if (panelData.roles.length >= 25) {
        await sendPanelNotice(selectInteraction, 'Ce panneau a déjà atteint le maximum de 25 rôles.', 'warning');
        return;
    }

    const roleSelect = new RoleSelectMenuBuilder()
        .setCustomId('rr_add_role_pick')
        .setPlaceholder('Sélectionne un rôle à ajouter…')
        .setMaxValues(1);

    const roleCount = Array.isArray(panelData.roles) ? panelData.roles.length : 0;
    await selectInteraction.followUp({
        embeds: [createEmbed({
            title: '➕ Ajouter un rôle',
            description: [
                `**Rôles actuels :** ${roleCount} / 25`,
                `\`${progressBar(roleCount, 25, 10)}\``,
                'Sélectionne un rôle à ajouter à ce panneau.',
            ].join('\n'),
            color: 'info',
            footer: brandFooter('Gestion des rôles'),
        })],
        components: [new ActionRowBuilder().addComponents(roleSelect)],
        flags: MessageFlags.Ephemeral,
        allowedMentions: MENTION_OPTIONS,
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
            await sendPanelNotice(roleInteraction, `${role} est déjà dans ce panneau.`, 'error');
            return;
        }
        if (role.id === guild.id) {
            await sendPanelNotice(roleInteraction, 'Tu ne peux pas utiliser @everyone.', 'error');
            return;
        }
        if (role.managed) {
            await sendPanelNotice(roleInteraction, 'Les rôles gérés (intégration/bot) ne peuvent pas être utilisés.', 'error');
            return;
        }
        if (hasDangerousPermissions(role)) {
            await sendPanelNotice(roleInteraction, 'Ce rôle possède des permissions sensibles (Administrateur, Gérer le serveur, etc.) et ne peut pas être utilisé.', 'error');
            return;
        }
        if (role.position >= guild.members.me.roles.highest.position) {
            await sendPanelNotice(roleInteraction, 'Ce rôle est au-dessus de mon rôle le plus haut. Place mon rôle au-dessus d’abord.', 'error');
            return;
        }

        panelData.roles.push(role.id);
        const key = `reaction_roles:${guildId}:${panelData.messageId}`;
        await client.db.set(key, panelData);

        await rebuildLivePanelMessage(guild, panelData);

        await roleInteraction.followUp({
            embeds: [noticeEmbed(
                'success',
                `${role} a été ajouté au panneau.`,
                'Gestion des rôles',
                '✅ Rôle ajouté',
            )],
            flags: MessageFlags.Ephemeral,
            allowedMentions: MENTION_OPTIONS,
        });

        const channel = guild.channels.cache.get(panelData.channelId);
        const discordMsg = channel
            ? await channel.messages.fetch(panelData.messageId).catch(() => null)
            : null;
        await showPanelDashboard(rootInteraction, panelData, discordMsg, guildId, guild, onBack, allPanels);
    });

    roleCollector.on('end', (collected, reason) => {
        if (reason === 'time' && collected.size === 0) {
            sendPanelNotice(selectInteraction, 'Aucun rôle sélectionné. Aucune modification n’a été effectuée.', 'warning');
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
        await sendPanelNotice(selectInteraction, 'Les rôles de ce panneau n’existent plus sur le serveur.', 'error');
        return;
    }

    const removeSelect = new StringSelectMenuBuilder()
        .setCustomId('rr_remove_role_pick')
        .setPlaceholder('Sélectionne un rôle à retirer…')
        .setMaxValues(1)
        .addOptions(
            roleOptions.map(r =>
                new StringSelectMenuOptionBuilder().setLabel(r.label).setValue(r.value).setEmoji('🎭'),
            ),
        );

    await selectInteraction.followUp({
        embeds: [createEmbed({
            title: '➖ Retirer un rôle',
            description: 'Sélectionne le rôle que tu souhaites retirer de ce panneau.',
            color: 'info',
            footer: brandFooter('Gestion des rôles'),
        })],
        components: [new ActionRowBuilder().addComponents(removeSelect)],
        flags: MessageFlags.Ephemeral,
        allowedMentions: MENTION_OPTIONS,
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
                embeds: [noticeEmbed(
                    'success',
                    'C’était le dernier rôle du panneau. Le panneau a été supprimé.',
                    'Gestion des rôles',
                    '✅ Rôle retiré',
                )],
                flags: MessageFlags.Ephemeral,
                allowedMentions: MENTION_OPTIONS,
            });

            // Remove the deleted panel from the array
            const panelIndex = panels.findIndex(p => p.messageId === panelData.messageId);
            if (panelIndex > -1) {
                panels.splice(panelIndex, 1);
            }

            if (panels.length === 0) {
                await InteractionHelper.safeEditReply(rootInteraction, {
                    embeds: [noticeEmbed(
                        'info',
                        'Aucun panneau ne subsiste. Utilise `/reactroles setup` pour en créer un.',
                        UI_CONTEXT,
                        '📋 Aucun panneau actif',
                    )],
                    components: [],
                    allowedMentions: MENTION_OPTIONS,
                });
            } else {
                // Dashboard closed after last role removed
                await InteractionHelper.safeEditReply(rootInteraction, {
                    embeds: [noticeEmbed(
                        'success',
                        'Panneau supprimé. Lance `/reactroles dashboard` pour gérer un autre panneau.',
                        UI_CONTEXT,
                        '✅ Panneau supprimé',
                    )],
                    components: [],
                    allowedMentions: MENTION_OPTIONS,
                });
            }
        } else {
            const key = `reaction_roles:${guildId}:${panelData.messageId}`;
            await client.db.set(key, panelData);
            await rebuildLivePanelMessage(guild, panelData);

            await removeInteraction.followUp({
                embeds: [noticeEmbed(
                    'success',
                    `${role ? `\`${role.name}\`` : `\`${roleId}\``} a été retiré du panneau.`,
                    'Gestion des rôles',
                    '✅ Rôle retiré',
                )],
                flags: MessageFlags.Ephemeral,
                allowedMentions: MENTION_OPTIONS,
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
            sendPanelNotice(selectInteraction, 'Aucun rôle sélectionné. Aucune modification n’a été effectuée.', 'warning');
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
        .setTitle('Supprimer ce panneau');

    const deleteWarningText = new TextDisplayBuilder()
        .setContent(`⚠️ Tu es sur le point de supprimer définitivement le panneau **${title}**. Le message Discord et ses attributions de rôles seront supprimés.`);

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
        await sendPanelNotice(btnInteraction, 'Confirmation expirée. Le panneau n’a pas été supprimé.', 'warning');
        await showPanelDashboard(rootInteraction, panelData, discordMsg, guildId, guild, onBack, panels);
        return;
    }

    const confirmed = submitted.fields.getCheckbox('delete_confirmation');

    if (!confirmed) {
        await sendPanelNotice(submitted, 'Tu dois cocher la case de confirmation pour supprimer le panneau.', 'error');
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
        embeds: [noticeEmbed(
            'success',
            `**${String(title).slice(0, 120)}** a été supprimé.`,
            'Suppression de panneau',
            '✅ Panneau supprimé',
        )],
        flags: MessageFlags.Ephemeral,
        allowedMentions: MENTION_OPTIONS,
    });

    // Remove the deleted panel from the array
    const panelIndex = panels.findIndex(p => p.messageId === panelData.messageId);
    if (panelIndex > -1) {
        panels.splice(panelIndex, 1);
    }

    return panels;
}