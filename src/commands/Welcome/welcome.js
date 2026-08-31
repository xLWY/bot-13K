import { getColor } from '../../config/bot.js';
import { SlashCommandBuilder, PermissionFlagsBits, ChannelType, EmbedBuilder } from 'discord.js';
import { getWelcomeConfig, updateWelcomeConfig, removeWelcomeConfig } from '../../utils/database.js';
import { formatWelcomeMessage } from '../../utils/welcome.js';
import { logger } from '../../utils/logger.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';

export default {
    data: new SlashCommandBuilder()
        .setName('welcome')
        .setDescription('* Configurer le système de bienvenue')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
        .addSubcommand(subcommand =>
            subcommand
                .setName('setup')
                .setDescription('Configurer le message de bienvenue')
                .addChannelOption(option =>
                    option.setName('channel')
                        .setDescription('Le canal où envoyer les messages de bienvenue')
                        .addChannelTypes(ChannelType.GuildText)
                        .setRequired(true))
                .addStringOption(option =>
                    option.setName('message')
                        .setDescription('Message de bienvenue. Variables : {user}, {username}, {server}, {memberCount}')
                        .setRequired(true))
                .addStringOption(option =>
                    option.setName('image')
                        .setDescription('URL de l\'image à inclure dans le message de bienvenue')
                        .setRequired(false))
                .addBooleanOption(option =>
                    option.setName('ping')
                        .setDescription('Si l\'utilisateur doit être mentionné dans le message de bienvenue')
                        .setRequired(false))
                .addChannelOption(option =>
                    option.setName('pingchannel')
                        .setDescription('Salon où le membre est pingé à son arrivée (le ping se supprime tout seul)')
                        .addChannelTypes(ChannelType.GuildText)
                        .setRequired(false)))
        .addSubcommand(subcommand =>
            subcommand
                .setName('remove')
                .setDescription('Supprimer le système de bienvenue (rôles auto et au revoir conservés)')),

    async execute(interaction) {
        try {
            const deferSuccess = await InteractionHelper.safeDefer(interaction);
            if (!deferSuccess) {
                logger.warn(`Welcome interaction defer failed`, {
                    userId: interaction.user.id,
                    guildId: interaction.guildId,
                    commandName: 'welcome'
                });
                return;
            }
        } catch (deferError) {
            logger.error(`Welcome defer error`, { error: deferError.message });
            return;
        }

        const { options, guild, client } = interaction;

        if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
            return await InteractionHelper.sendErrorNotice(interaction, 'Tu as besoin de la permission **Gérer le serveur** pour utiliser `/welcome`.');
        }

        const subcommand = options.getSubcommand();

        if (subcommand === 'setup') {
            const channel = options.getChannel('channel');
            const message = options.getString('message');
            const image = options.getString('image');
            const ping = options.getBoolean('ping') ?? false;
            const pingChannel = options.getChannel('pingchannel');

            const existingConfig = await getWelcomeConfig(client, guild.id);
            if (existingConfig?.channelId) {
                logger.info(`[Welcome] Setup blocked because config already exists in channel ${existingConfig.channelId} for guild ${guild.id}`);
                return await InteractionHelper.sendErrorNotice(interaction, `La bienvenue est déjà configurée pour <#${existingConfig.channelId}>. Utilise **/welcome remove** puis **/welcome setup** pour la reconfigurer.`);
            }
            
            if (!message || message.trim().length === 0) {
                logger.warn(`[Welcome] Empty message provided by ${interaction.user.tag} in ${guild.name}`);
                return await InteractionHelper.sendErrorNotice(interaction, 'Le message de bienvenue ne peut pas être vide');
            }

            
            if (image) {
                try {
                    new URL(image);
                } catch (e) {
                    logger.warn(`[Welcome] Invalid image URL provided by ${interaction.user.tag}: ${image}`);
                    return await InteractionHelper.sendErrorNotice(interaction, "Veuillez fournir une URL d'image valide (doit commencer par http:// ou https://)");
                }
            }

            try {
                await updateWelcomeConfig(client, guild.id, {
                    enabled: true,
                    channelId: channel.id,
                    welcomeMessage: message,
                    welcomeImage: image || undefined,
                    welcomePing: ping,
                    pingChannelId: pingChannel?.id || null
                });

                logger.info(`[Welcome] Setup configured by ${interaction.user.tag} for guild ${guild.name} (${guild.id})`);

                const previewMessage = formatWelcomeMessage(message, {
                    user: interaction.user,
                    guild
                });

                const embed = new EmbedBuilder()
                    .setColor(getColor('success'))
                    .setTitle('✅ Système de bienvenue configuré')
                    .setDescription(`Les messages de bienvenue seront désormais envoyés dans ${channel}`)
                    .addFields(
                        { name: 'Aperçu du message', value: previewMessage },
                        { name: 'Mentionner l\'utilisateur', value: ping ? '✅ Oui' : '❌ Non' },
                        { name: 'Salon de ping auto-supprimé', value: pingChannel ? `${pingChannel} (le ping disparaît tout seul)` : '❌ Non configuré' },
                        { name: 'Statut', value: '✅ Activé' }
                    )
                    .setFooter({ text: 'Astuce : utilise /welcome remove pour supprimer le système de bienvenue' });

                if (image) {
                    embed.setImage(image);
                }

                await InteractionHelper.safeEditReply(interaction, { embeds: [embed] });
            } catch (error) {
                logger.error(`[Welcome] Failed to setup welcome system for guild ${guild.id}:`, error);
                return await InteractionHelper.sendErrorNotice(interaction, 'Une erreur est survenue lors de la configuration du système de bienvenue. Veuillez réessayer.');
            }
        } else if (subcommand === 'remove') {
            const existingConfig = await getWelcomeConfig(client, guild.id);
            if (!existingConfig?.channelId && !existingConfig?.pingChannelId) {
                return await InteractionHelper.sendErrorNotice(interaction, 'Aucun système de bienvenue ne semble configuré pour ce serveur.');
            }

            try {
                await removeWelcomeConfig(client, guild.id);
                logger.info(`[Welcome] Removed by ${interaction.user.tag} for guild ${guild.name} (${guild.id})`);

                await InteractionHelper.safeEditReply(interaction, {
                    embeds: [new EmbedBuilder()
                        .setColor(getColor('success'))
                        .setTitle('🗑️ Système de bienvenue supprimé')
                        .setDescription('Les messages de bienvenue sont désactivés. Les rôles auto (`/autorole`) et les au revoir (`/goodbye`) sont conservés.')]
                });
            } catch (error) {
                logger.error(`[Welcome] Failed to remove welcome system for guild ${guild.id}:`, error);
                return await InteractionHelper.sendErrorNotice(interaction, 'Une erreur est survenue lors de la suppression du système de bienvenue. Veuillez réessayer.');
            }
        }
    },
};



