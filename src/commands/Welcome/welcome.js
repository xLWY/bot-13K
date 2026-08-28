import { getColor } from '../../config/bot.js';
import { SlashCommandBuilder, PermissionFlagsBits, ChannelType, EmbedBuilder, MessageFlags } from 'discord.js';
import { errorEmbed } from '../../utils/embeds.js';
import { getWelcomeConfig, updateWelcomeConfig } from '../../utils/database.js';
import { formatWelcomeMessage } from '../../utils/welcome.js';
import { logger } from '../../utils/logger.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';

export default {
    data: new SlashCommandBuilder()
        .setName('welcome')
        .setDescription('Configurer le système de bienvenue')
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
                        .setDescription('Message de bienvenue. Variables: {user}, {username}, {server}, {memberCount}')
                        .setRequired(true))
                .addStringOption(option =>
                    option.setName('image')
                        .setDescription('URL de l\'image à inclure dans le message de bienvenue')
                        .setRequired(false))
                .addBooleanOption(option =>
                    option.setName('ping')
                        .setDescription('Whether to ping the user in the welcome message')
                        .setRequired(false))),

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
            return await InteractionHelper.safeEditReply(interaction, {
                embeds: [errorEmbed('Missing Permissions', 'You need the **Manage Server** permission to use `/welcome`.')],
                flags: MessageFlags.Ephemeral
            });
        }

        const subcommand = options.getSubcommand();

        if (subcommand === 'setup') {
            const channel = options.getChannel('channel');
            const message = options.getString('message');
            const image = options.getString('image');
            const ping = options.getBoolean('ping') ?? false;

            const existingConfig = await getWelcomeConfig(client, guild.id);
            if (existingConfig?.channelId) {
                logger.info(`[Welcome] Setup blocked because config already exists in channel ${existingConfig.channelId} for guild ${guild.id}`);
                return await InteractionHelper.safeEditReply(interaction, {
                    embeds: [errorEmbed(
                        'Welcome Setup Already Exists',
                        `Welcome is already configured for <#${existingConfig.channelId}>. Use **/welcome config** to customize channel, message, ping, or image.`
                    )],
                    flags: MessageFlags.Ephemeral
                });
            }
            
            if (!message || message.trim().length === 0) {
                logger.warn(`[Welcome] Empty message provided by ${interaction.user.tag} in ${guild.name}`);
                return await InteractionHelper.safeEditReply(interaction, {
                    embeds: [errorEmbed('Invalid Input', 'Welcome message cannot be empty')],
                    flags: MessageFlags.Ephemeral
                });
            }

            
            if (image) {
                try {
                    new URL(image);
                } catch (e) {
                    logger.warn(`[Welcome] Invalid image URL provided by ${interaction.user.tag}: ${image}`);
                    return await InteractionHelper.safeEditReply(interaction, {
                        embeds: [errorEmbed('Invalid Image URL', 'Please provide a valid image URL (must start with http:// or https://')],
                        flags: MessageFlags.Ephemeral
                    });
                }
            }

            try {
                await updateWelcomeConfig(client, guild.id, {
                    enabled: true,
                    channelId: channel.id,
                    welcomeMessage: message,
                    welcomeImage: image || undefined,
                    welcomePing: ping
                });

                logger.info(`[Welcome] Setup configured by ${interaction.user.tag} for guild ${guild.name} (${guild.id})`);

                const previewMessage = formatWelcomeMessage(message, {
                    user: interaction.user,
                    guild
                });

                const embed = new EmbedBuilder()
                    .setColor(getColor('success'))
                    .setTitle('✅ Welcome System Configured')
                    .setDescription(`Welcome messages will now be sent to ${channel}`)
                    .addFields(
                        { name: 'Message Preview', value: previewMessage },
                        { name: 'Ping User', value: ping ? '✅ Yes' : '❌ No' },
                        { name: 'Status', value: '✅ Enabled' }
                    )
                    .setFooter({ text: 'Tip: Use /welcome config to customize welcome settings' });

                if (image) {
                    embed.setImage(image);
                }

                await InteractionHelper.safeEditReply(interaction, { embeds: [embed] });
            } catch (error) {
                logger.error(`[Welcome] Failed to setup welcome system for guild ${guild.id}:`, error);
                await InteractionHelper.safeEditReply(interaction, {
                    embeds: [errorEmbed(
                        'Setup Failed',
                        'An error occurred while configuring the welcome system. Please try again.',
                        { showDetails: true }
                    )],
                    flags: MessageFlags.Ephemeral
                });
            }
        }
    },
};



