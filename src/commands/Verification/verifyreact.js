import { SlashCommandBuilder, PermissionFlagsBits, ChannelType, EmbedBuilder } from 'discord.js';
import { successEmbed, infoEmbed } from '../../utils/embeds.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { handleInteractionError } from '../../utils/errorHandler.js';
import { getColor } from '../../config/bot.js';
import { logger } from '../../utils/logger.js';
import { hasDangerousPermissions } from '../../services/reactionRoleService.js';
import {
    getVerifyReactConfig,
    saveVerifyReactConfig,
    deleteVerifyReactConfig,
    parseEmojiInput,
    formatEmoji
} from '../../services/verifyreactService.js';

export default {
    data: new SlashCommandBuilder()
        .setName('verifyreact')
        .setDescription('* Configurer le rôle d\'accès par réaction sur un message de règles')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addSubcommand(subcommand =>
            subcommand
                .setName('setup')
                .setDescription('Activer la réaction sur un message existant pour accorder un rôle')
                .addChannelOption(option =>
                    option.setName('channel')
                        .setDescription('Le salon du message des règles')
                        .setRequired(true)
                )
                .addStringOption(option =>
                    option.setName('message')
                        .setDescription('Le lien du message (clic droit → Copier le lien du message)')
                        .setRequired(true)
                )
                .addStringOption(option =>
                    option.setName('emoji')
                        .setDescription('L\'emoji de réaction (colle-le, mets son nom :verifygreen:, ou son ID)')
                        .setRequired(true)
                )
                .addRoleOption(option =>
                    option.setName('role')
                        .setDescription('Le rôle accordé en réagissant (et retiré en ôtant la réaction)')
                        .setRequired(true)
                )
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('status')
                .setDescription('Voir la configuration actuelle du rôle par réaction')
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('enable')
                .setDescription('Réactiver le rôle par réaction sans tout reconfigurer')
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('disable')
                .setDescription('Désactiver temporairement le rôle par réaction (sans supprimer la config)')
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('remove')
                .setDescription('Supprimer complètement la configuration du rôle par réaction')
        ),

    async execute(interaction) {
        const subcommand = interaction.options.getSubcommand();

        try {
            switch (subcommand) {
                case 'setup':
                    await handleSetup(interaction);
                    break;
                case 'status':
                    await handleStatus(interaction);
                    break;
                case 'enable':
                    await handleSetEnabled(interaction, true);
                    break;
                case 'disable':
                    await handleSetEnabled(interaction, false);
                    break;
                case 'remove':
                    await handleRemove(interaction);
                    break;
            }
        } catch (error) {
            await handleInteractionError(interaction, error, {
                type: 'command',
                commandName: 'verifyreact',
                subcommand
            });
        }
    }
};

async function handleSetup(interaction) {
    const deferSuccess = await InteractionHelper.safeDefer(interaction);
    if (!deferSuccess) return;

    const guild = interaction.guild;
    const client = interaction.client;
    const channel = interaction.options.getChannel('channel');
    const rawMessage = interaction.options.getString('message').trim();
    const rawEmoji = interaction.options.getString('emoji');
    const role = interaction.options.getRole('role');

    if (channel.type !== ChannelType.GuildText && channel.type !== ChannelType.GuildAnnouncement) {
        return await InteractionHelper.sendErrorNotice(interaction, 'sélectionne un salon textuel (ou d\'annonces) pour le message des règles.');
    }

    const ref = parseMessageRef(rawMessage);
    if (!ref.messageId || !/^\d{15,21}$/.test(ref.messageId)) {
        return await InteractionHelper.sendErrorNotice(interaction, 'lien du message invalide. Clic droit sur le message → Copier le lien du message.');
    }

    if (ref.channelId && ref.channelId !== channel.id) {
        return await InteractionHelper.sendErrorNotice(interaction, `ce lien ne pointe pas vers ${channel}, le salon choisi.`);
    }

    const message = await channel.messages.fetch(ref.messageId).catch(() => null);
    if (!message) {
        return await InteractionHelper.sendErrorNotice(interaction, `message introuvable dans ${channel}. Vérifie le lien.`);
    }

    if (role.id === guild.id) {
        return await InteractionHelper.sendErrorNotice(interaction, '@everyone ne peut pas être attribué par réaction.');
    }
    if (role.managed) {
        return await InteractionHelper.sendErrorNotice(interaction, 'ce rôle est géré (intégration/bot) et ne peut pas être attribué.');
    }
    if (hasDangerousPermissions(role)) {
        return await InteractionHelper.sendErrorNotice(interaction, 'ce rôle a des permissions sensibles (Administrateur, Gérer le serveur…) et ne peut pas être utilisé.');
    }

    const me = guild.members.me;
    if (!me.permissions.has(PermissionFlagsBits.ManageRoles)) {
        return await InteractionHelper.sendErrorNotice(interaction, 'il me faut la permission Gérer les rôles pour attribuer des rôles par réaction.');
    }
    if (role.position >= me.roles.highest.position) {
        return await InteractionHelper.sendErrorNotice(interaction, `le rôle ${role} est au-dessus de mon rôle le plus haut. Monte mon rôle dans la hiérarchie avant.`);
    }

    const emoji = parseEmojiInput(rawEmoji, guild);
    if (!emoji.id && !emoji.name) {
        return await InteractionHelper.sendErrorNotice(interaction, 'emoji invalide.');
    }

    await saveVerifyReactConfig(client, guild.id, {
        enabled: true,
        channelId: channel.id,
        messageId: message.id,
        emoji,
        roleId: role.id
    });

    const emojiDisplay = formatEmoji(emoji);
    const info = `✅ Rôle par réaction activé !\n\n` +
        `**Salon :** ${channel}\n` +
        `**Message :** [lier le message](${message.url})\n` +
        `**Emoji :** ${emojiDisplay}\n` +
        `**Rôle accordé :** ${role}\n\n` +
        `Chaque membre qui réagit avec ${emojiDisplay} reçoit ${role} ; retirer la réaction retire le rôle.`;

    await InteractionHelper.safeEditReply(interaction, {
        embeds: [successEmbed('Accès par réaction', info)]
    });
    logger.info(`[verifyreact] Configured for guild ${guild.id} on message ${message.id}`);
}

