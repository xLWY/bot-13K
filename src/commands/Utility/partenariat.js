import {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ChannelSelectMenuBuilder,
    ChannelType,
    ComponentType,
    MessageFlags,
    ModalBuilder,
    PermissionFlagsBits,
    RoleSelectMenuBuilder,
    SlashCommandBuilder,
    StringSelectMenuBuilder,
    StringSelectMenuOptionBuilder,
    TextInputBuilder,
    TextInputStyle,
} from 'discord.js';
import { getColor } from '../../config/bot.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { createEmbed, warningEmbed } from '../../utils/embeds.js';
import { findDiscordInvites } from '../../utils/linkFilter.js';
import { logger } from '../../utils/logger.js';

const DASHBOARD_TIME_MS = 5 * 60 * 1000;
const SUBFLOW_TIME_MS = 2 * 60 * 1000;
const MODAL_TIME_MS = 2 * 60 * 1000;
const MAX_TEXT_LENGTH = 4000;

const PARTNER_ROLE_NAMES = new Set([
    'partenariat',
    'partenariats',
    'partenaire',
    'partenaires',
]);

function normalizeRoleName(value) {
    return String(value || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '');
}

function findPartnerRole(guild) {
    return guild.roles.cache.find(role => PARTNER_ROLE_NAMES.has(normalizeRoleName(role.name))) ?? null;
}

