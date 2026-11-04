import { getColor } from '../../../config/bot.js';
import {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ChannelSelectMenuBuilder,
    ChannelType,
    ComponentType,
    EmbedBuilder,
    MessageFlags,
    ModalBuilder,
    RoleSelectMenuBuilder,
    StringSelectMenuBuilder,
    StringSelectMenuOptionBuilder,
    TextInputBuilder,
    TextInputStyle,
} from 'discord.js';
import { InteractionHelper } from '../../../utils/interactionHelper.js';
import { successEmbed, warningEmbed } from '../../../utils/embeds.js';
import { logger } from '../../../utils/logger.js';
import { normalizeAllowedDomains } from '../../../utils/linkFilter.js';
import {
    formatDuration,
    getAntiSpamConfig,
    getMissingAntiSpamPermissions,
    saveAntiSpamConfig,
} from '../../../services/antiSpamService.js';

const DASHBOARD_TIME = 300_000;
const FLOW_TIME = 120_000;
const MODAL_TIME = 120_000;

function formatIgnoredChannels(cfg, guild) {
    if (!cfg.ignoredChannels.length) return '`Aucun`';

    const shown = cfg.ignoredChannels.slice(0, 10).map(channelId =>
        guild.channels.cache.has(channelId)
            ? `<#${channelId}>`
            : '`Salon introuvable`',
    );
    const remaining = cfg.ignoredChannels.length - shown.length;

    return shown.join('\n') + (remaining > 0 ? `\n… et **${remaining}** autre(s)` : '');
}

function formatIgnoredRoles(cfg, guild) {
    if (!cfg.ignoredRoles.length) return '`Aucun`';

    const shown = cfg.ignoredRoles.slice(0, 10).map(roleId =>
        guild.roles?.cache?.has(roleId)
            ? `<@&${roleId}>`
            : '`Rôle introuvable`',
    );
    const remaining = cfg.ignoredRoles.length - shown.length;

    return shown.join('\n') + (remaining > 0 ? `\n… et **${remaining}** autre(s)` : '');
}

function formatAllowedDomains(cfg) {
    if (!cfg.allowedDomains.length) return '`Aucun`';

    const shown = [];
    for (const domain of cfg.allowedDomains.slice(0, 10)) {
        const label = `\`${domain}\``;
        if (shown.join(', ').length + label.length + 2 > 900) break;
        shown.push(label);
    }

    const remaining = cfg.allowedDomains.length - shown.length;
    return shown.join(', ') + (remaining > 0 ? ` … +${remaining}` : '');
}

function buildDashboardEmbed(cfg, guild, missingPermissions = []) {
    const fields = [
        {
            name: '⚙️ Statut',
            value: cfg.enabled ? '✅ Activé' : '❌ Désactivé',
            inline: true,
        },
        {
            name: '💬 Messages',
            value: `${cfg.messagesPerWindow} max / ${cfg.windowSeconds} s`,
            inline: true,
        },
        {
            name: '🔁 Doublons',
            value: `${cfg.duplicateThreshold} max / ${cfg.duplicateWindowSeconds} s`,
            inline: true,
        },
        {
            name: '📣 Mentions',
            value: `${cfg.mentionLimit} max`,
            inline: true,
        },
        {
            name: '⏱️ Silence',
            value: formatDuration(cfg.timeoutSeconds),
            inline: true,
        },
        {
            name: '🗑️ Suppression',
            value: cfg.deleteMessages ? '✅ Oui' : '❌ Non',
            inline: true,
        },
        {
            name: '🔔 Notification',
            value: cfg.notify ? '✅ Oui' : '❌ Non',
            inline: true,
        },
        {
            name: '🔗 Invitations Discord',
            value: cfg.blockInvites ? '✅ Bloquées' : '❌ Autorisées',
            inline: true,
        },
        {
            name: '🏠 Invites du serveur',
            value: cfg.allowOwnInvites ? '✅ Autorisées' : '❌ Bloquées',
            inline: true,
        },
        {
            name: '🌐 Liens externes',
            value: cfg.blockLinks ? '✅ Bloqués' : '❌ Autorisés',
            inline: true,
        },
        {
            name: '✂️ Raccourcisseurs',
            value: cfg.blockShorteners ? '✅ Bloqués' : '❌ Autorisés',
            inline: true,
        },
        {
            name: '✅ Domaines autorisés',
            value: formatAllowedDomains(cfg),
            inline: false,
        },
        {
            name: '🚫 Salons ignorés',
            value: formatIgnoredChannels(cfg, guild),
            inline: false,
        },
        {
            name: '👥 Rôles ignorés',
            value: formatIgnoredRoles(cfg, guild),
            inline: false,
        },
    ];

    if (missingPermissions.length > 0) {
        fields.push({
            name: '⚠️ Permissions manquantes',
            value: missingPermissions.map(permission => `• ${permission}`).join('\n'),
            inline: false,
        });
    }

    return new EmbedBuilder()
        .setTitle('🛡️ Tableau de bord Anti-spam')
        .setDescription(
            `Protège **${guild.name}** contre le flood, les doublons, les mentions abusives, ` +
            'les invitations Discord et les liens publicitaires.\n' +
            'Les réglages s’appliquent immédiatement aux membres non staff.',
        )
        .setColor(
            missingPermissions.length > 0
                ? getColor('warning')
                : getColor(cfg.enabled ? 'success' : 'info'),
        )
        .addFields(...fields)
        .setFooter({ text: 'Fermeture après 5 minutes d’inactivité' })
        .setTimestamp();
}

