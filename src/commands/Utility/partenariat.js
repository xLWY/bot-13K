import {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ChannelType,
    ComponentType,
    MessageFlags,
    PermissionFlagsBits,
    SlashCommandBuilder,
} from 'discord.js';
import { getColor } from '../../config/bot.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { createEmbed, warningEmbed } from '../../utils/embeds.js';
import { findDiscordInvites } from '../../utils/linkFilter.js';
import { logger } from '../../utils/logger.js';

const CONFIRM_TIME_MS = 2 * 60 * 1000;
const PARTNER_ROLE_NAMES = new Set([
    'partenariat',
    'partenariats',
    'partenaire',
    'partenaires',
]);

function normalizeRoleName(value) {
    return String(value || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '');
}

function findPartnerRole(guild) {
    return guild.roles.cache.find(role => PARTNER_ROLE_NAMES.has(normalizeRoleName(role.name))) ?? null;
}

function parseColor(value) {
    const raw = String(value || '').trim().replace(/^#/, '');
    if (!/^[0-9a-f]{6}$/i.test(raw)) return null;
    return Number.parseInt(raw, 16);
}

function isValidHttpUrl(value) {
    try {
        const url = new URL(value);
        return url.protocol === 'http:' || url.protocol === 'https:';
    } catch {
        return false;
    }
}

function resolveMention(interaction, mode) {
    if (mode === 'everyone') {
        return {
            mode,
            content: '@everyone',
            label: '`@everyone`',
            allowedMentions: { parse: ['everyone'] },
        };
    }

    if (mode === 'partenariat') {
        const role = interaction.options.getRole('role') ?? findPartnerRole(interaction.guild);

        if (!role) {
            return {
                error: 'Je ne trouve pas le rôle **@partenariat**. Crée un rôle avec ce nom ou choisis **Aucune mention**.',
            };
        }

        if (role.id === interaction.guild.id) {
            return {
                error: 'Pour mentionner tout le monde, choisis la mention **@everyone** au lieu du rôle @everyone.',
            };
        }

        return {
            mode,
            role,
            content: `<@&${role.id}>`,
            label: `\`@${role.name}\``,
            allowedMentions: { parse: [], roles: [role.id] },
        };
    }

    return {
        mode: 'none',
        content: null,
        label: 'Aucune',
        allowedMentions: { parse: [] },
    };
}

function buildPartnerEmbed({ title, text, inviteUrl, color, image }) {
    const embed = createEmbed({
        title: title || '🤝 Partenariat',
        description: text,
        color: color ?? getColor('info'),
        image: image || null,
        footer: 'Partenariat • xlwy bot',
        timestamp: true,
    });

    embed.addFields({
        name: '🔗 Serveur partenaire',
        value: `[Rejoindre le serveur](${inviteUrl})`,
        inline: false,
    });

    return embed;
}

function buildConfirmationRow() {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('partenariat_send')
            .setLabel('Envoyer')
            .setEmoji('📨')
            .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
            .setCustomId('partenariat_cancel')
            .setLabel('Annuler')
            .setEmoji('❌')
            .setStyle(ButtonStyle.Secondary),
    );
}

async function replyWithWarning(interaction, message, title = '⚠️ Partenariat') {
    await InteractionHelper.safeEditReply(interaction, {
        embeds: [warningEmbed(message, title)],
    });
}

