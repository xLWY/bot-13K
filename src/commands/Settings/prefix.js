import { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } from 'discord.js';
import { getGuildConfig, setConfigValue } from '../../services/guildConfig.js';
import { errorEmbed, successEmbed } from '../../utils/embeds.js';
import { logger } from '../../utils/logger.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';

const MAX_PREFIX_LENGTH = 5;

export default {
    data: new SlashCommandBuilder()
        .setName('prefix')
        .setDescription('View or change this server\'s command prefix')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
        .addStringOption(option =>
            option.setName('prefix')
                .setDescription('The new prefix to use (e.g. !, ., ?)')
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
            return InteractionHelper.safeEditReply(interaction, {
                embeds: [errorEmbed('You need the **Manage Server** permission to use `/prefix`.')],
                flags: MessageFlags.Ephemeral
            });
        }

        const { guild, options } = interaction;
        const newPrefix = options.getString('prefix');

        try {
            if (!newPrefix) {
                const guildConfig = await getGuildConfig(client, guild.id);
                const currentPrefix = guildConfig.prefix || '!';

                return await InteractionHelper.safeEditReply(interaction, {
                    embeds: [successEmbed(`The current prefix for this server is \`${currentPrefix}\``, 'ℹ️ Current Prefix')],
                    flags: MessageFlags.Ephemeral
                });
            }

            const trimmedPrefix = newPrefix.trim();

            if (trimmedPrefix.length === 0) {
                return InteractionHelper.safeEditReply(interaction, {
                    embeds: [errorEmbed('The prefix cannot be empty or only whitespace.')],
                    flags: MessageFlags.Ephemeral
                });
            }

            if (trimmedPrefix.length > MAX_PREFIX_LENGTH) {
                return InteractionHelper.safeEditReply(interaction, {
                    embeds: [errorEmbed(`The prefix cannot be longer than ${MAX_PREFIX_LENGTH} characters.`)],
                    flags: MessageFlags.Ephemeral
                });
            }

            if (/\s/.test(trimmedPrefix)) {
                return InteractionHelper.safeEditReply(interaction, {
                    embeds: [errorEmbed('The prefix cannot contain spaces.')],
                    flags: MessageFlags.Ephemeral
                });
            }

            await setConfigValue(client, guild.id, 'prefix', trimmedPrefix);

            logger.info(`[Prefix] Set prefix to "${trimmedPrefix}" in ${guild.name} (${guild.id}) by ${interaction.user.tag}`);

            await InteractionHelper.safeEditReply(interaction, {
                embeds: [successEmbed(`The server prefix has been updated to \`${trimmedPrefix}\``)],
                flags: MessageFlags.Ephemeral
            });
        } catch (error) {
            logger.error(`[Prefix] Failed to update prefix for guild ${guild.id}:`, error);
            await InteractionHelper.safeEditReply(interaction, {
                embeds: [errorEmbed('An error occurred while updating the prefix. Please try again.', error, { showDetails: true })],
                flags: MessageFlags.Ephemeral
            });
        }
    }
};
