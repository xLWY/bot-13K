import { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } from 'discord.js';
import { isBotOwner } from '../../utils/permissionGuard.js';
import { successEmbed, warningEmbed } from '../../utils/embeds.js';
import { logModerationAction } from '../../utils/moderation.js';
import { logger } from '../../utils/logger.js';
import { checkRateLimit } from '../../utils/rateLimiter.js';

import { InteractionHelper } from '../../utils/interactionHelper.js';
export default {
    data: new SlashCommandBuilder()
        .setName("masskick")
        .setDescription("* Expulser plusieurs utilisateurs du serveur d'un coup")
        .addStringOption(option =>
            option
                .setName("users")
                .setDescription("IDs ou mentions des utilisateurs Ã  expulser (sÃ©parÃ©s par des espaces ou des virgules)")
                .setRequired(true)
        )
        .addStringOption(option =>
            option.setName("reason")
                .setDescription("Raison de l'expulsion massive")
                .setRequired(false)
        )
        .setDefaultMemberPermissions(PermissionFlagsBits.KickMembers),
    category: "moderation",

    async execute(interaction, config, client) {
        const deferSuccess = await InteractionHelper.safeDefer(interaction);
        if (!deferSuccess) {
            logger.warn(`Masskick interaction defer failed`, {
                userId: interaction.user.id,
                guildId: interaction.guildId,
                commandName: 'masskick'
            });
            return;
        }

        if (!isBotOwner(interaction.member.id) && !interaction.member.permissions.has(PermissionFlagsBits.KickMembers)) {
            return await InteractionHelper.sendErrorNotice(interaction, "Tu n'as pas la permission d'expulser des membres.");
        }

        const usersInput = interaction.options.getString("users");
        const reason = interaction.options.getString("reason") || "Expulsion massive - Aucune raison fournie";

        try {
            
            const rateLimitKey = `masskick_${interaction.user.id}`;
            const isAllowed = await checkRateLimit(rateLimitKey, 3, 60000);
            if (!isAllowed) {
                return await InteractionHelper.safeEditReply(interaction, {
                    embeds: [
                        warningEmbed(
                            "Tu effectues des expulsions massives trop vite. Attends une minute avant de rÃ©essayer.",
                            "â³ Limite de frÃ©quence"
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
                return await InteractionHelper.sendErrorNotice(interaction, "Fournis des IDs ou mentions valides. Maximum 20 utilisateurs Ã  la fois.");
            }

            if (userIds.includes(interaction.user.id)) {
                return await InteractionHelper.sendErrorNotice(interaction, "Tu ne peux pas t'inclure toi-mÃªme dans une expulsion massive.");
            }

            if (userIds.includes(client.user.id)) {
                return await InteractionHelper.sendErrorNotice(interaction, "Tu ne peux pas inclure le bot dans une expulsion massive.");
            }

            const results = {
                successful: [],
                failed: [],
                skipped: []
            };

            for (const userId of userIds) {
                try {
                    const member = await interaction.guild.members.fetch(userId).catch(() => null);
                    
                    if (!member) {
                        results.failed.push({ userId, reason: "Utilisateur absent du serveur" });
                        continue;
                    }

                    if (member.roles.highest.position >= interaction.member.roles.highest.position && 
                        interaction.guild.ownerId !== interaction.user.id) {
                        results.skipped.push({ 
                            user: member.user.tag, 
                            userId, 
                            reason: "Impossible d'expulser un utilisateur au rÃ´le Ã©gal ou supÃ©rieur" 
                        });
                        continue;
                    }

                    await member.kick(reason);

                    results.successful.push({
                        user: member.user.tag,
                        userId
                    });

                    await logModerationAction({
                        client,
                        guild: interaction.guild,
                        event: {
                            action: "Member Kicked",
                            target: `<@${member.user.id}> (${member.user.id})`,
                            executor: `<@${interaction.user.id}> (${interaction.user.id})`,
                            reason: `${reason} (Expulsion massive)`,
                            metadata: {
                                userId: member.user.id,
                                moderatorId: interaction.user.id,
                                massKick: true
                            }
                        }
                    });

                } catch (error) {
                    logger.error(`Failed to kick user ${userId}:`, error);
                    results.failed.push({ 
                        userId, 
                        reason: error.message || "Erreur inconnue" 
                    });
                }
            }

            let description = `**RÃ©sultats de l'expulsion massive :**\n\n`;
            
            if (results.successful.length > 0) {
                description += `âœ… **ExpulsÃ©s avec succÃ¨s (${results.successful.length}) :**\n`;
                results.successful.forEach(result => {
                    description += `â€¢ ${result.user} (${result.userId})\n`;
                });
                description += '\n';
            }

            if (results.skipped.length > 0) {
                description += `âš ï¸ **IgnorÃ©s (${results.skipped.length}) :**\n`;
                results.skipped.forEach(result => {
                    description += `â€¢ ${result.user} - ${result.reason}\n`;
                });
                description += '\n';
            }

            if (results.failed.length > 0) {
                description += `âŒ **Ã‰checs (${results.failed.length}) :**\n`;
                results.failed.forEach(result => {
                    description += `â€¢ ${result.userId} - ${result.reason}\n`;
                });
            }

            const embed = results.successful.length > 0 ? successEmbed : warningEmbed;
            
            return await InteractionHelper.safeEditReply(interaction, {
                embeds: [
                    embed(
                        `ðŸ‘¢ Expulsion massive terminÃ©e`,
                        description
                    )
                ]
            });

        } catch (error) {
            logger.error("Error in masskick command:", error);
            return await InteractionHelper.sendErrorNotice(interaction, "Une erreur est survenue pendant l'expulsion massive. RÃ©essaie plus tard.");
        }
    }
};



