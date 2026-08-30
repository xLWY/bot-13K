import { SlashCommandBuilder, PermissionFlagsBits, PermissionsBitField, ChannelType, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, ComponentType, LabelBuilder, RoleSelectMenuBuilder } from 'discord.js';
import { createEmbed, errorEmbed, successEmbed } from '../../utils/embeds.js';
import { getColor } from '../../config/bot.js';
import { logger } from '../../utils/logger.js';
import { handleInteractionError, withErrorHandling, createError, ErrorTypes } from '../../utils/errorHandler.js';
import ApplicationService from '../../services/applicationService.js';
import { 
    getApplicationSettings, 
    saveApplicationSettings, 
    getApplication, 
    getApplications, 
    updateApplication,
    getApplicationRoles,
    saveApplicationRoles,
    getApplicationRoleSettings,
    saveApplicationRoleSettings,
    deleteApplication
} from '../../utils/database.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import appDashboard from './modules/app_dashboard.js';

function getApplicationStatusPresentation(statusValue) {
    const normalized = typeof statusValue === 'string' ? statusValue.trim().toLowerCase() : 'unknown';
    const statusLabel =
        normalized === 'pending' ? 'En Cours' :
        normalized === 'approved' ? 'Acceptée' :
        normalized === 'denied' ? 'Refusée' :
        'Inconnu';
    const statusEmoji =
        normalized === 'pending' ? '🟡' :
        normalized === 'approved' ? '🟢' :
        normalized === 'denied' ? '🔴' :
        '⚪';

    return { normalized, statusLabel, statusEmoji };
}

export default {
    data: new SlashCommandBuilder()
    .setName("app-admin")
    .setDescription("* Gérer les candidatures au staff")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((subcommand) =>
        subcommand
            .setName("setup")
            .setDescription("Configurer une nouvelle candidature")
    )
    .addSubcommand((subcommand) =>
        subcommand
            .setName("review")
            .setDescription("Approuver ou refuser une candidature")
            .addStringOption((option) =>
                option
                    .setName("id")
                    .setDescription("L'ID de la candidature")
                    .setRequired(true),
            ),
    )
    .addSubcommand((subcommand) =>
        subcommand
            .setName("list")
            .setDescription("Lister toutes les candidatures")
            .addStringOption((option) =>
                option
                    .setName("status")
                    .setDescription("Filtrer par statut")
                    .addChoices(
                        { name: "En Attente", value: "pending" },
                        { name: "Approuvée", value: "approved" },
                        { name: "Refusée", value: "denied" },
                    ),
            )
            .addStringOption((option) =>
                option.setName("role").setDescription("Filtrer par ID de rôle"),
            )
            .addUserOption((option) =>
                option.setName("user").setDescription("Filtrer par utilisateur"),
            )
            .addNumberOption((option) =>
                option
                    .setName("limit")
                    .setDescription(
                        "Nombre maximum de candidatures à afficher (défaut : 10)",
                    )
                    .setMinValue(1)
                    .setMaxValue(25),
            ),
    )
    .addSubcommand((subcommand) =>
        subcommand
            .setName("dashboard")
            .setDescription("Ouvrir le panneau de configuration des candidatures")
            .addStringOption((option) =>
                option
                    .setName("application")
                    .setDescription("Sélectionner une candidature à configurer")
                    .setRequired(false)
                    .setAutocomplete(true),
            ),
    ),

    category: "Community",

    execute: withErrorHandling(async (interaction) => {
        if (!interaction.inGuild()) {
            return InteractionHelper.safeReply(interaction, {
                embeds: [errorEmbed("Cette commande ne peut être utilisée que dans un serveur.")],
                flags: ["Ephemeral"],
            });
        }

        const { options, guild, member } = interaction;
        const subcommand = options.getSubcommand();

        if (subcommand !== 'dashboard' && subcommand !== 'setup') {
            await InteractionHelper.safeDefer(interaction, { flags: ['Ephemeral'] });
        }

        logger.info(`App-admin command executed: ${subcommand}`, {
            userId: interaction.user.id,
            guildId: guild.id,
            subcommand
        });

        // ✓ Permission check: User must have ManageGuild permission or a configured manager role
        // This prevents unauthorized users from accessing admin functions
        await ApplicationService.checkManagerPermission(interaction.client, guild.id, member);

        if (subcommand === "setup") {
            await handleSetup(interaction);
        } else if (subcommand === "review") {
            await handleReview(interaction);
        } else if (subcommand === "list") {
            await handleList(interaction);
        } else if (subcommand === "dashboard") {
            const selectedAppName = interaction.options.getString("application");
            await appDashboard.execute(interaction, null, interaction.client, selectedAppName);
        }
    }, { type: 'command', commandName: 'app-admin' })
};