function truncate(value, max) {
    const text = String(value ?? '');
    return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function parseColor(value) {
    const raw = String(value || '').trim().replace(/^#/, '');
    if (!/^[0-9a-f]{6}$/i.test(raw)) return null;
    return Number.parseInt(raw, 16);
}

function formatColor(value) {
    return typeof value === 'number' ? `#${value.toString(16).padStart(6, '0').toUpperCase()}` : 'Par défaut';
}

function isValidHttpUrl(value) {
    try {
        const url = new URL(value);
        return url.protocol === 'http:' || url.protocol === 'https:';
    } catch {
        return false;
    }
}

function createState(interaction) {
    return {
        link: null,
        text: null,
        title: '🤝 Partenariat',
        color: null,
        image: null,
        mentionMode: 'partenariat',
        roleId: null,
        channelId: interaction.channelId ?? interaction.channel?.id ?? null,
    };
}

function resolveMention(interaction, state) {
    if (state.mentionMode === 'everyone') {
        return {
            mode: 'everyone',
            content: '@everyone',
            label: '`@everyone`',
            allowedMentions: { parse: ['everyone'] },
        };
    }

    if (state.mentionMode === 'partenariat') {
        const role = state.roleId
            ? interaction.guild.roles.cache.get(state.roleId)
            : findPartnerRole(interaction.guild);

        if (!role) {
            return {
                error: 'Je ne trouve pas le rôle **@partenariat**. Choisis un rôle avec le bouton **Rôle** ou sélectionne **Aucune mention**.',
            };
        }

        if (role.id === interaction.guild.id) {
            return {
                error: 'Pour mentionner tout le monde, choisis la mention **@everyone** au lieu du rôle @everyone.',
            };
        }

        return {
            mode: 'partenariat',
            role,
            content: `<@&${role.id}>`,
            label: `\`@${role.name}\``,
            allowedMentions: { parse: [], roles: [role.id] },
        };
    }

    return {
        mode: 'none',
        content: null,
        label: '`Aucune`',
        allowedMentions: { parse: [] },
    };
}

function buildPartnerEmbed({ title, text, inviteUrl, color, image }) {
    const embed = createEmbed({
        title: title || '🤝 Partenariat',
        description: text,
        color: color ?? getColor('info'),
        image: image || null,
        footer: 'Partenariat • xlwy bot',
        timestamp: true,
    });

    embed.addFields({
        name: '🔗 Serveur partenaire',
        value: `[Rejoindre le serveur](${inviteUrl})`,
        inline: false,
    });

    return embed;
}

function buildDashboardEmbed(interaction, state) {
    const mention = resolveMention(interaction, state);
    const mentionLabel = mention.error ? '`Non configurée`' : mention.label;
    const targetChannel = state.channelId
        ? interaction.guild.channels.cache.get(state.channelId)
        : interaction.channel;
    const statusLabel = !state.link || !state.text
        ? '❌ Lien et texte requis'
        : mention.error
            ? '❌ Mention à configurer'
            : '✅ Prêt à publier';

    return createEmbed({
        title: '🤝 Partenariat',
        description:
            'Configure toutes les informations du partenariat avec les boutons ci-dessous.\n' +
            'Quand tout est prêt, clique sur **Envoyer**.',
        color: state.color ?? getColor('info'),
        fields: [
            {
                name: '🔗 Lien du serveur',
                value: state.link ? `[Invitation Discord](${state.link})` : '`Non défini`',
                inline: false,
            },
            {
                name: '📝 Texte',
                value: state.text
                    ? truncate(state.text.replace(/\s+/g, ' '), 300)
                    : '`Non défini`',
                inline: false,
            },
            {
                name: '📣 Mention',
                value: mentionLabel,
                inline: true,
            },
            {
                name: '📰 Titre',
                value: truncate(state.title || '🤝 Partenariat', 256),
                inline: true,
            },
            {
                name: '🎨 Couleur',
                value: state.color !== null ? formatColor(state.color) : '`Par défaut`',
                inline: true,
            },
            {
                name: '🖼️ Image',
                value: state.image ? '`Définie`' : '`Non définie`',
                inline: true,
            },
            {
                name: '📢 Salon',
                value: targetChannel ? `<#${targetChannel.id}>` : '`Salon actuel`',
                inline: true,
            },
            {
                name: '📌 État',
                value: statusLabel,
                inline: true,
            },
        ],
        footer: 'Fermeture après 5 minutes d’inactivité',
        timestamp: true,
    });
}

function buildDashboardComponents() {
    const editRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('partnership_link')
            .setLabel('Lien')
            .setEmoji('🔗')
            .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
            .setCustomId('partnership_text')
            .setLabel('Texte')
            .setEmoji('📝')
            .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
            .setCustomId('partnership_title')
            .setLabel('Titre')
            .setEmoji('📰')
            .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId('partnership_color')
            .setLabel('Couleur')
            .setEmoji('🎨')
            .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId('partnership_image')
            .setLabel('Image')
            .setEmoji('🖼️')
            .setStyle(ButtonStyle.Secondary),
    );

    const optionsRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('partnership_mention')
            .setLabel('Mention')
            .setEmoji('📣')
            .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId('partnership_role')
            .setLabel('Rôle')
            .setEmoji('🎭')
            .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId('partnership_channel')
            .setLabel('Salon')
            .setEmoji('📢')
            .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId('partnership_preview')
            .setLabel('Aperçu')
            .setEmoji('👁️')
            .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId('partnership_reset')
            .setLabel('Réinitialiser')
            .setEmoji('♻️')
            .setStyle(ButtonStyle.Secondary),
    );

    const actionRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('partnership_send')
            .setLabel('Envoyer')
            .setEmoji('📨')
            .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
            .setCustomId('partnership_cancel')
            .setLabel('Annuler')
            .setEmoji('❌')
            .setStyle(ButtonStyle.Danger),
    );

    return [editRow, optionsRow, actionRow];
}

function buildBackRow() {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('partnership_back')
            .setLabel('Retour')
            .setEmoji('↩️')
            .setStyle(ButtonStyle.Secondary),
    );
}

function getTargetChannel(interaction, state) {
    const channelId = state.channelId ?? interaction.channelId;
    return interaction.guild.channels.cache.get(channelId) ?? null;
}

function validatePartnerState(interaction, state) {
    if (!state.link) {
        return { error: 'Ajoute d’abord le lien d’invitation du serveur partenaire.' };
    }

    const invites = findDiscordInvites(state.link);
    if (invites.length === 0) {
        return { error: 'Le lien du serveur partenaire n’est pas une invitation Discord valide.' };
    }

    if (!state.text) {
        return { error: 'Ajoute le texte de présentation du partenariat.' };
    }

    const mention = resolveMention(interaction, state);
    if (mention.error) {
        return { error: mention.error };
    }

    const memberPermissions = interaction.memberPermissions;
    if (mention.mode === 'everyone' && !memberPermissions?.has(PermissionFlagsBits.MentionEveryone)) {
        return { error: 'Tu dois avoir la permission **Mentionner @everyone** pour utiliser cette mention.' };
    }

    if (
        mention.role &&
        !mention.role.mentionable &&
        !memberPermissions?.has(PermissionFlagsBits.MentionEveryone)
    ) {
        return {
            error: `Le rôle <@&${mention.role.id}> n’est pas mentionnable. Tu dois avoir la permission **Mentionner @everyone** pour le ping.`,
        };
    }

    return {
        mention,
        inviteUrl: invites[0].url,
    };
}

