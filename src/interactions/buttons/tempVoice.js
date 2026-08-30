import {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    MessageFlags,
    ModalBuilder,
    OverwriteType,
    PermissionFlagsBits,
    StringSelectMenuBuilder,
    TextInputBuilder,
    TextInputStyle
} from 'discord.js';
import { logger } from '../../utils/logger.js';
import {
    getJoinToCreateConfig,
    getTemporaryChannelInfo
} from '../../utils/database.js';
import {
    canControlMember,
    getChannelState,
    setChannelLocked,
    setChannelPrivate,
    renameTemporaryChannel,
    transferTemporaryChannel,
    refreshControlPanel
} from '../../services/tempVoiceService.js';

function getErrorEmbedText(error) {
    return error || 'Une erreur est survenue.';
}

async function resolveTarget(interaction, client, args) {
    const voiceChannelId = args?.[0];
    if (!voiceChannelId) {
        return { error: 'Salon introuvable.' };
    }

    const voiceChannel =
        interaction.guild?.channels.cache.get(voiceChannelId) ??
        (await interaction.guild?.channels.fetch(voiceChannelId).catch(() => null));

    if (!voiceChannel) {
        return { error: 'Salon introuvable.' };
    }

    const tempInfo = await getTemporaryChannelInfo(client, interaction.guild.id, voiceChannelId);
    if (!tempInfo) {
        return { error: "Ce salon n'est pas un salon temporaire." };
    }

    const config = await getJoinToCreateConfig(client, interaction.guild.id);

    if (!canControlMember(interaction.member, tempInfo, config)) {
        return { error: 'Seul le propriétaire du salon ou un modérateur peut utiliser ce bouton.' };
    }

    return { voiceChannel, tempInfo, config };
}

async function replyError(interaction, text) {
    try {
        await interaction.reply({
            content: `❌ ${getErrorEmbedText(text)}`,
            flags: MessageFlags.Ephemeral
        });
    } catch (replyError) {
        logger.warn('Failed to reply temp voice error:', replyError);
    }
}

const lockHandler = {
    name: 'tv_lock',
    async execute(interaction, client, args) {
        const resolved = await resolveTarget(interaction, client, args);
        if (resolved.error) {
            return replyError(interaction, resolved.error);
        }

        const { voiceChannel, tempInfo, config } = resolved;
        const state = getChannelState(voiceChannel);
        const locked = !state.locked;

        const success = await setChannelLocked(client, voiceChannel, tempInfo, config, locked);
        if (!success) {
            return replyError(interaction, 'Impossible de modifier le salon. Vérifie les permissions du robot.');
        }

        await interaction.reply({
            content: locked ? '✅ Salon **verrouillé**. Personne ne peut plus le rejoindre.' : '✅ Salon **déverrouillé**.',
            flags: MessageFlags.Ephemeral
        }).catch(() => {});
    }
};

const privateHandler = {
    name: 'tv_private',
    async execute(interaction, client, args) {
        const resolved = await resolveTarget(interaction, client, args);
        if (resolved.error) {
            return replyError(interaction, resolved.error);
        }

        const { voiceChannel, tempInfo, config } = resolved;
        const state = getChannelState(voiceChannel);
        const privateChannel = !state.hidden;

        const success = await setChannelPrivate(client, voiceChannel, tempInfo, config, privateChannel);
        if (!success) {
            return replyError(interaction, 'Impossible de modifier le salon. Vérifie les permissions du robot.');
        }

        await interaction.reply({
            content: privateChannel
                ? '🎫 Salon **privé** : seul le propriétaire, les membres et les modérateurs peuvent le voir et le rejoindre.'
                : '👀 Salon **visible** pour tout le monde.',
            flags: MessageFlags.Ephemeral
        }).catch(() => {});
    }
};

