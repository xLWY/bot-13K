import { Events, EmbedBuilder, MessageFlags, PermissionFlagsBits } from 'discord.js';
import { getReactionRoleMessage, addReactionRole, removeReactionRole } from '../services/reactionRoleService.js';
import { logEvent, EVENT_TYPES } from '../services/loggingService.js';
import { errorEmbed } from '../utils/embeds.js';
import { logger } from '../utils/logger.js';








async function handleReactionAdd(client, reaction, user) {
    try {
        if (user.bot || !reaction.message.guild) return;

        const { message } = reaction;
        const { guild } = message;
        const emoji = reaction.emoji.id || reaction.emoji.name;

        const reactionRoleMessage = await getReactionRoleMessage(
            client,
            guild.id,
            message.id
        );

        if (!reactionRoleMessage) return;

        const roleId = reactionRoleMessage.roles[emoji];
        if (!roleId) return;

        const member = await guild.members.fetch(user.id);
        const role = guild.roles.cache.get(roleId);

        if (!role) {
            await removeReactionRole(client, guild.id, message.id, emoji);
            return;
        }

        await member.roles.add(role);

        
        try {
            await logEvent({
                client,
                guildId: guild.id,
                eventType: EVENT_TYPES.REACTION_ROLE_ADD,
                data: {
                    description: `Rôle de réaction attribué à ${user.tag}`,
                    userId: user.id,
                    channelId: message.channel.id,
                    fields: [
                        {
                            name: '👤 Membre',
                            value: `${user.tag} (${user.id})`,
                            inline: true
                        },
                        {
                            name: '🏷️ Rôle',
                            value: role.toString(),
                            inline: true
                        },
                        {
                            name: '😊 Réaction',
                            value: reaction.emoji.toString(),
                            inline: true
                        }
                    ]
                }
            });
        } catch (error) {
            logger.debug('Error logging reaction role add:', error);
        }

    } catch (error) {
        logger.error('Error in handleReactionAdd:', error);
    }
}








async function handleReactionRemove(client, reaction, user) {
    try {
        if (user.bot || !reaction.message.guild) return;

        const { message } = reaction;
        const { guild } = message;
        const emoji = reaction.emoji.id || reaction.emoji.name;

        const reactionRoleMessage = await getReactionRoleMessage(
            client,
            guild.id,
            message.id
        );

        if (!reactionRoleMessage) return;

        const roleId = reactionRoleMessage.roles[emoji];
        if (!roleId) return;

        const member = await guild.members.fetch(user.id);
        const role = guild.roles.cache.get(roleId);

        if (!role) {
            await removeReactionRole(client, guild.id, message.id, emoji);
            return;
        }

        await member.roles.remove(role);

        
        try {
            await logEvent({
                client,
                guildId: guild.id,
                eventType: EVENT_TYPES.REACTION_ROLE_REMOVE,
                data: {
                    description: `Rôle de réaction retiré à ${user.tag}`,
                    userId: user.id,
                    channelId: message.channel.id,
                    fields: [
                        {
                            name: '👤 Membre',
                            value: `${user.tag} (${user.id})`,
                            inline: true
                        },
                        {
                            name: '🏷️ Rôle',
                            value: role.toString(),
                            inline: true
                        },
                        {
                            name: '😊 Réaction',
                            value: reaction.emoji.toString(),
                            inline: true
                        }
                    ]
                }
            });
        } catch (error) {
            logger.debug('Error logging reaction role remove:', error);
        }

    } catch (error) {
        logger.error('Error in handleReactionRemove:', error);
    }
}






export async function handleReactionRoles(interaction) {
    try {
        if (!interaction.isCommand()) return false;

        const { commandName, options, guild, member } = interaction;

        if (commandName === 'reactionrole') {
            const subcommand = options.getSubcommand();
            
            if (subcommand === 'create') {
                if (!member.permissions.has(PermissionFlagsBits.ManageRoles)) {
                    await interaction.reply({
                        embeds: [errorEmbed('Tu as besoin de la permission `Gérer les rôles` pour utiliser cette commande.')],
                        flags: MessageFlags.Ephemeral
                    });
                    return true;
                }

                const messageId = options.getString('message_id');
                const emoji = options.getString('emoji');
                const role = options.getRole('role');

                if (!guild || !member) {
                    await interaction.reply({
                        embeds: [errorEmbed('Cette commande ne peut être utilisée que dans un serveur.')],
                        flags: MessageFlags.Ephemeral
                    });
                    return true;
                }

                if (!messageId || !/^\d{17,20}$/.test(messageId)) {
                    await interaction.reply({
                        embeds: [errorEmbed('Identifiant de message invalide. Fournis un identifiant de message Discord valide.')],
                        flags: MessageFlags.Ephemeral
                    });
                    return true;
                }

                if (!emoji || emoji.length > 100) {
                    await interaction.reply({
                        embeds: [errorEmbed('Émoji invalide. Fournis un émoji valide.')],
                        flags: MessageFlags.Ephemeral
                    });
                    return true;
                }

                if (!role) {
                    await interaction.reply({
                        embeds: [errorEmbed('Sélection de rôle invalide.')],
                        flags: MessageFlags.Ephemeral
                    });
                    return true;
                }

                let emojiId = emoji;
                const emojiMatch = emoji.match(/<a?:\w+:(\d+)>/);
                if (emojiMatch) {
                    emojiId = emojiMatch[1];
                }

                await addReactionRole(
                    interaction.client,
                    guild.id,
                    messageId,
                    emojiId,
                    role.id
                );

                try {
                    const channel = interaction.channel;
                    const message = await channel.messages.fetch(messageId);
                    await message.react(emoji);
                } catch (error) {
                    logger.error('Error adding reaction to message:', error);
                }

                await interaction.reply({
                    embeds: [
                        new EmbedBuilder()
                            .setDescription(`✅ Rôle de réaction ajouté pour ${emoji} à <@&${role.id}>`)
                            .setColor('#00ff00')
                    ],
                    flags: MessageFlags.Ephemeral
                });

                return true;
            }
        }

        return false;
    } catch (error) {
        logger.error('Error in handleReactionRoles:', error);
        if (interaction.replied || interaction.deferred) {
            await interaction.followUp({
                embeds: [errorEmbed('Une erreur est survenue lors du traitement de ta demande.')],
                flags: MessageFlags.Ephemeral
            });
        } else {
            await interaction.reply({
                embeds: [errorEmbed('Une erreur est survenue lors du traitement de ta demande.')],
                flags: MessageFlags.Ephemeral
            });
        }
        return true;
    }
}





export function setupReactionRoleListeners(client) {
    client.on(Events.MessageReactionAdd, async (reaction, user) => {
        await handleReactionAdd(client, reaction, user);
    });

    client.on(Events.MessageReactionRemove, async (reaction, user) => {
        await handleReactionRemove(client, reaction, user);
    });
}




