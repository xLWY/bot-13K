import { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } from 'discord.js';
import { isBotOwner } from '../../utils/ownerIds.js';
import { logModerationAction } from '../../utils/moderation.js';
import { errorEmbed, successEmbed } from '../../utils/embeds.js';
import { brandFooter } from '../../ui/kit.js';
import { logger } from '../../utils/logger.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { XlwyBotError, ErrorTypes } from '../../utils/errorHandler.js';

const NO_MENTIONS = { parse: [], repliedUser: false };
const CONTEXT = 'Expulsion';

function payload(embed) {
    return {
        embeds: [embed.setFooter(brandFooter(CONTEXT))],
        components: [],
        allowedMentions: NO_MENTIONS,
    };
}

function short(value, limit = 400) {
    return String(value ?? 'Aucune raison fournie').replace(/`/g, '').slice(0, limit);
}

export default {
    data: new SlashCommandBuilder()
        .setName('kick')
        .setDescription('Expulser un utilisateur du serveur')
        .addUserOption((option) =>
            option
                .setName('target')
                .setDescription('L’utilisateur à expulser')
                .setRequired(true),
        )
        .addStringOption((option) =>
            option.setName('reason').setDescription('Raison de l’expulsion'),
        )
        .setDefaultMemberPermissions(PermissionFlagsBits.KickMembers),
    category: 'moderation',

    async execute(interaction, config, client) {
        await InteractionHelper.safeDefer(interaction, { flags: MessageFlags.Ephemeral });

        try {
            if (!isBotOwner(interaction.member.id) && !interaction.member.permissions.has(PermissionFlagsBits.KickMembers)) {
                throw new XlwyBotError(
                    'User lacks permission',
                    ErrorTypes.PERMISSION,
                    'Tu n’as pas la permission d’expulser des membres.',
                );
            }

            const targetUser = interaction.options.getUser('target');
            const member = interaction.options.getMember('target');
            const reason = interaction.options.getString('reason') || 'Aucune raison fournie';

            if (targetUser.id === interaction.user.id) {
                throw new XlwyBotError(
                    'Cannot kick self',
                    ErrorTypes.VALIDATION,
                    'Tu ne peux pas t’expulser toi-même.',
                );
            }

            if (targetUser.id === client.user.id) {
                throw new XlwyBotError(
                    'Cannot kick bot',
                    ErrorTypes.VALIDATION,
                    'Tu ne peux pas expulser le bot.',
                );
            }

            if (!member) {
                throw new XlwyBotError(
                    'Target not found',
                    ErrorTypes.USER_INPUT,
                    'L’utilisateur ciblé n’est actuellement pas dans ce serveur.',
                    { subtype: 'user_not_found' },
                );
            }

            if (!isBotOwner(interaction.user.id) && interaction.member.roles.highest.position <= member.roles.highest.position) {
                throw new XlwyBotError(
                    'Cannot kick user',
                    ErrorTypes.PERMISSION,
                    'Tu ne peux pas expulser un utilisateur ayant un rôle égal ou supérieur au tien.',
                );
            }

            if (!member.kickable) {
                throw new XlwyBotError(
                    'Bot cannot kick',
                    ErrorTypes.PERMISSION,
                    'Je ne peux pas expulser cet utilisateur. Vérifie ma position de rôle par rapport à l’utilisateur ciblé.',
                );
            }

            await member.kick(reason);

            const caseId = await logModerationAction({
                client,
                guild: interaction.guild,
                event: {
                    action: 'Member Kicked',
                    target: `<@${targetUser.id}> (${targetUser.id})`,
                    executor: `<@${interaction.user.id}> (${interaction.user.id})`,
                    reason,
                    metadata: {
                        userId: targetUser.id,
                        moderatorId: interaction.user.id,
                    },
                },
            });

            return InteractionHelper.safeEditReply(interaction, payload(
                successEmbed(`<@${targetUser.id}> a été expulsé du serveur.`, '✅ Membre expulsé')
                    .addFields(
                        { name: 'Membre', value: `<@${targetUser.id}> • \`${targetUser.id}\``, inline: false },
                        { name: 'Motif', value: short(reason), inline: false },
                        { name: 'Dossier', value: `\`#${caseId}\``, inline: true },
                    ),
            ));
        } catch (error) {
            logger.error('Kick command error:', error);
            return InteractionHelper.safeEditReply(interaction, payload(
                errorEmbed(error?.userMessage || 'Impossible d’expulser ce membre. Réessaie dans un instant.'),
            ));
        }
    },
};