async function updateDashboard(componentInteraction, interaction, state) {
    await componentInteraction.update({
        embeds: [buildDashboardEmbed(interaction, state)],
        components: buildDashboardComponents(state),
    });
}

async function replyWarning(componentInteraction, message) {
    const payload = {
        embeds: [warningEmbed(message, '⚠️ Partenariat')],
        flags: MessageFlags.Ephemeral,
    };

    try {
        if (componentInteraction.replied || componentInteraction.deferred) {
            await componentInteraction.followUp(payload);
        } else {
            await componentInteraction.reply(payload);
        }
    } catch {
        // The interaction may have expired while the dashboard was open.
    }
}

async function handleTextEdit(button, dashboardMessage, interaction, state, field) {
    const configs = {
        partnership_link: {
            modalId: 'partnership_link_modal',
            title: 'Lien du serveur partenaire',
            label: 'Invitation Discord',
            placeholder: 'https://discord.gg/...',
            style: TextInputStyle.Short,
            maxLength: 500,
        },
        partnership_text: {
            modalId: 'partnership_text_modal',
            title: 'Texte du partenariat',
            label: 'Présentation du serveur partenaire',
            placeholder: 'Décris le serveur partenaire...',
            style: TextInputStyle.Paragraph,
            maxLength: MAX_TEXT_LENGTH,
        },
        partnership_title: {
            modalId: 'partnership_title_modal',
            title: 'Titre de l’embed',
            label: 'Titre',
            placeholder: '🤝 Partenariat',
            style: TextInputStyle.Short,
            maxLength: 256,
        },
        partnership_color: {
            modalId: 'partnership_color_modal',
            title: 'Couleur de l’embed',
            label: 'Couleur hexadécimale',
            placeholder: '#8B5CF6',
            style: TextInputStyle.Short,
            maxLength: 20,
        },
        partnership_image: {
            modalId: 'partnership_image_modal',
            title: 'Image du partenariat',
            label: 'URL de l’image',
            placeholder: 'https://example.com/image.png',
            style: TextInputStyle.Short,
            maxLength: 500,
        },
    };

    const config = configs[field];
    if (!config) return;

    const modal = new ModalBuilder()
        .setCustomId(config.modalId)
        .setTitle(config.title);

    const input = new TextInputBuilder()
        .setCustomId('value')
        .setLabel(config.label)
        .setPlaceholder(config.placeholder)
        .setStyle(config.style)
        .setMaxLength(config.maxLength)
        .setRequired(false);

    if (field === 'partnership_link' && state.link) {
        input.setValue(state.link.slice(0, config.maxLength));
    } else if (field === 'partnership_text' && state.text) {
        input.setValue(state.text.slice(0, config.maxLength));
    } else if (field === 'partnership_title') {
        input.setValue((state.title || '').slice(0, config.maxLength));
    } else if (field === 'partnership_color' && state.color !== null) {
        input.setValue(formatColor(state.color));
    } else if (field === 'partnership_image' && state.image) {
        input.setValue(state.image.slice(0, config.maxLength));
    }

    modal.addComponents(new ActionRowBuilder().addComponents(input));

    const shown = await button.showModal(modal).then(() => true).catch(() => false);
    if (!shown) {
        await replyWarning(button, 'Impossible d’ouvrir la fenêtre de saisie. Réessaie.');
        return;
    }

    const submitted = await button
        .awaitModalSubmit({
            filter: modalInteraction =>
                modalInteraction.customId === config.modalId &&
                modalInteraction.user.id === interaction.user.id,
            time: MODAL_TIME_MS,
        })
        .catch(() => null);

    if (!submitted) return;

    const raw = submitted.fields.getTextInputValue('value').trim();

    if (field === 'partnership_link') {
        if (raw) {
            const invites = findDiscordInvites(raw);
            if (invites.length === 0) {
                await replyWarning(submitted, 'Lien invalide. Utilise une invitation comme `https://discord.gg/...`.');
                return;
            }
            state.link = invites[0].url;
        } else {
            state.link = null;
        }
    } else if (field === 'partnership_text') {
        state.text = raw || null;
    } else if (field === 'partnership_title') {
        state.title = raw || '🤝 Partenariat';
    } else if (field === 'partnership_color') {
        if (!raw) {
            state.color = null;
        } else {
            const color = parseColor(raw);
            if (color === null) {
                await replyWarning(submitted, 'Couleur invalide. Utilise un format hexadécimal comme `#8B5CF6`.');
                return;
            }
            state.color = color;
        }
    } else if (field === 'partnership_image') {
        if (raw && !isValidHttpUrl(raw)) {
            await replyWarning(submitted, 'URL d’image invalide. Utilise une adresse `https://...`.');
            return;
        }
        state.image = raw || null;
    }

    await submitted.update({
        embeds: [buildDashboardEmbed(interaction, state)],
        components: buildDashboardComponents(state),
    });
}