const renameHandler = {
    name: 'tv_rename',
    async execute(interaction, client, args) {
        const resolved = await resolveTarget(interaction, client, args);
        if (resolved.error) {
            return replyError(interaction, resolved.error);
        }

        const { voiceChannel, tempInfo } = resolved;

        const modal = new ModalBuilder()
            .setCustomId(`tv_modal_rename:${voiceChannel.id}`)
            .setTitle('✏️ Renommer le salon')
            .addComponents(
                new ActionRowBuilder().addComponents(
                    new TextInputBuilder()
                        .setCustomId('tv_rename_input')
                        .setLabel('Nouveau nom du salon (100 caractères max)')
                        .setStyle(TextInputStyle.Short)
                        .setRequired(true)
                        .setMaxLength(100)
                        .setValue(voiceChannel.name)
                )
            );

        await interaction.showModal(modal);

        try {
            const submission = await interaction.awaitModalSubmit({
                filter: (i) =>
                    i.customId.startsWith(`tv_modal_rename:${voiceChannel.id}`) &&
                    i.user.id === interaction.user.id,
                time: 60000
            });

            const rawName = submission.fields.getTextInputValue('tv_rename_input');
            const safeName = await renameTemporaryChannel(
                client,
                voiceChannel,
                tempInfo,
                rawName
            );

            await submission.reply({
                content: `✅ Salon renommé : 🔊 **${safeName}**`,
                flags: MessageFlags.Ephemeral
            });
        } catch (error) {
            if (error.code === 'INTERACTION_COLLECTOR_ERROR') {
                return;
            }
            logger.error('Error in temp voice rename modal:', error);
            try {
                await interaction.followUp({
                    content: '❌ Impossible de renommer le salon.',
                    flags: MessageFlags.Ephemeral
                });
            } catch (_) { /* noop */ }
        }
    }
};

const limitHandler = {
    name: 'tv_limit',
    async execute(interaction, client, args) {
        const resolved = await resolveTarget(interaction, client, args);
        if (resolved.error) {
            return replyError(interaction, resolved.error);
        }

        const { voiceChannel, tempInfo } = resolved;
        const currentLimit = voiceChannel.userLimit || 0;

        const modal = new ModalBuilder()
            .setCustomId(`tv_modal_limit:${voiceChannel.id}`)
            .setTitle("👥 Limite d'utilisateurs")
            .addComponents(
                new ActionRowBuilder().addComponents(
                    new TextInputBuilder()
                        .setCustomId('tv_limit_input')
                        .setLabel("Limite (0-99, 0 = illimitée)")
                        .setStyle(TextInputStyle.Short)
                        .setRequired(true)
                        .setMinLength(1)
                        .setMaxLength(3)
                        .setValue(String(currentLimit))
                )
            );

        await interaction.showModal(modal);

        try {
            const submission = await interaction.awaitModalSubmit({
                filter: (i) =>
                    i.customId.startsWith(`tv_modal_limit:${voiceChannel.id}`) &&
                    i.user.id === interaction.user.id,
                time: 60000
            });

            const raw = submission.fields.getTextInputValue('tv_limit_input').trim();
            const limit = parseInt(raw, 10);
            if (isNaN(limit) || limit < 0 || limit > 99) {
                return submission.reply({
                    content: '❌ Entrez un nombre entre 0 et 99 (0 = illimité).',
                    flags: MessageFlags.Ephemeral
                });
            }

            await voiceChannel.setUserLimit(limit);
            await submission.reply({
                content: limit === 0
                    ? '✅ Limite retirée : le salon peut accueillir tout le monde.'
                    : `✅ Limite définie : **${limit}** utilisateurs maximum.`,
                flags: MessageFlags.Ephemeral
            });

            await refreshControlPanel(client, interaction.guild, voiceChannel.id, tempInfo);
        } catch (error) {
            if (error.code === 'INTERACTION_COLLECTOR_ERROR') {
                return;
            }
            logger.error('Error in temp voice limit modal:', error);
            try {
                await interaction.followUp({
                    content: '❌ Impossible de définir la limite.',
                    flags: MessageFlags.Ephemeral
                });
            } catch (_) { /* noop */ }
        }
    }
};

