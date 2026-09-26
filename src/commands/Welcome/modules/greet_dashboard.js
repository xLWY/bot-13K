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
import { formatWelcomeMessageAsync } from '../../../utils/welcome.js';

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
        .setFooter({ text: 'Le tableau de bord se ferme après 5 minutes d\'inactivité' })
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
                .setCustomId(`greet_cfg_adopt_${guildId}`)
                .setLabel('Reprendre l\'ancien message')
                .setStyle(ButtonStyle.Secondary)
                .setEmoji('♻️')
                .setDisabled(disabled || !cfg.channelId),
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

            await InteractionHelper.safeDeferOrUpdate(interaction, {});

            const selectMenu = buildSelectMenu(guildId);

            await InteractionHelper.safeEditReply(interaction, {
                embeds: [buildDashboardEmbed(cfg, interaction.guild)],
                components: [
                    ...buildButtonRow(cfg, guildId),
                    new ActionRowBuilder().addComponents(selectMenu),
                ],
                flags: MessageFlags.Ephemeral,
            });

            InteractionHelper.armDashboardSession(interaction);

            // ── Select collector ──────────────────────────────────────────────
            const collector = interaction.channel.createMessageComponentCollector({
                componentType: ComponentType.StringSelect,
                filter: i =>
                    i.user.id === interaction.user.id && i.customId === `greet_cfg_${guildId}`,
                time: 300_000,
            });

            collector.on('collect', async selectInteraction => {
                InteractionHelper.armDashboardSession(interaction);
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
                            await handleArrivalChannel(selectInteraction, interaction, cfg, guildId, client);
                            break;
                        case 'arrival_message':
                            await handleArrivalMessage(selectInteraction, interaction, cfg, guildId, client);
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
                            : `Une erreur inattendue est survenue lors de la mise à jour de la configuration. (${error.message})`;

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
                        i.customId === `greet_cfg_adopt_${guildId}` ||
                        i.customId === `greet_cfg_back`),
                time: 300_000,
            });

            btnCollector.on('collect', async btnInteraction => {
                InteractionHelper.armDashboardSession(interaction);
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
                } else if (customId === `greet_cfg_adopt_${guildId}`) {
                    await handleAdoptExistingMessage(btnInteraction, cfg, guildId, client, interaction.guild);
                } else if (customId === `greet_cfg_back`) {
                    if (typeof onBack === 'function') {
                        await onBack(btnInteraction);
                    }
                    return;
                }

                await refreshDashboard(interaction, cfg, guildId);
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
    const channelSelect = new ChannelSelectMenuBuilder()
        .setCustomId('greet_cfg_welcome_channel')
        .setPlaceholder('Clique ici pour choisir le salon de bienvenue...')
        .addChannelTypes(ChannelType.GuildText)
        .setMaxValues(1);

    if (cfg.channelId) {
        channelSelect.setDefaultValues([cfg.channelId]);
    }

    const cancelButton = new ButtonBuilder()
        .setCustomId('greet_cfg_welcome_channel_cancel')
        .setLabel('Annuler')
        .setStyle(ButtonStyle.Danger)
        .setEmoji('❌');

    const pickerShown = await selectInteraction
        .deferReply({ flags: MessageFlags.Ephemeral })
        .then(() => selectInteraction.editReply({
                embeds: [
                    new EmbedBuilder()
                        .setTitle('🟢 Canal de bienvenue')
                        .setDescription(
                            `**Actuel :** ${cfg.channelId ? `<#${cfg.channelId}>` : '`Non défini`'}\n\nSélectionne le salon où les messages de bienvenue seront envoyés.`,
                        )
                        .setColor(getColor('info')),
                ],
                components: [
                    new ActionRowBuilder().addComponents(channelSelect),
                    new ActionRowBuilder().addComponents(cancelButton),
                ],
            }))
        .then(() => true)
        .catch(error => {
            logger.error('Welcome channel picker could not be displayed:', error);
            return false;
        });

    if (!pickerShown) {
        await InteractionHelper.sendErrorNotice(
            selectInteraction,
            'Impossible d\'afficher le sélecteur de salon. Réouvre le dashboard et réessaie.',
        ).catch(() => {});
        return;
    }

    const chanCollector = rootInteraction.channel.createMessageComponentCollector({
        componentType: ComponentType.ChannelSelect,
        filter: i =>
            i.user.id === selectInteraction.user.id && i.customId === 'greet_cfg_welcome_channel',
        time: 300_000,
        max: 1,
    });

    chanCollector.on('collect', async chanInteraction => {
        const acknowledged = await chanInteraction.deferUpdate().then(() => true).catch(() => false);
        if (!acknowledged) return;
        await chanInteraction.deleteReply().catch(() => {});
        InteractionHelper.armDashboardSession(rootInteraction);
        cancelCollector.stop('selected');
        const channel = chanInteraction.channels.first();

        if (!channel) {
            await InteractionHelper.sendErrorNotice(chanInteraction, 'Salon introuvable. Choisis un salon texte accessible.').catch(() => {});
            return;
        }

        if (!botHasPermission(channel, ['ViewChannel', 'SendMessages', 'EmbedLinks'])) {
            await InteractionHelper.sendErrorNotice(chanInteraction, `J\'ai besoin des permissions **Voir le canal**, **Envoyer des messages** et **Intégrer des liens** dans ${channel}.`).catch(() => {});
            return;
        }

        cfg.channelId = channel.id;
        const saved = await saveWelcomeConfig(client, guildId, cfg);

        if (!saved) {
            await InteractionHelper.sendErrorNotice(chanInteraction, 'La configuration n\'a pas pu être enregistrée. Réessaie dans un instant.').catch(() => {});
            return;
        }

        await chanInteraction.followUp({
            embeds: [successEmbed('✅ Canal mis à jour', `Les messages de bienvenue seront désormais envoyés dans ${channel}.`)],
            flags: MessageFlags.Ephemeral,
        });

        await refreshDashboard(rootInteraction, cfg, guildId);
    });

    const cancelCollector = rootInteraction.channel.createMessageComponentCollector({
        componentType: ComponentType.Button,
        filter: i =>
            i.user.id === selectInteraction.user.id && i.customId === 'greet_cfg_welcome_channel_cancel',
        time: 300_000,
        max: 1,
    });

    cancelCollector.on('collect', async cancelInteraction => {
        await cancelInteraction.deferUpdate().catch(() => {});
        await cancelInteraction.deleteReply().catch(() => {});
        InteractionHelper.armDashboardSession(rootInteraction);
        chanCollector.stop('cancelled');
        await InteractionHelper.sendErrorNotice(cancelInteraction, 'Sélection annulée. Le paramètre n\'a pas été modifié.').catch(() => {});
        await refreshDashboard(rootInteraction, cfg, guildId);
    });

    chanCollector.on('end', (collected, reason) => {
        cancelCollector.stop(reason);
        if (reason === 'time' && collected.size === 0) {
            InteractionHelper.sendErrorNotice(selectInteraction, 'Aucun salon n\'a été sélectionné. Le paramètre n\'a pas été modifié.')
                .catch(() => {});
            refreshDashboard(rootInteraction, cfg, guildId).catch(() => {});
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
                    .setLabel('Message ({user}, {server}, #salon, @membre)')
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

    const liveUpdated = await updateLiveWelcomeMessage(client, rootInteraction.guild, cfg);

    await submitted.reply({
        embeds: [
            successEmbed(
                '✅ Message de bienvenue mis à jour',
                liveUpdated
                    ? 'Le message a été enregistré et le message déjà envoyé dans le salon a été modifié sur place.'
                    : 'Le message a été enregistré. Aucun message envoyé précédemment n\'a été trouvé à modifier.',
            ),
        ],
        flags: MessageFlags.Ephemeral,
    });

    await refreshDashboard(rootInteraction, cfg, guildId);
}

// ─── Live Welcome Message ─────────────────────────────────────────────────────

async function findLiveWelcomeMessage(client, guild, channelId) {
    if (!channelId) {
        return null;
    }

    const channel =
        guild.channels.cache.get(channelId) ||
        (await guild.channels.fetch(channelId).catch(() => null));

    if (!channel) {
        return null;
    }

    const messages = await channel.messages.fetch({ limit: 50 }).catch(() => null);
    if (!messages) {
        return null;
    }

    const candidates = [...messages.values()].filter(
        (m) => m.author.id === client.user.id && m.embeds.length > 0,
    );

    if (candidates.length === 0) {
        return null;
    }

    const welcomeLike = candidates.find((m) =>
        /bienvenue|arriv/i.test(`${m.embeds[0]?.title || ''} ${m.embeds[0]?.description || ''}`),
    );

    if (welcomeLike) {
        return welcomeLike;
    }

    return candidates.find((m) => m.embeds[0]?.thumbnail?.url) || null;
}

async function updateLiveWelcomeMessage(client, guild, cfg) {
    if (!cfg.channelId) {
        return false;
    }

    const source = await findLiveWelcomeMessage(client, guild, cfg.channelId);
    if (!source) {
        return false;
    }

    const previous = source.embeds[0];
    const formatData = {
        user: source.member?.user || guild.client.user,
        guild,
        member: source.member,
        config: cfg,
    };

    const embed = new EmbedBuilder()
        .setColor(cfg.welcomeEmbed?.color || getColor('success'))
        .setTitle(await formatWelcomeMessageAsync(cfg.welcomeEmbed?.title || '🎉 Bienvenue !', formatData))
        .setDescription(
            await formatWelcomeMessageAsync(
                cfg.welcomeMessage || 'Bienvenue {user} sur **{server}** ! 🎉',
                formatData,
            ),
        )
        .setTimestamp();

    if (previous?.thumbnail?.url) {
        embed.setThumbnail(previous.thumbnail.url);
    }
    if (typeof cfg.welcomeImage === 'string' && cfg.welcomeImage) {
        embed.setImage(cfg.welcomeImage);
    }

    try {
        await source.edit({
            content: cfg.welcomePing && source.member ? source.member.toString() : null,
            embeds: [embed],
        });
        return true;
    } catch (error) {
        logger.debug('Could not edit live welcome message:', error.message);
        return false;
    }
}

// ─── Adopt Existing Message ───────────────────────────────────────────────────

async function handleAdoptExistingMessage(btnInteraction, cfg, guildId, client, guild) {
    if (!cfg.channelId) {
        await InteractionHelper.sendErrorNotice(btnInteraction, 'Aucun salon de bienvenue défini. Commence par « Définir le salon de bienvenue ».');
        return;
    }

    const channel =
        guild.channels.cache.get(cfg.channelId) ||
        (await guild.channels.fetch(cfg.channelId).catch(() => null));

    if (!channel) {
        await InteractionHelper.sendErrorNotice(btnInteraction, 'Le salon de bienvenue est introuvable. Choisis-en un autre.');
        return;
    }

    const source = await findLiveWelcomeMessage(client, guild, cfg.channelId);

    if (!source) {
        await InteractionHelper.sendErrorNotice(btnInteraction, `Je n'ai trouvé aucun ancien message de bienvenue dans ${channel} (50 derniers messages).`);
        return;
    }

    const embed = source.embeds[0];

    let title = embed.title || '';
    let description = embed.description || '';

    const avatarMatch = (embed.thumbnail?.url || '').match(/(?:avatars|users)\/(\d+)\//);
    const member = avatarMatch
        ? guild.members.cache.get(avatarMatch[1]) ||
          (await guild.members.fetch(avatarMatch[1]).catch(() => null))
        : null;

    const identities = member
        ? [member.user.username, member.displayName, member.user.globalName].filter(
              (value) => typeof value === 'string' && value.length >= 2,
          )
        : [];

    for (const value of identities) {
        title = title.split(value).join('{user}');
        description = description.split(value).join('{user}');
    }

    if (guild.name) {
        title = title.split(guild.name).join('{server}');
        description = description.split(guild.name).join('{server}');
    }

    if (!description.trim()) {
        await InteractionHelper.sendErrorNotice(btnInteraction, 'Le message trouvé ne contient pas de texte réutilisable.');
        return;
    }

    cfg.welcomeMessage = description.trim();
    if (title.trim() && title.trim() !== '🎉 Bienvenue !') {
        cfg.welcomeEmbed = { ...(cfg.welcomeEmbed || {}), title: title.trim() };
    }
    if (embed.image?.url) {
        cfg.welcomeImage = embed.image.url;
    }

    await saveWelcomeConfig(client, guildId, cfg);

    const liveUpdated = await updateLiveWelcomeMessage(client, guild, cfg);
    const preview = cfg.welcomeMessage.length > 300 ? `${cfg.welcomeMessage.slice(0, 300)}…` : cfg.welcomeMessage;

    await btnInteraction.followUp({
        embeds: [
            successEmbed(
                '♻️ Ancien message repris',
                `J'ai récupéré le contenu de mon message dans ${channel} :\n\n> ${preview.replace(/\n/g, '\n> ')}\n\n${
                    liveUpdated
                        ? 'Le message déjà présent dans le salon a été modifié sur place : aucun nouveau message n\'a été créé. '
                        : ''
                }Les nouveaux membres recevront ce message. Tu peux encore le modifier via « Modifier le message de bienvenue ».`,
            ),
        ],
        flags: MessageFlags.Ephemeral,
    });
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

    const liveUpdated = await updateLiveWelcomeMessage(client, rootInteraction.guild, cfg);

    await submitted.reply({
        embeds: [
            successEmbed(
                '✅ Image de bienvenue mise à jour',
                `Image ${imageUrl ? 'mise à jour' : 'supprimée'} avec succès.${
                    liveUpdated
                        ? '\nLe message déjà envoyé dans le salon a été modifié sur place.'
                        : '\nAucun message envoyé précédemment n\'a été trouvé à modifier.'
                }`,
            ),
        ],
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

async function handleArrivalChannel(selectInteraction, rootInteraction, cfg, guildId, client) {
    const channelSelect = new ChannelSelectMenuBuilder()
        .setCustomId('greet_cfg_arrival_channel')
        .setPlaceholder('Clique ici pour choisir le salon d\'arrivée...')
        .addChannelTypes(ChannelType.GuildText)
        .setMaxValues(1);

    if (cfg.arrivalChannelId) {
        channelSelect.setDefaultValues([cfg.arrivalChannelId]);
    }

    const cancelButton = new ButtonBuilder()
        .setCustomId('greet_cfg_arrival_channel_cancel')
        .setLabel('Annuler')
        .setStyle(ButtonStyle.Danger)
        .setEmoji('❌');

    const pickerShown = await selectInteraction
        .deferReply({ flags: MessageFlags.Ephemeral })
        .then(() => selectInteraction.editReply({
                embeds: [
                    new EmbedBuilder()
                        .setTitle('🚪 Salon d\'arrivée')
                        .setDescription(
                            `**Actuel :** ${cfg.arrivalChannelId ? `<#${cfg.arrivalChannelId}>` : '`Non défini`'}\n\nSélectionne le salon où le message « X vient d'arriver » sera posté. Il reste affiché 10 minutes puis disparaît.`,
                        )
                        .setColor(getColor('info')),
                ],
                components: [
                    new ActionRowBuilder().addComponents(channelSelect),
                    new ActionRowBuilder().addComponents(cancelButton),
                ],
            }))
        .then(() => true)
        .catch(error => {
            logger.error('Arrival channel picker could not be displayed:', error);
            return false;
        });

    if (!pickerShown) {
        await InteractionHelper.sendErrorNotice(
            selectInteraction,
            'Impossible d\'afficher le sélecteur de salon. Réouvre le dashboard et réessaie.',
        ).catch(() => {});
        return;
    }

    const chanCollector = rootInteraction.channel.createMessageComponentCollector({
        componentType: ComponentType.ChannelSelect,
        filter: i =>
            i.user.id === selectInteraction.user.id && i.customId === 'greet_cfg_arrival_channel',
        time: 300_000,
        max: 1,
    });

    const cancelCollector = rootInteraction.channel.createMessageComponentCollector({
        componentType: ComponentType.Button,
        filter: i =>
            i.user.id === selectInteraction.user.id && i.customId === 'greet_cfg_arrival_channel_cancel',
        time: 300_000,
        max: 1,
    });

    cancelCollector.on('collect', async cancelInteraction => {
        await cancelInteraction.deferUpdate().catch(() => {});
        await cancelInteraction.deleteReply().catch(() => {});
        InteractionHelper.armDashboardSession(rootInteraction);
        chanCollector.stop('cancelled');
        await InteractionHelper.sendErrorNotice(cancelInteraction, 'Sélection annulée. Le paramètre n\'a pas été modifié.').catch(() => {});
        await refreshDashboard(rootInteraction, cfg, guildId);
    });

    chanCollector.on('collect', async chanInteraction => {
        const acknowledged = await chanInteraction.deferUpdate().then(() => true).catch(() => false);
        if (!acknowledged) return;
        await chanInteraction.deleteReply().catch(() => {});
        InteractionHelper.armDashboardSession(rootInteraction);
        cancelCollector.stop('selected');
        const channel = chanInteraction.channels.first();

        if (!channel) {
            await InteractionHelper.sendErrorNotice(chanInteraction, 'Salon introuvable. Choisis un salon texte accessible.').catch(() => {});
            return;
        }

        if (!botHasPermission(channel, ['ViewChannel', 'SendMessages'])) {
            await InteractionHelper.sendErrorNotice(chanInteraction, `J\'ai besoin des permissions **Voir le canal** et **Envoyer des messages** dans ${channel}.`).catch(() => {});
            return;
        }

        cfg.arrivalChannelId = channel.id;
        const saved = await saveWelcomeConfig(client, guildId, cfg);

        if (!saved) {
            await InteractionHelper.sendErrorNotice(chanInteraction, 'La configuration n\'a pas pu être enregistrée. Réessaie dans un instant.').catch(() => {});
            return;
        }

        await chanInteraction.followUp({
            embeds: [successEmbed('✅ Salon d\'arrivée mis à jour', `Les messages « X vient d'arriver » seront postés dans ${channel} pendant 10 minutes.`)],
            flags: MessageFlags.Ephemeral,
        });

        await refreshDashboard(rootInteraction, cfg, guildId);
    });

    chanCollector.on('end', (collected, reason) => {
        cancelCollector.stop(reason);
        if (reason === 'time' && collected.size === 0) {
            InteractionHelper.sendErrorNotice(selectInteraction, 'Aucun salon n\'a été sélectionné. Le paramètre n\'a pas été modifié.')
                .catch(() => {});
            refreshDashboard(rootInteraction, cfg, guildId).catch(() => {});
        }
    });
}

// ─── Message d'arrivée (texte) ────────────────────────────────────────────────

async function handleArrivalMessage(selectInteraction, rootInteraction, cfg, guildId, client) {
    const modal = new ModalBuilder()
        .setCustomId('greet_cfg_arrival_message')
        .setTitle('Modifier le message d\'arrivée')
        .addComponents(
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('message_input')
                    .setLabel('Message ({user}, #salon, @membre)')
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