async function handleMentionSelect(button, dashboardMessage, interaction, state) {
    const select = new StringSelectMenuBuilder()
        .setCustomId('partnership_mention_select')
        .setPlaceholder('Choisir la mention')
        .addOptions(
            new StringSelectMenuOptionBuilder()
                .setLabel('@everyone')
                .setDescription('Mentionner tout le monde')
                .setValue('everyone')
                .setDefault(state.mentionMode === 'everyone'),
            new StringSelectMenuOptionBuilder()
                .setLabel('@partenariat')
                .setDescription('Mentionner le rôle partenariat')
                .setValue('partenariat')
                .setDefault(state.mentionMode === 'partenariat' && !state.roleId),
            new StringSelectMenuOptionBuilder()
                .setLabel('Aucune mention')
                .setDescription('Publier sans mentionner personne')
                .setValue('none')
                .setDefault(state.mentionMode === 'none'),
        );

    await button.update({
        embeds: [buildDashboardEmbed(interaction, state)],
        components: [
            new ActionRowBuilder().addComponents(select),
            buildBackRow(),
        ],
    });

    const selected = await dashboardMessage
        .awaitMessageComponent({
            filter: component =>
                component.user.id === interaction.user.id &&
                ['partnership_mention_select', 'partnership_back'].includes(component.customId),
            time: SUBFLOW_TIME_MS,
        })
        .catch(() => null);

    if (!selected) {
        await dashboardMessage.edit({
            embeds: [buildDashboardEmbed(interaction, state)],
            components: buildDashboardComponents(state),
        }).catch(() => {});
        return;
    }

    if (selected.customId === 'partnership_back') {
        await updateDashboard(selected, interaction, state);
        return;
    }

    state.mentionMode = selected.values[0] || 'none';
    state.roleId = null;
    await updateDashboard(selected, interaction, state);
}

async function handleRoleSelect(button, dashboardMessage, interaction, state) {
    const roleSelect = new RoleSelectMenuBuilder()
        .setCustomId('partnership_role_select')
        .setPlaceholder('Choisir le rôle à mentionner')
        .setMinValues(1)
        .setMaxValues(1);

    await button.update({
        embeds: [buildDashboardEmbed(interaction, state)],
        components: [
            new ActionRowBuilder().addComponents(roleSelect),
            buildBackRow(),
        ],
    });

    const selected = await dashboardMessage
        .awaitMessageComponent({
            filter: component =>
                component.user.id === interaction.user.id &&
                ['partnership_role_select', 'partnership_back'].includes(component.customId),
            time: SUBFLOW_TIME_MS,
        })
        .catch(() => null);

    if (!selected) {
        await dashboardMessage.edit({
            embeds: [buildDashboardEmbed(interaction, state)],
            components: buildDashboardComponents(state),
        }).catch(() => {});
        return;
    }

    if (selected.customId === 'partnership_back') {
        await updateDashboard(selected, interaction, state);
        return;
    }

    const role = selected.roles.first();
    if (!role) {
        await updateDashboard(selected, interaction, state);
        return;
    }

    if (role.id === interaction.guild.id) {
        state.mentionMode = 'everyone';
        state.roleId = null;
    } else {
        state.mentionMode = 'partenariat';
        state.roleId = role.id;
    }

    await updateDashboard(selected, interaction, state);
}

