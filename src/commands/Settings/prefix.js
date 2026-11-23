import { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } from 'discord.js';
import { getGuildConfig, setConfigValue } from '../../services/guildConfig.js';
import { logger } from '../../utils/logger.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { isBotOwner } from '../../utils/ownerIds.js';
import { createEmbed, errorEmbed, successEmbed } from '../../utils/embeds.js';
import { brandFooter } from '../../ui/kit.js';

const MAX_PREFIX_LENGTH = 5;
const NO_MENTIONS = { parse: [], repliedUser: false };
const FOOTER_CONTEXT = 'Préfixe du serveur';

function errorReply(interaction, message) {
    const embed = errorEmbed(message);
    embed.setFooter(brandFooter(FOOTER_CONTEXT));
    return InteractionHelper.safeEditReply(interaction, {
        embeds: [embed],
        allowedMentions: NO_MENTIONS,
        flags: MessageFlags.Ephemeral,
    });
}

export default {
    data: new SlashCommandBuilder()
        .setName('prefix')
        .setDescription('Voir ou modifier le préfixe de commande de ce serveur')
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

        if (!isBotOwner(interaction.user.id) && !interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
            return errorReply(interaction, 'Tu as besoin de la permission **Gérer le serveur** pour utiliser `/prefix`.');
        }

        const { guild, options } = interaction;
        const newPrefix = options.getString('prefix');

        try {
            if (!newPrefix) {
                const guildConfig = await getGuildConfig(client, guild.id);
                const currentPrefix = guildConfig.prefix;
                const embed = createEmbed({
                    title: '⌨️ Préfixe du serveur',
                    description: 'Utilise `/prefix <nouveau>` pour le modifier, ou tape une commande préfixée pour l’essayer.',
                    color: 'info',
                    fields: [{ name: 'Préfixe actuel', value: `\`${currentPrefix}\`` }],
                    footer: brandFooter(FOOTER_CONTEXT),
                });
                return await InteractionHelper.safeEditReply(interaction, {
                    embeds: [embed],
                    allowedMentions: NO_MENTIONS,
                    flags: MessageFlags.Ephemeral,
                });
            }

            const trimmedPrefix = newPrefix.trim();

            if (trimmedPrefix.length === 0) {
                return errorReply(interaction, 'Le préfixe ne peut pas être vide ou ne contenir que des espaces.');
            }

            if (trimmedPrefix.length > MAX_PREFIX_LENGTH) {
                return errorReply(interaction, `Le préfixe ne peut pas dépasser ${MAX_PREFIX_LENGTH} caractères.`);
            }

            if (/\s/.test(trimmedPrefix)) {
                return errorReply(interaction, 'Le préfixe ne peut pas contenir d’espaces.');
            }

            await setConfigValue(client, guild.id, 'prefix', trimmedPrefix);

            logger.info(`[Prefix] Set prefix to "${trimmedPrefix}" in ${guild.name} (${guild.id}) by ${interaction.user.tag}`);

            const embed = successEmbed('Le nouveau préfixe est actif pour les commandes préfixées.', '✅ Préfixe mis à jour');
            embed.addFields({ name: 'Nouveau préfixe', value: `\`${trimmedPrefix}\``, inline: true });
            embed.setFooter(brandFooter(FOOTER_CONTEXT));
            await InteractionHelper.safeEditReply(interaction, {
                embeds: [embed],
                allowedMentions: NO_MENTIONS,
                flags: MessageFlags.Ephemeral,
            });
        } catch (error) {
            logger.error(`[Prefix] Failed to update prefix for guild ${guild.id}:`, error);
            await errorReply(interaction, 'Une erreur est survenue lors de la mise à jour du préfixe. Réessaie dans un instant.');
        }
    }
};
