import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { isBotOwner } from '../../utils/ownerIds.js';
import { errorEmbed, successEmbed, warningEmbed } from '../../utils/embeds.js';
import { brandFooter } from '../../ui/kit.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { logger } from '../../utils/logger.js';

const NO_MENTIONS = { parse: [], repliedUser: false };
const CONTEXT = 'Gestion des rôles';

function parseMentions(message) {
    const roles = [...(message.mentions.roles?.values?.() ?? [])];
    const users = [...(message.mentions.users?.values?.() ?? [])];

    // Un ID brut n'apparaît pas dans message.mentions : on l'extrait du texte.
    const withoutMentions = String(message.content || '')
        .replace(/<@!?\d+>/g, ' ')
        .replace(/<@&\d+>/g, ' ')
        .replace(/<#\d+>/g, ' ');
    const rawIds = [...withoutMentions.matchAll(/\b(\d{15,20})\b/g)].map((match) => match[1]);

    for (const id of rawIds) {
        if (users.some((user) => user.id === id)) continue;

        const role = message.guild?.roles?.cache?.get(id);
        if (role) {
            if (!roles.some((entry) => entry.id === id)) roles.push(role);
        } else {
            users.push({ id });
        }
    }

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

function cleanLabel(value) {
    return String(value ?? 'Inconnu').replace(/[`@]/g, '').slice(0, 80);
}

function payload(embed) {
    return {
        embeds: [embed.setFooter(brandFooter(CONTEXT))],
        components: [],
        allowedMentions: NO_MENTIONS,
    };
}

/**
 * Les erreurs de commandes préfixées partent en MP : Discord ne permet pas
 * de rendre un message de salon éphémère.
 */
async function fail(interaction, message, context = CONTEXT) {
    const embed = errorEmbed(message).setFooter(brandFooter(context));
    if (interaction.isPrefixCommand?.()) {
        const sent = await interaction.user.send({
            embeds: [embed],
            allowedMentions: NO_MENTIONS,
        }).catch((error) => {
            logger.debug(`[RemoveRole] DM notice failed: ${error.code || error.message}`);
            return null;
        });
        if (sent) {
            await interaction.deleteReply?.().catch(() => {});
            return;
        }
        await InteractionHelper.safeReply(interaction, {
            content: message,
            allowedMentions: NO_MENTIONS,
        }).catch(() => {});
        return;
    }
    await InteractionHelper.safeEditReply(interaction, payload(embed)).catch(() => {});
}

export default {
    data: new SlashCommandBuilder()
        .setName('removerole')
        .setDescription('Retirer un rôle à un membre (mentions dans n’importe quel ordre)')
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
                return fail(interaction, parsed.error, 'Arguments');
            }
            role = parsed.role;
            user = parsed.user;
        } else {
            role = interaction.options.getRole('role');
            user = interaction.options.getUser('membre');
        }

        if (!role || !user) {
            return fail(interaction, 'Il manque : **un rôle** et **un membre**.', 'Arguments');
        }

        const deferSuccess = await InteractionHelper.safeDefer(interaction);
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
                return fail(interaction, 'Je n’arrive pas à te trouver dans ce serveur.');
            }

            if (!isOwner && !authorMember.permissions.has(PermissionFlagsBits.ManageRoles)) {
                return fail(interaction, 'Tu as besoin de la permission **Gérer les rôles** pour utiliser cette commande.');
            }

            const botMember = guild.members.me
                ?? await guild.members.fetchMe().catch(() => null);

            if (!botMember) {
                return fail(interaction, 'Je n’arrive pas à récupérer mon propre membre dans ce serveur.');
            }

            if (!botMember.permissions.has(PermissionFlagsBits.ManageRoles)) {
                return fail(interaction, 'Je n’ai pas la permission **Gérer les rôles**.');
            }

            const targetMember = await guild.members.fetch(user.id).catch(() => null);

            if (!targetMember) {
                return fail(interaction, 'Ce membre n’est pas dans le serveur.');
            }

            if (role.id === guild.id) {
                return fail(interaction, 'Le rôle `@everyone` ne peut pas être retiré.');
            }

            if (!targetMember.roles.cache.has(role.id)) {
                return InteractionHelper.safeEditReply(interaction, payload(
                    warningEmbed(`<@${targetMember.id}> n’a pas le rôle \`${cleanLabel(role.name)}\`.`),
                ));
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

            return InteractionHelper.safeEditReply(interaction, payload(
                successEmbed(`<@${targetMember.id}> a perdu le rôle \`${cleanLabel(role.name)}\`.`, '✅ Rôle retiré')
                    .addFields(
                        { name: 'Membre', value: `<@${targetMember.id}> • \`${targetMember.id}\``, inline: false },
                        { name: 'Rôle', value: `\`${cleanLabel(role.name)}\` • \`${role.id}\``, inline: false },
                        { name: 'Modérateur', value: `<@${interaction.user.id}>`, inline: true },
                    ),
            ));
        } catch (error) {
            logger.error('RemoveRole command error:', error);
            return fail(interaction, 'Impossible de retirer ce rôle. Vérifie mes permissions et la position de mon rôle.');
        }
    },
};