export default {
    data: new SlashCommandBuilder()
        .setName('partenariat')
        .setDescription('* Créer et publier une annonce de partenariat')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
        .setDMPermission(false)
        .addStringOption(option =>
            option
                .setName('lien')
                .setDescription('Lien d’invitation du serveur Discord partenaire')
                .setRequired(true)
                .setMaxLength(500),
        )
        .addStringOption(option =>
            option
                .setName('texte')
                .setDescription('Texte de présentation du partenariat')
                .setRequired(true)
                .setMaxLength(4000),
        )
        .addStringOption(option =>
            option
                .setName('mention')
                .setDescription('Qui mentionner lors de la publication ?')
                .setRequired(false)
                .addChoices(
                    { name: '@everyone', value: 'everyone' },
                    { name: '@partenariat', value: 'partenariat' },
                    { name: 'Aucune mention', value: 'none' },
                ),
        )
        .addRoleOption(option =>
            option
                .setName('role')
                .setDescription('Rôle personnalisé à mentionner à la place de @partenariat')
                .setRequired(false),
        )
        .addStringOption(option =>
            option
                .setName('titre')
                .setDescription('Titre de l’embed (par défaut : 🤝 Partenariat)')
                .setRequired(false)
                .setMaxLength(256),
        )
        .addStringOption(option =>
            option
                .setName('couleur')
                .setDescription('Couleur de l’embed en hexadécimal (ex : #8B5CF6)')
                .setRequired(false)
                .setMaxLength(20),
        )
        .addStringOption(option =>
            option
                .setName('image')
                .setDescription('URL d’une image à afficher dans l’embed')
                .setRequired(false)
                .setMaxLength(500),
        )
        .addChannelOption(option =>
            option
                .setName('salon')
                .setDescription('Salon où publier le partenariat (par défaut : salon actuel)')
                .setRequired(false)
                .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement),
        ),

    category: 'utility',

    async execute(interaction) {
        const deferred = await InteractionHelper.safeDefer(interaction, {
            flags: MessageFlags.Ephemeral,
        });
        if (!deferred) return;

        try {
            if (!interaction.guild) {
                await replyWithWarning(interaction, 'Cette commande doit être utilisée dans un serveur.');
                return;
            }

            const inviteInput = interaction.options.getString('lien', true);
            const text = interaction.options.getString('texte', true).trim();
            const title = interaction.options.getString('titre')?.trim() || '🤝 Partenariat';
            const colorInput = interaction.options.getString('couleur')?.trim() || null;
            const image = interaction.options.getString('image')?.trim() || null;
            const mentionMode = interaction.options.getString('mention') || 'partenariat';

            if (!text) {
                await replyWithWarning(interaction, 'Le texte du partenariat ne peut pas être vide.');
                return;
            }

            const invites = findDiscordInvites(inviteInput);
            if (invites.length === 0) {
                await replyWithWarning(
                    interaction,
                    'Le lien fourni n’est pas une invitation Discord valide. Utilise un lien comme `https://discord.gg/...`.',
                );
                return;
            }

            const color = colorInput ? parseColor(colorInput) : null;
            if (colorInput && color === null) {
                await replyWithWarning(
                    interaction,
                    'Couleur invalide. Utilise un format hexadécimal comme `#8B5CF6`.',
                );
                return;
            }

            if (image && !isValidHttpUrl(image)) {
                await replyWithWarning(
                    interaction,
                    'L’URL de l’image est invalide. Utilise une adresse `https://...`.',
                );
                return;
            }

            const mention = resolveMention(interaction, mentionMode);
            if (mention.error) {
                await replyWithWarning(interaction, mention.error);
                return;
            }

            const memberPermissions = interaction.memberPermissions;
            if (mention.mode === 'everyone' && !memberPermissions?.has(PermissionFlagsBits.MentionEveryone)) {
                await replyWithWarning(
                    interaction,
                    'Tu dois avoir la permission **Mentionner @everyone** pour utiliser cette mention.',
                );
                return;
            }

            if (
                mention.role &&
                !mention.role.mentionable &&
                !memberPermissions?.has(PermissionFlagsBits.MentionEveryone)
            ) {
                await replyWithWarning(
                    interaction,
                    `Le rôle <@&${mention.role.id}> n’est pas mentionnable. Tu dois avoir la permission **Mentionner @everyone** pour le ping.`,
                );
                return;
            }

            const targetChannel = interaction.options.getChannel('salon') ?? interaction.channel;
            if (!targetChannel?.isTextBased?.() || targetChannel.type === ChannelType.GuildForum) {
                await replyWithWarning(interaction, 'Le salon choisi n’est pas un salon texte valide.');
                return;
            }

            const botPermissions = targetChannel.permissionsFor(interaction.guild.members.me);
            const missingPermissions = [];
            if (!botPermissions?.has(PermissionFlagsBits.ViewChannel)) missingPermissions.push('Voir le salon');
            if (!botPermissions?.has(PermissionFlagsBits.SendMessages)) missingPermissions.push('Envoyer des messages');
            if (!botPermissions?.has(PermissionFlagsBits.EmbedLinks)) missingPermissions.push('Intégrer des liens');
            if (
                (mention.mode === 'everyone' ||
                    (mention.role && !mention.role.mentionable)) &&
                !botPermissions?.has(PermissionFlagsBits.MentionEveryone)
            ) {
                missingPermissions.push('Mentionner @everyone');
            }

            if (missingPermissions.length > 0) {
                await replyWithWarning(
                    interaction,
                    `Le bot n’a pas les permissions suivantes dans ${targetChannel} : **${missingPermissions.join(', ')}**.`,
                    '⚠️ Permissions manquantes',
                );
                return;
            }

            const embed = buildPartnerEmbed({
                title,
                text,
                inviteUrl: invites[0].url,
                color,
                image,
            });

            await InteractionHelper.safeEditReply(interaction, {
                content: `**Mention prévue :** ${mention.label}\n**Salon :** ${targetChannel}`,
                embeds: [embed],
                components: [buildConfirmationRow()],
            });

            const previewMessage = await interaction.fetchReply().catch(() => null);
            if (!previewMessage) {
                await replyWithWarning(interaction, 'Impossible de préparer l’aperçu du partenariat.');
                return;
            }

            const confirmation = await previewMessage
                .awaitMessageComponent({
                    componentType: ComponentType.Button,
                    filter: button =>
                        button.user.id === interaction.user.id &&
                        ['partenariat_send', 'partenariat_cancel'].includes(button.customId),
                    time: CONFIRM_TIME_MS,
                })
                .catch(() => null);

            if (!confirmation) {
                await previewMessage.edit({
                    content: '⌛ L’aperçu a expiré. Relance `/partenariat` pour recommencer.',
                    embeds: [],
                    components: [],
                }).catch(() => {});
                return;
            }

            if (confirmation.customId === 'partenariat_cancel') {
                await confirmation.update({
                    content: '❌ Publication du partenariat annulée.',
                    embeds: [],
                    components: [],
                }).catch(() => {});
                return;
            }

            await confirmation.deferUpdate().catch(() => {});

            try {
                const sentMessage = await targetChannel.send({
                    content: mention.content || undefined,
                    embeds: [embed],
                    allowedMentions: mention.allowedMentions,
                });

                await previewMessage.edit({
                    content: `✅ Partenariat publié dans ${targetChannel}.` +
                        (sentMessage?.url ? `\n[Voir le message](${sentMessage.url})` : ''),
                    embeds: [],
                    components: [],
                }).catch(() => {});
            } catch (error) {
                logger.error('Partnership publication failed:', error);
                await previewMessage.edit({
                    content: '❌ Impossible de publier le partenariat. Vérifie les permissions du bot dans ce salon.',
                    embeds: [],
                    components: [],
                }).catch(() => {});
            }
        } catch (error) {
            logger.error('Partnership command failed:', error);
            await replyWithWarning(
                interaction,
                'Une erreur est survenue pendant la création du partenariat.',
                '❌ Erreur',
            ).catch(() => {});
        }
    },
};
