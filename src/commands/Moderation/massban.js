import { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } from 'discord.js';
import { successEmbed, warningEmbed } from '../../utils/embeds.js';
import { logModerationAction } from '../../utils/moderation.js';
import { logger } from '../../utils/logger.js';
import { checkRateLimit } from '../../utils/rateLimiter.js';

import { InteractionHelper } from '../../utils/interactionHelper.js';
export default {
    data: new SlashCommandBuilder()
        .setName("massban")
        .setDescription("* Bannir plusieurs utilisateurs du serveur d'un coup")
        .addStringOption(option =>
            option
                .setName("users")
                .setDescription("IDs ou mentions des utilisateurs à bannir (séparés par des espaces ou des virgules)")
                .setRequired(true)
        )
        .addStringOption(option =>
            option.setName("reason")
                .setDescription("Raison du bannissement massif")
                .setRequired(false)
        )
        .addIntegerOption(option =>
            option
                .setName("delete_days")
                .setDescription("Nombre de jours de messages à supprimer (0-7)")
                .setMinValue(0)
                .setMaxValue(7)
                .setRequired(false)
        )
        .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers),
    category: "moderation",

    async execute(interaction, config, client) {
        const deferSuccess = await InteractionHelper.safeDefer(interaction);
        if (!deferSuccess) {
            logger.warn(`Massban interaction defer failed`, {
                userId: interaction.user.id,
                guildId: interaction.guildId,
                commandName: 'massban'
            });
            return;
        }

        if (!interaction.member.permissions.has(PermissionFlagsBits.BanMembers)) {
            return await InteractionHelper.sendErrorNotice(interaction, "Tu n'as pas la permission de bannir des membres.");
        }

        const usersInput = interaction.options.getString("users");
        const reason = interaction.options.getString("reason") || "Bannissement massif - Aucune raison fournie";
        const deleteDays = interaction.options.getInteger("delete_days") || 0;

        try {
            
            const rateLimitKey = `massban_${interaction.user.id}`;
            const isAllowed = await checkRateLimit(rateLimitKey, 3, 60000);
            if (!isAllowed) {
                return await InteractionHelper.safeEditReply(interaction, {
                    embeds: [
                        warningEmbed(
                            "Tu effectues des bannissements massifs trop vite. Attends une minute avant de réessayer.",
                            "⏳ Limite de fréquence"
                        ),
                    ],
                    flags: MessageFlags.Ephemeral,
                });
            }

            const userIds = usersInput
.replace(/<@!?(\d+)>/g, '$1')
.split(/[\s,]+/)
.filter(id => id && /^\d+$/.test(id))
.slice(0, 20);

            if (userIds.length === 0) {
                return await InteractionHelper.sendErrorNotice(interaction, "Fournis des IDs ou mentions valides. Maximum 20 utilisateurs à la fois.");
            }

            if (userIds.includes(interaction.user.id)) {
                return await InteractionHelper.sendErrorNotice(interaction, "Tu ne peux pas t'inclure toi-même dans un bannissement massif.");
            }

            if (userIds.includes(client.user.id)) {
                return await InteractionHelper.sendErrorNotice(interaction, "Tu ne peux pas inclure le bot dans un bannissement massif.");
            }

            const results = {
                successful: [],
                failed: [],
                skipped: []
            };

            for (const userId of userIds) {
                try {
                    const user = await client.users.fetch(userId).catch(() => null);
                    
                    if (!user) {
                        results.failed.push({ userId, reason: "Utilisateur introuvable" });
                        continue;
                    }

                    const member = await interaction.guild.members.fetch(userId).catch(() => null);
                    
                    if (member) {
                        if (member.roles.highest.position >= interaction.member.roles.highest.position && 
                            interaction.guild.ownerId !== interaction.user.id) {
                            results.skipped.push({ 
                                user: user.tag, 
                                userId, 
                                reason: "Impossible de bannir un utilisateur au rôle égal ou supérieur" 
                            });
                            continue;
                        }
                    }

                    await interaction.guild.members.ban(userId, {
                        reason: reason,
                        deleteMessageDays: deleteDays
                    });

                    results.successful.push({
                        user: user.tag,
                        userId
                    });

                    await logModerationAction({
                        client,
                        guild: interaction.guild,
                        event: {
                            action: "Member Banned",
                            target: `<@${user.id}> (${user.id})`,
                            executor: `<@${interaction.user.id}> (${interaction.user.id})`,
                            reason: `${reason} (Bannissement massif)`,
                            metadata: {
                                userId: user.id,
                                moderatorId: interaction.user.id,
                                massBan: true,
                                permanent: true
                            }
                        }
                    });

                } catch (error) {
                    logger.error(`Failed to ban user ${userId}:`, error);
                    results.failed.push({ 
                        userId, 
                        reason: error.message || "Erreur inconnue" 
                    });
                }
            }

            let description = `**Résultats du bannissement massif :**\n\n`;
            
            if (results.successful.length > 0) {
                description += `✅ **Bannis avec succès (${results.successful.length}) :**\n`;
                results.successful.forEach(result => {
                    description += `• ${result.user} (${result.userId})\n`;
                });
                description += '\n';
            }

            if (results.skipped.length > 0) {
                description += `⚠️ **Ignorés (${results.skipped.length}) :**\n`;
                results.skipped.forEach(result => {
                    description += `• ${result.user} - ${result.reason}\n`;
                });
                description += '\n';
            }

            if (results.failed.length > 0) {
                description += `❌ **Échecs (${results.failed.length}) :**\n`;
                results.failed.forEach(result => {
                    description += `• ${result.userId} - ${result.reason}\n`;
                });
            }

            const embed = results.successful.length > 0 ? successEmbed : warningEmbed;
            
            return await InteractionHelper.safeEditReply(interaction, {
                embeds: [
                    embed(
                        `🔨 Bannissement massif terminé`,
                        description
                    )
                ]
            });

        } catch (error) {
            logger.error("Error in massban command:", error);
            return await InteractionHelper.sendErrorNotice(interaction, "Une erreur est survenue pendant le bannissement massif. Réessaie plus tard.");
        }
    }
};