const transferHandler = {
    name: 'tv_transfer',
    async execute(interaction, client, args) {
        const resolved = await resolveTarget(interaction, client, args);
        if (resolved.error) {
            return replyError(interaction, resolved.error);
        }

        const { voiceChannel, tempInfo } = resolved;

        if (interaction.user.id === tempInfo.ownerId) {
            return replyError(interaction, 'Tu es déjà le propriétaire de ce salon.');
        }

        if (!voiceChannel.members.has(interaction.user.id)) {
            return replyError(interaction, "Rejoins d'abord le salon vocal pour pouvoir en prendre la propriété.");
        }

        const result = await transferTemporaryChannel(
            client,
            voiceChannel,
            interaction.user.id
        );

        if (!result) {
            return replyError(interaction, 'Impossible de transférer la propriété du salon.');
        }

        await interaction.reply({
            content: `✅ Propriété transférée à <@${interaction.user.id}>. Le salon a été renommé en **${result.newChannelName}**.`,
            flags: MessageFlags.Ephemeral
        }).catch(() => {});
    }
};

const blacklistHandler = {
    name: 'tv_blacklist',
    async execute(interaction, client, args) {
        const resolved = await resolveTarget(interaction, client, args);
        if (resolved.error) {
            return replyError(interaction, resolved.error);
        }

        const { voiceChannel, tempInfo } = resolved;

        const candidates = [...voiceChannel.members.values()]
            .filter((member) => !member.user.bot && member.id !== tempInfo.ownerId && member.id !== client.user.id);

        if (candidates.length === 0) {
            return replyError(interaction, "Personne d'autre dans le salon à bannir.");
        }

        const options = candidates.slice(0, 25).map((member) => ({
            label: member.displayName.substring(0, 100),
            value: member.id,
            description: member.user.username.substring(0, 100)
        }));

        const select = new StringSelectMenuBuilder()
            .setCustomId(`tv_blacklist_select:${voiceChannel.id}`)
            .setPlaceholder('Choisis un membre à bannir du salon')
            .addOptions(options);

        await interaction.reply({
            content: '🚫 Sélectionne le membre à **bannir** de ce salon :',
            components: [new ActionRowBuilder().addComponents(select)],
            flags: MessageFlags.Ephemeral
        }).catch(() => {});
    }
};

const unblacklistHandler = {
    name: 'tv_unblacklist',
    async execute(interaction, client, args) {
        const resolved = await resolveTarget(interaction, client, args);
        if (resolved.error) {
            return replyError(interaction, resolved.error);
        }

        const { voiceChannel } = resolved;

        const deniedUsers = [];
        for (const overwrite of voiceChannel.permissionOverwrites.cache.values()) {
            if (overwrite.type === OverwriteType.Member && overwrite.deny?.has(PermissionFlagsBits.Connect)) {
                deniedUsers.push(overwrite.id);
            }
        }

        if (deniedUsers.length === 0) {
            return replyError(interaction, "Aucun membre n'est banni de ce salon.");
        }

        const options = [];
        for (const userId of deniedUsers.slice(0, 25)) {
            const member = await interaction.guild.members.fetch(userId).catch(() => null);
            options.push({
                label: (member?.displayName || userId).substring(0, 100),
                value: userId,
                description: member ? member.user.username.substring(0, 100) : 'Membre indisponible'
            });
        }

        const select = new StringSelectMenuBuilder()
            .setCustomId(`tv_unblacklist_select:${voiceChannel.id}`)
            .setPlaceholder('Choisis un membre à retirer de la liste noire')
            .addOptions(options);

        await interaction.reply({
            content: '✅ Sélectionne le membre à **débannir** du salon :',
            components: [new ActionRowBuilder().addComponents(select)],
            flags: MessageFlags.Ephemeral
        }).catch(() => {});
    }
};

export default [
    lockHandler,
    privateHandler,
    renameHandler,
    limitHandler,
    transferHandler,
    blacklistHandler,
    unblacklistHandler
];