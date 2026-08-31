import { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } from 'discord.js';
import { getGuildConfig, setConfigValue } from '../../services/guildConfig.js';
import { successEmbed } from '../../utils/embeds.js';
import { logger } from '../../utils/logger.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';

const MAX_PREFIX_LENGTH = 5;

export default {
    data: new SlashCommandBuilder()
        .setName('prefix')
        .setDescription('* Voir ou modifier le préfixe de commande de ce serveur')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
        .addStringOption(option =>
            option.setName('prefix')
                .setDescription('Le nouveau préfixe à utiliser (ex : !, ., ?)')
                .setRequired(false)
                .setMaxLength(MAX_PREFIX_LENGTH)),

    category: 'settings',

    async execute(interaction, config, client) {
        const deferSuccess = await InteractionHelper.safeDefer(interaction, { flags: MessageFlags.Ephemeral });
        if (!deferSuccess) {
            logger.warn('Prefix interaction defer failed', {
                userId: interaction.user.id,
                guildId: interaction.guildId,
                commandName: 'prefix'
            });
            return;
        }

        if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
            return InteractionHelper.sendErrorNotice(interaction, 'Tu as besoin de la permission **Gérer le serveur** pour utiliser `/prefix`.');
        }

        const { guild, options } = interaction;
        const newPrefix = options.getString('prefix');

        try {
            if (!newPrefix) {
                const guildConfig = await getGuildConfig(client, guild.id);
                const currentPrefix = guildConfig.prefix || '!';

                return await InteractionHelper.safeEditReply(interaction, {
                    embeds: [successEmbed(`Le préfixe actuel de ce serveur est \`${currentPrefix}\``, 'ℹ️ Préfixe actuel')],
                    flags: MessageFlags.Ephemeral
                });
            }

            const trimmedPrefix = newPrefix.trim();

            if (trimmedPrefix.length === 0) {
                return InteractionHelper.sendErrorNotice(interaction, 'Le préfixe ne peut pas être vide ou ne contenir que des espaces.');
            }

            if (trimmedPrefix.length > MAX_PREFIX_LENGTH) {
                return InteractionHelper.sendErrorNotice(interaction, `Le préfixe ne peut pas dépasser ${MAX_PREFIX_LENGTH} caractères.`);
            }

            if (/\s/.test(trimmedPrefix)) {
                return InteractionHelper.sendErrorNotice(interaction, 'Le préfixe ne peut pas contenir d\'espaces.');
            }

            await setConfigValue(client, guild.id, 'prefix', trimmedPrefix);

            logger.info(`[Prefix] Set prefix to "${trimmedPrefix}" in ${guild.name} (${guild.id}) by ${interaction.user.tag}`);

            await InteractionHelper.safeEditReply(interaction, {
                embeds: [successEmbed(`Le préfixe du serveur a été mis à jour en \`${trimmedPrefix}\``)],
                flags: MessageFlags.Ephemeral
            });
        } catch (error) {
            logger.error(`[Prefix] Failed to update prefix for guild ${guild.id}:`, error);
            await InteractionHelper.sendErrorNotice(interaction, 'Une erreur est survenue lors de la mise à jour du préfixe. Veuillez réessayer.');
        }
    }
};
