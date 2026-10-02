import { SlashCommandBuilder, PermissionFlagsBits, MessageFlags, ChannelType } from 'discord.js';
import { setLoggingChannel, getLoggingStatus, EVENT_TYPES } from '../../services/loggingService.js';
import { getGuildConfig, updateGuildConfig } from '../../services/guildConfig.js';
import { successEmbed, infoEmbed } from '../../utils/embeds.js';
import { logger } from '../../utils/logger.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';

export default {
    data: new SlashCommandBuilder()
        .setName('logs')
        .setDescription('* Les logs sont envoyes en MP au proprietaire du bot. Definit un canal de secours')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
        .addChannelOption(option =>
            option.setName('channel')
                .setDescription('Canal textuel de secours, utilise seulement si le MP echoue')
                .setRequired(false)
                .addChannelTypes(ChannelType.GuildText))
        .addStringOption(option =>
            option.setName('exclusions')
                .setDescription('Vide la liste des utilisateurs/canaux ignores qui bloquent des logs')
                .setRequired(false)
                .addChoices(
                    { name: 'Vider les exclusions', value: 'clear' },
                    { name: 'Voir les exclusions', value: 'show' },
                )),

    category: 'settings',

    async execute(interaction, config, client) {
        const deferSuccess = await InteractionHelper.safeDefer(interaction, { flags: MessageFlags.Ephemeral });
        if (!deferSuccess) {
            logger.warn('Logs interaction defer failed', {
                userId: interaction.user.id,
                guildId: interaction.guildId,
                commandName: 'logs'
            });
            return;
        }

        if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
            return InteractionHelper.sendErrorNotice(interaction, 'Tu as besoin de la permission **Gérer le serveur** pour configurer les logs.');
        }

        const channel = interaction.options.getChannel('channel');
        const exclusionAction = interaction.options.getString('exclusions');

        try {
            if (exclusionAction) {
                const current = await getGuildConfig(client, interaction.guild.id);
                const ignore = current?.logIgnore || { users: [], channels: [] };
                const users = Array.isArray(ignore.users) ? ignore.users : [];
                const channels = Array.isArray(ignore.channels) ? ignore.channels : [];

                if (exclusionAction === 'clear') {
                    await updateGuildConfig(client, interaction.guild.id, {
                        logIgnore: { users: [], channels: [] }
                    });
                    return InteractionHelper.safeEditReply(interaction, {
                        embeds: [successEmbed(
                            `Exclusions vid\u{00E9}es : \`${users.length}\` utilisateur(s) et \`${channels.length}\` canal(aux) ne sont plus ignores. Tous les logs repartent.`,
                            '\u{1F5C2}\u{FE0F} Exclusions Vides'
                        )],
                        flags: MessageFlags.Ephemeral
                    });
                }

                const userList = users.length ? users.map(id => `<@${id}>`).join(', ') : '`aucun`';
                const channelList = channels.length ? channels.map(id => `<#${id}>`).join(', ') : '`aucun`';
                return InteractionHelper.safeEditReply(interaction, {
                    embeds: [infoEmbed(
                        `Utilisateurs ignores : ${userList}\nCanaux ignores : ${channelList}\n\nUn evenement concerning un utilisateur ou un salon de cette liste n est **jamais** logu\u{00E9}.`,
                        '\u{1F50D} Exclusions'
                    )],
                    flags: MessageFlags.Ephemeral
                });
            }

            if (channel) {
                if (channel.guildId !== interaction.guildId) {
                    return InteractionHelper.sendErrorNotice(interaction, `<#${channel.id}> n'est pas dans ce serveur.`);
                }

                const success = await setLoggingChannel(client, interaction.guild.id, channel.id);
                if (!success) {
                    return InteractionHelper.sendErrorNotice(interaction, 'Échec de la configuration du canal des logs. Veuillez réessayer.');
                }

                logger.info(`[Logs] Set logging channel to ${channel.name} (${channel.id}) in ${interaction.guild.name} (${interaction.guild.id}) by ${interaction.user.tag}`);

                await InteractionHelper.safeEditReply(interaction, {
                    embeds: [successEmbed(
                        `${channel} est désormais le **canal de secours** des logs. Les logs sont envoyes en **message prive au proprietaire du bot** ; ils ne tomberont dans ce salon que si le DM est impossible.\n\n${Object.keys(EVENT_TYPES).length} types d'evenements sont actifs (moderation, messages, roles, membres, tickets, giveaways, reaction roles, leveling...).`,
                        '\u{1F4DD} Logs Configures'
                    )],
                    flags: MessageFlags.Ephemeral
                });

                try {
                    await channel.send({
                        embeds: [successEmbed('Ce canal est desormais le **canal de secours** du bot. Les logs partent en message prive au proprietaire ; ce salon ne recoit les logs quen cas dechec du DM.', '\u{1F4DD} Canal de Secours Actif')]
                    });
                } catch {
                    logger.warn(`[Logs] Could not send confirmation in logs channel ${channel.id} (missing Send/Embed permissions?)`);
                }
                return;
            }

            const status = await getLoggingStatus(client, interaction.guild.id);

            const enabledCount = Object.values(EVENT_TYPES).filter(
                type => status.enabledEvents[type] !== false
            ).length;
            const totalCount = Object.keys(EVENT_TYPES).length;

            const currentConfig = await getGuildConfig(client, interaction.guild.id);
            const ignore = currentConfig?.logIgnore || { users: [], channels: [] };
            const ignoredUsers = Array.isArray(ignore.users) ? ignore.users : [];
            const ignoredChannels = Array.isArray(ignore.channels) ? ignore.channels : [];
            const hasExclusions = ignoredUsers.length > 0 || ignoredChannels.length > 0;

            const exclusionWarning = hasExclusions
                ? `\n\u{26A0}\u{FE0F} **Attention : ${ignoredUsers.length} utilisateur(s) et ${ignoredChannels.length} salon(s) sont exclus des logs.** Leurs evenements ne sont jamais envoy\u{00E9}s. Utilise \`/logs exclusions:Vider les exclusions\`.`
                : '';

            const fallbackLine = status.channelId
                ? (() => {
                    const ch = interaction.guild.channels.cache.get(status.channelId);
                    return `Canal de secours : ${ch ? ch.toString() : `\`${status.channelId}\``}.`;
                })()
                : 'Aucun canal de secours configure.';

            return InteractionHelper.safeEditReply(interaction, {
                embeds: [infoEmbed(
                    `Les logs sont envoyes en **message prive** aux proprietaires du bot.\n${fallbackLine}\n**${enabledCount}/${totalCount}** types d'evenements sont actifs.${exclusionWarning}`,
                    '\u{1F4DD} Statut des Logs'
                )],
                flags: MessageFlags.Ephemeral
            });
        } catch (error) {
            logger.error(`[Logs] Failed to configure logging for guild ${interaction.guild.id}:`, error);
            await InteractionHelper.sendErrorNotice(interaction, 'Une erreur est survenue lors de la configuration du canal des logs. Veuillez réessayer.');
        }
    }
};