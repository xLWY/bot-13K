import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ChannelType,
  MessageFlags,
} from 'discord.js';
import { createEmbed, errorEmbed, successEmbed } from '../../utils/embeds.js';
import { buildTicketTypeButtons } from '../../services/ticket.js';
import { getGuildConfig } from '../../services/guildConfig.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { logger } from '../../utils/logger.js';
import { isBotOwner } from '../../utils/ownerIds.js';
import { brandFooter, formatNumber, guildIconUrl } from '../../ui/kit.js';

import ticketConfig from './modules/ticket_dashboard.js';

const NO_MENTIONS = { parse: [], repliedUser: false };

function errorReply(interaction, message) {
    const embed = errorEmbed(message);
    embed.setFooter(brandFooter('Tickets'));
    return InteractionHelper.safeEditReply(interaction, {
        embeds: [embed],
        allowedMentions: NO_MENTIONS,
        flags: MessageFlags.Ephemeral,
    });
}

export default {
    data: new SlashCommandBuilder()
        .setName('ticket')
        .setDescription('Gère le système de tickets du serveur.')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
        .addSubcommand((subcommand) =>
            subcommand
                .setName('setup')
                .setDescription('Configure le panneau de création de tickets dans un salon spécifié.')
                .addChannelOption((option) =>
                    option
                        .setName('panel_channel')
                        .setDescription('Le salon où le panneau de tickets sera envoyé.')
                        .addChannelTypes(ChannelType.GuildText)
                        .setRequired(true),
                )
                .addStringOption((option) =>
                    option
                        .setName('panel_message')
                        .setDescription('Le message principal / description du panneau de tickets.')
                        .setRequired(true),
                )
                .addStringOption((option) =>
                    option
                        .setName('button_label')
                        .setDescription('Le libellé du bouton de création de ticket (défaut : Ouvrir un ticket)')
                        .setRequired(false),
                )
                .addChannelOption((option) =>
                    option
                        .setName('category')
                        .setDescription('La catégorie où les nouveaux tickets seront créés (facultatif).')
                        .addChannelTypes(ChannelType.GuildCategory)
                        .setRequired(false),
                )
                .addChannelOption((option) =>
                    option
                        .setName('closed_category')
                        .setDescription('La catégorie où les tickets fermés seront déplacés (facultatif).')
                        .addChannelTypes(ChannelType.GuildCategory)
                        .setRequired(false),
                )
                .addRoleOption((option) =>
                    option
                        .setName('staff_role')
                        .setDescription('Rôle ayant accès aux tickets. Ajoute les autres via /ticket dashboard.')
                        .setRequired(false),
                )
                .addIntegerOption((option) =>
                    option
                        .setName('max_tickets_per_user')
                        .setDescription('Nombre maximum de tickets qu’un utilisateur peut créer (défaut : 3)')
                        .setMinValue(1)
                        .setMaxValue(10)
                        .setRequired(false),
                ),
        )
        .addSubcommand((subcommand) =>
            subcommand
                .setName('dashboard')
                .setDescription('Ouvre le tableau de bord interactif du système de tickets'),
        )
        .addSubcommand((subcommand) =>
            subcommand
                .setName('debug')
                .setDescription('Diagnostique l’état du système de tickets (boutons, menus, modales)'),
        ),
    category: 'ticket',

    async execute(interaction, config, client) {
        try {
            const deferred = await InteractionHelper.safeDefer(interaction, { flags: MessageFlags.Ephemeral });
            if (!deferred) {
                return;
            }

            if (
                !isBotOwner(interaction.user.id) &&
                !interaction.member.permissions.has(
                    PermissionFlagsBits.ManageChannels,
                )
            ) {
                logger.warn('Ticket command permission denied', {
                    userId: interaction.user.id,
                    guildId: interaction.guildId,
                    commandName: 'ticket'
                });
                return errorReply(interaction, 'Tu as besoin de la permission `Gérer les salons` pour cette action.');
            }

            const subcommand = interaction.options.getSubcommand();

            if (subcommand === 'debug') {
                const check = (name, collection) =>
                    collection.has(name)
                        ? `✅ \`${name}\``
                        : `❌ \`${name}\``;

                const buttonNames = [
                    'create_ticket',
                    'create_ticket_direct',
                    'create_ticket_modal',
                    'ticket_close',
                    'ticket_close_modal',
                    'ticket_claim',
                    'ticket_pin',
                    'ticket_unclaim',
                    'ticket_reopen',
                    'ticket_delete',
                ];

                const botVersion = `\`${process.env.COMMIT_SHA || 'inconnu'}\``;
                const registeredButtons = buttonNames.filter((name) => client.buttons.has(name)).length;

                const debugEmbed = createEmbed({
                    title: '🔍 Diagnostic du système de tickets',
                    description: [
                        `Version déployée : ${botVersion}`,
                        `Boutons attendus : \`${formatNumber(buttonNames.length)}\` (${formatNumber(registeredButtons)} chargés) • Menus : \`${formatNumber(client.selectMenus.size)}\` • Modales : \`${formatNumber(client.modals.size)}\``,
                    ].join('\n'),
                    color: 'info',
                    thumbnail: guildIconUrl(interaction.guild, 128),
                    fields: [
                        {
                            name: 'Boutons',
                            value: buttonNames
                                .map((n) => check(n, client.buttons))
                                .join('\n'),
                            inline: true,
                        },
                        {
                            name: 'Menus & modales',
                            value: `${check('ticket_type_select', client.selectMenus)}\n${check('create_ticket_modal', client.modals)}\n${check('ticket_close_modal', client.modals)}`,
                            inline: true,
                        },
                        {
                            name: 'Étapes suivantes',
                            value: client.buttons.has('create_ticket_direct')
                                ? 'Tout est en ordre : recharge la page du panneau (ré-envoie-le avec `/ticket setup` dans un salon de test si besoin).'
                                : 'Le bouton `create_ticket_direct` n’est pas chargé sur ce serveur. Le bot tourne avec une version périmée de `handlers/ticketButtons.js` — il faut redéployer.\n\n⚠️ Si une ligne `❌` apparaît pour TOUS les boutons, les interactions ne sont pas chargées du tout : vérifie `Error loading interaction` dans les logs.',
                        },
                    ],
                    footer: brandFooter('Diagnostic tickets'),
                });

                return await InteractionHelper.safeEditReply(interaction, {
                    embeds: [debugEmbed],
                    allowedMentions: NO_MENTIONS,
                    flags: MessageFlags.Ephemeral,
                });
            }

            if (subcommand === 'dashboard') {
                return ticketConfig.execute(interaction, config, client);
            }

            if (subcommand === 'setup') {
                const existingConfig = await getGuildConfig(client, interaction.guildId);
                if (existingConfig?.ticketPanelChannelId) {
                    return errorReply(interaction, `Ce serveur possède déjà un système de tickets (panneau dans <#${existingConfig.ticketPanelChannelId}>). Un seul système est pris en charge : utilise \`/ticket dashboard\` pour le modifier.`);
                }

                const panelChannel = interaction.options.getChannel('panel_channel');
                const categoryChannel = interaction.options.getChannel('category');
                const closedCategoryChannel = interaction.options.getChannel('closed_category');
                const staffRole = interaction.options.getRole('staff_role');
                const panelMessage =
                    interaction.options.getString('panel_message') ||
                    'Bonjour ! Besoin d’aide ou d’une question ? Clique sur le bouton ci-dessous pour ouvrir un ticket.';
                const buttonLabel =
                    interaction.options.getString('button_label') ||
                    'Ouvrir un ticket';
                const maxTicketsPerUser = interaction.options.getInteger('max_tickets_per_user') || 3;

                const setupEmbed = createEmbed({
                    title: '🎫 Centre d’aide',
                    description: `${panelMessage}\n\nClique sur le bouton ci-dessous pour ouvrir un ticket.`,
                    color: 'info',
                    footer: brandFooter('Centre d’aide'),
                });

                try {
                    await panelChannel.send({
                        embeds: [setupEmbed],
                        components: buildTicketTypeButtons(buttonLabel),
                    });

                    if (client.db && interaction.guildId) {
                        const currentConfig = existingConfig;
                        currentConfig.ticketCategoryId = categoryChannel ? categoryChannel.id : null;
                        currentConfig.ticketClosedCategoryId = closedCategoryChannel ? closedCategoryChannel.id : null;
                        currentConfig.ticketStaffRoleIds = staffRole ? [staffRole.id] : [];
                        currentConfig.ticketStaffRoleId = staffRole ? staffRole.id : null;
                        currentConfig.ticketPanelChannelId = panelChannel.id;
                        currentConfig.ticketPanelMessage = panelMessage;
                        currentConfig.ticketButtonLabel = buttonLabel;
                        currentConfig.maxTicketsPerUser = maxTicketsPerUser;

                        const { getGuildConfigKey } = await import('../../utils/database.js');
                        const configKey = getGuildConfigKey(interaction.guildId);
                        await client.db.set(configKey, currentConfig);
                        logger.info('Ticket configuration saved', {
                            guildId: interaction.guildId,
                            categoryId: categoryChannel?.id,
                            closedCategoryId: closedCategoryChannel?.id,
                            staffRoleId: staffRole?.id,
                            staffRoleIds: currentConfig.ticketStaffRoleIds,
                            maxTickets: maxTicketsPerUser
                        });
                    }

                    const successFields = [
                        { name: 'Salon du panneau', value: `${panelChannel}`, inline: true },
                        {
                            name: 'Catégorie des tickets',
                            value: categoryChannel ? `${categoryChannel}` : 'Nouvelle catégorie « Tickets »',
                            inline: true,
                        },
                        {
                            name: 'Catégorie fermée',
                            value: closedCategoryChannel ? `${closedCategoryChannel}` : 'Aucune',
                            inline: true,
                        },
                        {
                            name: 'Rôle staff',
                            value: staffRole ? `${staffRole}` : 'Aucun (ajoutable via le dashboard)',
                            inline: true,
                        },
                        { name: 'Tickets max par membre', value: `\`${formatNumber(maxTicketsPerUser)}\``, inline: true },
                    ];

                    const replyEmbed = successEmbed(
                        'Le panneau est en ligne. Les nouveaux tickets apparaîtront dans la catégorie choisie.',
                        '✅ Panneau de tickets configuré',
                    );
                    replyEmbed.addFields(successFields);
                    replyEmbed.setFooter(brandFooter('Configuration des tickets'));

                    await InteractionHelper.safeEditReply(interaction, {
                        embeds: [replyEmbed],
                        allowedMentions: NO_MENTIONS,
                        flags: MessageFlags.Ephemeral,
                    });

                    logger.info('Ticket panel setup completed', {
                        userId: interaction.user.id,
                        userTag: interaction.user.tag,
                        guildId: interaction.guildId,
                        panelChannelId: panelChannel.id,
                        categoryId: categoryChannel?.id,
                        closedCategoryId: closedCategoryChannel?.id,
                        staffRoleId: staffRole?.id,
                        maxTickets: maxTicketsPerUser,
                        commandName: 'ticket_setup'
                    });

                    const logEmbed = createEmbed({
                        title: '🔧 Mise en place du système de tickets',
                        description: `Le panneau de tickets a été configuré dans ${panelChannel} par ${interaction.user}.`,
                        color: 'warning',
                        fields: [
                            { name: 'Salon du panneau', value: panelChannel.toString(), inline: true },
                            {
                                name: 'Catégorie des tickets',
                                value: categoryChannel ? categoryChannel.toString() : 'Aucune spécifiée.',
                                inline: true,
                            },
                            {
                                name: 'Catégorie fermée',
                                value: closedCategoryChannel ? closedCategoryChannel.toString() : 'Aucune spécifiée.',
                                inline: true,
                            },
                            {
                                name: 'Rôles staff',
                                value: staffRole ? staffRole.toString() : 'Aucun spécifié.',
                                inline: true,
                            },
                            {
                                name: 'Tickets max par utilisateur',
                                value: maxTicketsPerUser.toString(),
                                inline: true,
                            },
                            {
                                name: 'Modérateur',
                                value: `${interaction.user.tag} (${interaction.user.id})`,
                                inline: false,
                            },
                        ],
                        footer: brandFooter('Journal de configuration'),
                    });

                } catch (error) {
                    logger.error('Ticket setup error', {
                        error: error.message,
                        stack: error.stack,
                        userId: interaction.user.id,
                        guildId: interaction.guildId,
                        commandName: 'ticket_setup'
                    });
                    await errorReply(interaction, 'Impossible d’envoyer le panneau de tickets ou d’enregistrer la configuration. Vérifie les permissions du bot et la connexion à la base de données.');
                }
            }
        } catch (error) {
            logger.error('Error executing ticket command', {
                error: error.message,
                stack: error.stack,
                userId: interaction.user.id,
                guildId: interaction.guildId,
                commandName: 'ticket'
            });
            await errorReply(interaction, 'Impossible de terminer la commande tickets. Réessaie dans un instant.');
        }
    },
};