function buildButtonRows(cfg) {
    const mainRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('asp_toggle')
            .setLabel(cfg.enabled ? 'Désactiver' : 'Activer')
            .setEmoji('🛡️')
            .setStyle(cfg.enabled ? ButtonStyle.Danger : ButtonStyle.Success),
        new ButtonBuilder()
            .setCustomId('asp_messages')
            .setLabel('Messages')
            .setEmoji('💬')
            .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId('asp_duplicates')
            .setLabel('Doublons')
            .setEmoji('🔁')
            .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId('asp_mentions')
            .setLabel('Mentions')
            .setEmoji('📣')
            .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId('asp_timeout')
            .setLabel('Silence')
            .setEmoji('⏱️')
            .setStyle(ButtonStyle.Secondary),
    );

    const optionsRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('asp_delete')
            .setLabel('Suppression')
            .setEmoji('🗑️')
            .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId('asp_notify')
            .setLabel('Notification')
            .setEmoji('🔔')
            .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId('asp_ignore')
            .setLabel('Salons ignorés')
            .setEmoji('🚫')
            .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId('asp_refresh')
            .setLabel('Actualiser')
            .setEmoji('🔄')
            .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId('asp_back')
            .setLabel('Retour')
            .setEmoji('↩️')
            .setStyle(ButtonStyle.Danger),
    );

    const linkRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('asp_invites')
            .setLabel('Invitations')
            .setEmoji('🔗')
            .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId('asp_owninvites')
            .setLabel('Invites serveur')
            .setEmoji('🏠')
            .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId('asp_links')
            .setLabel('Liens')
            .setEmoji('🌐')
            .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId('asp_shorteners')
            .setLabel('Raccourcis')
            .setEmoji('✂️')
            .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId('asp_domains')
            .setLabel('Domaines')
            .setEmoji('✅')
            .setStyle(ButtonStyle.Secondary),
    );

    const roleRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('asp_ignoreroles')
            .setLabel('Rôles ignorés')
            .setEmoji('👥')
            .setStyle(ButtonStyle.Secondary),
    );

    return [mainRow, optionsRow, linkRow, roleRow];
}

async function sendNotice(interaction, text, { title = '🛡️ Anti-spam', success = false } = {}) {
    const embed = success ? successEmbed(text, title) : warningEmbed(text, title);

    try {
        if (interaction.replied || interaction.deferred) {
            await interaction.followUp({
                embeds: [embed],
                flags: MessageFlags.Ephemeral,
            });
        } else {
            await interaction.reply({
                embeds: [embed],
                flags: MessageFlags.Ephemeral,
            });
        }
    } catch (error) {
        logger.debug('Anti-spam notice failed:', error.message);
    }
}

async function refreshDashboard(rootInteraction, client, guildId) {
    try {
        const cfg = await getAntiSpamConfig(client, guildId, { force: true });
        const missingPermissions = getMissingAntiSpamPermissions(
            rootInteraction.guild?.members?.me,
            cfg,
        );

        await InteractionHelper.safeEditReply(rootInteraction, {
            embeds: [buildDashboardEmbed(cfg, rootInteraction.guild, missingPermissions)],
            components: buildButtonRows(cfg),
        });
    } catch (error) {
        logger.debug('Anti-spam dashboard refresh failed:', error.message);
    }
}