async function handleSetup(interaction) {
    // Ensure interaction hasn't been deferred/replied yet (safety check)
    if (interaction.deferred || interaction.replied) {
        return InteractionHelper.safeReply(interaction, {
            embeds: [errorEmbed("Cette interaction a déjà été traitée. Veuillez réessayer la commande.")],
            flags: ["Ephemeral"],
        });
    }

    // Build modal using LabelBuilder API with a native role select dropdown
    const modal = new ModalBuilder()
        .setCustomId('app_setup_modal')
        .setTitle('Configurer une Nouvelle Candidature');

    const roleSelect = new RoleSelectMenuBuilder()
        .setCustomId('role_id')
        .setPlaceholder('Sélectionner le rôle que les utilisateurs postuleront')
        .setRequired(true);

    const roleLabel = new LabelBuilder()
        .setLabel('Rôle de la Candidature')
        .setDescription('Le rôle pour lequel les utilisateurs postuleront')
        .setRoleSelectMenuComponent(roleSelect);

    const appNameInput = new TextInputBuilder()
        .setCustomId('app_name')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('ex. Modérateur, Assistant, Développeur')
        .setMaxLength(50)
        .setMinLength(1)
        .setRequired(true);

    const appNameLabel = new LabelBuilder()
        .setLabel('Nom de la Candidature')
        .setTextInputComponent(appNameInput);

    const q1Input = new TextInputBuilder()
        .setCustomId('app_question_1')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('Pourquoi veux-tu ce rôle ?')
        .setMaxLength(100)
        .setMinLength(1)
        .setRequired(true);

    const q1Label = new LabelBuilder()
        .setLabel('Question 1 (obligatoire)')
        .setTextInputComponent(q1Input);

    const q2Input = new TextInputBuilder()
        .setCustomId('app_question_2')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('Quelle expérience as-tu ?')
        .setMaxLength(100)
        .setRequired(false);

    const q2Label = new LabelBuilder()
        .setLabel('Question 2 (optionnelle)')
        .setTextInputComponent(q2Input);

    const q3Input = new TextInputBuilder()
        .setCustomId('app_question_3')
        .setStyle(TextInputStyle.Short)
        .setMaxLength(100)
        .setRequired(false);

    const q3Label = new LabelBuilder()
        .setLabel('Question 3 (optionnelle)')
        .setTextInputComponent(q3Input);

    modal.addLabelComponents(roleLabel, appNameLabel, q1Label, q2Label, q3Label);

    await interaction.showModal(modal);

    const submitted = await interaction.awaitModalSubmit({
        time: 15 * 60 * 1000, // 15 minutes
        filter: (i) =>
            i.customId === 'app_setup_modal' &&
            i.user.id === interaction.user.id,
    }).catch(() => null);

    if (!submitted) {
        logger.info('App setup modal dismissed or timed out', { guildId: interaction.guild.id, userId: interaction.user.id });
        return;
    }

    const appName = submitted.fields.getTextInputValue('app_name').trim();
    const selectedRoles = submitted.fields.getSelectedRoles('role_id');
    const roleId = selectedRoles.first()?.id;

    if (!roleId) {
        await submitted.reply({
            embeds: [errorEmbed('Aucun Rôle Sélectionné', 'Tu dois sélectionner un rôle pour la candidature.')],
            flags: ['Ephemeral'],
        });
        return;
    }

    const questions = [
        submitted.fields.getTextInputValue('app_question_1').trim(),
        submitted.fields.getTextInputValue('app_question_2').trim(),
        submitted.fields.getTextInputValue('app_question_3').trim(),
    ].filter(q => q.length > 0);

    // Get the role to verify it exists
    const role = await interaction.guild.roles.fetch(roleId).catch(() => null);
    if (!role) {
        await submitted.reply({
            embeds: [errorEmbed('Rôle Invalide', 'Le rôle sélectionné est introuvable.')],
            flags: ['Ephemeral'],
        });
        return;
    }

    // Check if this role is already an application
    const existingRoles = await getApplicationRoles(interaction.client, interaction.guild.id);
    if (existingRoles.some(r => r.roleId === roleId)) {
        await submitted.reply({
            embeds: [errorEmbed('Déjà Configuré', `Le rôle ${role} est déjà configuré comme candidature.`)],
            flags: ['Ephemeral'],
        });
        return;
    }

    // Add the role to applications with enabled status
    existingRoles.push({
        roleId: roleId,
        name: appName,
        enabled: true,  // New applications start enabled
    });

    await saveApplicationRoles(interaction.client, interaction.guild.id, existingRoles);

    // Enable the system
    const settings = await getApplicationSettings(interaction.client, interaction.guild.id);
    if (!settings.enabled) {
        await ApplicationService.updateSettings(interaction.client, interaction.guild.id, { enabled: true });
    }

    // Save the questions for this specific role
    await saveApplicationRoleSettings(interaction.client, interaction.guild.id, roleId, { questions });

    await submitted.reply({
        embeds: [successEmbed(
            '✅ Candidature Créée',
            `La candidature **${appName}** a été créée pour ${role}.\n\nTu peux personnaliser le canal de logs, les rôles gestionnaires, les questions et la période de conservation dans le panneau de configuration.`,
        )],
        flags: ['Ephemeral'],
    });

    // Auto-open dashboard with this app selected
    setTimeout(() => {
        appDashboard.execute(submitted, null, interaction.client, appName);
    }, 500);
}