async function handleStatus(interaction) {
    const deferSuccess = await InteractionHelper.safeDefer(interaction);
    if (!deferSuccess) return;

    const config = await getVerifyReactConfig(interaction.client, interaction.guild.id);
    if (!config) {
        return await InteractionHelper.sendErrorNotice(interaction, 'aucune configuration de rôle par réaction. Utilise `/verifyreact setup`.');
    }

    const guild = interaction.guild;
    const channel = guild.channels.cache.get(config.channelId);
    const role = guild.roles.cache.get(config.roleId);
    const emojiDisplay = formatEmoji(config.emoji);
    const statusText = config.enabled ? '✅ **Activé**' : '⏸️ **Désactivé**';

    const fields = [
        { name: 'État', value: statusText, inline: true },
        { name: 'Salon', value: channel ? channel.toString() : '`Introuvable`', inline: true },
        { name: 'Emoji', value: emojiDisplay, inline: true },
        { name: 'Rôle accordé', value: role ? role.toString() : '`Introuvable`', inline: true },
        { name: 'Message', value: channel ? `[voir le message](https://discord.com/channels/${guild.id}/${config.channelId}/${config.messageId})` : '`Introuvable`', inline: false }
    ];

    const embed = new EmbedBuilder()
        .setTitle('🎭 Rôle par réaction')
        .setDescription('Configuration actuelle de l\'accès par réaction.')
        .setColor(getColor('info'))
        .addFields(fields)
        .setFooter({ text: 'Utilise `/verifyreact setup` pour modifier' });

    await InteractionHelper.safeEditReply(interaction, { embeds: [embed] });
}

async function handleSetEnabled(interaction, enabled) {
    const deferSuccess = await InteractionHelper.safeDefer(interaction);
    if (!deferSuccess) return;

    const config = await getVerifyReactConfig(interaction.client, interaction.guild.id);
    if (!config) {
        return await InteractionHelper.sendErrorNotice(interaction, 'aucune configuration de rôle par réaction. Utilise `/verifyreact setup`.');
    }

    await saveVerifyReactConfig(interaction.client, interaction.guild.id, { ...config, enabled });

    await InteractionHelper.safeEditReply(interaction, {
        embeds: [infoEmbed(enabled ? 'Réactivé' : 'Désactivé', enabled
            ? 'La réaction accorde à nouveau le rôle aux membres.'
            : 'Le rôle par réaction est temporairement désactivé. La configuration est conservée (`/verifyreact enable` pour réactiver).')]
    });
}

async function handleRemove(interaction) {
    const deferSuccess = await InteractionHelper.safeDefer(interaction);
    if (!deferSuccess) return;

    const config = await getVerifyReactConfig(interaction.client, interaction.guild.id);
    if (!config) {
        return await InteractionHelper.sendErrorNotice(interaction, 'aucune configuration de rôle par réaction à supprimer.');
    }

    await deleteVerifyReactConfig(interaction.client, interaction.guild.id);

    await InteractionHelper.safeEditReply(interaction, {
        embeds: [successEmbed('Config supprimée', 'La configuration du rôle par réaction a été supprimée. Les rôles déjà accordés restent inchangés.')]
    });
}

function parseMessageRef(input) {
    const match = input.match(/discord(?:app)?\.com\/channels\/\d+\/(\d+)\/(\d+)/);
    if (match) {
        return { channelId: match[1], messageId: match[2] };
    }
    return { channelId: null, messageId: input };
}