function parseInteger(rawValue, min, max) {
    const value = Number.parseInt(String(rawValue).trim(), 10);
    return Number.isInteger(value) && value >= min && value <= max ? value : null;
}

async function showModal(btnInteraction, modal, customId) {
    const shown = await btnInteraction.showModal(modal).then(() => true).catch(() => false);
    if (!shown) {
        await sendNotice(btnInteraction, 'Impossible d’ouvrir la fenêtre de saisie. Réessaie.');
        return null;
    }

    return btnInteraction
        .awaitModalSubmit({
            filter: interaction =>
                interaction.customId === customId &&
                interaction.user.id === btnInteraction.user.id,
            time: MODAL_TIME,
        })
        .catch(() => null);
}

async function saveAndConfirm(submitted, client, guildId, updates, message, title) {
    try {
        const current = await getAntiSpamConfig(client, guildId, { force: true });
        await saveAntiSpamConfig(client, guildId, current, updates);
    } catch (error) {
        logger.error('Anti-spam dashboard save failed:', error);
        await sendNotice(submitted, 'Impossible d’enregistrer ce réglage. Réessaie dans un instant.');
        return false;
    }

    await sendNotice(submitted, message, { title, success: true });
    return true;
}

async function handleToggle(btnInteraction, client, guildId, setting) {
    await btnInteraction.deferUpdate().catch(() => {});

    const cfg = await getAntiSpamConfig(client, guildId, { force: true });
    const labels = {
        enabled: {
            value: !cfg.enabled,
            on: 'La protection anti-spam est maintenant **activée**.',
            off: 'La protection anti-spam est maintenant **désactivée**.',
            title: '🛡️ Anti-spam',
        },
        deleteMessages: {
            value: !cfg.deleteMessages,
            on: 'Les messages détectés seront désormais **supprimés**.',
            off: 'Les messages détectés ne seront plus supprimés.',
            title: '🗑️ Suppression',
        },
        notify: {
            value: !cfg.notify,
            on: 'Le bot **préviendra** le salon lorsqu’un spam est détecté.',
            off: 'Le bot ne préviendra plus le salon lors d’une détection.',
            title: '🔔 Notification',
        },
        blockInvites: {
            value: !cfg.blockInvites,
            on: 'Les invitations vers d’autres serveurs Discord sont maintenant **bloquées**.',
            off: 'Les invitations vers d’autres serveurs Discord sont maintenant **autorisées**.',
            title: '🔗 Invitations Discord',
        },
        allowOwnInvites: {
            value: !cfg.allowOwnInvites,
            on: 'Les invitations de **ce serveur** sont maintenant **autorisées**.',
            off: 'Les invitations de **ce serveur** sont maintenant **bloquées**.',
            title: '🏠 Invites du serveur',
        },
        blockLinks: {
            value: !cfg.blockLinks,
            on: 'Tous les liens externes sont maintenant **bloqués**, sauf les domaines autorisés.',
            off: 'Les liens externes sont maintenant **autorisés**.',
            title: '🌐 Liens externes',
        },
        blockShorteners: {
            value: !cfg.blockShorteners,
            on: 'Les liens raccourcis sont maintenant **bloqués**.',
            off: 'Les liens raccourcis sont maintenant **autorisés**.',
            title: '✂️ Raccourcisseurs',
        },
    };

    const settingInfo = labels[setting];
    if (!settingInfo) return;

    await saveAntiSpamConfig(client, guildId, cfg, {
        [setting]: settingInfo.value,
    });

    await sendNotice(
        btnInteraction,
        settingInfo.value ? settingInfo.on : settingInfo.off,
        { title: settingInfo.title, success: true },
    );
}