async function handleReview(interaction) {
    const appId = interaction.options.getString("id");

    const application = await getApplication(
        interaction.client,
        interaction.guild.id,
        appId,
    );
    if (!application) {
        return InteractionHelper.safeEditReply(interaction, {
            embeds: [errorEmbed("Candidature introuvable.")],
            flags: ["Ephemeral"],
        });
    }

    if (application.status !== "pending") {
        return InteractionHelper.safeEditReply(interaction, {
            embeds: [
                errorEmbed("Cette candidature a déjà été traitée."),
            ],
            flags: ["Ephemeral"],
        });
    }

    // Show application details with approve/deny buttons
    const appEmbed = createEmbed({
        title: `📋 Examiner la Candidature`,
        description: `**Utilisateur :** <@${application.userId}>\n**Candidature :** ${application.roleName}\n**ID de la candidature :** \`${appId}\``,
        color: 'info',
    });

    // Add application answers to the embed
    if (application.answers && application.answers.length > 0) {
        application.answers.forEach((item, index) => {
            appEmbed.addFields({
                name: `Q${index + 1} : ${item.question}`,
                value: item.answer || '*Aucune réponse fournie*',
                inline: false
            });
        });
    }

    const buttonRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`app_review_approve_${appId}`)
            .setLabel('Approuver')
            .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
            .setCustomId(`app_review_deny_${appId}`)
            .setLabel('Refuser')
            .setStyle(ButtonStyle.Danger),
    );

    await InteractionHelper.safeEditReply(interaction, {
        embeds: [appEmbed],
        components: [buttonRow],
        flags: ["Ephemeral"],
    });

    // Setup button collector
    const collector = interaction.channel.createMessageComponentCollector({
        componentType: ComponentType.Button,
        filter: i =>
            i.user.id === interaction.user.id &&
            (i.customId.startsWith(`app_review_approve_${appId}`) ||
             i.customId.startsWith(`app_review_deny_${appId}`)),
        time: 300_000, // 5 minutes
        max: 1,
    });

    collector.on('collect', async buttonInteraction => {
        const isApprove = buttonInteraction.customId.includes('approve');
        
        // Show modal for reason
        const reasonModal = new ModalBuilder()
            .setCustomId(`app_review_reason_${appId}_${isApprove ? 'approve' : 'deny'}`)
            .setTitle(`${isApprove ? 'Approuver' : 'Refuser'} la Candidature - Motif`);

        reasonModal.addComponents(
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('review_reason')
                    .setLabel('Motif (optionnel)')
                    .setStyle(TextInputStyle.Paragraph)
                    .setPlaceholder('Fournis une raison pour cette décision...')
                    .setMaxLength(500)
                    .setRequired(false),
            ),
        );

        await buttonInteraction.showModal(reasonModal);

        try {
            const reasonSubmit = await buttonInteraction.awaitModalSubmit({
                time: 5 * 60 * 1000, // 5 minutes
                filter: i =>
                    i.customId === `app_review_reason_${appId}_${isApprove ? 'approve' : 'deny'}` &&
                    i.user.id === buttonInteraction.user.id,
            }).catch(() => null);

            if (!reasonSubmit) return;

            const reason = reasonSubmit.fields.getTextInputValue('review_reason').trim() || "Aucun motif fourni.";
            const action = isApprove ? 'approve' : 'deny';
            const status = isApprove ? 'approved' : 'denied';

            const updatedApplication = await ApplicationService.reviewApplication(
                reasonSubmit.client,
                interaction.guild.id,
                appId,
                {
                    action,
                    reason,
                    reviewerId: reasonSubmit.user.id
                }
            );

            // Send DM to user
            try {
                const user = await reasonSubmit.client.users.fetch(application.userId);
                const statusColor = status === "approved" ? getColor('success') : getColor('error');
                const reviewStatus = getApplicationStatusPresentation(status);
                const dmEmbed = createEmbed(
                    `${reviewStatus.statusEmoji} Candidature ${reviewStatus.statusLabel}`,
                    `Ta candidature pour **${application.roleName}** a été **${status}**\n` +
                        `**Note :** ${reason}\n\n` +
                        `Utilise \`/apply status id:${appId}\` pour afficher les détails.`
                ).setColor(statusColor);

                await user.send({ embeds: [dmEmbed] });
            } catch (error) {
                logger.warn('Failed to send DM to user for application review', {
                    error: error.message,
                    userId: application.userId,
                    applicationId: appId
                });
            }

            // Update log message
            if (application.logMessageId && application.logChannelId) {
                try {
                    const statusColor = status === "approved" ? getColor('success') : getColor('error');
                    const logChannel = interaction.guild.channels.cache.get(
                        application.logChannelId,
                    );
                    if (logChannel) {
                        const logMessage = await logChannel.messages.fetch(
                            application.logMessageId,
                        );
                        if (logMessage) {
                            const embed = logMessage.embeds[0];
                            if (embed) {
                                const reviewStatus = getApplicationStatusPresentation(status);
                                const newEmbed = EmbedBuilder.from(embed)
                                    .setColor(statusColor)
                                    .spliceFields(0, 1, {
                                        name: "Statut",
                                        value: `${reviewStatus.statusEmoji} ${reviewStatus.statusLabel}`,
                                    });

                                await logMessage.edit({
                                    embeds: [newEmbed],
                                    components: [],
                                });
                            }
                        }
                    }
                } catch (error) {
                    logger.warn('Failed to update log message for application', {
                        error: error.message,
                        applicationId: appId,
                        logMessageId: application.logMessageId
                    });
                }
            }

            // Assign role if approved
            if (isApprove) {
                try {
                    const member = await interaction.guild.members.fetch(
                        application.userId,
                    );
                    await member.roles.add(application.roleId);
                } catch (error) {
                    logger.error('Failed to assign role to approved applicant', {
                        error: error.message,
                        userId: application.userId,
                        roleId: application.roleId,
                        applicationId: appId
                    });
                }
            }

            // Respond to modal submission
            await reasonSubmit.reply({
                embeds: [
                    successEmbed(
                        `Candidature ${status}`,
                        `La candidature a été **${status}**.`,
                    ),
                ],
                flags: ["Ephemeral"],
            });

        } catch (error) {
            logger.error('Error reviewing application:', error);
            await buttonInteraction.reply({
                embeds: [errorEmbed('Erreur', 'Une erreur est survenue lors de l\'examen de la candidature.')],
                flags: ["Ephemeral"],
            });
        }
    });

    collector.on('end', async (collected, reason) => {
        if (reason === 'time') {
            const timeoutEmbed = createEmbed({
                title: '⏱️ Examen Expiré',
                description: 'Les boutons d\'examen ont expiré.',
                color: 'warning',
            });

            await InteractionHelper.safeEditReply(interaction, {
                embeds: [timeoutEmbed],
                components: [],
            }).catch(() => {});
        }
    });
}

