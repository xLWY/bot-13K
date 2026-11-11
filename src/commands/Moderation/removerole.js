import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { isBotOwner } from '../../utils/ownerIds.js';
import { errorEmbed, infoEmbed, successEmbed } from '../../utils/embeds.js';
import { moderationMentionPayload } from '../../utils/moderation.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { logger } from '../../utils/logger.js';

function parseMentions(message) {
    const roles = [...(message.mentions.roles?.values?.() ?? [])];
    const users = [...(message.mentions.users?.values?.() ?? [])];

    if (roles.length === 0 && users.length === 0) {
        return { error: 'Il manque : **un rôle** et **un membre**.' };
    }
    if (roles.length === 0) {
        return { error: 'Il manque : **un rôle**.' };
    }
    if (users.length === 0) {
        return { error: 'Il manque : **un membre**.' };
    }
    if (roles.length > 1) {
        return { error: 'Mentionne un seul rôle.' };
    }
    if (users.length > 1) {
        return { error: 'Mentionne un seul membre.' };
    }

    return { role: roles[0], user: users[0] };
}

async function fail(interaction, message) {
    await InteractionHelper.safeEditReply(interaction, {
        embeds: [errorEmbed(message)],
    }).catch(() => {});
}

async function notifyPrefixArgumentError(interaction, text) {
    const sent = await interaction.user.send({
        content: text,
        allowedMentions: { parse: [] },
    }).catch((error) => {
        logger.warn(`Could not DM removerole notice to ${interaction.user.tag} (${interaction.user.id}): ${error.code || error.message}`);
        return null;
    });

    if (sent) return;

    const fallback = await interaction.reply({
        content: `<@${interaction.user.id}> ${text}`,
        allowedMentions: { users: [interaction.user.id] },
    }).catch((error) => {
        logger.warn(`removerole fallback notice failed: ${error.code || error.message}`);
        return null;
    });

    if (fallback?.delete) {
        setTimeout(() => {
            fallback.delete().catch(() => {});
        }, 5000).unref?.();
    }
}

export default {
    data: new SlashCommandBuilder()
        .setName('removerole')
        .setDescription('Retirer un rôle à un membre (mentions dans n\'importe quel ordre)')
        .addRoleOption((option) =>
            option
                .setName('role')
                .setDescription('Rôle à retirer')
                .setRequired(true),
        )
        .addUserOption((option) =>
            option
                .setName('membre')
                .setDescription('Membre à qui retirer le rôle')
                .setRequired(true),
        )
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
        .setDMPermission(false),

    category: 'moderation',
    // `!deleterole` est un alias préfixe de `!removerole`.
    aliases: ['deleterole'],
    // Le préfixe est analysé directement dans execute() pour accepter
    // `!removerole` (ou `!deleterole`) @Rôle @Membre et @Membre @Rôle.
    prefixOptions: [],

    async execute(interaction, config, client) {
        const isPrefix = interaction.isPrefixCommand?.() === true;
        let role;
        let user;

        if (isPrefix) {
            const parsed = parseMentions(interaction.message);
            if (parsed.error) {
                return notifyPrefixArgumentError(interaction, parsed.error);
            }
            role = parsed.role;
            user = parsed.user;
        } else {
            role = interaction.options.getRole('role');
            user = interaction.options.getUser('membre');
        }

        if (!role || !user) {
            if (isPrefix) {
                return notifyPrefixArgumentError(interaction, 'Il manque : **un rôle** et **un membre**.');
            }
            return fail(interaction, 'Il manque : **un rôle** et **un membre**.');
        }

        const deferSuccess = await InteractionHelper.safeDefer(interaction, {});
        if (!deferSuccess) return;

        try {
            if (!interaction.guild) {
                return fail(interaction, 'Cette commande doit être utilisée dans un serveur.');
            }

            const guild = interaction.guild;
            const isOwner = isBotOwner(interaction.user.id);
            const authorMember = interaction.member
                ?? await guild.members.fetch(interaction.user.id).catch(() => null);

            if (!authorMember) {
                return fail(interaction, 'Je n\'arrive pas à te trouver dans ce serveur.');
            }

            if (!isOwner && !authorMember.permissions.has(PermissionFlagsBits.ManageRoles)) {
                return fail(interaction, 'Tu as besoin de la permission **Gérer les rôles** pour utiliser cette commande.');
            }

            const botMember = guild.members.me
                ?? await guild.members.fetchMe().catch(() => null);

            if (!botMember) {
                return fail(interaction, 'Je n\'arrive pas à récupérer mon propre membre dans ce serveur.');
            }

            if (!botMember.permissions.has(PermissionFlagsBits.ManageRoles)) {
                return fail(interaction, 'Je n\'ai pas la permission **Gérer les rôles**.');
            }

            const targetMember = await guild.members.fetch(user.id).catch(() => null);

            if (!targetMember) {
                return fail(interaction, 'Ce membre n\'est pas dans le serveur.');
            }

            if (role.id === guild.id) {
                return fail(interaction, 'Le rôle `@everyone` ne peut pas être retiré.');
            }

            if (!targetMember.roles.cache.has(role.id)) {
                return InteractionHelper.safeEditReply(interaction, {
                    embeds: [infoEmbed(`${targetMember} n'a pas le rôle **${role.name}**.`, 'ℹ️ Rôle absent')],
                });
            }

            if (role.managed) {
                return fail(interaction, 'Ce rôle est géré par une intégration et ne peut pas être retiré manuellement.');
            }

            if (role.position >= botMember.roles.highest.position) {
                return fail(interaction, 'Ce rôle est au-dessus ou au même niveau que mon rôle le plus haut. Déplace mon rôle plus haut dans la hiérarchie.');
            }

            if (!isOwner && role.position >= authorMember.roles.highest.position) {
                return fail(interaction, 'Ce rôle est au-dessus ou au même niveau que ton rôle le plus haut.');
            }

            const commandLabel = isPrefix
                ? `!${interaction.commandName}`
                : `/${interaction.commandName}`;

            await targetMember.roles.remove(
                role,
                `Retiré par ${interaction.user.tag} via ${commandLabel}`,
            );

            logger.info(
                `[RemoveRole] ${interaction.user.tag} a retiré le rôle ${role.name} (${role.id}) à ${targetMember.user.tag} (${targetMember.id}) dans ${guild.name}`,
            );

            return InteractionHelper.safeEditReply(interaction, {
                ...moderationMentionPayload(targetMember.id, `a perdu le rôle **${role.name}**.`),
                embeds: [
                    successEmbed(
                        `Le rôle **${role.name}** a été retiré à ${targetMember}.`,
                        '✅ Rôle retiré',
                    ),
                ],
            });
        } catch (error) {
            logger.error('RemoveRole command error:', error);
            return fail(interaction, 'Impossible de retirer ce rôle. Vérifie mes permissions et la position de mon rôle.');
        }
    },
};