async function handleMessages(btnInteraction, rootInteraction, client, guildId) {
    const cfg = await getAntiSpamConfig(client, guildId, { force: true });

    const modal = new ModalBuilder()
        .setCustomId('asp_messages_modal')
        .setTitle('Limite de messages')
        .addComponents(
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('messages_input')
                    .setLabel('Messages max par fenêtre (3-50)')
                    .setStyle(TextInputStyle.Short)
                    .setValue(String(cfg.messagesPerWindow))
                    .setMinLength(1)
                    .setMaxLength(2)
                    .setRequired(true),
            ),
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('window_input')
                    .setLabel('Fenêtre en secondes (2-60)')
                    .setStyle(TextInputStyle.Short)
                    .setValue(String(cfg.windowSeconds))
                    .setMinLength(1)
                    .setMaxLength(2)
                    .setRequired(true),
            ),
        );

    const submitted = await showModal(btnInteraction, modal, 'asp_messages_modal');
    if (!submitted) return;

    const messages = parseInteger(submitted.fields.getTextInputValue('messages_input'), 3, 50);
    const window = parseInteger(submitted.fields.getTextInputValue('window_input'), 2, 60);

    if (messages === null || window === null) {
        await sendNotice(
            submitted,
            'La limite doit être comprise entre **3 et 50** messages, et la fenêtre entre **2 et 60** secondes.',
            { title: '⚠️ Réglage invalide' },
        );
        return;
    }

    const saved = await saveAndConfirm(
        submitted,
        client,
        guildId,
        { messagesPerWindow: messages, windowSeconds: window },
        `Le seuil est maintenant de **${messages} messages** en **${window} secondes**.`,
        '💬 Limite de messages',
    );

    if (saved) await refreshDashboard(rootInteraction, client, guildId);
}

async function handleDuplicates(btnInteraction, rootInteraction, client, guildId) {
    const cfg = await getAntiSpamConfig(client, guildId, { force: true });

    const modal = new ModalBuilder()
        .setCustomId('asp_duplicates_modal')
        .setTitle('Détection des doublons')
        .addComponents(
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('duplicates_input')
                    .setLabel('Messages identiques max (2-20)')
                    .setStyle(TextInputStyle.Short)
                    .setValue(String(cfg.duplicateThreshold))
                    .setMinLength(1)
                    .setMaxLength(2)
                    .setRequired(true),
            ),
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('window_input')
                    .setLabel('Fenêtre en secondes (5-120)')
                    .setStyle(TextInputStyle.Short)
                    .setValue(String(cfg.duplicateWindowSeconds))
                    .setMinLength(1)
                    .setMaxLength(3)
                    .setRequired(true),
            ),
        );

    const submitted = await showModal(btnInteraction, modal, 'asp_duplicates_modal');
    if (!submitted) return;

    const duplicates = parseInteger(submitted.fields.getTextInputValue('duplicates_input'), 2, 20);
    const window = parseInteger(submitted.fields.getTextInputValue('window_input'), 5, 120);

    if (duplicates === null || window === null) {
        await sendNotice(
            submitted,
            'La limite doit être comprise entre **2 et 20** messages identiques, et la fenêtre entre **5 et 120** secondes.',
            { title: '⚠️ Réglage invalide' },
        );
        return;
    }

    const saved = await saveAndConfirm(
        submitted,
        client,
        guildId,
        { duplicateThreshold: duplicates, duplicateWindowSeconds: window },
        `Le seuil est maintenant de **${duplicates} messages identiques** en **${window} secondes**.`,
        '🔁 Détection des doublons',
    );

    if (saved) await refreshDashboard(rootInteraction, client, guildId);
}

async function handleMentions(btnInteraction, rootInteraction, client, guildId) {
    const cfg = await getAntiSpamConfig(client, guildId, { force: true });

    const modal = new ModalBuilder()
        .setCustomId('asp_mentions_modal')
        .setTitle('Limite de mentions')
        .addComponents(
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('mentions_input')
                    .setLabel('Mentions max par message (1-25)')
                    .setStyle(TextInputStyle.Short)
                    .setValue(String(cfg.mentionLimit))
                    .setMinLength(1)
                    .setMaxLength(2)
                    .setRequired(true),
            ),
        );

    const submitted = await showModal(btnInteraction, modal, 'asp_mentions_modal');
    if (!submitted) return;

    const mentions = parseInteger(submitted.fields.getTextInputValue('mentions_input'), 1, 25);
    if (mentions === null) {
        await sendNotice(
            submitted,
            'La limite de mentions doit être comprise entre **1 et 25**.',
            { title: '⚠️ Réglage invalide' },
        );
        return;
    }

    const saved = await saveAndConfirm(
        submitted,
        client,
        guildId,
        { mentionLimit: mentions },
        `Un message est désormais signalé à partir de **${mentions} mentions**.`,
        '📣 Limite de mentions',
    );

    if (saved) await refreshDashboard(rootInteraction, client, guildId);
}