async function handleList(interaction) {
    const status = interaction.options.getString("status");
    const user = interaction.options.getUser("user");
    const limit = interaction.options.getNumber("limit") || 10;

    const filters = {};
    // Default to showing only pending applications if no status specified
    if (status) {
        filters.status = status;
    } else {
        filters.status = 'pending';
    }

    let applications = await getApplications(
        interaction.client,
        interaction.guild.id,
        filters,
    );
    
    // Filter out applications from users who are no longer in the guild (except if filtering by specific user)
    if (!user) {
        applications = await Promise.all(
            applications.map(async (app) => {
                try {
                    await interaction.guild.members.fetch(app.userId);
                    return app; // User still in guild
                } catch {
                    // User no longer in guild, delete the application
                    await deleteApplication(interaction.client, interaction.guild.id, app.id, app.userId);
                    return null; // Mark for removal
                }
            })
        ).then(results => results.filter(Boolean)); // Remove nulls
    }

    if (user) {
        applications = applications.filter((app) => app.userId === user.id);
    }

    if (applications.length === 0) {
        const applicationRoles = await getApplicationRoles(interaction.client, interaction.guild.id);
        
        if (applicationRoles.length > 0) {
            const embed = createEmbed({ 
                title: "Aucune Candidature Trouvée", 
                description: "Aucune candidature soumise ne correspond aux critères spécifiés.\n\nCependant, les rôles de candidature suivants sont configurés :" 
            });

            applicationRoles.forEach((appRole, index) => {
                const role = interaction.guild.roles.cache.get(appRole.roleId);
                embed.addFields({
                    name: `${index + 1}. ${appRole.name}`,
                    value: `**Rôle :** ${role ? `<@&${appRole.roleId}>` : 'Rôle introuvable'}\n**Disponible pour les candidatures :** Oui`,
                    inline: false
                });
            });

            embed.setFooter({
                text: "Les utilisateurs peuvent postuler avec /apply submit ou voir les rôles disponibles avec /apply list"
            });

            return InteractionHelper.safeEditReply(interaction, { embeds: [embed], flags: ["Ephemeral"] });
        } else {
            return InteractionHelper.safeEditReply(interaction, {
                embeds: [
                    errorEmbed(
                        "Aucune candidature trouvée et aucun rôle de candidature configuré.\n" +
                        "Utilise `/app-admin roles add` pour configurer des rôles de candidature en premier."
                    ),
                ],
                flags: ["Ephemeral"],
            });
        }
    }

    applications = applications
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
        .slice(0, limit);

    const embed = createEmbed({ title: "Candidatures Soumises", description: `Affichage de ${applications.length} candidature(s).`, });

    applications.forEach((app) => {
        const statusView = getApplicationStatusPresentation(app?.status);
        const roleName = app?.roleName || 'Rôle Inconnu';
        const username = app?.username || 'Utilisateur Inconnu';
        const createdAt = app?.createdAt ? new Date(app.createdAt) : null;
        const createdAtDisplay = createdAt && !Number.isNaN(createdAt.getTime())
            ? createdAt.toLocaleString()
            : 'Date inconnue';

        embed.addFields({
            name: `${statusView.statusEmoji} ${roleName} - ${username}`,
            value:
                `**ID :** \`${app.id}\`\n` +
                `**Statut :** ${statusView.statusEmoji} ${statusView.statusLabel}\n` +
                `**Date :** ${createdAtDisplay}`,
            inline: true,
        });
    });

    await InteractionHelper.safeEditReply(interaction, {
        embeds: [embed],
        flags: ["Ephemeral"],
    });
}