async function handleChannelSelect(button, dashboardMessage, interaction, state) {
    const channelSelect = new ChannelSelectMenuBuilder()
        .setCustomId('partnership_channel_select')
        .setPlaceholder('Choisir le salon de publication')
        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
        .setMinValues(1)
        .setMaxValues(1);

    await button.update({
        embeds: [buildDashboardEmbed(interaction, state)],
        components: [
            new ActionRowBuilder().addComponents(channelSelect),
            buildBackRow(),
        ],
    });

    const selected = await dashboardMessage
        .awaitMessageComponent({
            filter: component =>
                component.user.id === interaction.user.id &&
                ['partnership_channel_select', 'partnership_back'].includes(component.customId),
            time: SUBFLOW_TIME_MS,
        })
        .catch(() => null);

    if (!selected) {
        await dashboardMessage.edit({
            embeds: [buildDashboardEmbed(interaction, state)],
            components: buildDashboardComponents(state),
        }).catch(() => {});
        return;
    }

    if (selected.customId === 'partnership_back') {
        await updateDashboard(selected, interaction, state);
        return;
    }

    const channel = selected.channels.first();
    if (channel) {
        state.channelId = channel.id;
    }

    await updateDashboard(selected, interaction, state);
}

async function handlePreview(button, state) {
    if (!state.link) {
        await replyWarning(button, 'Ajoute d’abord le lien d’invitation du serveur partenaire.');
        return;
    }

    const invites = findDiscordInvites(state.link);
    if (invites.length === 0) {
        await replyWarning(button, 'Le lien du serveur partenaire n’est pas une invitation Discord valide.');
        return;
    }

    if (!state.text) {
        await replyWarning(button, 'Ajoute le texte de présentation du partenariat.');
        return;
    }

    const preview = buildPartnerEmbed({
        title: state.title,
        text: state.text,
        inviteUrl: invites[0].url,
        color: state.color,
        image: state.image,
    });

    await button.reply({
        embeds: [preview],
        flags: MessageFlags.Ephemeral,
    }).catch(() => {});
}

async function handleSend(button, dashboardMessage, interaction, state) {
    const validation = validatePartnerState(interaction, state);
    if (validation.error) {
        await replyWarning(button, validation.error);
        return false;
    }

    const targetChannel = getTargetChannel(interaction, state);
    if (!targetChannel?.isTextBased?.() || targetChannel.type === ChannelType.GuildForum) {
        await replyWarning(button, 'Le salon choisi n’est pas un salon texte valide.');
        return false;
    }

    const botPermissions = targetChannel.permissionsFor(interaction.guild.members.me);
    const missingPermissions = [];
    if (!botPermissions?.has(PermissionFlagsBits.ViewChannel)) missingPermissions.push('Voir le salon');
    if (!botPermissions?.has(PermissionFlagsBits.SendMessages)) missingPermissions.push('Envoyer des messages');
    if (!botPermissions?.has(PermissionFlagsBits.EmbedLinks)) missingPermissions.push('Intégrer des liens');
    if (
        (validation.mention.mode === 'everyone' ||
            (validation.mention.role && !validation.mention.role.mentionable)) &&
        !botPermissions?.has(PermissionFlagsBits.MentionEveryone)
    ) {
        missingPermissions.push('Mentionner @everyone');
    }

    if (missingPermissions.length > 0) {
        await replyWarning(
            button,
            `Le bot n’a pas les permissions suivantes dans ${targetChannel} : **${missingPermissions.join(', ')}**.`,
        );
        return false;
    }

    const embed = buildPartnerEmbed({
        title: state.title,
        text: state.text,
        inviteUrl: validation.inviteUrl,
        color: state.color,
        image: state.image,
    });

    await button.deferUpdate().catch(() => {});

    try {
        const sentMessage = await targetChannel.send({
            content: validation.mention.content || undefined,
            embeds: [embed],
            allowedMentions: validation.mention.allowedMentions,
        });

        await dashboardMessage.edit({
            content: `✅ Partenariat publié dans ${targetChannel}.` +
                (sentMessage?.url ? `\n[Voir le message](${sentMessage.url})` : ''),
            embeds: [],
            components: [],
        }).catch(() => {});

        return true;
    } catch (error) {
        logger.error('Partnership publication failed:', error);
        await dashboardMessage.edit({
            embeds: [
                warningEmbed(
                    'Impossible de publier le partenariat. Vérifie les permissions du bot dans ce salon.',
                    '❌ Erreur',
                ),
                buildDashboardEmbed(interaction, state),
            ],
            components: buildDashboardComponents(state),
        }).catch(() => {});
        return false;
    }
}