async function handleTimeout(btnInteraction, rootInteraction, client, guildId) {
    const cfg = await getAntiSpamConfig(client, guildId, { force: true });

    const modal = new ModalBuilder()
        .setCustomId('asp_timeout_modal')
        .setTitle('Durée du silence')
        .addComponents(
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('minutes_input')
                    .setLabel('Durée en minutes (1-40320)')
                    .setStyle(TextInputStyle.Short)
                    .setValue(String(Math.max(1, Math.round(cfg.timeoutSeconds / 60))))
                    .setMinLength(1)
                    .setMaxLength(5)
                    .setRequired(true),
            ),
        );

    const submitted = await showModal(btnInteraction, modal, 'asp_timeout_modal');
    if (!submitted) return;

    const minutes = parseInteger(submitted.fields.getTextInputValue('minutes_input'), 1, 40320);
    if (minutes === null) {
        await sendNotice(
            submitted,
            'La durée doit être comprise entre **1 minute** et **28 jours**.',
            { title: '⚠️ Réglage invalide' },
        );
        return;
    }

    const saved = await saveAndConfirm(
        submitted,
        client,
        guildId,
        { timeoutSeconds: minutes * 60 },
        `Un membre détecté sera réduit au silence pendant **${formatDuration(minutes * 60)}**.`,
        '⏱️ Durée du silence',
    );

    if (saved) await refreshDashboard(rootInteraction, client, guildId);
}

async function handleAllowedDomains(btnInteraction, rootInteraction, client, guildId) {
    const cfg = await getAntiSpamConfig(client, guildId, { force: true });

    const input = new TextInputBuilder()
        .setCustomId('domains_input')
        .setLabel('Domaines autorisés (un par ligne)')
        .setStyle(TextInputStyle.Paragraph)
        .setPlaceholder('youtube.com, tenor.com, imgur.com')
        .setMaxLength(1000)
        .setRequired(false);

    if (cfg.allowedDomains.length > 0) {
        input.setValue(cfg.allowedDomains.join('\n').slice(0, 1000));
    }

    const modal = new ModalBuilder()
        .setCustomId('asp_domains_modal')
        .setTitle('Domaines autorisés')
        .addComponents(new ActionRowBuilder().addComponents(input));

    const submitted = await showModal(btnInteraction, modal, 'asp_domains_modal');
    if (!submitted) return;

    const raw = submitted.fields.getTextInputValue('domains_input');
    const domains = normalizeAllowedDomains(raw);
    const tokens = raw.split(/[\s,;]+/).filter(Boolean);

    if (tokens.length > 0 && domains.length === 0) {
        await sendNotice(
            submitted,
            'Aucun domaine valide. Utilise un format comme `youtube.com` ou `tenor.com`.',
            { title: '⚠️ Domaines invalides' },
        );
        return;
    }

    const list = domains.length === 0
        ? 'Aucun domaine n’est autorisé.'
        : `Domaines autorisés :\n${domains.slice(0, 10).map(domain => `• \`${domain}\``).join('\n')}` +
          (domains.length > 10 ? `\n… +${domains.length - 10}` : '');

    const saved = await saveAndConfirm(
        submitted,
        client,
        guildId,
        { allowedDomains: domains },
        list,
        '✅ Domaines autorisés',
    );

    if (saved) await refreshDashboard(rootInteraction, client, guildId);
}

function buildIgnoredOptions(cfg, guild) {
    return cfg.ignoredChannels.slice(0, 25).map((channelId, index) => {
        const channel = guild.channels.cache.get(channelId);

        return new StringSelectMenuOptionBuilder()
            .setLabel(
                (channel ? `#${channel.name}` : `Salon introuvable ${index + 1}`).slice(0, 100),
            )
            .setDescription(
                (channel ? 'Retirer ce salon de la liste' : 'Ce salon n’existe plus').slice(0, 100),
            )
            .setValue(channelId);
    });
}