export async function handleApplicationReviewModal(interaction) {
    if (!interaction.isModalSubmit()) return;
    
    const customId = interaction.customId;
    if (!customId.startsWith('app_review_')) return;
    
    const [, appId, action] = customId.split('_');
    const reason = interaction.fields.getTextInputValue('reason') || 'Aucun motif fourni.';
    const isApprove = action === 'approve';
    
    try {
        const application = await getApplication(interaction.client, interaction.guild.id, appId);
        if (!application) {
            return InteractionHelper.safeReply(interaction, {
                embeds: [errorEmbed('Candidature introuvable.')],
                flags: ["Ephemeral"]
            });
        }
        
        const status = isApprove ? 'approved' : 'denied';
        await updateApplication(interaction.client, interaction.guild.id, appId, {
            status,
            reviewer: interaction.user.id,
            reviewMessage: reason,
            reviewedAt: new Date().toISOString()
        });
        
        try {
            const user = await interaction.client.users.fetch(application.userId);
            const reviewStatus = getApplicationStatusPresentation(status);
            const dmEmbed = createEmbed(
                `${reviewStatus.statusEmoji} Candidature ${reviewStatus.statusLabel}`,
                `Ta candidature pour **${application.roleName}** a été **${status}**.\n` +
                `**Note :** ${reason}\n\n` +
                `Utilise \`/apply status id:${appId}\` pour afficher les détails.`,
                isApprove ? '#00FF00' : '#FF0000'
            );
            
            await user.send({ embeds: [dmEmbed] });
        } catch (error) {
            logger.error('Error sending DM to user:', error);
        }
        
        if (application.logMessageId && application.logChannelId) {
            try {
                const logChannel = interaction.guild.channels.cache.get(application.logChannelId);
                if (logChannel) {
                    const logMessage = await logChannel.messages.fetch(application.logMessageId);
                    if (logMessage) {
                        const embed = logMessage.embeds[0];
                        if (embed) {
                            const reviewStatus = getApplicationStatusPresentation(status);
                                const newEmbed = EmbedBuilder.from(embed)
                                    .setColor(isApprove ? '#00FF00' : '#FF0000')
                                    .spliceFields(0, 1, {
                                        name: 'Statut',
                                        value: `${reviewStatus.statusEmoji} ${reviewStatus.statusLabel}`
                                    });
                            
                            await logMessage.edit({
                                embeds: [newEmbed],
                                components: []
                            });
                        }
                    }
                }
            } catch (error) {
                logger.error('Error updating log message:', error);
            }
        }
        
        if (isApprove) {
            try {
                const member = await interaction.guild.members.fetch(application.userId);
                await member.roles.add(application.role);
            } catch (error) {
                logger.error('Error assigning role:', error);
            }
        }
        
        await InteractionHelper.safeEditReply(interaction, {
            embeds: [
                successEmbed(
                    `${getApplicationStatusPresentation(status).statusEmoji} Candidature ${getApplicationStatusPresentation(status).statusLabel}`,
                    `La candidature a été marquée comme ${getApplicationStatusPresentation(status).statusLabel}.`
                )
            ],
            flags: ["Ephemeral"]
        });
        
    } catch (error) {
        logger.error('Error processing application review:', error);
        await InteractionHelper.safeEditReply(interaction, {
            embeds: [errorEmbed('Une erreur est survenue lors du traitement de la candidature.')],
            flags: ["Ephemeral"]
        });
    }
}