export default {
    data: new SlashCommandBuilder()
        .setName('partenariat')
        .setDescription('Créer et publier une annonce de partenariat')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
        .setDMPermission(false),

    category: 'utility',
    deferEphemeral: true,

    async execute(interaction) {
        const deferred = await InteractionHelper.safeDefer(interaction, {
            flags: MessageFlags.Ephemeral,
        });
        if (!deferred) return;

        try {
            if (!interaction.guild) {
                await InteractionHelper.safeEditReply(interaction, {
                    embeds: [warningEmbed('Cette commande doit être utilisée dans un serveur.')],
                });
                return;
            }

            const state = createState(interaction);

            await InteractionHelper.safeEditReply(interaction, {
                embeds: [buildDashboardEmbed(interaction, state)],
                components: buildDashboardComponents(state),
            });

            const dashboardMessage = await interaction.fetchReply().catch(() => null);
            if (!dashboardMessage) {
                await InteractionHelper.safeEditReply(interaction, {
                    embeds: [warningEmbed('Impossible d’ouvrir le tableau de bord du partenariat.')],
                });
                return;
            }

            while (true) {
                const button = await dashboardMessage
                    .awaitMessageComponent({
                        componentType: ComponentType.Button,
                        filter: component =>
                            component.user.id === interaction.user.id &&
                            [
                                'partnership_link',
                                'partnership_text',
                                'partnership_title',
                                'partnership_color',
                                'partnership_image',
                                'partnership_mention',
                                'partnership_role',
                                'partnership_channel',
                                'partnership_preview',
                                'partnership_reset',
                                'partnership_send',
                                'partnership_cancel',
                            ].includes(component.customId),
                        time: DASHBOARD_TIME_MS,
                    })
                    .catch(() => null);

                if (!button) {
                    await dashboardMessage.edit({
                        content: '⌛ Le tableau de bord a expiré. Relance `/partenariat` pour recommencer.',
                        embeds: [],
                        components: [],
                    }).catch(() => {});
                    return;
                }

                try {
                    switch (button.customId) {
                        case 'partnership_link':
                        case 'partnership_text':
                        case 'partnership_title':
                        case 'partnership_color':
                        case 'partnership_image':
                            await handleTextEdit(button, dashboardMessage, interaction, state, button.customId);
                            break;
                        case 'partnership_mention':
                            await handleMentionSelect(button, dashboardMessage, interaction, state);
                            break;
                        case 'partnership_role':
                            await handleRoleSelect(button, dashboardMessage, interaction, state);
                            break;
                        case 'partnership_channel':
                            await handleChannelSelect(button, dashboardMessage, interaction, state);
                            break;
                        case 'partnership_preview':
                            await handlePreview(button, state);
                            break;
                        case 'partnership_reset':
                            Object.assign(state, createState(interaction));
                            await updateDashboard(button, interaction, state);
                            break;
                        case 'partnership_send': {
                            const sent = await handleSend(button, dashboardMessage, interaction, state);
                            if (sent) return;
                            break;
                        }
                        case 'partnership_cancel':
                            await button.update({
                                content: '❌ Publication du partenariat annulée.',
                                embeds: [],
                                components: [],
                            }).catch(() => {});
                            return;
                    }
                } catch (error) {
                    logger.error('Partnership dashboard action failed:', error);
                    if (!button.replied && !button.deferred) {
                        await replyWarning(button, 'Une erreur est survenue. Réessaie ou relance la commande.');
                    }
                }
            }
        } catch (error) {
            logger.error('Partnership command failed:', error);
            await InteractionHelper.safeEditReply(interaction, {
                embeds: [warningEmbed('Une erreur est survenue pendant la création du partenariat.')],
            }).catch(() => {});
        }
    },
};