async function handleIgnoredChannels(btnInteraction, rootInteraction, client, guildId) {
    await btnInteraction.deferUpdate().catch(() => {});

    const cfg = await getAntiSpamConfig(client, guildId, { force: true });
    const ignoredOptions = buildIgnoredOptions(cfg, rootInteraction.guild);
    const components = [
        new ActionRowBuilder().addComponents(
            new ChannelSelectMenuBuilder()
                .setCustomId('asp_ignore_add')
                .setPlaceholder('Ajouter un salon à ignorer')
                .addChannelTypes(
                    ChannelType.GuildText,
                    ChannelType.GuildAnnouncement,
                    ChannelType.GuildForum,
                )
                .setMinValues(1)
                .setMaxValues(1),
        ),
    ];

    if (ignoredOptions.length > 0) {
        components.push(
            new ActionRowBuilder().addComponents(
                new StringSelectMenuBuilder()
                    .setCustomId('asp_ignore_remove')
                    .setPlaceholder('Retirer un salon ignoré')
                    .addOptions(ignoredOptions)
                    .setMinValues(1)
                    .setMaxValues(1),
            ),
        );
    }

    const prompt = await btnInteraction
        .followUp({
            embeds: [
                new EmbedBuilder()
                    .setTitle('🚫 Salons ignorés')
                    .setDescription(
                        `L’anti-spam ne s’applique pas aux salons ci-dessous.\n\n${formatIgnoredChannels(cfg, rootInteraction.guild)}` +
                        (cfg.ignoredChannels.length > 25
                            ? '\n\nSeuls les 25 premiers salons peuvent être retirés depuis ce menu.'
                            : ''),
                    )
                    .setColor(getColor('info'))
                    .setFooter({ text: 'Sélectionne un salon à ajouter ou à retirer.' }),
            ],
            components,
            flags: MessageFlags.Ephemeral,
            fetchReply: true,
        })
        .catch(() => null);

    if (!prompt) return;

    const selected = await prompt
        .awaitMessageComponent({
            filter: interaction =>
                interaction.user.id === btnInteraction.user.id &&
                ['asp_ignore_add', 'asp_ignore_remove'].includes(interaction.customId),
            time: FLOW_TIME,
        })
        .catch(() => null);

    if (!selected) {
        await prompt.edit({
            embeds: [
                warningEmbed(
                    'Le menu a expiré. Relance **Salons ignorés** depuis le tableau de bord.',
                    '⏱️ Délai dépassé',
                ),
            ],
            components: [],
        }).catch(() => {});
        return;
    }

    await selected.deferUpdate().catch(() => {});

    try {
        const latest = await getAntiSpamConfig(client, guildId, { force: true });
        let nextChannels;
        let message;

        if (selected.customId === 'asp_ignore_add') {
            const channel = selected.channels.first();
            if (!channel) {
                await selected.editReply({
                    embeds: [warningEmbed('Aucun salon sélectionné.', '⚠️ Aucun changement')],
                    components: [],
                });
                return;
            }

            if (latest.ignoredChannels.includes(channel.id)) {
                await selected.editReply({
                    embeds: [
                        warningEmbed(
                            `<#${channel.id}> est déjà ignoré par l’anti-spam.`,
                            '⚠️ Aucun changement',
                        ),
                    ],
                    components: [],
                });
                return;
            }

            nextChannels = [...latest.ignoredChannels, channel.id];
            message = `<#${channel.id}> sera désormais ignoré par l’anti-spam.`;
        } else {
            const channelId = selected.values[0];
            if (!channelId) {
                await selected.editReply({
                    embeds: [warningEmbed('Aucun salon sélectionné.', '⚠️ Aucun changement')],
                    components: [],
                });
                return;
            }

            nextChannels = latest.ignoredChannels.filter(id => id !== channelId);
            message = `<#${channelId}> n’est plus ignoré par l’anti-spam.`;
        }

        await saveAntiSpamConfig(client, guildId, latest, {
            ignoredChannels: nextChannels,
        });

        await selected.editReply({
            embeds: [successEmbed(message, '🚫 Salons ignorés')],
            components: [],
        });

        await refreshDashboard(rootInteraction, client, guildId);
    } catch (error) {
        logger.error('Anti-spam ignored channels update failed:', error);
        await selected.editReply({
            embeds: [
                warningEmbed(
                    'Impossible d’enregistrer ce changement. Réessaie dans un instant.',
                    '⚠️ Erreur',
                ),
            ],
            components: [],
        }).catch(() => {});
    }
}

function buildIgnoredRoleOptions(cfg, guild) {
    return cfg.ignoredRoles.slice(0, 25).map((roleId, index) => {
        const role = guild.roles?.cache?.get(roleId);

        return new StringSelectMenuOptionBuilder()
            .setLabel(
                (role ? `@${role.name}` : `Rôle introuvable ${index + 1}`).slice(0, 100),
            )
            .setDescription(
                (role ? 'Retirer ce rôle de la liste' : 'Ce rôle n’existe plus').slice(0, 100),
            )
            .setValue(roleId);
    });
}

