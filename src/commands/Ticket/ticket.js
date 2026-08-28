import { getColor } from '../../config/bot.js';
import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ChannelType,
  MessageFlags,
} from 'discord.js';
import { createEmbed, errorEmbed, successEmbed } from '../../utils/embeds.js';
import { buildTicketTypeButtons, resolveTicketTypes } from '../../services/ticket.js';
import { getGuildConfig } from '../../services/guildConfig.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { logger } from '../../utils/logger.js';
import { handleInteractionError } from '../../utils/errorHandler.js';

import ticketConfig from './modules/ticket_dashboard.js';

export default {
    data: new SlashCommandBuilder()
        .setName("ticket")
        .setDescription("Gère le système de tickets du serveur.")
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
        .addSubcommand((subcommand) =>
            subcommand
                .setName("setup")
                .setDescription(
                    "Configure le panneau de création de tickets dans un salon spécifié.",
                )
                .addChannelOption((option) =>
                    option
                        .setName("panel_channel")
                        .setDescription(
                            "Le salon où le panneau de tickets sera envoyé.",
                        )
                        .addChannelTypes(ChannelType.GuildText)
                        .setRequired(true),
                )
                .addStringOption((option) =>
                    option
                        .setName("panel_message")
                        .setDescription(
                            "Le message principal / description du panneau de tickets.",
                        )
                        .setRequired(true),
                )
                .addStringOption((option) =>
                    option
                        .setName("button_label")
                        .setDescription(
                            "Le libellé du bouton de création de ticket (défaut : Ouvrir un ticket)",
                        )
                        .setRequired(false),
                )
                .addChannelOption((option) =>
                    option
                        .setName("category")
                        .setDescription(
                            "La catégorie où les nouveaux tickets seront créés (facultatif).",
                        )
                        .addChannelTypes(ChannelType.GuildCategory)
                        .setRequired(false),
                )
                .addChannelOption((option) =>
                    option
                        .setName("closed_category")
                        .setDescription(
                            "La catégorie où les tickets fermés seront déplacés (facultatif).",
                        )
                        .addChannelTypes(ChannelType.GuildCategory)
                        .setRequired(false),
                )
                .addRoleOption((option) =>
                    option
                        .setName("staff_role")
                        .setDescription(
                            "Le rôle qui peut accéder aux tickets (facultatif).",
                        )
                        .setRequired(false),
                )
                .addIntegerOption((option) =>
                    option
                        .setName("max_tickets_per_user")
                        .setDescription("Nombre maximum de tickets qu'un utilisateur peut créer (défaut : 3)")
                        .setMinValue(1)
                        .setMaxValue(10)
                        .setRequired(false),
                )
                .addBooleanOption((option) =>
                    option
                        .setName("dm_on_close")
                        .setDescription("Envoyer un MP à l'utilisateur quand son ticket est fermé (défaut : oui)")
                        .setRequired(false),
                ),
        )
        .addSubcommand((subcommand) =>
            subcommand
                .setName("dashboard")
                .setDescription("Ouvre le tableau de bord interactif du système de tickets"),
        )
        .addSubcommand((subcommand) =>
            subcommand
                .setName("debug")
                .setDescription("Diagnostique l'état du système de tickets (boutons, menus, modales)"),
        ),
    category: "ticket",

    async execute(interaction, config, client) {
        try {
            const deferred = await InteractionHelper.safeDefer(interaction, { flags: MessageFlags.Ephemeral });
            if (!deferred) {
                return;
            }

            if (
                !interaction.member.permissions.has(
                    PermissionFlagsBits.ManageChannels,
                )
            ) {
                logger.warn('Ticket command permission denied', {
                    userId: interaction.user.id,
                    guildId: interaction.guildId,
                    commandName: 'ticket'
                });
                return await InteractionHelper.safeEditReply(interaction, {
                    embeds: [
                        errorEmbed(
                            "Permission refusée",
                            "Vous avez besoin de la permission `Gérer les salons` pour cette action.",
                        ),
                    ],
                });
            }

            const subcommand = interaction.options.getSubcommand();

            if (subcommand === "debug") {
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
                    'ticket_priority',
                    'ticket_pin',
                    'ticket_unclaim',
                    'ticket_reopen',
                    'ticket_delete',
                ];

                const botVersion = `\`${process.env.COMMIT_SHA || 'inconnu'}\``;

                const debugEmbed = createEmbed({
                    title: '🔍 Diagnostic du système de tickets',
                    description: `**Version déployée :** ${botVersion}\n**Boutons enregistrés :** ${client.buttons.size} · **Menus :** ${client.selectMenus.size} · **Modales :** ${client.modals.size}`,
                    color: 0x3498db,
                    timestamp: true,
                }).addFields(
                    {
                        name: 'Boutons',
                        value: buttonNames
                            .map((n) => check(n, client.buttons))
                            .join('\n'),
                        inline: true,
                    },
                    {
                        name: 'Menus & Modales',
                        value: `${check('ticket_type_select', client.selectMenus)}\n${check('create_ticket_modal', client.modals)}\n${check('ticket_close_modal', client.modals)}`,
                        inline: true,
                    },
                    {
                        name: 'Etapes suivantes',
                        value: client.buttons.has('create_ticket_direct')
                            ? 'Tout est en ordre : recharge la page du panneau (ré-envoie-le avec `/ticket setup` dans un salon de test si besoin).'
                            : 'Le bouton `create_ticket_direct` n\'est pas chargé sur ce serveur. Le bot tourne avec une version périmée de `handlers/ticketButtons.js` — il faut redéployer.\n\n⚠️ Si une ligne `❌` apparaît pour TOUS les boutons, les interactions ne sont pas chargées du tout : vérifie `Error loading interaction` dans les logs.',
                    },
                );

                return await InteractionHelper.safeEditReply(interaction, {
                    embeds: [debugEmbed],
                });
            }

            if (subcommand === "dashboard") {
                return ticketConfig.execute(interaction, config, client);
            }

            if (subcommand === "setup") {
                const existingConfig = await getGuildConfig(client, interaction.guildId);
                if (existingConfig?.ticketPanelChannelId) {
                    return await InteractionHelper.safeEditReply(interaction, {
                        embeds: [
                            errorEmbed(
                                'Système de tickets déjà actif',
                                `Ce serveur possède déjà un système de tickets (panneau dans <#${existingConfig.ticketPanelChannelId}>).\n\nUn seul système de tickets est pris en charge par serveur. Utilisez \`/ticket dashboard\` pour modifier la configuration existante, ou choisissez **Supprimer le système** dans le tableau de bord pour repartir de zéro.`,
                            ),
                        ],
                    });
                }

                const panelChannel = interaction.options.getChannel("panel_channel");
                const categoryChannel = interaction.options.getChannel("category");
                const closedCategoryChannel = interaction.options.getChannel("closed_category");
                const staffRole = interaction.options.getRole("staff_role");
                const panelMessage =
                    interaction.options.getString("panel_message") ||
                    "Bonjour ! Besoin d'aide ou d'une question ? Cliquez sur le bouton ci-dessous pour ouvrir un ticket.";
                const buttonLabel =
                    interaction.options.getString("button_label") ||
                    "Ouvrir un ticket";
                const maxTicketsPerUser = interaction.options.getInteger("max_tickets_per_user") || 3;
                const dmOnClose = interaction.options.getBoolean("dm_on_close") !== false;

                const setupEmbed = createEmbed({
                    title: "🎫 Centre d'aide",
                    description: panelMessage,
                    color: getColor('info'),
                    footer: { text: 'Choisissez un bouton ci-dessous pour ouvrir un ticket' },
                });

                try {
                    await panelChannel.send({
                        embeds: [setupEmbed],
                        components: buildTicketTypeButtons(resolveTicketTypes(existingConfig)),
                    });

                    if (client.db && interaction.guildId) {
                        const currentConfig = existingConfig;
                        currentConfig.ticketCategoryId = categoryChannel ? categoryChannel.id : null;
                        currentConfig.ticketClosedCategoryId = closedCategoryChannel ? closedCategoryChannel.id : null;
                        currentConfig.ticketStaffRoleId = staffRole ? staffRole.id : null;
                        currentConfig.ticketPanelChannelId = panelChannel.id;
                        currentConfig.ticketPanelMessage = panelMessage;
                        currentConfig.ticketButtonLabel = buttonLabel;
                        currentConfig.maxTicketsPerUser = maxTicketsPerUser;
                        currentConfig.dmOnClose = dmOnClose;

                        const { getGuildConfigKey } = await import('../../utils/database.js');
                        const configKey = getGuildConfigKey(interaction.guildId);
                        await client.db.set(configKey, currentConfig);
                        logger.info('Ticket configuration saved', {
                            guildId: interaction.guildId,
                            categoryId: categoryChannel?.id,
                            closedCategoryId: closedCategoryChannel?.id,
                            staffRoleId: staffRole?.id,
                            maxTickets: maxTicketsPerUser,
                            dmOnClose: dmOnClose
                        });
                    }

                    let successMessage = `Le panneau de création de tickets a été envoyé dans ${panelChannel}. `;

                    if (categoryChannel) {
                        successMessage += `Les nouveaux tickets seront créés dans la catégorie **${categoryChannel.name}**. `;
                    } else {
                        successMessage += 'Les nouveaux tickets seront créés dans une nouvelle catégorie "Tickets". ';
                    }

                    if (closedCategoryChannel) {
                        successMessage += `Les tickets fermés seront déplacés vers **${closedCategoryChannel.name}**. `;
                    }

                    if (staffRole) {
                        successMessage += `Le rôle **${staffRole.name}** aura accès aux tickets. `;
                    }

                    successMessage += `\n\n**Tickets max par utilisateur :** ${maxTicketsPerUser}\n**MP à la fermeture :** ${dmOnClose ? 'Activé' : 'Désactivé'}`;

                    await InteractionHelper.safeEditReply(interaction, {
                        embeds: [
                            successEmbed(
                                "Panneau de tickets configuré",
                                successMessage,
                            ),
                        ],
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
                        dmOnClose: dmOnClose,
                        commandName: 'ticket_setup'
                    });

                    const logEmbed = createEmbed({
                        title: "🔧 Mise en place du système de tickets (Journal de configuration)",
                        description: `Le panneau de tickets a été configuré dans ${panelChannel} par ${interaction.user}.`,
                        color: getColor('warning'),
                    })
                        .addFields(
                            {
                                name: "Salon du panneau",
                                value: panelChannel.toString(),
                                inline: true,
                            },
                            {
                                name: "Catégorie des tickets",
                                value: categoryChannel
                                    ? categoryChannel.toString()
                                    : "Aucune spécifiée.",
                                inline: true,
                            },
                            {
                                name: "Catégorie fermée",
                                value: closedCategoryChannel
                                    ? closedCategoryChannel.toString()
                                    : "Aucune spécifiée.",
                                inline: true,
                            },
                            {
                                name: "Rôle staff",
                                value: staffRole
                                    ? staffRole.toString()
                                    : "Aucun spécifié.",
                                inline: true,
                            },
                            {
                                name: "Tickets max par utilisateur",
                                value: maxTicketsPerUser.toString(),
                                inline: true,
                            },
                            {
                                name: "MP à la fermeture",
                                value: dmOnClose ? 'Activé' : 'Désactivé',
                                inline: true,
                            },
                            {
                                name: "Modérateur",
                                value: `${interaction.user.tag} (${interaction.user.id})`,
                                inline: false,
                            },
                        );

                } catch (error) {
                    logger.error('Ticket setup error', {
                        error: error.message,
                        stack: error.stack,
                        userId: interaction.user.id,
                        guildId: interaction.guildId,
                        commandName: 'ticket_setup'
                    });
                    if (interaction.deferred || interaction.replied) {
                        await InteractionHelper.safeEditReply(interaction, {
                            embeds: [
                                errorEmbed(
                                    "Échec de la configuration",
                                    "Impossible d'envoyer le panneau de tickets ou d'enregistrer la configuration. Vérifiez les permissions du bot (notamment l'envoi de messages dans le salon cible) et la connexion à la base de données.",
                                ),
                            ],
                        }).catch(err => {
                            logger.error('Failed to send error reply', {
                                error: err.message,
                                guildId: interaction.guildId
                            });
                        });
                    } else {
                        await handleInteractionError(interaction, error, {
                            commandName: 'ticket_setup',
                            source: 'ticket_setup_command'
                        });
                    }
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
            await handleInteractionError(interaction, error, {
                commandName: 'ticket',
                source: 'ticket_command_main'
            });
        }
    }
};