async function handleIgnoredRoles(btnInteraction, rootInteraction, client, guildId) {
    await btnInteraction.deferUpdate().catch(() => {});

    const cfg = await getAntiSpamConfig(client, guildId, { force: true });
    const ignoredOptions = buildIgnoredRoleOptions(cfg, rootInteraction.guild);
    const components = [
        new ActionRowBuilder().addComponents(
            new RoleSelectMenuBuilder()
                .setCustomId('asp_ignorerole_add')
                .setPlaceholder('Ajouter un rôle à ignorer')
                .setMinValues(1)
                .setMaxValues(1),
        ),
    ];

    if (ignoredOptions.length > 0) {
        components.push(
            new ActionRowBuilder().addComponents(
                new StringSelectMenuBuilder()
                    .setCustomId('asp_ignorerole_remove')
                    .setPlaceholder('Retirer un rôle ignoré')
                    .addOptions(ignoredOptions)
                    .setMinValues(1)
                    .setMaxValues(1),
            ),
        );
    }

    const prompt = await btnInteraction
        .followUp({
            embeds: [
                new EmbedBuilder()
                    .setTitle('👥 Rôles ignorés')
                    .setDescription(
                        `L’anti-spam ne s’applique pas aux membres ayant l’un de ces rôles.\n\n${formatIgnoredRoles(cfg, rootInteraction.guild)}` +
                        (cfg.ignoredRoles.length > 25
                            ? '\n\nSeuls les 25 premiers rôles peuvent être retirés depuis ce menu.'
                            : ''),
                    )
                    .setColor(getColor('info'))
                    .setFooter({ text: 'Sélectionne un rôle à ajouter ou à retirer.' }),
            ],
            components,
            flags: MessageFlags.Ephemeral,
            fetchReply: true,
        })
        .catch(() => null);

    if (!prompt) return;

    const selected = await prompt
        .awaitMessageComponent({
            filter: interaction =>
                interaction.user.id === btnInteraction.user.id &&
                ['asp_ignorerole_add', 'asp_ignorerole_remove'].includes(interaction.customId),
            time: FLOW_TIME,
        })
        .catch(() => null);

    if (!selected) {
        await prompt.edit({
            embeds: [
                warningEmbed(
                    'Le menu a expiré. Relance **Rôles ignorés** depuis le tableau de bord.',
                    '⏱️ Délai dépassé',
                ),
            ],
            components: [],
        }).catch(() => {});
        return;
    }

    await selected.deferUpdate().catch(() => {});

    try {
        const latest = await getAntiSpamConfig(client, guildId, { force: true });
        let nextRoles;
        let message;

        if (selected.customId === 'asp_ignorerole_add') {
            const role = selected.roles.first();
            if (!role) {
                await selected.editReply({
                    embeds: [warningEmbed('Aucun rôle sélectionné.', '⚠️ Aucun changement')],
                    components: [],
                });
                return;
            }

            if (role.id === guildId) {
                await selected.editReply({
                    embeds: [
                        warningEmbed(
                            'Le rôle **@everyone** ne peut pas être ignoré. Choisis un rôle spécifique.',
                            '⚠️ Rôle invalide',
                        ),
                    ],
                    components: [],
                });
                return;
            }

            if (latest.ignoredRoles.includes(role.id)) {
                await selected.editReply({
                    embeds: [
                        warningEmbed(
                            `Le rôle <@&${role.id}> est déjà ignoré par l’anti-spam.`,
                            '⚠️ Aucun changement',
                        ),
                    ],
                    components: [],
                });
                return;
            }

            nextRoles = [...latest.ignoredRoles, role.id];
            message = `Le rôle <@&${role.id}> sera désormais ignoré par l’anti-spam.`;
        } else {
            const roleId = selected.values[0];
            if (!roleId) {
                await selected.editReply({
                    embeds: [warningEmbed('Aucun rôle sélectionné.', '⚠️ Aucun changement')],
                    components: [],
                });
                return;
            }

            nextRoles = latest.ignoredRoles.filter(id => id !== roleId);
            message = `Le rôle <@&${roleId}> n’est plus ignoré par l’anti-spam.`;
        }

        await saveAntiSpamConfig(client, guildId, latest, {
            ignoredRoles: nextRoles,
        });

        await selected.editReply({
            embeds: [successEmbed(message, '👥 Rôles ignorés')],
            components: [],
        });

        await refreshDashboard(rootInteraction, client, guildId);
    } catch (error) {
        logger.error('Anti-spam ignored roles update failed:', error);
        await selected.editReply({
            embeds: [
                warningEmbed(
                    'Impossible d’enregistrer ce changement. Réessaie dans un instant.',
                    '⚠️ Erreur',
                ),
            ],
            components: [],
        }).catch(() => {});
    }
}

export default {
    async execute(interaction, config, client, onBack) {
        const deferred = await InteractionHelper.safeDeferOrUpdate(interaction, {});
        if (!deferred) return;

        try {
            const guildId = interaction.guildId || interaction.guild.id;
            const cfg = await getAntiSpamConfig(client, guildId, { force: true });
            const missingPermissions = getMissingAntiSpamPermissions(interaction.guild?.members?.me, cfg);

            await InteractionHelper.safeEditReply(interaction, {
                embeds: [buildDashboardEmbed(cfg, interaction.guild, missingPermissions)],
                components: buildButtonRows(cfg),
            });

            InteractionHelper.armDashboardSession(interaction);

            const collector = interaction.channel.createMessageComponentCollector({
                componentType: ComponentType.Button,
                filter: buttonInteraction =>
                    buttonInteraction.user.id === interaction.user.id &&
                    [
                        'asp_toggle',
                        'asp_messages',
                        'asp_duplicates',
                        'asp_mentions',
                        'asp_timeout',
                        'asp_delete',
                        'asp_notify',
                        'asp_ignore',
                        'asp_ignoreroles',
                        'asp_refresh',
                        'asp_back',
                        'asp_invites',
                        'asp_owninvites',
                        'asp_links',
                        'asp_shorteners',
                        'asp_domains',
                    ].includes(buttonInteraction.customId),
                time: DASHBOARD_TIME,
            });

            collector.on('collect', async btnInteraction => {
                InteractionHelper.armDashboardSession(interaction);

                try {
                    switch (btnInteraction.customId) {
                        case 'asp_toggle':
                            await handleToggle(btnInteraction, client, guildId, 'enabled');
                            await refreshDashboard(interaction, client, guildId);
                            break;
                        case 'asp_delete':
                            await handleToggle(btnInteraction, client, guildId, 'deleteMessages');
                            await refreshDashboard(interaction, client, guildId);
                            break;
                        case 'asp_notify':
                            await handleToggle(btnInteraction, client, guildId, 'notify');
                            await refreshDashboard(interaction, client, guildId);
                            break;
                        case 'asp_messages':
                            await handleMessages(btnInteraction, interaction, client, guildId);
                            break;
                        case 'asp_duplicates':
                            await handleDuplicates(btnInteraction, interaction, client, guildId);
                            break;
                        case 'asp_mentions':
                            await handleMentions(btnInteraction, interaction, client, guildId);
                            break;
                        case 'asp_timeout':
                            await handleTimeout(btnInteraction, interaction, client, guildId);
                            break;
                        case 'asp_ignore':
                            await handleIgnoredChannels(btnInteraction, interaction, client, guildId);
                            break;
                        case 'asp_ignoreroles':
                            await handleIgnoredRoles(btnInteraction, interaction, client, guildId);
                            break;
                        case 'asp_invites':
                            await handleToggle(btnInteraction, client, guildId, 'blockInvites');
                            await refreshDashboard(interaction, client, guildId);
                            break;
                        case 'asp_owninvites':
                            await handleToggle(btnInteraction, client, guildId, 'allowOwnInvites');
                            await refreshDashboard(interaction, client, guildId);
                            break;
                        case 'asp_links':
                            await handleToggle(btnInteraction, client, guildId, 'blockLinks');
                            await refreshDashboard(interaction, client, guildId);
                            break;
                        case 'asp_shorteners':
                            await handleToggle(btnInteraction, client, guildId, 'blockShorteners');
                            await refreshDashboard(interaction, client, guildId);
                            break;
                        case 'asp_domains':
                            await handleAllowedDomains(btnInteraction, interaction, client, guildId);
                            break;
                        case 'asp_refresh':
                            await btnInteraction.deferUpdate().catch(() => {});
                            await refreshDashboard(interaction, client, guildId);
                            break;
                        case 'asp_back':
                            await btnInteraction.deferUpdate().catch(() => {});
                            collector.stop('back');
                            if (typeof onBack === 'function') {
                                await onBack(btnInteraction);
                            }
                            break;
                    }
                } catch (error) {
                    logger.error('Unexpected anti-spam dashboard error:', error);
                    await sendNotice(
                        btnInteraction,
                        'Une erreur inattendue est survenue. Réessaie dans un instant.',
                    );
                }
            });
        } catch (error) {
            logger.error('Anti-spam dashboard failed to open:', error);
            await sendNotice(
                interaction,
                'Impossible d’ouvrir le tableau de bord anti-spam. Réessaie dans un instant.',
            );
        }
    },
};
